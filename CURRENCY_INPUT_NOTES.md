# Typing in your own currency: deposits, withdrawals and trading

**What was asked for:** "On the withdrawal and deposit pages and trading features there are still
hardcoded USD texts — check and make sure everything is in order."

**What was wrong:** every balance, price and P&L *display* already converted to the user's currency, but
every *input* was still hardcoded USD. Users read a chart in naira and then had to type into a field
labelled `$ … USD`. The worst case was the limit-order price: its placeholder was pre-filled with the
raw USD price (`83192`) while the chart directly above showed `₦108,609,460.95` — so a Nigerian user
typing the number they could see would have placed an order 1,331× off.

**What this does:** amount and price fields are now entered in the user's own display currency, with the
server converting to the USD ledger. Confirmed scope decisions: convert **all** inputs including price
levels, and use the **profile currency automatically** (no per-field selector).

Companion to `CURRENCY_FIX_NOTES.md` (display) and `ADMIN_FUNDING_CURRENCY_NOTES.md` (admin funding).

---

## 1. Fields converted

| Area | Field | Route |
| --- | --- | --- |
| Trade | Amount (quick trade + spot order) | `POST /api/app` (`action: trade`) |
| Trade | Limit / stop / take-profit **trigger price** | `POST /api/orders` |
| Trade | Amount spent on an order | `POST /api/orders` |
| Margin | Margin (collateral) | `POST /api/positions` |
| Margin | Take-profit price, stop-loss price | `POST /api/positions` |
| Alerts | Target price | `POST /api/price-alerts` |
| Bots | Allocation amount | `POST /api/bot-instances` |
| Deposit | Amount you sent | `POST /api/deposits` |
| Withdrawal | Amount to withdraw (+ quick-amount buttons) | `POST /api/withdrawals` |
| Admin | Custom fill price on a manual trade | `POST /api/admin/users/[id]/trades` |

Labels, the `₦`/`$` prefix and the currency-code suffix now follow the user's currency, and the
`{symbol}/USD` pair label became `{symbol}/{currency}`.

## 2. The ledger is still USD

No storage changed. Balances, orders, positions, trades, deposits, withdrawals and alerts all still hold
USD. A currency only affects how a figure is *typed* and how it's converted on the way in.

Verified against the live database for a user displaying NGN (rate 1 USD = ₦1,331.275645):

```
positions:  ETH margin=1000.00 entry=2417.63 tp=2659.39299896 sl=2296.74849944 liq=1934.104
orders:     BTC qty=0.00612872 trigger=81583.00000298 status=filled
alerts:     BTC above target=81583.00000298
deposits:   amount=250.00     withdrawals: amount=100.00
bots:       amount=600.00     users.cash_balance: 17500.00 (USD)
```

## 3. Two different rounding rules — money vs. price

This is the part that would have silently broken things if treated uniformly.

- **Money** (deposit, withdrawal, margin, allocation, trade amount) → `convertToUsd()`, rounded to **2dp**,
  because the ledger stores cents.
- **Price levels** (trigger price, TP, SL, alert target, manual fill price) → `convertPriceToUsd()`,
  kept to **12 decimals**, because prices are stored at 8dp and can legitimately be tiny.

Rounding a price to cents would destroy it: a memecoin target of `£0.0000092` would become `£0.00` and
the alert would never fire. Test:

```
PASS  tiny price keeps sub-cent precision (not rounded to 0.00)   -> 1.2190e-5
PASS  ...and survives the schema's 8dp storage                    -> 0.000012189935
PASS  price round-trips to within a kobo of what was typed        -> 110745120.5000 vs 110745120.5
```

## 4. Quantity is now derived server-side

Previously the browser computed `quantity = amount / price` and sent the quantity. With amounts typed in
a foreign currency that would have made the client's exchange rate authoritative for the size of a
position — a stale rate would silently produce a wrong order.

Now the client sends the **typed amount and its currency**, and `/api/app` and `/api/orders` convert and
derive quantity themselves from their own live price. The quantity shown in the confirm dialog is a
preview; the server's figure is what's stored. A raw `quantity` is still accepted for any other caller.

## 5. Three unit-mismatch bugs this exposed and fixed

Converting inputs surfaced places where a local-currency figure was being compared against a USD one.
All three were live bugs:

| Where | Bug | Fix |
| --- | --- | --- |
| Withdrawal | `amount > data.user.cashBalance` compared ₦ to $ — a NGN user was told they could withdraw **1,331× their actual balance** | compare `usdOf(amount)` to the USD balance |
| Bot allocation | `amount < bot.minAllocation` compared ₦ to a USD minimum | compare `usdOf(amount)` |
| Margin | `margin < MIN_MARGIN` compared ₦ to a USD floor of $10 | compare `usdOf(margin)` |
| Manual-trade confirm (admin) | rendered the typed price through `marketPrice()`, **double-converting** it | echo the typed figure with `formatInCurrency()` |

Server-side bounds were also re-anchored: a `10,000,000` cap means "$10M", not "10M naira" (≈$7.5k), so
caps and minimums are now checked against the **converted USD** value, not the typed one.

## 6. Refuses to guess — and says the right thing per audience

Same rule as admin funding: a real rate is required, `stale` is accepted, `unavailable` and uncovered
codes are rejected. USD needs no rate, so USD users are never blocked.

The recovery advice differs by audience, because their options differ. Admin funding forms have a
currency selector; user-facing forms follow the profile currency and have none:

```
user  → HTTP 400  No exchange rate is available for ZZZ. Switch your display currency to USD on
                  your profile, then try again.
admin → HTTP 400  No exchange rate is available for ZZZ. Enter the amount in USD instead.
```

In the UI the same condition shows a red hint under the field *before* the button is pressed:

