# Currency switch now applies site-wide

**The problem:** the display-currency setting (Profile → Display currency) only
converted *some* of what a user saw. The dashboard balances/prices converted, but
the admin panel was hardcoded to USD, deposit/withdrawal forms gave no converted
figures, and every server-written message — toasts, notifications, emails and
transaction-history descriptions — said `$` regardless of the user's choice.
Non-USD currencies also rendered as `NGN 1,234.00` instead of `₦1,234.00`.

**The fix:** one currency-aware formatting layer, used by every surface.

The ledger is unchanged — all balances, trades, orders, positions and
transactions are still stored and computed in USD. Only *display* converts.

---

## 1. The formatting layer

| File | Change |
|---|---|
| `src/lib/currency.ts` | **Fixed symbol rendering.** `Intl.NumberFormat` now uses `currencyDisplay: "narrowSymbol"`, so NGN shows `₦`, GHS `GH₵`, ZAR `R`, INR `₹`, etc. instead of the ISO code. Currencies that narrow-symbol would collapse to a bare `$` (CAD, AUD, HKD, SGD, NZD…) keep their unambiguous form (`CA$`, `A$`) so they're never mistaken for USD. Formatters are cached. Added `formatUsdAmount()`. |
| `src/lib/fx-server.ts` | New `MoneyFormatter` + `moneyFormatterFor(currency)` — the server-side equivalent of the client helpers, so API routes and background jobs can format in a given user's currency. Memoised 60s so sweeps don't refetch rates. |
| `src/lib/accounts.ts` | `tradeLimitMessage()` accepts an optional currency-aware labeler. |
| `src/lib/market.ts` | Its USD-only helpers are now documented as internal/catalog-only, to stop them creeping back into user-facing text. |

