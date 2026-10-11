import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, holdings, trades, transactions, planSubscriptions, plans, notifications } from "@/db/schema";
import { desc, eq, and, sql, gt, isNull, asc } from "drizzle-orm";
import { getUser, createDemoUser, setSession, clearSession } from "@/lib/auth";
import { getAsset, marketPrice } from "@/lib/market";
import { getMarketSnapshot } from "@/lib/market-server";
import { blockedActionMessage, tradeLimitMessage } from "@/lib/accounts";
import { executeSpotFill, reservedBuyCash, reservedSellQuantity, sweepForUser } from "@/lib/trading-engine";
import { getFxRate } from "@/lib/fx-server";
import { notifyUser } from "@/lib/notify";
import { DEFAULT_PLAN_SUBSCRIPTION_MS } from "@/lib/subscriptions";

// Every user should always have a plan - if they've never subscribed to
// anything (brand new account, legacy account from before this feature, or
// a freshly-minted demo user), silently enroll them in the cheapest active
// plan (expected to be a $0 "Starter"-style free tier) so the UI never has
// to show a "No active plan" dead end. No-ops if no active plan exists yet.
async function ensureDefaultPlan(userId: string) {
  const [cheapest] = await db.select().from(plans).where(eq(plans.isActive, true)).orderBy(asc(plans.priceWeekly), asc(plans.sortOrder)).limit(1);
  if (!cheapest || Number(cheapest.priceWeekly) !== 0) return null; // no free tier configured - nothing to default to
  const now = new Date();
  const expiresAt = new Date(now.getTime() + DEFAULT_PLAN_SUBSCRIPTION_MS);
  await db.insert(planSubscriptions).values({ userId, planId: cheapest.id, amount: "0.00", startedAt: now, expiresAt });
  return { planName: cheapest.name, expiresAt, amount: "0.00" };
}

export const dynamic = "force-dynamic";
const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

