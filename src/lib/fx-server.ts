// Foreign-exchange rate fetching for the "display amounts in the user's
// currency" feature. The ledger (cash balances, trades, orders, positions,
// transactions) is always stored and computed in USD - this module only
// supplies a USD -> target-currency multiplier used purely for display
// formatting on the client. Rates come from a free, keyless public API and
// are cached in-process with a stale-while-revalidate fallback, mirroring
// the pattern used for CoinGecko market data in market-server.ts.

import { formatCompactMoney, formatInCurrency, formatMarketPrice, formatMoney, formatUsdAmount } from "@/lib/currency";

export type FxSnapshot = {
  base: "USD";
  rates: Record<string, number>; // USD -> currency multiplier, e.g. rates.NGN = 1331
  status: "live" | "stale" | "unavailable";
  updatedAt: string | null;
};

const FX_URL = "https://open.er-api.com/v6/latest/USD";
const REVALIDATE_SECONDS = 60 * 60; // FX moves slowly; refresh hourly
const STALE_AFTER_MS = 26 * 60 * 60 * 1000; // allow the previous day's rate to keep serving if the provider is briefly down

let lastGood: { rates: Record<string, number>; updatedAt: string } | null = null;

export async function getFxSnapshot(): Promise<FxSnapshot> {
  try {
    const response = await fetch(FX_URL, {
      headers: { Accept: "application/json" },
      next: { revalidate: REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`FX provider returned ${response.status}`);
    const data = await response.json();
    const rates = data?.rates;
    if (!rates || typeof rates !== "object" || typeof rates.USD !== "number") throw new Error("Invalid FX response");
    const updatedAt = new Date().toISOString();
    lastGood = { rates, updatedAt };
    return { base: "USD", rates, status: "live", updatedAt };
  } catch (error) {
    console.error("FX snapshot unavailable:", error instanceof Error ? error.message : error);
    if (lastGood && Date.now() - Date.parse(lastGood.updatedAt) < STALE_AFTER_MS) {
      return { base: "USD", rates: lastGood.rates, status: "stale", updatedAt: lastGood.updatedAt };
    }
    return { base: "USD", rates: { USD: 1 }, status: "unavailable", updatedAt: null };
  }
}

// Convenience helper for server routes that only need one currency's rate.
export async function getFxRate(currency: string): Promise<{ rate: number; status: FxSnapshot["status"]; updatedAt: string | null }> {
  const snapshot = await getFxSnapshot();
  const code = (currency || "USD").toUpperCase();
  if (code === "USD") return { rate: 1, status: snapshot.status, updatedAt: snapshot.updatedAt };
  const rate = snapshot.rates[code];
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
    // Currency not covered by the provider (e.g. KPW) - fall back to USD
    // 1:1 rather than showing a broken/zero amount.
    return { rate: 1, status: "unavailable", updatedAt: snapshot.updatedAt };
  }
  return { rate, status: snapshot.status, updatedAt: snapshot.updatedAt };
}

// ---------------------------------------------------------------------------
// Currency-aware money formatting for server-generated text
// ---------------------------------------------------------------------------
// Notification bodies, API response messages and toasts are written on the
// server, so they can't use the client-side `money()` helpers that read the
// signed-in user's currency from React state. These formatters do the same
// job server-side: hand them a user's stored `currency` preference and every
// amount comes back converted and symbolised correctly.
//
// Amounts baked into stored notification text are a snapshot of the rate at
// the moment the event happened - which is the right behaviour for a historical
// record. Live UI numbers still convert on every render via the client helpers.

export type MoneyFormatter = {
  currency: string;
  rate: number;
  // General money amounts (balances, margins, P&L, deposits, withdrawals).
  money: (amountUSD: number, digits?: number) => string;
  // Asset/market prices - extra precision for sub-unit assets.
  marketPrice: (amountUSD: number) => string;
  // Compact notation for large numbers.
  compact: (amountUSD: number) => string;
  // A USD ledger amount the user types into a USD-denominated field,
  // annotated with its converted equivalent (e.g. "$10.00 (≈ ₦14,950.00)").
  usd: (amountUSD: number, digits?: number) => string;
};

const FORMATTER_TTL_MS = 60 * 1000;
// Message formatting is cosmetic, but moneyFormatterFor() is called from
// write paths (placing a trade, opening a position, submitting a deposit).
// Those must never stall waiting on a slow rate provider, so we cap the wait
// and fall back to the last rate we saw for that currency.
const RATE_WAIT_MS = 2000;
const formatterCache = new Map<string, { at: number; formatter: MoneyFormatter }>();
// Never expires: the safety net used when a fresh rate can't be fetched in
// time. A slightly stale rate in a notification beats a blocked trade.
const lastKnownRate = new Map<string, number>();

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(fallback); },
    );
  });
}