> ⚠ Rates for NGN are unavailable, so this can't be converted yet. Switch your display currency to USD
> to continue.

## 7. What the user sees

Every field states its currency and previews the USD figure that will be stored:

```
Amount in NGN          [₦] 1,331,275.65 [NGN]
≈ $1,000.00 USD

Limit price in NGN     [₦] 108,609,460.95 [NGN]
```

Confirm dialogs echo exactly what's in the field (no re-conversion drift) and preview the derived size:

> This will buy about 0.01225745 BTC (~₦1,331,275.65) at the live market price.

USD-denominated thresholds keep showing both figures, so a minimum is legible in either unit:

```
HTTP 400  Enter an allocation of at least $300.00 (≈ ₦399,382.69).
```

Withdrawal quick-amount buttons were already *labelled* in the user's currency but *entered* USD —
clicking "₦133,128" filled in `100`. Both are now the same currency.

## 8. Deliberately left USD-denominated

Admin **catalog prices and account limits**: bot minimum allocation, bot/trader subscription prices,
weekly plan prices, and per-account max trade size. These are labelled `(USD)` and now carry a live
"Users see ≈ ₦399,382.69" hint.

Reason: they're stored configuration that is **loaded back into edit forms**. Converting on the way in
and out would let an hourly rate refresh silently change a product's stored price — load at rate A, save
untouched at rate B, and the plan's price has drifted. Showing the USD figure with a live local
equivalent is honest and drift-free. Say the word if you'd rather have these converted too; it needs
dirty-field tracking to be safe.

Also unchanged: subscription checkout amounts (taken from the catalog, never typed) and deposit/withdrawal
*approval* (the admin approves an amount the user already entered).

---

## Files changed (12)

| File | Change |
| --- | --- |
| `src/lib/fx-server.ts` | `convertPriceToUsd()`; `USD_ADVICE_ADMIN` / `USD_ADVICE_USER`; `convertToUsd()` takes an advice string |
| `src/app/page.tsx` | currency-aware inputs, labels, prefixes/suffixes, placeholders, `min` attributes, previews, confirm dialogs, handlers; `usdOf` / `typedMoney` / `usdPreview` / `inMyCurrency` / `amountHint` helpers; three unit-mismatch fixes |
| `src/app/admin/page.tsx` | manual fill price typed in the admin's currency; catalog/limit labels state USD + "Users see ≈" hints |
| `src/app/api/app/route.ts` | trade accepts `amount` + `currency`, derives quantity server-side |
| `src/app/api/orders/route.ts` | accepts `amount` + `currency`, converts trigger price, derives quantity |
| `src/app/api/positions/route.ts` | converts margin (2dp) and TP/SL (price precision) before validating them |
| `src/app/api/price-alerts/route.ts` | converts the target price |
| `src/app/api/bot-instances/route.ts` | converts the allocation; minimum checked against USD |
| `src/app/api/deposits/route.ts` | converts the amount; bounds checked against USD |
| `src/app/api/withdrawals/route.ts` | converts the amount; bounds and balance check against USD |
| `src/app/api/admin/users/[id]/trades/route.ts` | converts the admin's custom fill price |
| `scripts/check-funding.ts` | +8 price-conversion assertions (now 33) |

## Verification

`scripts/check-funding.ts` — **33/33 pass** (25 previous + 8 new price-conversion assertions, including
FX-failure injection). `scripts/check-currency.ts` — **25/25** (display layer unregressed).

End-to-end against real PostgreSQL 17 + live CoinGecko (BTC $81,583, ETH $2,417.63) + live FX, as a user
displaying **NGN** at 1 USD = ₦1,331.275645, typing every figure in naira:

| Typed | Response | Stored (USD) |
| --- | --- | --- |
| Market buy ₦1,331,275.65 of BTC | `Bought 0.01225745 BTC at ₦108,609,460.95` | qty `0.01225745`, total `$1,000.00` |
| Limit buy ₦665,637.82 @ ₦108,609,460.95 | `Bought 0.00612872 BTC at ₦108,609,460.95 (filled immediately)` | `trigger=81583.00000298` |
| 5x long ETH, ₦1,331,275.65 margin | `Opened 5x long ETH position at ₦3,218,531.94. Liquidation at ₦2,574,825.55.` | `margin=1000.00` |
| …TP ₦3,540,385.13 / SL ₦3,057,605.34 | — | `tp=2659.39299896`, `sl=2296.74849944` |
| Alert: BTC above ₦108,609,460.95 | `We'll notify you when BTC goes above ₦108,609,460.95.` | `target=81583.00000298` |
| Deposit ₦332,818.91 | submitted for review | `amount=250.00` |
| Withdraw ₦133,127.56 | submitted, reserved from balance | `amount=100.00` |
| Bot allocation ₦798,765.39 | `Scalper Bot · BTC is configured and running.` | `amount=600.00` |
| Bot allocation ₦199,691.35 (below min) | `Enter an allocation of at least $300.00 (≈ ₦399,382.69).` | rejected |
| Any of the above with `ZZZ` | `No exchange rate is available for ZZZ. Switch your display currency to USD…` | rejected |

**USD users are unaffected** — switched the same account to USD and repeated: `$500` bought
`0.20688428 ETH`, and `$250` with no `currency` field at all bought exactly half (`0.10344214`). Every
route treats a missing `currency` as USD, so older clients keep working.

Other gates: `tsc --noEmit` clean; `npm run build` ✓ 7.4s, 6/6 static pages; `/`, `/admin`,
`/reset-password` all HTTP 200; ESLint **39 errors — identical to the pre-existing baseline**, with 0
errors in all 11 source files touched here; full dev-server log reviewed, no 500s or unhandled errors
(the only non-200s were the deliberate probes above).
