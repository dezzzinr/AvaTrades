// Server-only trading engine: executes spot fills, and sweeps open orders /
// open leverage positions against live prices to fire pending limit/
// stop-loss/take-profit fills, take-profit/stop-loss closes, and
// liquidations.
//
// There is no persistent background worker in this app (it runs as
// serverless Next.js routes), so triggers are evaluated opportunistically:
// - Every GET /api/market call (polled by any open browser tab) sweeps ALL
//   users' open orders/positions, rate-limited to roughly once every 20s
//   per server instance so rapid polling doesn't hammer the database.
// - Every GET /api/app call additionally sweeps just the requesting user,
//   so their own dashboard/trade page always reflects fresh fills the
//   instant they load it, even if the global sweep hasn't run yet.
// - Placing a new order/position immediately checks itself once, so e.g. a
//   limit buy placed at/above the current price fills right away instead
//   of waiting for the next sweep, exactly like a real exchange.
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { holdings, orders, positions, priceAlerts, trades, transactions, users } from "@/db/schema";
import { spotOrderShouldFill, spotOrderFillPrice, positionCloseEvent, realizedPnl, orderTypeLabel, type PendingOrderType } from "@/lib/trading";
import { moneyFormatterFor, type MoneyFormatter } from "@/lib/fx-server";
import { notifyUser } from "@/lib/notify";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Notification and ledger-description text written by the engine belongs to
// whichever user the sweep happened to touch, so their display-currency
// preference has to be looked up rather than read from a request. Rates are
// cached in-process by moneyFormatterFor, and a failed lookup falls back to
// USD so a formatting problem can never block a fill or a close.
async function formatterForCurrency(currency: string | null | undefined): Promise<MoneyFormatter> {
  try {
    return await moneyFormatterFor(currency);
  } catch (error) {
    console.error("Currency formatter lookup failed, defaulting to USD:", error);
    return moneyFormatterFor("USD");
  }
}

async function formatterFor(userId: string): Promise<MoneyFormatter> {
  const [row] = await db.select({ currency: users.currency }).from(users).where(eq(users.id, userId)).limit(1);
  return formatterForCurrency(row?.currency);
}

// Same, resolved from a position/order id before its transaction opens, so
// the description stored inside the transaction is already formatted. The
// transaction still re-selects the row FOR UPDATE and re-validates status.
async function formatterForPosition(positionId: string): Promise<MoneyFormatter> {
  const [row] = await db.select({ currency: users.currency })
    .from(positions).innerJoin(users, eq(users.id, positions.userId))
    .where(eq(positions.id, positionId)).limit(1);
  return formatterForCurrency(row?.currency);
}

async function formatterForOrder(orderId: string): Promise<MoneyFormatter> {
  const [row] = await db.select({ currency: users.currency })
    .from(orders).innerJoin(users, eq(users.id, orders.userId))
    .where(eq(orders.id, orderId)).limit(1);
  return formatterForCurrency(row?.currency);
}

// --- Spot fill execution (shared by manual market orders, pending-order
// fills, and the engine sweep) -------------------------------------------

