# Admin funding in any currency

**What was asked for:** "Admin should be able to select the currency when funding user accounts."

**What this does:** in the admin panel, every place an admin puts money onto a user's account now has a
currency selector next to the amount. The admin picks a currency, types the amount in it, sees the USD
figure that will be stored before confirming, and the server does the conversion.

This builds on the site-wide currency work (`CURRENCY_FIX_NOTES.md`). That feature made *display*
currency-aware; this one makes admin *funding input* currency-aware, which is the deliberate exception
to the rule that ledger input fields stay USD-labelled.

---

## 1. Where it applies

All four admin surfaces that credit or set a user's money:

| Surface | Route | Field(s) |
| --- | --- | --- |
| Create user | `POST /api/admin/users` | starting balance + starting profits (one shared selector) |
| Edit balance | `POST /api/admin/users/[id]/balance` | new balance |
| Edit profits | `POST /api/admin/users/[id]/profit` | new profits |
| Set Target | `POST /api/admin/users/[id]/target-balance` | new Target |

Deliberately **not** changed:

- **Deposit / withdrawal approval** — the admin approves an amount the *user* already entered; there's no
  amount to type, so there's nothing to convert.
- **Manual trade price override** — that's a market price, not funding.
- **Max trade size** (account standing) — a limit/threshold, not money movement. Left USD-labelled.
- **Catalog prices** (copy traders, bots, plans) — product pricing, not user funding.

## 2. The ledger is still USD

Nothing about storage changed. `users.cashBalance`, `profitBalance`, `targetBalance` and every
`transactions.amount` remain USD, exactly as before. A currency choice affects only how an amount is
*entered* and how it is converted on the way in.

Verified against the live database after funding a user in GBP and NGN:

```
cash=1000.00 profit=500.00 target=2000.00 tgt_prog=40.00 currency=USD
admin_credit | 1000.00 | Funded in pounds
profit_credit | 500.00 | Profit credit in naira
```

## 3. The server converts — never the client

`convertToUsd(amount, currency)` in `src/lib/fx-server.ts` is the single authoritative conversion:

```
usd = round2(amount / rate)      // rate = USD -> currency multiplier
```

The admin panel shows a live preview (`Will store $1,000.00 · 1 USD = ₦1,331.2756`), but that preview is
informational only. Each funding route re-does the conversion itself from the raw `amount` + `currency`
in the request body, so a tampered or stale client cannot cause a wrong credit.

The full rate table is shipped to the panel via `/api/admin/me` → `fx.rates` (166 currencies) purely so
the preview works for any currency the admin picks.

## 4. It refuses to guess

This is the safety-critical decision. The display layer falls back to 1:1 when the FX provider is down,
which is harmless for *showing* a number. For *funding* it would be catastrophic: an admin typing
`1331275.65` NGN with a 1:1 fallback would credit **$1,331,275.65** instead of **$1,000.00**.

So `convertToUsd` rejects rather than approximates:

| Rate state | Funding in that currency | Why |
| --- | --- | --- |
| `live` | **accepted** | real rate |
| `stale` (provider briefly down, yesterday's cached rates) | **accepted**, and the confirmation says "rate may be slightly delayed" | FX moves slowly; blocking an admin from funding an account over a transient outage is worse than a rate that is a few hours old |
| `unavailable` (no cached rates at all) | **rejected 400** | guessing would mis-credit by orders of magnitude |
| code the provider doesn't cover (e.g. `ZZZ`, `KPW`) | **rejected 400** | same |
| malformed code (`DOLLARS`, `""`) | **rejected 400** | same |

Rejections are actionable, not generic:

```
HTTP 400 {"error":"No exchange rate is available for ZZZ. Enter the amount in USD instead."}
HTTP 400 {"error":"Live exchange rates are unavailable right now, so NGN amounts can't be converted
                   safely. Enter the amount in USD instead."}
```

USD funding short-circuits before any network call, so **funding in USD always works even with FX
completely down** — there is always a way to complete the action.

The picker warns about the same condition in the UI (red hint, "Enter the amount in USD instead"), so
the admin normally sees it before pressing save rather than after.

## 5. What the admin sees

**Confirmation toast** — leads with the USD amount actually stored, then echoes what was typed and the
rate applied, so the action is auditable at a glance:

```
Balance updated to $1,000.00 (entered £754.72 · 1 USD = £0.7547).
Profit balance updated to $500.00 (entered ₦665,637.82 · 1 USD = ₦1,331.2756).
Target updated to $2,000.00 (entered £1,509.44 · 1 USD = £0.7547) at 40% progress.
```

Entered in USD it stays as short as before — `Balance updated to $1,000.00.` — with no redundant
parenthetical.

The typed figure is echoed with `formatInCurrency()`, which applies **no** rate. Re-deriving it from the
rounded USD value would drift (`₦1,331,275.65` would come back as `₦1,331,281.03`) and show the admin a
number that doesn't match what's still on screen in the form.

**Confirm dialog** — states the conversion before the action:

> This directly sets their cash balance to £754.72 → stored as $1,000.00 (1 USD = £0.7547) and logs the
> difference as an admin credit/debit.

For create-user, the conversion is spelled out only when it's relevant (non-USD currency and non-zero
amounts), for both starting amounts.

**The user's notification** is unchanged in behaviour and still rendered in *their own* display currency,
not the currency the admin happened to type in — the user has no reason to care:

> An admin credited $1,000.00 to your account balance. Note: Funded in pounds

