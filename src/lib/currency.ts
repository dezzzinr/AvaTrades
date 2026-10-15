// Client-side currency display helpers. Every dollar amount in the app's
// data model (balances, prices, P&L, transactions) is stored and computed in
// USD; these helpers only convert *how it's displayed* to the signed-in
// user's preferred currency, using a USD -> currency rate supplied by the
// server (see src/lib/fx-server.ts). Nothing here should ever be used for
// ledger math - only for rendering text.

const SYMBOL_FALLBACKS: Record<string, string> = {
  // Used only when Intl can't format a code at all (e.g. a retired/invalid
  // currency), so the amount still renders with a recognisable prefix
  // instead of throwing.
  NGN: "₦", GBP: "£", EUR: "€", USD: "$", JPY: "¥", INR: "₹", KRW: "₩",
  GHS: "GH₵", KES: "KSh", ZAR: "R", EGP: "E£", TZS: "TSh", UGX: "USh",
  XOF: "CFA", XAF: "FCFA", MAD: "DH", AED: "AED", SAR: "SR",
};

export function currencySymbol(currency: string): string {
  return SYMBOL_FALLBACKS[currency.toUpperCase()] ?? currency.toUpperCase() + " ";
}

// Intl's default currency display spells out the ISO code for many
// currencies that have a perfectly good symbol - an NGN user would see
// "NGN 18,810,750.00" instead of "₦18,810,750.00". `narrowSymbol` fixes
// that (₦, GH₵, R, ₹, ₩, ₽, ₺, ₫, ...) but it also collapses several
// dollar currencies (CAD, AUD, HKD, SGD, NZD...) to a bare "$", which is
// genuinely ambiguous sitting next to USD amounts - so those keep the
// default display ("CA$", "A$", ...).
const formatterCache = new Map<string, Intl.NumberFormat>();

function formatterFor(currency: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const code = currency.toUpperCase();
  const cacheKey = code + JSON.stringify(options);
  const cached = formatterCache.get(cacheKey);
  if (cached) return cached;
  const base: Intl.NumberFormatOptions = { style: "currency", currency: code, ...options };
  let formatter: Intl.NumberFormat;
  try {
    const narrow = new Intl.NumberFormat("en-US", { ...base, currencyDisplay: "narrowSymbol" });
    const symbol = narrow.formatToParts(1).find((part) => part.type === "currency")?.value ?? "";
    formatter = code !== "USD" && symbol === "$" ? new Intl.NumberFormat("en-US", base) : narrow;
  } catch {
    // narrowSymbol unsupported, or the code isn't a valid ISO currency.
    formatter = new Intl.NumberFormat("en-US", base);
  }
  formatterCache.set(cacheKey, formatter);
  return formatter;
}

function fmt(amount: number, currency: string, options: Intl.NumberFormatOptions): string {
  try {
    return formatterFor(currency, options).format(amount);
  } catch {
    // Unknown/unsupported currency code - fall back to a plain prefixed number.
    return currencySymbol(currency) + amount.toLocaleString("en-US", { minimumFractionDigits: options.minimumFractionDigits ?? 2, maximumFractionDigits: options.maximumFractionDigits ?? 2 });
  }
}

// Formats an amount that is ALREADY denominated in `currency` - no rate is
// applied. Used to echo back exactly what someone typed (e.g. an admin
// funding an account in NGN), where running the figure through the USD
// helpers would reintroduce rounding and no longer match the input.
export function formatInCurrency(amount: number, currency: string, digits = 2): string {
  if (!Number.isFinite(amount)) return "—";
  return fmt(amount, currency, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// General money amounts (balances, totals, transactions).
export function formatMoney(amountUSD: number, currency: string, rate: number, digits = 2): string {
  if (!Number.isFinite(amountUSD)) return "—";
  return fmt(amountUSD * (Number.isFinite(rate) && rate > 0 ? rate : 1), currency, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// Asset/market prices - needs more precision for sub-$1 (or sub-unit)
// assets, based on the *converted* magnitude so it reads naturally in any
// currency.
export function formatMarketPrice(amountUSD: number, currency: string, rate: number): string {
  if (!(amountUSD > 0) || !Number.isFinite(amountUSD)) return "—";
  const effectiveRate = Number.isFinite(rate) && rate > 0 ? rate : 1;
  const converted = amountUSD * effectiveRate;
  const digits = converted >= 1 ? 2 : converted >= 0.1 ? 4 : converted >= 0.0001 ? 6 : 8;
  return fmt(converted, currency, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// Compact notation for big numbers (market cap, volume, etc.)
export function formatCompactMoney(amountUSD: number, currency: string, rate: number): string {
  if (!Number.isFinite(amountUSD) || amountUSD <= 0) return "—";
  return fmt(amountUSD * (Number.isFinite(rate) && rate > 0 ? rate : 1), currency, { notation: "compact", maximumFractionDigits: 2 });
}

// A USD ledger amount, annotated with its converted equivalent when the
// viewer is displaying in another currency. Use this for values the user
// types into USD-denominated fields (trade size, margin, order price, trade
// limits) - the message stays tied to the field they're filling in, while
// still reading naturally in the currency they've chosen:
//   USD viewer: "$10.00"
//   NGN viewer: "$10.00 (≈ ₦14,950.00)"
export function formatUsdAmount(amountUSD: number, currency: string, rate: number, digits = 2): string {
  if (!Number.isFinite(amountUSD)) return "—";
  const usd = "$" + amountUSD.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const code = (currency || "USD").toUpperCase();
  if (code === "USD") return usd;
  return `${usd} (≈ ${formatMoney(amountUSD, code, rate, digits)})`;
}
