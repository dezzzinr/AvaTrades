// Quick verification of the currency-display helpers used across the app.
// Run with: ./node_modules/.bin/tsx scripts/check-currency.ts
import { formatMoney, formatMarketPrice, formatCompactMoney, formatUsdAmount, currencySymbol } from "../src/lib/currency";

const NGN = 1500; // pretend USD->NGN rate
const GBP = 0.79;

const rows: [string, string, string][] = [];
const check = (label: string, actual: string, expected: string) => {
  rows.push([label, actual, actual === expected ? "PASS" : `FAIL (want ${expected})`]);
};

// Balances / money amounts
check("money NGN 12540.50", formatMoney(12540.5, "NGN", NGN), "₦18,810,750.00");
check("money GBP 12540.50", formatMoney(12540.5, "GBP", GBP), "£9,907.00");
check("money USD 12540.50", formatMoney(12540.5, "USD", 1), "$12,540.50");
check("money NGN 0 digits", formatMoney(100, "NGN", NGN, 0), "₦150,000");
check("money negative (P&L)", formatMoney(-42.5, "NGN", NGN), "-₦63,750.00");
check("money non-finite", formatMoney(NaN, "NGN", NGN), "—");
check("money bad rate falls back 1:1", formatMoney(10, "NGN", 0), "₦10.00");

// Market prices - precision scales with converted magnitude
check("price NGN 60000", formatMarketPrice(60000, "NGN", NGN), "₦90,000,000.00");
check("price NGN 0.5 (sub-unit)", formatMarketPrice(0.5, "NGN", NGN), "₦750.00");
check("price USD 0.00001234", formatMarketPrice(0.00001234, "USD", 1), "$0.00001234");
check("price GBP 0.05", formatMarketPrice(0.05, "GBP", GBP), "£0.039500");
check("price zero", formatMarketPrice(0, "NGN", NGN), "—");

// Compact (market cap / volume)
check("compact NGN 1.2e9", formatCompactMoney(1.2e9, "NGN", NGN), "₦1.80T");
check("compact USD 1.2e9", formatCompactMoney(1.2e9, "USD", 1), "$1.20B");

// USD-input thresholds annotated with the converted equivalent
check("usd NGN 10", formatUsdAmount(10, "NGN", NGN), "$10.00 (≈ ₦15,000.00)");
check("usd NGN 10, 0 digits", formatUsdAmount(10, "NGN", NGN, 0), "$10 (≈ ₦15,000)");
check("usd USD 10 (no annotation)", formatUsdAmount(10, "USD", 1), "$10.00");
check("usd GBP 1", formatUsdAmount(1, "GBP", GBP), "$1.00 (≈ £0.79)");

// Unknown currency code falls back to a prefixed number rather than throwing
check("invalid code hits fallback", formatMoney(5, "NOT_A_CODE", 2), "NOT_A_CODE 10.00");
check("CAD stays unambiguous", formatMoney(100, "CAD", 1.36), "CA$136.00");
check("GHS narrow symbol", formatMoney(100, "GHS", 15.2), "GH₵1,520.00");
check("ZAR narrow symbol", formatMoney(100, "ZAR", 18.4), "R\u00A01,840.00");
check("KES keeps code", formatMoney(100, "KES", 129), "KES\u00A012,900.00");
check("symbol NGN", currencySymbol("NGN"), "₦");
check("symbol lowercase input", currencySymbol("ngn"), "₦");

let failures = 0;
for (const [label, actual, verdict] of rows) {
  if (!verdict.startsWith("PASS")) failures++;
  console.log(`${verdict.startsWith("PASS") ? "ok  " : "FAIL"}  ${label.padEnd(34)} -> ${actual}${verdict.startsWith("PASS") ? "" : "   " + verdict}`);
}
console.log(`\n${rows.length - failures}/${rows.length} passed`);
process.exit(failures ? 1 : 0);