export async function executeSpotFill(
  tx: Tx,
  userId: string,
  symbol: string,
  side: "buy" | "sell",
  quantity: number,
  price: number,
  orderId?: string,
): Promise<number> {
  const total = Math.round(quantity * price * 1e8) / 1e8; // keep cent precision below
  const roundedTotal = Math.round(total * 100) / 100;
  const [wallet] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
  const [existing] = await tx.select().from(holdings).where(and(eq(holdings.userId, userId), eq(holdings.symbol, symbol))).for("update");
  if (side === "buy") {
    if (Number(wallet.cashBalance) + 0.000001 < roundedTotal) throw new Error("Insufficient available balance.");
    await tx.update(users).set({ cashBalance: sql`${users.cashBalance} - ${roundedTotal}` }).where(eq(users.id, userId));
    if (existing) {
      const oldQty = Number(existing.quantity);
      const newQty = oldQty + quantity;
      const avgPrice = (oldQty * Number(existing.avgPrice) + quantity * price) / newQty;
      await tx.update(holdings).set({ quantity: newQty.toFixed(8), avgPrice: avgPrice.toFixed(8) }).where(eq(holdings.id, existing.id));
    } else {
      await tx.insert(holdings).values({ userId, symbol, quantity: quantity.toFixed(8), avgPrice: price.toFixed(8) });
    }
  } else {
    if (!existing || Number(existing.quantity) + 0.000000001 < quantity) throw new Error("Insufficient asset balance.");
    await tx.update(users).set({ cashBalance: sql`${users.cashBalance} + ${roundedTotal}` }).where(eq(users.id, userId));
    const remaining = Number(existing.quantity) - quantity;
    if (remaining < 0.00000001) await tx.delete(holdings).where(eq(holdings.id, existing.id));
    else await tx.update(holdings).set({ quantity: remaining.toFixed(8) }).where(eq(holdings.id, existing.id));
  }
  await tx.insert(trades).values({
    userId,
    symbol,
    side,
    quantity: quantity.toFixed(8),
    price: price.toFixed(8),
    total: roundedTotal.toFixed(2),
    orderId: orderId ?? null,
  });
  return roundedTotal;
}

// --- Reservation helpers: how much of a user's cash/holdings is already
// committed to other open orders, so a new order can't be placed against
// funds/assets that are already spoken for. --------------------------------

export async function reservedBuyCash(tx: Tx, userId: string): Promise<number> {
  const rows = await tx.select({ quantity: orders.quantity, price: orders.triggerPrice })
    .from(orders)
    .where(and(eq(orders.userId, userId), eq(orders.side, "buy"), eq(orders.status, "open")));
  return rows.reduce((sum, row) => sum + Number(row.quantity) * Number(row.price), 0);
}

export async function reservedSellQuantity(tx: Tx, userId: string, symbol: string): Promise<number> {
  const rows = await tx.select({ quantity: orders.quantity })
    .from(orders)
    .where(and(eq(orders.userId, userId), eq(orders.symbol, symbol), eq(orders.side, "sell"), eq(orders.status, "open")));
  return rows.reduce((sum, row) => sum + Number(row.quantity), 0);
}

// --- Single-order / single-position evaluation (used immediately after
// placement, and by the sweeps below) -------------------------------------

export async function evaluateOneOrder(orderId: string, currentPrice: number): Promise<boolean> {
  const filled = await db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
    if (!order || order.status !== "open") return null;
    const type = order.type as PendingOrderType;
    const side = order.side as "buy" | "sell";
    const shouldFill = spotOrderShouldFill(type, side, Number(order.triggerPrice), currentPrice);
    if (!shouldFill) return null;
    const fillPrice = spotOrderFillPrice(type, side, Number(order.triggerPrice), currentPrice);
    try {
      await executeSpotFill(tx, order.userId, order.symbol, side, Number(order.quantity), fillPrice, order.id);
    } catch {
      // Insufficient funds/holding at fill time (e.g. the user spent the
      // reserved cash/asset some other way) - cancel instead of silently
      // dropping it so it doesn't sit open forever pretending to be valid.
      await tx.update(orders).set({ status: "cancelled", cancelledAt: new Date() }).where(eq(orders.id, order.id));
      return null;
    }
    await tx.update(orders).set({ status: "filled", filledPrice: fillPrice.toFixed(8), filledAt: new Date() }).where(eq(orders.id, order.id));
    return { userId: order.userId, symbol: order.symbol, side, quantity: order.quantity, fillPrice };
  });
  if (!filled) return false;
  // Notified after the transaction commits (plain db, not tx) - this can
  // fire for an arbitrary other user mid-sweep, so the email send is
  // deferred and must never block whichever request triggered the sweep.
  const fmt = await formatterFor(filled.userId);
  await notifyUser({
    userId: filled.userId,
    type: "order_filled",
    title: `${filled.side === "buy" ? "Buy" : "Sell"} order filled`,
    message: `Your ${filled.side} order for ${Number(filled.quantity)} ${filled.symbol} filled at ${fmt.marketPrice(filled.fillPrice)}.`,
  });
  return true;
}

