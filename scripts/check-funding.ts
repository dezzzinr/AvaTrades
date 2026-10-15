// Tests for admin funding-currency conversion: an admin picks a currency and
// types an amount in it, the ledger stores USD.
//
// Run with: ./node_modules/.bin/tsx scripts/check-funding.ts
// Exits non-zero if any assertion fails.
//
// Phase 1 runs with fetch stubbed to reject, which puts the FX layer in its
// "unavailable" state. That's the safety-critical case: converting at 1:1
// would credit $1,331 instead of $1 for an NGN amount, so those requests must
// be REFUSED - while USD funding must keep working, since it needs no rate.
// Phase 2 restores real fetch and checks conversions against live rates.

import { convertToUsd, convertPriceToUsd, convertedAmountLabel, rateLabel, type UsdConversion } from "../src/lib/fx-server";
import { formatInCurrency, formatMoney } from "../src/lib/currency";

let pass = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail = "") {
  if (condition) { pass += 1; console.log(`  PASS  ${label}${detail ? ` (${detail})` : ""}`); }
  else { failures.push(label); console.log(`  FAIL  ${label}${detail ? ` (${detail})` : ""}`); }
}

const ok = (r: UsdConversion) => r.ok ? r : null;
const near = (a: number, b: number, tol = 0.02) => Math.abs(a - b) <= tol;