function buildFormatter(code: string, rate: number): MoneyFormatter {
  return {
    currency: code,
    rate,
    money: (amountUSD: number, digits = 2) => formatMoney(amountUSD, code, rate, digits),
    marketPrice: (amountUSD: number) => formatMarketPrice(amountUSD, code, rate),
    compact: (amountUSD: number) => formatCompactMoney(amountUSD, code, rate),
    usd: (amountUSD: number, digits = 2) => formatUsdAmount(amountUSD, code, rate, digits),
  };
}

// Formatter for one user's preferred display currency. Results are memoised
// briefly so a background sweep touching many users doesn't refetch the
// snapshot on every notification.
export async function moneyFormatterFor(currency: string | null | undefined): Promise<MoneyFormatter> {
  const code = (currency || "USD").toUpperCase();
  const cached = formatterCache.get(code);
  if (cached && Date.now() - cached.at < FORMATTER_TTL_MS) return cached.formatter;

  // USD is the ledger currency, so it needs no rate lookup at all - this
  // keeps the common case free of any network dependency.
  const rate = code === "USD"
    ? 1
    : await withTimeout(
        getFxRate(code).then((result) => result.rate),
        RATE_WAIT_MS,
        lastKnownRate.get(code) ?? 1,
      );

  lastKnownRate.set(code, rate);
  const formatter = buildFormatter(code, rate);
  formatterCache.set(code, { at: Date.now(), formatter });
  return formatter;
}

// USD formatter for callers with no user context (e.g. system-wide logs).
export const usdFormatter: MoneyFormatter = buildFormatter("USD", 1);

// ---------------------------------------------------------------------------
// Converting an entered amount INTO the USD ledger
// ---------------------------------------------------------------------------
// Used by admin funding actions, where the admin picks a currency and types an
// amount in it. The ledger only ever stores USD, so the amount has to be
// converted - and this must happen on the server. A client-supplied converted
// figure can't be trusted for something that moves money.
//
// This deliberately REFUSES to guess. Falling back to 1:1 for an unsupported or
// unrateable currency would credit e.g. $1,331 instead of $1 for an NGN amount,
// so those cases return an error and the admin is told to enter USD instead.
// A "stale" rate (the provider was briefly down, yesterday's cached rates are
// still being served) IS accepted - FX moves slowly, and blocking an admin from
// funding an account over a transient provider outage is worse than a rate that
// is a few hours old. The status is returned so callers can disclose it.

export type UsdConversion =
  | { ok: true; usd: number; rate: number; currency: string; status: FxSnapshot["status"] }
  | { ok: false; error: string };

const round2 = (value: number) => Math.round(value * 100) / 100;

// The way out differs by audience, so the rejection has to say the right thing.
// Admin funding forms have a currency selector, so the admin can simply retype
// the figure in USD. User-facing forms follow the profile currency and have no
// selector, so the only route back is to change that preference.
export const USD_ADVICE_ADMIN = "Enter the amount in USD instead.";
export const USD_ADVICE_USER = "Switch your display currency to USD on your profile, then try again.";