// Auto-cancels a pending order whose user-chosen "good-til-time" duration
// has elapsed before it filled. Checked ahead of the price-trigger fill
// condition in the sweeps below, so once an order's time is up it stops
// being fillable even if the price would otherwise match it right now.
export async function expireOneOrder(orderId: string): Promise<boolean> {
  const expired = await db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
    if (!order || order.status !== "open") return null;
    if (!order.expiresAt || order.expiresAt.getTime() > Date.now()) return null;
    await tx.update(orders).set({ status: "expired", cancelledAt: new Date() }).where(eq(orders.id, order.id));
    return { userId: order.userId, symbol: order.symbol, side: order.side as "buy" | "sell", type: order.type as PendingOrderType, quantity: order.quantity, triggerPrice: order.triggerPrice };
  });
  if (!expired) return false;
  const fmt = await formatterFor(expired.userId);
  await notifyUser({
    userId: expired.userId,
    type: "order_cancelled",
    title: `${orderTypeLabel(expired.type)} order expired`,
    message: `Your ${orderTypeLabel(expired.type).toLowerCase()} order to ${expired.side} ${Number(expired.quantity)} ${expired.symbol} at ${fmt.marketPrice(Number(expired.triggerPrice))} reached its set duration before filling and was automatically cancelled.`,
  });
  return true;
}

export async function evaluateOnePosition(positionId: string, currentPrice: number): Promise<boolean> {
  // Resolved before the transaction so the ledger description written inside
  // it is already formatted in the owner's display currency.
  const fmt = await formatterForPosition(positionId);
  const result = await db.transaction(async (tx) => {
    const [position] = await tx.select().from(positions).where(eq(positions.id, positionId)).for("update");
    if (!position || position.status !== "open") return null;
    const event = positionCloseEvent(
      position.side as "long" | "short",
      Number(position.liquidationPrice),
      position.takeProfitPrice == null ? null : Number(position.takeProfitPrice),
      position.stopLossPrice == null ? null : Number(position.stopLossPrice),
      currentPrice,
    );
    if (!event) return null;
    const pnl = event.reason === "liquidation"
      ? -Number(position.margin)
      : realizedPnl(Number(position.margin), closePnl(position, event.price));
    const credit = Math.round((Number(position.margin) + pnl) * 100) / 100;
    await tx.update(users).set({ cashBalance: sql`${users.cashBalance} + ${credit}` }).where(eq(users.id, position.userId));
    await tx.update(positions).set({
      status: event.reason === "liquidation" ? "liquidated" : "closed",
      closePrice: event.price.toFixed(8),
      closeReason: event.reason,
      realizedPnl: pnl.toFixed(2),
      closedAt: new Date(),
    }).where(eq(positions.id, position.id));
    await tx.insert(transactions).values({
      userId: position.userId,
      type: event.reason === "liquidation" ? "position_liquidated" : "position_closed",
      amount: pnl.toFixed(2),
      description: `${event.reason === "liquidation" ? "Liquidated" : event.reason === "take_profit" ? "Take-profit closed" : "Stop-loss closed"} ${Number(position.leverage)}x ${position.side} ${position.symbol} position at ${fmt.marketPrice(event.price)}`,
    });
    return { userId: position.userId, symbol: position.symbol, side: position.side, leverage: Number(position.leverage), pnl, event };
  });
  if (!result) return false;
  const { event } = result;
  const label = event.reason === "liquidation" ? "Liquidated" : event.reason === "take_profit" ? "Take-profit hit" : "Stop-loss hit";
  await notifyUser({
    userId: result.userId,
    type: "position_auto_closed",
    title: `${label}: ${result.symbol} position`,
    message: `${label} on your ${result.leverage}x ${result.side} ${result.symbol} position at ${fmt.marketPrice(event.price)} (${result.pnl >= 0 ? "+" : ""}${fmt.money(result.pnl)} P&L).`,
  });
  return true;
}