`formatUsdAmount` exists because trade/margin/deposit **input fields are
USD-denominated** (that's what the ledger charges). Threshold messages therefore
show both, e.g. `Margin must be between $10 (≈ ₦13,312.76) and $10,000,000 (≈ …)` —
tied to the field being filled in, but readable in the user's currency.

## 2. Admin panel — was entirely hardcoded USD

| File | Change |
|---|---|
| `src/app/api/admin/me/route.ts` | Now returns the admin's `currency` plus a live FX snapshot (same shape `/api/app` returns). |
| `src/app/admin/page.tsx` | Dropped the hardcoded `USD`-only `money()`; every amount in the panel now formats through the admin's own currency — overview totals, the users table (balance/profits/target), user detail (trades, transactions, subscriptions, deposit & withdrawal requests), and the traders/bots/plans catalogs. Topbar shows an "Amounts in NGN" badge when not USD. Trade prices use the precision-aware market-price formatter. |

Admin **input** labels (`New balance ($)`, `Starting balance ($)`, etc.) stay USD —
those write ledger values.

## 3. Trading area

| File | Change |
|---|---|
| `src/app/page.tsx` | Added `usdAmount()` helper; margin-minimum error, price-alert confirmation and limit-order confirmation now match the user's currency. |
| `src/app/api/app/route.ts` | Trade confirmations/notifications, "insufficient balance — X already committed", minimum trade value, and the account trade-limit message. |
| `src/app/api/orders/route.ts` | Order-placed notification, immediate-fill message, reserved-balance error, minimum order value, trade-limit message. |
| `src/app/api/positions/route.ts` | Margin range error, the ledger description written on open, and the opened-position notification/response. |
| `src/app/api/positions/[id]/route.ts` | Close-position ledger description, notification and response (incl. signed P&L). |
| `src/app/api/price-alerts/route.ts` | Alert-created confirmation. |
| `src/lib/trading-engine.ts` | **Background events** — order fills, order expiry, take-profit/stop-loss/liquidation closes, duration expiry and price-alert triggers. These fire for whichever user a sweep touches, so their currency is looked up per event (cached). Both the notification *and* the transaction-history description are now in that user's currency. |

## 4. Deposits & withdrawals

| File | Change |
|---|---|
| `src/app/page.tsx` | Added a live `≈ converted` hint under both the deposit and withdrawal amount fields (matching the trading forms), and the withdrawal quick-amount buttons (100/500/1000/5000) now render in the user's currency. |
| `src/app/api/deposits/route.ts` | Minimum-amount error and the "request submitted" notification. |
| `src/app/api/withdrawals/route.ts` | Same. |
| `src/app/api/admin/deposits/[id]/route.ts` | Approve/reject notification goes to the *user*, so it's formatted in the **user's** currency. |
| `src/app/api/admin/withdrawals/[id]/route.ts` | Same. |

## 5. Other server-written text

| File | Change |
|---|---|
| `src/app/api/admin/users/[id]/balance/route.ts` | Two audiences, two currencies: the admin's confirmation toast uses the **admin's** currency, the credited/debited notification uses the **target user's**. |
| `src/app/api/admin/users/[id]/profit/route.ts` | Same pattern. |
| `src/app/api/admin/users/[id]/target-balance/route.ts` | Same pattern. |
| `src/app/api/admin/users/[id]/trades/route.ts` | Admin-placed trade confirmation + minimum trade value. |
| `src/app/api/auth/route.ts` | Referral bonus: the referrer's notification uses the referrer's currency, the new user's welcome message uses theirs (derived from country at signup). |
| `src/app/api/bot-instances/route.ts`, `.../[id]/route.ts` | Minimum-allocation errors. |

## 6. Bug fixed in the switch itself

`src/app/api/profile/route.ts` + `src/components/profile-page.tsx`: changing the
currency returned no fresh rate, so the "1 USD ≈ X" hint under the selector kept
showing the *previous* currency's rate until a full page reload. PATCH now returns
a fresh FX snapshot when the currency changed, and the profile page applies it
immediately. (The rest of the app already refreshed via `onProfileUpdated()` →
`/api/app`.)

---

## 7. Write-path latency protection

`moneyFormatterFor()` is now called from write paths (placing a trade, opening a
position, submitting a deposit/withdrawal), and the FX provider can be slow. A
cosmetic detail like a notification's currency symbol must never stall a trade, so
the rate lookup is capped:

- **USD short-circuits** — it's the ledger currency, so no rate lookup or network
  call happens at all (0ms).
- **Non-USD waits at most 2s**, then falls back to the last rate seen for that
  currency; if there is none, to 1:1.
- Formatters are memoised 60s per currency, so a background sweep touching many
  users costs one lookup per currency per minute.

Measured with the provider made unreachable (hanging fetch, then rejecting fetch):

| Scenario | Time | Result |
|---|---|---|
| Healthy provider, first NGN lookup | 100ms | rate 1331.275645 → `₦13,312.76` |
| USD while provider hangs | 0ms | `$10.00` (no network touched) |
| NGN cached, provider hangs | 0ms | `₦13,312.76` (last known rate) |
| NGN cached, provider rejects | 0ms | `₦13,312.76` (last known rate) |
| Brand-new currency (GHS), provider hangs | 2002ms | cap hit → 1:1 fallback, `GH₵10.00` |
| NGN after provider recovers | 0ms | live rate again |

Worst case is a 2s wait on the *first* message ever formatted for a currency while
the provider is down — and it degrades to a 1:1 rate rather than blocking.

## 8. Rounding defect found and fixed during testing

The first end-to-end run surfaced a genuine defect in my own change: threshold
messages passed `0` decimal places, so a $1 minimum rendered as
`"Enter a valid amount of at least $1 (≈ £1)"` — £1 is wrong (it's £0.75) and
reads as though the minimum were higher than it is. Small thresholds must keep
their decimals; only very large round caps read better without them.

| Before | After |
|---|---|
| `at least $1 (≈ £1)` | `at least $1.00 (≈ £0.75)` |
| `between $10 (≈ £8) and $1,000,000 (≈ £754,721)` | `between $10.00 (≈ £7.55) and $1,000,000 (≈ £754,721)` |

Fixed in `src/app/api/deposits/route.ts`, `src/app/api/withdrawals/route.ts`,
`src/app/api/positions/route.ts` and `src/app/page.tsx`. `MAX_MARGIN` keeps 0
digits deliberately — `$1,000,000.00 (≈ £754,721.00)` is just noise at that scale.

## Verification

- `npm run typecheck` — clean.
- `npm run build` — clean (all routes compile, static pages generate).
- `npm run lint` — no new problems; the remaining warnings/errors are pre-existing
  (`setState` in effects, `<img>` vs `next/image`, unescaped apostrophes) in files
  and lines this change didn't touch.
- `scripts/check-currency.ts` — 25/25 formatting assertions pass:
  ```bash
  ./node_modules/.bin/tsx scripts/check-currency.ts
  ```
  Covers balances, negative P&L, sub-unit price precision, compact market caps,
  USD-threshold annotations, non-finite input, zero/invalid rates, invalid
  currency codes, and the CAD-stays-`CA$` ambiguity guard.
- Live end-to-end check of `moneyFormatterFor()` against the real FX provider:
  `USD → $1,250.00`, `NGN → ₦1,664,094.56` (rate 1331.27564), `GBP → £943.40`,
  `null → USD`, invalid code → graceful `CODE 1,250.00` fallback. Repeat lookups
  hit the cache in 0ms.
- Rate-provider failure injection (hanging fetch, then rejecting fetch) — see the
  table in section 7. No path blocks a write for more than the 2s cap.
- **Full end-to-end run against a real Postgres database and live CoinGecko +
  FX rates.** Two accounts on *different* currencies (Ada = GBP, Admin = NGN) to
  prove the split-audience paths. Actual server responses:

  | Flow | Result |
  |---|---|
  | Register with country `NG` | currency auto-set to `NGN`, live rate 1331.275645 |
  | `PATCH /api/profile` → GBP | returns **fresh** `fx` (rate 0.754721) — the stale-rate bug is gone |
  | `GET /api/app` after switch | `fx.currency: GBP`, ledger still `1000` USD |
  | Price alert at $100,000 | `We'll notify you when BTC goes above £75,472.10.` |
  | Buy 0.005 BTC | `Bought 0.005 BTC at £62,834.30` |
  | Open 5x long ETH | `Opened 5x long ETH position at £1,886.49. Liquidation at £1,509.19.` |
  | Stored ledger description | `Opened 5x long ETH position (margin £150.94, entry £1,886.49)` |
  | Close position (signed P&L) | `Position closed at £1,886.06 (-£0.17 P&L).` |
  | Limit order filled **by the background engine** | `Your buy order for 0.002 BTC filled at £62,834.30.` |
  | Admin (NGN) sets Ada's balance | admin toast `Balance updated to ₦1,331,275.65.` / Ada's notification `An admin credited £754.72 to your account balance.` |
  | Ada submits $250 deposit | `Your £188.68 deposit request via crypto was submitted…` |
  | Admin (NGN) approves it | Ada notified `Your £188.68 Cryptocurrency deposit was approved and credited to your balance.` |
  | Ada withdraws $100 | `Your £75.47 withdrawal request…` → admin approves → `Your £75.47 Cryptocurrency withdrawal was approved and marked as sent.` |
  | `/`, `/admin`, `/reset-password` | all HTTP 200 |

  No 500s and no unhandled errors anywhere in the run; the only non-200s were the
  deliberate validation probes. Note the `₦` in the admin toast — that's the
  `narrowSymbol` fix from section 1 (it would previously have read `NGN 1,331,275.65`).

## Behaviour notes

- **Stored** notification text and transaction descriptions are a snapshot of the
  rate at the moment the event happened — correct for a historical record. Live UI
  numbers re-convert on every render.
- If the FX provider is unreachable, rates fall back to 1:1 with
  `status: "unavailable"` — the pre-existing behaviour, unchanged.
- Demo accounts can't reach most of these paths (trading/deposits are blocked
  server-side for demo users), which is unchanged.
