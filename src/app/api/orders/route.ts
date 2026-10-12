import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { holdings, orders, users } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { getUser } from "@/lib/auth";
import { getAsset, marketPrice } from "@/lib/market";
import { getMarketSnapshot } from "@/lib/market-server";
import { blockedActionMessage, tradeLimitMessage } from "@/lib/accounts";
import { PENDING_ORDER_TYPES, allowedOrderTypesForSide, orderTypeLabel, spotOrderShouldFill, spotOrderFillPrice, normalizeDurationMinutes, formatDurationMinutes, MAX_DURATION_MINUTES, type PendingOrderType } from "@/lib/trading";
import { evaluateOneOrder, reservedBuyCash, reservedSellQuantity } from "@/lib/trading-engine";
import { notifyUser } from "@/lib/notify";

export const dynamic = "force-dynamic";
const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

export async function GET(request: NextRequest) {
  try {
    const user = await getUser(request);
    if (!user) return bad("Session expired. Please refresh the page.", 401);
    const rows = await db.select().from(orders).where(eq(orders.userId, user.id)).orderBy(desc(orders.createdAt)).limit(100);
    return NextResponse.json({
      open: rows.filter((o) => o.status === "open"),
      history: rows.filter((o) => o.status !== "open"),
    });
  } catch (error) {
    console.error("Orders GET:", error);
    return bad("Unable to load your orders. Please try again.", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getUser(request);
    if (!user) return bad("Session expired. Please refresh the page.", 401);
    const blocked = blockedActionMessage(user, "trade");
    if (blocked) return bad(blocked, 403);

    const body = await request.json().catch(() => ({}));
    const symbol = String(body.symbol ?? "").toUpperCase();
    const side = body.side;
    const type = body.type as PendingOrderType;
    const quantity = Number(body.quantity);
    const triggerPrice = Number(body.triggerPrice);
    // Custom timer: a raw number of minutes (any value), not a fixed
    // preset - null/0/absent means "no expiry".
    if (body.durationMinutes !== undefined && body.durationMinutes !== null && body.durationMinutes !== "" && normalizeDurationMinutes(body.durationMinutes) === null) {
      return bad(`Enter a valid duration (at least 1 minute, up to ${Math.round(MAX_DURATION_MINUTES / 1440)} days).`);
    }
    const durationMinutes = normalizeDurationMinutes(body.durationMinutes);
    const expiresAt = durationMinutes ? new Date(Date.now() + durationMinutes * 60_000) : null;

    if (!getAsset(symbol)) return bad("Choose a valid asset.");
    if (!["buy", "sell"].includes(side)) return bad("Choose buy or sell.");
    if (!PENDING_ORDER_TYPES.includes(type)) return bad("Choose a valid order type.");
    if (!allowedOrderTypesForSide(side).includes(type)) return bad(`${orderTypeLabel(type)} orders are only available on the sell side.`);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000 || (quantity.toString().split(".")[1]?.length ?? 0) > 8) return bad("Enter a valid quantity.");
    if (!Number.isFinite(triggerPrice) || triggerPrice <= 0 || triggerPrice > 100_000_000) return bad("Enter a valid price.");

    const market = await getMarketSnapshot();
    const asset = market.assets.find((item) => item.symbol === symbol);
    if (market.status !== "live" || !asset || asset.price <= 0) return bad("Live market pricing is unavailable. Orders can't be placed until prices recover.", 503);

    const total = Math.round(quantity * triggerPrice * 100) / 100;
    if (total < 0.01) return bad("Minimum order value is $0.01.");
    const limitMsg = tradeLimitMessage(user, total);
    if (limitMsg) return bad(limitMsg, 403);

    const orderId = await db.transaction(async (tx) => {
      const [wallet] = await tx.select().from(users).where(eq(users.id, user.id)).for("update");
      const [holding] = await tx.select().from(holdings).where(and(eq(holdings.userId, user.id), eq(holdings.symbol, symbol))).for("update");
      if (side === "buy") {
        const reserved = await reservedBuyCash(tx, user.id);
        const available = Number(wallet.cashBalance) - reserved;
        if (total > available + 0.0001) {
          throw new Error(reserved > 0
            ? `Insufficient available balance — $${reserved.toFixed(2)} is already committed to other open buy orders.`
            : "Insufficient available balance.");
        }
      } else {
        const reserved = await reservedSellQuantity(tx, user.id, symbol);
        const available = (holding ? Number(holding.quantity) : 0) - reserved;
        if (quantity > available + 0.00000001) {
          throw new Error(reserved > 0
            ? `Insufficient available ${symbol} — ${reserved} is already committed to other open sell orders.`
            : `You don't hold enough ${symbol} for this order.`);
        }
      }
      const [row] = await tx.insert(orders).values({
        userId: user.id,
        symbol,
        side,
        type,
        quantity: quantity.toFixed(8),
        triggerPrice: triggerPrice.toFixed(8),
        status: "open",
        expiresAt,
      }).returning({ id: orders.id });
      return row.id;
    });

    // If the trigger condition is already satisfied by the current price
    // (e.g. a limit buy placed at/above the current ask), fill it right
    // away instead of waiting for the next sweep - this matches how real
    // exchanges handle marketable limit orders.
    let filled = false;
    if (spotOrderShouldFill(type, side, triggerPrice, asset.price)) {
      filled = await evaluateOneOrder(orderId, asset.price);
    }
    const fillPrice = spotOrderFillPrice(type, side, triggerPrice, asset.price);

    // evaluateOneOrder() above already sends an "order_filled" notification
    // when it fills - only notify here for the order staying open, so the
    // user gets exactly one notification either way, not two.
    if (!filled) {
      const expiryNote = expiresAt ? ` It will automatically cancel if it hasn't filled within ${formatDurationMinutes(durationMinutes!)}.` : "";
      await notifyUser({
        userId: user.id,
        type: "order_placed",
        title: `${orderTypeLabel(type)} order placed`,
        message: `Your ${orderTypeLabel(type).toLowerCase()} order to ${side} ${quantity} ${symbol} at ${marketPrice(triggerPrice)} is open and will fill automatically when the market reaches that price.${expiryNote}`,
      });
    }

    return NextResponse.json({
      success: true,
      filled,
      message: filled
        ? `${side === "buy" ? "Bought" : "Sold"} ${quantity} ${symbol} at ${marketPrice(fillPrice)} (filled immediately).`
        : `${orderTypeLabel(type)} order placed: ${side} ${quantity} ${symbol} at ${marketPrice(triggerPrice)}${expiresAt ? ` (expires in ${formatDurationMinutes(durationMinutes!)})` : ""}.`,
    });
  } catch (error) {
    console.error("Orders POST:", error);
    return bad(error instanceof Error ? error.message : "Unable to place this order.", 400);
  }
}