function closePnl(position: typeof positions.$inferSelect, closePrice: number): number {
  const entry = Number(position.entryPrice);
  const qty = Number(position.quantity);
  return position.side === "long" ? (closePrice - entry) * qty : (entry - closePrice) * qty;
}

// Auto-closes a position whose user-chosen duration has elapsed, at the
// current market price - exactly like a manual close, just triggered by
// time instead of a button click. Only called once a sweep has already
// confirmed no take-profit/stop-loss/liquidation price event fired first
// (those take priority since they're real risk events, not a timer).
export async function expireOnePosition(positionId: string, currentPrice: number): Promise<boolean> {
  // Resolved before the transaction so the ledger description written inside
  // it is already formatted in the owner's display currency.
  const fmt = await formatterForPosition(positionId);
  const result = await db.transaction(async (tx) => {
    const [position] = await tx.select().from(positions).where(eq(positions.id, positionId)).for("update");
    if (!position || position.status !== "open") return null;
    if (!position.expiresAt || position.expiresAt.getTime() > Date.now()) return null;
    const pnl = realizedPnl(Number(position.margin), closePnl(position, currentPrice));
    const credit = Math.round((Number(position.margin) + pnl) * 100) / 100;
    await tx.update(users).set({ cashBalance: sql`${users.cashBalance} + ${credit}` }).where(eq(users.id, position.userId));
    await tx.update(positions).set({
      status: "closed",
      closePrice: currentPrice.toFixed(8),
      closeReason: "duration_expired",
      realizedPnl: pnl.toFixed(2),
      closedAt: new Date(),
    }).where(eq(positions.id, position.id));
    await tx.insert(transactions).values({
      userId: position.userId,
      type: "position_closed",
      amount: pnl.toFixed(2),
      description: `Duration ended — closed ${Number(position.leverage)}x ${position.side} ${position.symbol} position at ${fmt.marketPrice(currentPrice)}`,
    });
    return { userId: position.userId, symbol: position.symbol, side: position.side, leverage: Number(position.leverage), pnl };
  });
  if (!result) return false;
  await notifyUser({
    userId: result.userId,
    type: "position_auto_closed",
    title: `Duration ended: ${result.symbol} position`,
    message: `Your ${result.leverage}x ${result.side} ${result.symbol} position reached its set duration and was automatically closed at ${fmt.marketPrice(currentPrice)} (${result.pnl >= 0 ? "+" : ""}${fmt.money(result.pnl)} P&L).`,
  });
  return true;
}

// --- Sweeps: evaluate every open order/position (optionally scoped to one
// user) against a map of live prices. ---------------------------------------

export async function sweepOrders(prices: Record<string, number>, userId?: string): Promise<number> {
  const symbols = Object.keys(prices);
  if (symbols.length === 0) return 0;
  const where = userId
    ? and(eq(orders.status, "open"), eq(orders.userId, userId), inArray(orders.symbol, symbols))
    : and(eq(orders.status, "open"), inArray(orders.symbol, symbols));
  const open = await db.select({ id: orders.id, symbol: orders.symbol, type: orders.type, side: orders.side, triggerPrice: orders.triggerPrice, expiresAt: orders.expiresAt }).from(orders).where(where);
  let filled = 0;
  for (const order of open) {
    // A "good-til-time" order stops being fillable once its duration is
    // up, even if the price would otherwise match it this instant.
    if (order.expiresAt && order.expiresAt.getTime() <= Date.now()) {
      if (await expireOneOrder(order.id)) filled++;
      continue;
    }
    const price = prices[order.symbol];
    if (price == null || price <= 0) continue;
    if (!spotOrderShouldFill(order.type as PendingOrderType, order.side as "buy" | "sell", Number(order.triggerPrice), price)) continue;
    if (await evaluateOneOrder(order.id, price)) filled++;
  }
  return filled;
}

