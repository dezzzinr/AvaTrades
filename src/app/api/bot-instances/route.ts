import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { botInstances, botProducts, botSubscriptions } from "@/db/schema";
import { and, desc, eq, gt } from "drizzle-orm";
import { getUser } from "@/lib/auth";
import { blockedActionMessage } from "@/lib/accounts";
import { getAsset } from "@/lib/market";
import { moneyFormatterFor, convertToUsd, USD_ADVICE_USER } from "@/lib/fx-server";

export const dynamic = "force-dynamic";
const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

// Checks whether the user currently holds a non-expired subscription to a
// given bot product.
async function hasActiveSubscription(userId: string, botProductId: string) {
  const [row] = await db.select({ id: botSubscriptions.id }).from(botSubscriptions).where(and(eq(botSubscriptions.userId, userId), eq(botSubscriptions.botProductId, botProductId), gt(botSubscriptions.expiresAt, new Date()))).limit(1);
  return !!row;
}

// The user's configured bot instances, joined with their bot product for
// display, plus whether the underlying subscription is currently active
// (an expired subscription locks the instance until the user resubscribes).
export async function GET(request: NextRequest) {
  try {
    const user = await getUser(request);
    if (!user) return bad("Session expired. Please refresh the page.", 401);
    const rows = await db
      .select({
        id: botInstances.id,
        botProductId: botInstances.botProductId,
        botName: botProducts.name,
        strategy: botProducts.strategy,
        name: botInstances.name,
        symbol: botInstances.symbol,
        amount: botInstances.amount,
        active: botInstances.active,
        createdAt: botInstances.createdAt,
      })
      .from(botInstances)
      .innerJoin(botProducts, eq(botInstances.botProductId, botProducts.id))
      .where(eq(botInstances.userId, user.id))
      .orderBy(desc(botInstances.createdAt));
    const now = new Date();
    const activeSubs = await db.select({ botProductId: botSubscriptions.botProductId }).from(botSubscriptions).where(and(eq(botSubscriptions.userId, user.id), gt(botSubscriptions.expiresAt, now)));
    const subscribedProductIds = new Set(activeSubs.map((s) => s.botProductId));
    return NextResponse.json({ instances: rows.map((r) => ({ ...r, subscriptionActive: subscribedProductIds.has(r.botProductId) })) });
  } catch (error) {
    console.error("Bot instances GET:", error);
    return bad("Unable to load your bots.", 500);
  }
}

// Create a new configured bot instance. Requires an active subscription to
// the chosen bot product - users may create as many instances of a
// subscribed bot as they like (e.g. one per asset).
export async function POST(request: NextRequest) {
  try {
    const user = await getUser(request);
    if (!user) return bad("Session expired. Please refresh the page.", 401);
    const blocked = blockedActionMessage(user, "configure");
    if (blocked) return bad(blocked, 403);
    const body = await request.json().catch(() => ({}));
    const botProductId = String(body.botProductId ?? "");
    const symbol = String(body.symbol ?? "").toUpperCase();

    const [product] = await db.select().from(botProducts).where(eq(botProducts.id, botProductId)).limit(1);
    if (!product) return bad("Bot not found.");
    if (!(await hasActiveSubscription(user.id, botProductId))) return bad(`Subscribe to ${product.name} first to configure it.`);
    if (!getAsset(symbol)) return bad("Choose a valid asset to trade.");

    // The allocation is typed in the user's own display currency and stored in
    // the USD ledger. The product's minAllocation is a USD figure, so the check
    // compares against the converted amount - not what the user typed.
    const entered = Number(body.amount);
    if (!Number.isFinite(entered) || entered <= 0) {
      const fmt = await moneyFormatterFor(user.currency);
      return bad(`Enter an allocation of at least ${fmt.usd(Number(product.minAllocation))}.`);
    }
    const conversion = await convertToUsd(entered, body.currency, USD_ADVICE_USER);
    if (!conversion.ok) return bad(conversion.error);
    const amount = conversion.usd;
    const minAllocation = Number(product.minAllocation);
    if (amount < minAllocation) {
      const fmt = await moneyFormatterFor(user.currency);
      return bad(`Enter an allocation of at least ${fmt.usd(minAllocation)}.`);
    }
    if (amount > 10000000) return bad("Enter a smaller allocation amount.");

    const name = String(body.name ?? "").trim().slice(0, 80) || `${product.name} · ${symbol}`;
    const [row] = await db.insert(botInstances).values({ userId: user.id, botProductId, name, symbol, amount: amount.toFixed(2), active: true }).returning();
    return NextResponse.json({ success: true, instance: row, message: `${name} is configured and running.` });
  } catch (error) {
    console.error("Bot instances POST:", error);
    return bad("Unable to create bot instance.", 500);
  }
}
