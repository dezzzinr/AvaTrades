// Shared constants and pure math for the order book and leverage trading
// features. No DB/network imports here so the client bundle can reuse the
// exact same calculations the server uses (live preview of liquidation
// price, P&L, etc. before a user submits an order/position).
//
// This app simulates a real exchange's order types and margin mechanics,
// but deliberately charges no trading fees and simulates no slippage:
// every fill/close happens at exactly the quoted limit/trigger/market
// price.

export const ORDER_TYPES = ["market", "limit", "stop_loss", "take_profit"] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

// Only these types are ever stored as a pending row in `orders` — market
// orders execute immediately and go straight into `trades`.
export const PENDING_ORDER_TYPES = ["limit", "stop_loss", "take_profit"] as const;
export type PendingOrderType = (typeof PENDING_ORDER_TYPES)[number];

export const ORDER_SIDES = ["buy", "sell"] as const;
export type OrderSide = (typeof ORDER_SIDES)[number];

export const POSITION_SIDES = ["long", "short"] as const;
export type PositionSide = (typeof POSITION_SIDES)[number];

export const LEVERAGE_OPTIONS = [1, 2, 3, 5, 10, 20, 50, 100] as const;
export const MIN_MARGIN = 10;
export const MAX_MARGIN = 1_000_000;

// How long a trade should last, chosen by the user when placing it:
// - Margin positions (including a plain 1x "trade" with no leverage
//   amplification) auto-close at the live market price once this much time
//   has passed, exactly like an unattended take-profit/stop-loss/
//   liquidation close (realizes whatever P&L exists at that moment).
// - Pending spot orders (limit/stop-loss/take-profit): a "good-til-time"
//   order - if it hasn't filled by this time, it's automatically cancelled
//   instead of sitting open forever.
// - A spot "market" order can also carry a duration: it still fills
//   instantly, but instead of landing in holdings forever it's opened as a
//   1x position that auto-closes (sells back / buys back) once the
//   duration elapses.
// "No expiry" (the default, preserving pre-existing behavior) means the
// trade stays open/pending indefinitely until manually closed/cancelled or
// a price target is hit.
//
// Duration is a free-form custom timer (any whole number of minutes),
// not a fixed preset list - the options below are just convenience
// quick-picks shown in the UI to prefill the custom timer.
export const MIN_DURATION_MINUTES = 1;
export const MAX_DURATION_MINUTES = 60 * 24 * 90; // 90 days - a sane upper bound
export const DURATION_UNITS = [
  { id: "minutes", label: "Minutes", minutes: 1 },
  { id: "hours", label: "Hours", minutes: 60 },
  { id: "days", label: "Days", minutes: 60 * 24 },
] as const satisfies readonly { id: string; label: string; minutes: number }[];
export type DurationUnitId = (typeof DURATION_UNITS)[number]["id"];
export function minutesPerUnit(unit: string): number {
  return DURATION_UNITS.find((u) => u.id === unit)?.minutes ?? 1;
}

// Quick-pick presets for the custom timer (clicking one just fills the
// amount/unit inputs - the timer itself accepts any custom value).
export const DURATION_PRESETS = [
  { label: "1 minute", minutes: 1 },
  { label: "15 minutes", minutes: 15 },
  { label: "1 hour", minutes: 60 },
  { label: "4 hours", minutes: 60 * 4 },
  { label: "1 day", minutes: 60 * 24 },
  { label: "1 week", minutes: 60 * 24 * 7 },
] as const;

// Validates/clamps a user-entered duration. Returns null for "no expiry",
// otherwise a whole number of minutes within [MIN_DURATION_MINUTES,
// MAX_DURATION_MINUTES], or throws-worthy `null` if the input is garbage
// (callers should treat a non-null, non-finite input as a validation
// error, not silently fall back to "no expiry").
export function normalizeDurationMinutes(minutes: unknown): number | null {
  if (minutes === null || minutes === undefined || minutes === "") return null;
  const n = Math.round(Number(minutes));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(MAX_DURATION_MINUTES, Math.max(MIN_DURATION_MINUTES, n));
}

// Pretty-prints an arbitrary custom duration (not just the presets) for
// notification copy and UI labels, e.g. 1 -> "1 minute", 90 -> "1h 30m",
// 4320 -> "3 days".
export function formatDurationMinutes(totalMinutes: number): string {
  const mins = Math.max(0, Math.round(totalMinutes));
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"}`;
  if (mins < 60 * 24) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m === 0 ? `${h} hour${h === 1 ? "" : "s"}` : `${h}h ${m}m`;
  }
  const d = Math.floor(mins / (60 * 24));
  const h = Math.floor((mins % (60 * 24)) / 60);
  return h === 0 ? `${d} day${d === 1 ? "" : "s"}` : `${d}d ${h}h`;
}

export function orderTypeLabel(type: string): string {
  switch (type) {
    case "market": return "Market";
    case "limit": return "Limit";
    case "stop_loss": return "Stop-Loss";
    case "take_profit": return "Take-Profit";
    default: return type;
  }
}