export async function sweepPositions(prices: Record<string, number>, userId?: string): Promise<number> {
  const symbols = Object.keys(prices);
  if (symbols.length === 0) return 0;
  const where = userId
    ? and(eq(positions.status, "open"), eq(positions.userId, userId), inArray(positions.symbol, symbols))
    : and(eq(positions.status, "open"), inArray(positions.symbol, symbols));
  const open = await db.select({
    id: positions.id, symbol: positions.symbol, side: positions.side,
    liquidationPrice: positions.liquidationPrice, takeProfitPrice: positions.takeProfitPrice, stopLossPrice: positions.stopLossPrice,
    expiresAt: positions.expiresAt,
  }).from(positions).where(where);
  let closed = 0;
  for (const position of open) {
    const price = prices[position.symbol];
    if (price == null || price <= 0) continue;
    const event = positionCloseEvent(
      position.side as "long" | "short",
      Number(position.liquidationPrice),
      position.takeProfitPrice == null ? null : Number(position.takeProfitPrice),
      position.stopLossPrice == null ? null : Number(position.stopLossPrice),
      price,
    );
    if (event) {
      if (await evaluateOnePosition(position.id, price)) closed++;
      continue;
    }
    // No price-trigger event fired - fall back to checking whether the
    // user's chosen duration has elapsed.
    if (position.expiresAt && position.expiresAt.getTime() <= Date.now()) {
      if (await expireOnePosition(position.id, price)) closed++;
    }
  }
  return closed;
}

// --- Price alerts: one-shot "notify me when BTC goes above/below $X"
// triggers, evaluated by the same opportunistic sweep as order fills. ------

export async function sweepPriceAlerts(prices: Record<string, number>, userId?: string): Promise<number> {
  const symbols = Object.keys(prices);
  if (symbols.length === 0) return 0;
  const where = userId
    ? and(eq(priceAlerts.status, "open"), eq(priceAlerts.userId, userId), inArray(priceAlerts.symbol, symbols))
    : and(eq(priceAlerts.status, "open"), inArray(priceAlerts.symbol, symbols));
  const open = await db.select().from(priceAlerts).where(where);
  let triggered = 0;
  for (const alert of open) {
    const price = prices[alert.symbol];
    if (price == null || price <= 0) continue;
    const target = Number(alert.targetPrice);
    const hit = alert.direction === "above" ? price >= target : price <= target;
    if (!hit) continue;
    const [updated] = await db.update(priceAlerts)
      .set({ status: "triggered", triggeredAt: new Date() })
      .where(and(eq(priceAlerts.id, alert.id), eq(priceAlerts.status, "open")))
      .returning();
    if (!updated) continue; // lost a race with another sweep - already handled
    triggered++;
    const fmt = await formatterFor(alert.userId);
    await notifyUser({
      userId: alert.userId,
      type: "price_alert_triggered",
      title: `${alert.symbol} ${alert.direction === "above" ? "crossed above" : "dropped below"} your target`,
      message: `${alert.symbol} just ${alert.direction === "above" ? "rose above" : "fell below"} ${fmt.marketPrice(target)} (now ${fmt.marketPrice(price)}). This alert has been used up - set a new one if you want to keep watching ${alert.symbol}.`,
    });
  }
  return triggered;
}

// Global sweep cooldown, per server instance. Best-effort only: with
// multiple serverless instances each has its own timer, but combined with
// the per-user sweep on every /api/app load this keeps fills timely without
// scanning the whole orders/positions table on every single page view.
let lastGlobalSweep = 0;
const GLOBAL_SWEEP_COOLDOWN_MS = 20_000;

export async function maybeSweepAll(prices: Record<string, number>) {
  const now = Date.now();
  if (now - lastGlobalSweep < GLOBAL_SWEEP_COOLDOWN_MS) return;
  lastGlobalSweep = now;
  try {
    await Promise.all([sweepOrders(prices), sweepPositions(prices), sweepPriceAlerts(prices)]);
  } catch (error) {
    console.error("Trading engine sweep failed:", error);
  }
}

export async function sweepForUser(prices: Record<string, number>, userId: string) {
  try {
    await Promise.all([sweepOrders(prices, userId), sweepPositions(prices, userId), sweepPriceAlerts(prices, userId)]);
  } catch (error) {
    console.error("Trading engine per-user sweep failed:", error);
  }
}