export async function GET(request: NextRequest) {
  try {
    let user = await getUser(request);
    // A locked account can't be used even with a still-valid session cookie
    // - kill the session and tell the client, instead of silently handing
    // them a fresh demo workspace.
    if (user && user.accountStatus === "locked") {
      return await clearSession(request, NextResponse.json({ error: "This account has been locked. Contact support for help.", locked: true }, { status: 403 }));
    }
    let fresh = false;
    if (!user) { user = await createDemoUser(); fresh = true; }
    if (!fresh) {
      // Make sure this user's own pending orders/leverage positions are
      // evaluated against the latest live prices right when their
      // dashboard loads, so fills/closes feel instant even between the
      // periodic global sweep (see /api/market) runs.
      try {
        const market = await getMarketSnapshot();
        if (market.status === "live") {
          const prices: Record<string, number> = {};
          for (const asset of market.assets) prices[asset.symbol] = asset.price;
          await sweepForUser(prices, user.id);
        }
      } catch (error) { console.error("App GET sweep:", error); }
    }
    const [h, t, tx, currentPlan, notifRows, unreadCount, fx] = await Promise.all([
      db.select().from(holdings).where(eq(holdings.userId, user.id)),
      db.select().from(trades).where(eq(trades.userId, user.id)).orderBy(desc(trades.createdAt)).limit(50),
      db.select().from(transactions).where(eq(transactions.userId, user.id)).orderBy(desc(transactions.createdAt)).limit(50),
      db.select({ planName: plans.name, expiresAt: planSubscriptions.expiresAt, amount: planSubscriptions.amount })
        .from(planSubscriptions)
        .innerJoin(plans, eq(planSubscriptions.planId, plans.id))
        .where(and(eq(planSubscriptions.userId, user.id), gt(planSubscriptions.expiresAt, new Date())))
        .orderBy(desc(planSubscriptions.startedAt))
        .limit(1),
      db.select().from(notifications).where(eq(notifications.userId, user.id)).orderBy(desc(notifications.createdAt)).limit(20),
      db.select({ count: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.userId, user.id), isNull(notifications.readAt))),
      // Display-only FX rate for this user's chosen currency; the ledger
      // below (cashBalance, trades, transactions) always stays in USD.
      getFxRate(user.currency ?? "USD"),
    ]);
    let plan = currentPlan[0];
    if (!plan) {
      const defaulted = await ensureDefaultPlan(user.id);
      if (defaulted) plan = defaulted;
    }
    const response = NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        username: user.username,
        isDemo: user.isDemo,
        role: user.role,
        cashBalance: Number(user.cashBalance),
        profitBalance: Number(user.profitBalance),
        accountStatus: user.accountStatus,
        maxTradeAmount: user.maxTradeAmount == null ? null : Number(user.maxTradeAmount),
        withdrawalsBlocked: user.withdrawalsBlocked,
        statusReason: user.statusReason,
        profilePhoto: user.profilePhoto,
        currency: user.currency ?? "USD",
        language: user.language ?? "en",
      },
      holdings: h,
      trades: t,
      transactions: tx,
      plan: plan?.planName ?? null,
      planExpiresAt: plan?.expiresAt ?? null,
      planAmount: plan ? Number(plan.amount) : null,
      notifications: notifRows,
      unreadNotifications: unreadCount[0]?.count ?? 0,
      fx: { currency: user.currency ?? "USD", rate: fx.rate, status: fx.status, updatedAt: fx.updatedAt },
    });
    if (fresh) await setSession(response, user.id);
    return response;
  } catch (error) { console.error("App GET:", error); return bad("Unable to load your workspace. Please try again.", 500); }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getUser(request);
    if (!user) return bad("Session expired. Please refresh the page.", 401);
    const body = await request.json();
    const action = String(body.action ?? "");

    if (action === "trade") {
      const blocked = blockedActionMessage(user, "trade");
      if (blocked) return bad(blocked, 403);
      const symbol = String(body.symbol ?? "").toUpperCase();
      const side = body.side;
      const quantity = Number(body.quantity);
      if (!getAsset(symbol) || !["buy", "sell"].includes(side) || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1000000 || quantity.toString().split(".")[1]?.length > 8) return bad("Enter a valid trade quantity.");
      const market = await getMarketSnapshot();
      const asset = market.assets.find((item) => item.symbol === symbol);
      if (market.status !== "live" || !asset || asset.price <= 0) return bad("Live market pricing is unavailable. Paper trading is paused until prices recover.", 503);
      const total = Math.round(quantity * asset.price * 100) / 100;
      if (total < 0.01) return bad("Minimum trade value is $0.01.");
      const limitMsg = tradeLimitMessage(user, total);
      if (limitMsg) return bad(limitMsg, 403);
      await db.transaction(async (tx) => {
        // Respect quantity/cash already committed to the user's other open
        // limit/stop-loss/take-profit orders, so a market trade can't spend
        // funds or an asset balance that's reserved for a pending order.
        if (side === "buy") {
          const [wallet] = await tx.select().from(users).where(eq(users.id, user.id)).for("update");
          const reserved = await reservedBuyCash(tx, user.id);
          if (total > Number(wallet.cashBalance) - reserved + 0.0001) {
            throw new Error(reserved > 0 ? `Insufficient available balance — $${reserved.toFixed(2)} is already committed to open buy orders.` : "Insufficient available balance.");
          }
        } else {
          const [existing] = await tx.select().from(holdings).where(and(eq(holdings.userId, user.id), eq(holdings.symbol, symbol))).for("update");
          const reserved = await reservedSellQuantity(tx, user.id, symbol);
          const available = (existing ? Number(existing.quantity) : 0) - reserved;
          if (quantity > available + 0.00000001) {
            throw new Error(reserved > 0 ? `Insufficient available ${symbol} — ${reserved} is already committed to open sell orders.` : "Insufficient asset balance.");
          }
        }
        await executeSpotFill(tx, user.id, symbol, side, quantity, asset.price);
      });
      // blockedActionMessage() above already rules out demo accounts, so
      // every notification from here on is for a real, registered user.
      await notifyUser({
        userId: user.id,
        type: "trade_placed",
        title: `${side === "buy" ? "Bought" : "Sold"} ${symbol}`,
        message: `${side === "buy" ? "Bought" : "Sold"} ${quantity} ${symbol} at ${marketPrice(asset.price)} for a total of $${total.toFixed(2)}.`,
      });
      return NextResponse.json({ success: true, price: asset.price, total, message: `${side === "buy" ? "Bought" : "Sold"} ${quantity} ${symbol} at ${marketPrice(asset.price)}` });
    }
    if (action === "markNotificationsRead") {
      await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));
      return NextResponse.json({ success: true });
    }
    if (action === "withdrawal") return bad("Withdrawals now require admin review. Go to Withdraw to get started.");
    if (action === "deposit") return bad("Deposits now require submitting a payment receipt for admin review. Go to Deposit to get started.");
    if (action === "createBot" || action === "toggleBot") return bad("Trading bots now require a paid 7-day subscription. Go to Trading Bot to subscribe and configure one.");
    if (action === "copy") return bad("Copy trading now uses paid 7-day subscriptions. Go to Copy Trading to subscribe.");
    if (action === "plan") return bad("Plans now use paid weekly subscriptions. Go to Plans to subscribe.");
    return bad("Unknown action.");
  } catch (error) { console.error("App POST:", error); return bad(error instanceof Error ? error.message : "Something went wrong.", 400); }
}
