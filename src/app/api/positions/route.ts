import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { positions, transactions, users } from "@/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { getUser } from "@/lib/auth";
import { getAsset } from "@/lib/market";
import { getMarketSnapshot } from "@/lib/market-server";
import { blockedActionMessage, tradeLimitMessage } from "@/lib/accounts";
import { LEVERAGE_OPTIONS, MAX_MARGIN, MIN_MARGIN, POSITION_SIDES, liquidationPrice, positionPnl, validatePositionTarget, normalizeDurationMinutes, formatDurationMinutes, MAX_DURATION_MINUTES, type PositionSide } from "@/lib/trading";
import { notifyUser } from "@/lib/notify";
import { moneyFormatterFor, convertToUsd, convertPriceToUsd, USD_ADVICE_USER } from "@/lib/fx-server";

export const dynamic = "force-dynamic";
const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

export async function GET(request: NextRequest) {
  try {
    const user = await getUser(request);
    if (!user) return bad("Session expired. Please refresh the page.", 401);
    const rows = await db.select().from(positions).where(eq(positions.userId, user.id)).orderBy(desc(positions.createdAt)).limit(100);
    const open = rows.filter((p) => p.status === "open");
    const history = rows.filter((p) => p.status !== "open");

    let market = null;
    if (open.length > 0) market = await getMarketSnapshot();
    const openWithPnl = open.map((p) => {
      const asset = market?.assets.find((a) => a.symbol === p.symbol);
      const currentPrice = asset?.price ?? Number(p.entryPrice);
      const pnl = positionPnl(p.side as PositionSide, Number(p.entryPrice), currentPrice, Number(p.quantity));
      return { ...p, currentPrice, unrealizedPnl: Math.round(pnl * 100) / 100 };
    });

    return NextResponse.json({ open: openWithPnl, history });
  } catch (error) {
    console.error("Positions GET:", error);
    return bad("Unable to load your positions. Please try again.", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getUser(request);
    if (!user) return bad("Session expired. Please refresh the page.", 401);
    const blocked = blockedActionMessage(user, "trade");
    if (blocked) return bad(blocked, 403);
    // Formats every amount in this request's messages in the user's own
    // display currency (chosen on their profile). Ledger math stays USD.
    const fmt = await moneyFormatterFor(user.currency);

    const body = await request.json().catch(() => ({}));
    const symbol = String(body.symbol ?? "").toUpperCase();
    const side = body.side as PositionSide;
    const leverage = Number(body.leverage);
    // Margin is money (typed in the user's display currency, stored in the USD
    // ledger at 2dp). Take-profit / stop-loss are PRICE LEVELS: the user reads
    // the chart in their own currency, so they type the level they see, and it's
    // converted to a USD price at high precision - rounding those to cents would
    // wreck any low-priced asset.
    const enteredMargin = Number(body.margin);
    const takeProfitRaw = body.takeProfitPrice === undefined || body.takeProfitPrice === null || body.takeProfitPrice === "" ? null : Number(body.takeProfitPrice);
    const stopLossRaw = body.stopLossPrice === undefined || body.stopLossPrice === null || body.stopLossPrice === "" ? null : Number(body.stopLossPrice);
    // Custom timer: a raw number of minutes (any value), not a fixed
    // preset - null/0/absent means "no expiry".
    if (body.durationMinutes !== undefined && body.durationMinutes !== null && body.durationMinutes !== "" && normalizeDurationMinutes(body.durationMinutes) === null) {
      return bad(`Enter a valid duration (at least 1 minute, up to ${Math.round(MAX_DURATION_MINUTES / 1440)} days).`);
    }
    const durationMinutes = normalizeDurationMinutes(body.durationMinutes);
    const expiresAt = durationMinutes ? new Date(Date.now() + durationMinutes * 60_000) : null;

    if (!getAsset(symbol)) return bad("Choose a valid asset.");
    if (!POSITION_SIDES.includes(side)) return bad("Choose long or short.");
    if (!(LEVERAGE_OPTIONS as readonly number[]).includes(leverage)) return bad("Choose a valid leverage multiplier.");
    if (!Number.isFinite(enteredMargin) || enteredMargin <= 0) return bad(`Margin must be between ${fmt.usd(MIN_MARGIN)} and ${fmt.usd(MAX_MARGIN, 0)}.`);
    if (takeProfitRaw !== null && !Number.isFinite(takeProfitRaw)) return bad("Enter a valid take-profit price.");
    if (stopLossRaw !== null && !Number.isFinite(stopLossRaw)) return bad("Enter a valid stop-loss price.");

    const marginConversion = await convertToUsd(enteredMargin, body.currency, USD_ADVICE_USER);
    if (!marginConversion.ok) return bad(marginConversion.error);
    const margin = marginConversion.usd;
    if (margin < MIN_MARGIN || margin > MAX_MARGIN) return bad(`Margin must be between ${fmt.usd(MIN_MARGIN)} and ${fmt.usd(MAX_MARGIN, 0)}.`);

    // TP/SL must be converted BEFORE they're validated against the entry and
    // liquidation prices, which are USD market values.
    let takeProfitInput: number | null = null;
    let stopLossInput: number | null = null;
    if (takeProfitRaw !== null && takeProfitRaw > 0) {
      const tp = await convertPriceToUsd(takeProfitRaw, body.currency);
      if (!tp.ok) return bad(tp.error);
      takeProfitInput = tp.usd;
    }
    if (stopLossRaw !== null && stopLossRaw > 0) {
      const sl = await convertPriceToUsd(stopLossRaw, body.currency);
      if (!sl.ok) return bad(sl.error);
      stopLossInput = sl.usd;
    }

    const market = await getMarketSnapshot();
    const asset = market.assets.find((item) => item.symbol === symbol);
    if (market.status !== "live" || !asset || asset.price <= 0) return bad("Live market pricing is unavailable. Positions can't be opened until prices recover.", 503);

    const entryPrice = asset.price;
    const liqPrice = liquidationPrice(entryPrice, leverage, side);
    if (takeProfitInput !== null) {
      const err = validatePositionTarget("takeProfit", side, entryPrice, liqPrice, takeProfitInput);
      if (err) return bad(err);
    }
    if (stopLossInput !== null) {
      const err = validatePositionTarget("stopLoss", side, entryPrice, liqPrice, stopLossInput);
      if (err) return bad(err);
    }

    const notional = Math.round(margin * leverage * 100) / 100;
    const limitMsg = tradeLimitMessage(user, notional, fmt.usd);
    if (limitMsg) return bad(limitMsg, 403);

    const quantity = notional / entryPrice;

    const positionId = await db.transaction(async (tx) => {
      const [wallet] = await tx.select().from(users).where(eq(users.id, user.id)).for("update");
      if (Number(wallet.cashBalance) + 0.000001 < margin) throw new Error("Insufficient available balance for this margin amount.");
      await tx.update(users).set({ cashBalance: sql`${users.cashBalance} - ${margin}` }).where(eq(users.id, user.id));
      const [row] = await tx.insert(positions).values({
        userId: user.id,
        symbol,
        side,
        leverage: leverage.toFixed(2),
        margin: margin.toFixed(2),
        quantity: quantity.toFixed(8),
        entryPrice: entryPrice.toFixed(8),
        liquidationPrice: liqPrice.toFixed(8),
        takeProfitPrice: takeProfitInput !== null ? takeProfitInput.toFixed(8) : null,
        stopLossPrice: stopLossInput !== null ? stopLossInput.toFixed(8) : null,
        status: "open",
        expiresAt,
      }).returning({ id: positions.id });
      await tx.insert(transactions).values({
        userId: user.id,
        type: "margin_open",
        amount: (-margin).toFixed(2),
        description: `Opened ${leverage}x ${side} ${symbol} position (margin ${fmt.money(margin)}, entry ${fmt.marketPrice(entryPrice)})`,
      });
      return row.id;
    });

    const expiryNote = expiresAt ? ` It will automatically close at the market price after ${formatDurationMinutes(durationMinutes!)} if still open.` : "";
    await notifyUser({
      userId: user.id,
      type: "position_opened",
      title: `Opened ${leverage}x ${side} ${symbol} position`,
      message: `Opened a ${leverage}x ${side} ${symbol} position at ${fmt.marketPrice(entryPrice)} with ${fmt.money(margin)} margin. Liquidation at ${fmt.marketPrice(liqPrice)}.${expiryNote}`,
    });

    return NextResponse.json({
      success: true,
      message: `Opened ${leverage}x ${side} ${symbol} position at ${fmt.marketPrice(entryPrice)}. Liquidation at ${fmt.marketPrice(liqPrice)}.${expiresAt ? ` Closes automatically in ${formatDurationMinutes(durationMinutes!)}.` : ""}`,
      positionId,
    });
  } catch (error) {
    console.error("Positions POST:", error);
    return bad(error instanceof Error ? error.message : "Unable to open this position.", 400);
  }
}
