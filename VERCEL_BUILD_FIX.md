# Vercel build failure — root cause and fix

## The error

```
./src/app/api/app/route.ts:151:55
Type error: Expected 2 arguments, but got 3.
> 151 |   const limitMsg = tradeLimitMessage(user, total, fmt.usd);
```

## What it actually means

This is **not a bug in the new code** — it's a partial deployment. Three API routes call
`tradeLimitMessage(user, total, fmt.usd)` with a third "label this USD threshold in the user's
currency" argument. That optional third parameter was added to `src/lib/accounts.ts` during the
site-wide currency work.

Your Vercel build has the **new routes** but the **old `src/lib/accounts.ts`**, whose
`tradeLimitMessage` still takes only two parameters — so TypeScript rejects the third argument.

The full source tree builds cleanly from scratch (`rm -rf .next && npm run build` → ✓ Compiled
successfully, `tsc --noEmit` → exit 0), which is exactly what Vercel runs.

## Why it happened

The currency work was delivered as three separate zips, and they overlap. Applying only the newest one
leaves older library files behind:

| Zip | Contained the libs? |
| --- | --- |
| `avatrades-currency-fix.zip` | yes — `accounts.ts`, `market.ts`, `trading-engine.ts`, `currency.ts`, `fx-server.ts` |
| `avatrades-admin-funding-currency.zip` | only `currency.ts`, `fx-server.ts` |
| `avatrades-currency-inputs.zip` | only `currency.ts`, `fx-server.ts` |

## A second, worse gap I found while investigating

`src/components/market-chart.tsx` and `src/components/candlestick-chart.tsx` were also modified by the
currency work — they now import the 3-argument `formatMarketPrice(value, currency, rate)` and accept
`currency` / `rate` props — but they were **never included in any of the three zips**. That was a
packaging error on my side.

`next build` stops at the first type error, so you only saw `app/route.ts:151`. Fixing `accounts.ts`
alone would very likely have surfaced a chart error immediately afterwards.

## The fix — use the complete tree

Rather than hand-picking files, `avatrades-full-source.zip` contains the **entire `src/` and `scripts/`
directories** exactly as verified here, so there is no possibility of a mismatch:

1. Unzip over the root of your project, replacing `src/` and `scripts/` wholesale.
2. Leave `package.json`, `package-lock.json`, `drizzle.config.ts`, `.env` and Vercel project settings
   alone — **no new npm dependencies were introduced** by any of the currency work (it uses the built-in
   `Intl.NumberFormat` and `fetch`).
3. Redeploy.

If you would rather patch surgically, the minimum set of files that must be copied across together is:

```
src/lib/accounts.ts            <- the file causing your current error
src/lib/market.ts
src/lib/trading-engine.ts
src/lib/currency.ts
src/lib/fx-server.ts
src/components/market-chart.tsx
src/components/candlestick-chart.tsx
src/components/profile-page.tsx
src/app/page.tsx
src/app/admin/page.tsx
src/app/api/**                 (all API routes)
```

…which is effectively the whole tree, hence the complete zip.

## Environment variables required on Vercel

Unchanged by this work, but needed for the app to boot:

- `DATABASE_URL` — pooled connection string (Neon/Supabase pgBouncer). Note `drizzle.config.ts` strips
  `-pooler` for migrations.
- `ADMIN_EMAILS` — comma-separated; matching addresses get the `admin` role at registration.
- Optional: `RESEND_API_KEY` (without it, emails are logged instead of sent).

FX rates come from a keyless public endpoint (`open.er-api.com`) and market prices from CoinGecko's
keyless API, so no additional secrets are needed for the currency features.

## How to confirm the deploy is healthy

After deploying, check that a non-USD user gets converted figures end to end:

1. Profile → set display currency to e.g. NGN. Balances and chart prices should switch to ₦.
2. Deposit page → the amount field should read `Amount in NGN` with an `≈ $x USD` preview underneath.
3. Trade → typing `₦1,331,275.65` for BTC should report roughly `$1,000.00` of exposure, and the
   confirmation should read `Bought 0.0122… BTC at ₦108,6…`.
4. Admin → funding a user should offer a currency selector next to each amount.

`scripts/check-currency.ts` (25 assertions) and `scripts/check-funding.ts` (33 assertions, including
FX-failure injection) can be run locally with `npx tsx scripts/check-currency.ts` if you want to verify
the formatting and conversion layers independently of a database.