// Stop-loss / take-profit are protective orders against an existing spot
// holding; spot has no shorting, so they only ever make sense as sell
// orders. Limit orders can be either side.
export function allowedOrderTypesForSide(side: OrderSide): OrderType[] {
  return side === "sell" ? ["market", "limit", "stop_loss", "take_profit"] : ["market", "limit"];
}

// Isolated-margin liquidation price: the price at which the position's
// equity (margin + unrealized P&L) hits zero, assuming no fees.
export function liquidationPrice(entryPrice: number, leverage: number, side: PositionSide): number {
  return side === "long" ? entryPrice * (1 - 1 / leverage) : entryPrice * (1 + 1 / leverage);
}

export function positionPnl(side: PositionSide, entryPrice: number, currentPrice: number, quantity: number): number {
  return side === "long" ? (currentPrice - entryPrice) * quantity : (entryPrice - currentPrice) * quantity;
}

// Realized loss can never exceed the margin put up — the position would
// have already been liquidated before equity could go negative. This floor
// protects cashBalance from ever going negative because of a gap/skip in
// our periodic (not tick-by-tick) price-trigger evaluation.
export function realizedPnl(margin: number, pnl: number): number {
  return Math.max(pnl, -margin);
}

export function positionEquity(margin: number, pnl: number): number {
  return margin + realizedPnl(margin, pnl);
}

// Validates a requested take-profit / stop-loss price against the position
// direction and its own liquidation price. Returns an error string, or null
// if valid (undefined/omitted targets are always valid - they're optional).
export function validatePositionTarget(
  kind: "takeProfit" | "stopLoss",
  side: PositionSide,
  entryPrice: number,
  liqPrice: number,
  value: number,
): string | null {
  if (!Number.isFinite(value) || value <= 0) return "Enter a valid price.";
  if (kind === "takeProfit") {
    if (side === "long" && value <= entryPrice) return "Take-profit must be above the entry price for a long position.";
    if (side === "short" && value >= entryPrice) return "Take-profit must be below the entry price for a short position.";
  } else {
    if (side === "long" && (value >= entryPrice || value <= liqPrice)) {
      return "Stop-loss must be below the entry price and above the liquidation price.";
    }
    if (side === "short" && (value <= entryPrice || value >= liqPrice)) {
      return "Stop-loss must be above the entry price and below the liquidation price.";
    }
  }
  return null;
}

// Whether a pending spot order's trigger condition is satisfied by the
// current live price.
export function spotOrderShouldFill(type: PendingOrderType, side: OrderSide, triggerPrice: number, currentPrice: number): boolean {
  if (type === "limit") return side === "buy" ? currentPrice <= triggerPrice : currentPrice >= triggerPrice;
  if (type === "stop_loss") return currentPrice <= triggerPrice; // sell-only
  if (type === "take_profit") return currentPrice >= triggerPrice; // sell-only
  return false;
}

// The exact execution price once a fill is triggered. There is no fee and
// no randomized slippage, but a limit order still fills at the better of
// your limit and the live price (exactly like a real exchange: a limit buy
// never pays more than its limit, and fills at the live price if that's
// cheaper) - it never fills at a synthetic *worse* price. Stop-loss and
// take-profit orders fill at exactly their trigger price, since that's the
// outcome they promise once reached.
export function spotOrderFillPrice(type: PendingOrderType, side: OrderSide, triggerPrice: number, currentPrice: number): number {
  if (type === "limit") return side === "buy" ? Math.min(triggerPrice, currentPrice) : Math.max(triggerPrice, currentPrice);
  return triggerPrice;
}

export function closeReasonLabel(reason: string | null | undefined): string {
  switch (reason) {
    case "manual": return "Manually closed";
    case "take_profit": return "Take-profit hit";
    case "stop_loss": return "Stop-loss hit";
    case "liquidation": return "Liquidated";
    case "duration_expired": return "Duration ended";
    default: return "—";
  }
}

export type PositionCloseEvent = { reason: "liquidation" | "take_profit" | "stop_loss"; price: number };

// Checks liquidation first (most severe), then take-profit, then stop-loss.
// Closes always happen at the exact trigger price, never the live price.
export function positionCloseEvent(
  side: PositionSide,
  liqPrice: number,
  takeProfitPrice: number | null,
  stopLossPrice: number | null,
  currentPrice: number,
): PositionCloseEvent | null {
  if (side === "long") {
    if (currentPrice <= liqPrice) return { reason: "liquidation", price: liqPrice };
    if (takeProfitPrice != null && currentPrice >= takeProfitPrice) return { reason: "take_profit", price: takeProfitPrice };
    if (stopLossPrice != null && currentPrice <= stopLossPrice) return { reason: "stop_loss", price: stopLossPrice };
  } else {
    if (currentPrice >= liqPrice) return { reason: "liquidation", price: liqPrice };
    if (takeProfitPrice != null && currentPrice <= takeProfitPrice) return { reason: "take_profit", price: takeProfitPrice };
    if (stopLossPrice != null && currentPrice >= stopLossPrice) return { reason: "stop_loss", price: stopLossPrice };
  }
  return null;
}