## 6. Sensible defaults

Each funding form's selector defaults to the **target user's own display currency** — an admin funding a
Nigerian user is most likely thinking in NGN. Create-user defaults to USD, since there's no user yet.
USD is always in the list, and the list is the same set users can choose as their display currency
(derived from `COUNTRIES`).

## 7. Backward compatible

`currency` is optional. A request without it is treated as USD, so any existing client, script, or
integration that posts `{newBalance: 1000}` behaves exactly as it did before:

```
POST …/balance {"newBalance":1000,"note":"legacy payload"}
→ "Balance updated to $1,000.00."   usd: 1000
```

Codes are trimmed and case-normalised (`" usd "` → USD).

---

## Files changed

| File | Change |
| --- | --- |
| `src/lib/fx-server.ts` | `convertToUsd()`, `convertedAmountLabel()`, `rateLabel()`; import moved to top of file |
| `src/lib/currency.ts` | `formatInCurrency()` — formats an amount already in a currency, no rate applied |
| `src/app/api/admin/me/route.ts` | returns the full `fx.rates` table for previews; keeps `getFxRate()`'s status semantics for the admin's own currency |
| `src/app/api/admin/users/route.ts` | create-user accepts `currency` for both starting amounts |
| `src/app/api/admin/users/[id]/balance/route.ts` | accepts `currency`, converts server-side |
| `src/app/api/admin/users/[id]/profit/route.ts` | accepts `currency`, converts server-side |
| `src/app/api/admin/users/[id]/target-balance/route.ts` | accepts `currency`, converts server-side |
| `src/app/admin/page.tsx` | `FundingCurrency` picker + live preview on all four forms; currency in form state, confirm dialogs and payloads |
| `scripts/check-funding.ts` | **new** — 25 assertions incl. FX-failure injection |

## Verification

`scripts/check-funding.ts` — **25/25 pass**. Runs in two phases: first with `fetch` stubbed to reject
(FX fully down), then against live rates.

```
Phase 1 - FX provider unreachable (status: unavailable)
  PASS  USD funding still works with FX completely down
  PASS  NGN funding is REFUSED with no rate (never guesses 1:1)
  PASS  ...and the refusal tells the admin to use USD
  PASS  GBP funding is refused too (not just NGN)

Phase 2 - live rates
  PASS  NGN 1,331,275.65 converts to ~$1,000 USD (usd=1000 rate=1331.275645)
  PASS  ...rate is a real NGN rate (>100), not a 1:1 fallback
  PASS  ...status is live or stale (both acceptable)
  PASS  GBP 754.72 converts to ~$1,000 USD
  PASS  converted USD is rounded to 2 decimal places
  PASS  negative amount rejected / NaN rejected / malformed code rejected / unknown code rejected
  PASS  omitted currency means USD (existing admin clients keep working)
  PASS  currency code is trimmed and case-normalised

Confirmation labels + formatInCurrency echo: 8 further assertions, all pass
```

End-to-end against real PostgreSQL 17 + live FX, with **three currencies in play at once** — the admin
displays NGN, enters amounts in GBP/NGN, and the funded user displays USD:

| Action | Admin confirmation | Stored (USD) | User notified |
| --- | --- | --- | --- |
| Balance ← £754.72 GBP | `$1,000.00 (entered £754.72 · 1 USD = £0.7547)` | `cash=1000.00` | `credited $1,000.00` |
| Profits ← ₦665,637.82 NGN | `$500.00 (entered ₦665,637.82 · 1 USD = ₦1,331.2756)` | `profit=500.00` | `credited $500.00` |
| Target ← £1,509.44 GBP @40% | `$2,000.00 (entered £1,509.44 · 1 USD = £0.7547) at 40%` | `target=2000.00` | `Target to $2,000.00 (40% progress)` |
| Create user ← ₦1,331,275.65 / ₦66,563.78 NGN | `funded: cash 1000, profit 50` | `cashBalance=1000.00, profitBalance=50.00` | — |
| Balance ← `ZZZ` | HTTP 400 | unchanged | — |
| Balance ← no `currency` field | `$1,000.00` | `cash=1000.00` | — |

**Preview/server parity** — the number in the form must equal the number stored, or the admin is being
misled. 12/12 agree across NGN, GBP, EUR, JPY, KES, GHS, ZAR, CAD, INR, including edge amounts
(₦1 → $0.00, £0.01 → $0.01, ¥7 → $0.04):

```
OK   NGN   1331275.65 -> server $1,000.00 | preview $1,000.00
OK   JPY       152340 -> server $962.30   | preview $962.30
OK   INR    999999.99 -> server $10,491.07| preview $10,491.07
...
preview/server parity: 12/12 agree
```

Other gates:

- `tsc --noEmit` — clean (exit 0)
- `npm run build` — ✓ Compiled successfully in 7.9s, 6/6 static pages
- `scripts/check-currency.ts` — **25/25** (the prior site-wide currency feature is unregressed)
- ESLint — **39 errors, unchanged from the pre-existing baseline**; all 8 server/lib files touched here
  report 0 errors, 0 warnings
- Full dev-server log reviewed: no 500s, no unhandled errors; the only non-200s were the deliberate
  validation probes above

## Note on tiny amounts

Amounts below one US cent in a high-denomination currency round to `$0.00` (₦1 → $0.00). That's correct
2-decimal ledger behaviour, and because the preview shows `$0.00` *before* the admin confirms, it can't
surprise anyone.