async function main() {
  const realFetch = globalThis.fetch;

  // ---------------------------------------------------------------------
  console.log("\nPhase 1 - FX provider unreachable (status: unavailable)");
  // ---------------------------------------------------------------------
  globalThis.fetch = (async () => { throw new Error("injected network failure"); }) as typeof fetch;

  const usdWhileDown = await convertToUsd(1000, "USD");
  check("USD funding still works with FX completely down", ok(usdWhileDown)?.usd === 1000, JSON.stringify(usdWhileDown));

  const ngnWhileDown = await convertToUsd(1331275.65, "NGN");
  check("NGN funding is REFUSED with no rate (never guesses 1:1)", !ngnWhileDown.ok,
    ngnWhileDown.ok ? `usd=${ngnWhileDown.usd}` : ngnWhileDown.error);
  check("...and the refusal tells the admin to use USD",
    !ngnWhileDown.ok && /USD instead/i.test(ngnWhileDown.error), ngnWhileDown.ok ? "" : ngnWhileDown.error);

  const gbpWhileDown = await convertToUsd(754.72, "GBP");
  check("GBP funding is refused too (not just NGN)", !gbpWhileDown.ok);

  globalThis.fetch = realFetch;

  // ---------------------------------------------------------------------
  console.log("\nPhase 2 - live rates");
  // ---------------------------------------------------------------------
  const ngn = await convertToUsd(1331275.65, "NGN");
  const ngnOk = ok(ngn);
  check("NGN 1,331,275.65 converts to ~$1,000 USD", !!ngnOk && near(ngnOk.usd, 1000, 2), ngnOk ? `usd=${ngnOk.usd} rate=${ngnOk.rate}` : ngn.ok ? "" : ngn.error);
  check("...rate is a real NGN rate (>100), not a 1:1 fallback", !!ngnOk && ngnOk.rate > 100, ngnOk ? String(ngnOk.rate) : "");
  check("...status is live or stale (both acceptable)", !!ngnOk && (ngnOk.status === "live" || ngnOk.status === "stale"), ngnOk?.status);

  const gbp = ok(await convertToUsd(754.72, "GBP"));
  check("GBP 754.72 converts to ~$1,000 USD", !!gbp && near(gbp.usd, 1000, 5), gbp ? `usd=${gbp.usd}` : "");

  // Rounding: the ledger stores 2dp, so a conversion must not smuggle in
  // sub-cent precision that would drift away from the stored value.
  const rounded = ok(await convertToUsd(1000, "NGN"));
  check("converted USD is rounded to 2 decimal places",
    !!rounded && Number(rounded.usd.toFixed(2)) === rounded.usd, rounded ? String(rounded.usd) : "");

  // Input validation
  check("negative amount rejected", !(await convertToUsd(-5, "NGN")).ok);
  check("NaN amount rejected", !(await convertToUsd(Number.NaN, "NGN")).ok);
  check("malformed currency code rejected", !(await convertToUsd(10, "DOLLARS")).ok);
  check("unknown 3-letter code rejected (provider has no rate)", !(await convertToUsd(10, "ZZZ")).ok);

  // Defaults / normalisation
  const noCurrency = ok(await convertToUsd(250, undefined));
  check("omitted currency means USD (existing admin clients keep working)", noCurrency?.usd === 250 && noCurrency.currency === "USD");
  const lower = ok(await convertToUsd(250, " usd "));
  check("currency code is trimmed and case-normalised", lower?.usd === 250);

  // ---------------------------------------------------------------------
  console.log("\nConfirmation labels (what the admin sees after saving)");
  // ---------------------------------------------------------------------
  if (ngnOk) {
    const label = convertedAmountLabel(ngnOk, 1331275.65);
    check("label leads with the USD amount actually stored", label.startsWith("$"), label);
    check("label echoes the typed amount verbatim", label.includes(formatInCurrency(1331275.65, "NGN")), label);
    check("label discloses the rate applied", /1 USD = /.test(label), label);
    // The echo must equal what the admin typed - if it were re-derived from the
    // rounded USD value it would drift (e.g. 1,331,275.65 -> 1,331,281.03).
    check("echoed amount has no rounding drift from the input",
      label.includes("1,331,275.65"), label);
  }
  const usdLabel = convertedAmountLabel({ ok: true, usd: 1000, rate: 1, currency: "USD", status: "live" }, 1000);
  check("USD entry produces a plain amount, no redundant parenthetical", usdLabel === formatMoney(1000, "USD", 1), usdLabel);

  const staleLabel = convertedAmountLabel({ ok: true, usd: 10, rate: 0.8, currency: "GBP", status: "stale" }, 8);
  check("stale rate is disclosed to the admin", /slightly delayed/.test(staleLabel), staleLabel);

  // ---------------------------------------------------------------------
  console.log("\nformatInCurrency (pure echo helper, applies no rate)");
  // ---------------------------------------------------------------------
  check("NGN echo keeps the naira sign", formatInCurrency(1331275.65, "NGN") === "₦1,331,275.65", formatInCurrency(1331275.65, "NGN"));
  check("GBP echo keeps the pound sign", formatInCurrency(754.72, "GBP") === "£754.72", formatInCurrency(754.72, "GBP"));
  check("rate echo uses 4 decimals", /1 USD = .*\d\.\d{4}/.test(await rateLabel("NGN")), await rateLabel("NGN"));
  check("USD rate label", (await rateLabel("USD")) === "1 USD = $1.0000", await rateLabel("USD"));

  // -------------------------------------------------------------------
  console.log("\nPrice-level conversion (limit / TP / SL / alert targets)");
  // -------------------------------------------------------------------
  // Prices are stored at 8dp and can legitimately be tiny, so these must NOT be
  // rounded to cents the way money amounts are.
  const btcNgn = ok(await convertPriceToUsd(110745120.5, "NGN"));
  check("large NGN price converts to a sane USD price", !!btcNgn && btcNgn.usd > 1000 && btcNgn.usd < 200000, btcNgn ? String(btcNgn.usd) : "");

  const tinyGbp = ok(await convertPriceToUsd(0.0000092, "GBP"));
  check("tiny price keeps sub-cent precision (not rounded to 0.00)",
    !!tinyGbp && tinyGbp.usd > 0 && tinyGbp.usd < 0.0001, tinyGbp ? tinyGbp.usd.toExponential(4) : "");
  check("...and survives the schema's 8dp storage",
    !!tinyGbp && Number(tinyGbp.usd.toFixed(8)) > 0, tinyGbp ? tinyGbp.usd.toFixed(12) : "");

  const usdPrice = ok(await convertPriceToUsd(83192.13, "USD"));
  check("USD price passes through untouched", usdPrice?.usd === 83192.13, String(usdPrice?.usd));

  check("zero price rejected", !(await convertPriceToUsd(0, "NGN")).ok);
  check("negative price rejected", !(await convertPriceToUsd(-5, "NGN")).ok);
  check("price in an unrateable currency rejected", !(await convertPriceToUsd(100, "ZZZ")).ok);

  // Round-trip: converting a price to USD and rendering it back in the user's
  // currency must reproduce what they typed, or the chart and the field disagree.
  if (btcNgn) {
    const back = btcNgn.usd * btcNgn.rate;
    check("price round-trips to within a kobo of what was typed",
      Math.abs(back - 110745120.5) < 0.01, `${back.toFixed(4)} vs 110745120.5`);
  }

  console.log(`\n${failures.length === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${failures.length} failed`);
  if (failures.length) { failures.forEach((f) => console.log(`  - ${f}`)); process.exit(1); }
}

main().catch((error) => { console.error(error); process.exit(1); });