export async function convertToUsd(
  amount: number,
  currency: string | null | undefined,
  advice: string = USD_ADVICE_ADMIN,
): Promise<UsdConversion> {
  const code = (currency || "USD").trim().toUpperCase();
  if (!Number.isFinite(amount) || amount < 0) return { ok: false, error: "Enter a valid amount." };
  if (code === "USD") return { ok: true, usd: round2(amount), rate: 1, currency: "USD", status: "live" };
  if (!/^[A-Z]{3}$/.test(code)) return { ok: false, error: "Choose a valid currency." };

  const snapshot = await getFxSnapshot();
  if (snapshot.status === "unavailable") {
    return { ok: false, error: `Live exchange rates are unavailable right now, so ${code} amounts can't be converted safely. ${advice}` };
  }
  const rate = snapshot.rates[code];
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
    return { ok: false, error: `No exchange rate is available for ${code}. ${advice}` };
  }
  return { ok: true, usd: round2(amount / rate), rate, currency: code, status: snapshot.status };
}

// "1 USD = ₦1,331.2756" - the rate disclosure shown alongside a conversion so
// an admin can see exactly what was applied.
export async function rateLabel(currency: string): Promise<string> {
  const code = (currency || "USD").trim().toUpperCase();
  if (code === "USD") return "1 USD = $1.0000";
  const { rate } = await getFxRate(code);
  return `1 USD = ${formatInCurrency(rate, code, 4)}`;
}

// Confirmation text for an admin funding action: the USD value actually stored
// in the ledger, plus - when the admin entered a different currency - exactly
// what they typed and the rate that was applied. Money-moving admin actions
// should be auditable at a glance, and echoing the typed figure verbatim (via
// formatInCurrency, which applies no rate) avoids showing a number that
// differs from what's still on screen in the form.
export function convertedAmountLabel(
  conversion: Extract<UsdConversion, { ok: true }>,
  enteredAmount: number,
): string {
  const stored = formatMoney(conversion.usd, "USD", 1);
  if (conversion.currency === "USD") return stored;
  const rateText = formatInCurrency(conversion.rate, conversion.currency, 4);
  const stale = conversion.status === "stale" ? ", rate may be slightly delayed" : "";
  return `${stored} (entered ${formatInCurrency(enteredAmount, conversion.currency)} · 1 USD = ${rateText}${stale})`;
}

// Price-level conversion, for fields where the user types a MARKET PRICE rather
// than an amount of money: limit/stop trigger prices, take-profit, stop-loss and
// price-alert targets.
//
// Same safety rule as convertToUsd (refuse rather than guess - a wrong trigger
// price fills an order at the wrong moment), but a different rounding rule:
// money is stored at 2dp, whereas prices are stored at 8dp and can legitimately
// be tiny (a memecoin at $0.00001234). Rounding those to cents would destroy
// them, so this keeps 12 decimals - comfortably beyond the 8 the schema stores.
export async function convertPriceToUsd(price: number, currency: string | null | undefined): Promise<UsdConversion> {
  const code = (currency || "USD").trim().toUpperCase();
  if (!Number.isFinite(price) || price <= 0) return { ok: false, error: "Enter a valid price." };
  if (code === "USD") return { ok: true, usd: price, rate: 1, currency: "USD", status: "live" };
  if (!/^[A-Z]{3}$/.test(code)) return { ok: false, error: "Choose a valid currency." };

  const snapshot = await getFxSnapshot();
  if (snapshot.status === "unavailable") {
    return { ok: false, error: `Live exchange rates are unavailable right now, so ${code} prices can't be converted safely. Switch your display currency to USD and try again.` };
  }
  const rate = snapshot.rates[code];
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
    return { ok: false, error: `No exchange rate is available for ${code}. Switch your display currency to USD and try again.` };
  }
  return { ok: true, usd: Number((price / rate).toFixed(12)), rate, currency: code, status: snapshot.status };
}
