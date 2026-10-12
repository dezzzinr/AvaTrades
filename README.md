# AvaTrades

A crypto paper-trading web app built with Next.js App Router, Drizzle ORM, and PostgreSQL. Visitors can explore immediately in a seeded demo workspace or create an account with their own persistent simulation balance.

## Connect to Neon

Create a Neon PostgreSQL database and set `DATABASE_URL` in `.env` to the connection string from the Neon dashboard (a pooled connection string is supported):

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST.neon.tech/DBNAME?sslmode=require"
```

Then install dependencies, apply the schema, seed the starter catalog, and start the app:

```bash
npm install
npx drizzle-kit push
npm run seed
npm run dev
```

The app and Drizzle both read the same `DATABASE_URL`; no credentials are embedded in the source. `npm run seed` (`scripts/seed.mjs`) is idempotent — safe to re-run — and inserts the 10 starter trading bots and 4 starter plans described below only if they don't already exist, so admins are free to edit/delete/add to the catalog afterwards without the seed re-adding anything.

## Deploy to Vercel + Neon

1. **Create a Neon database.** In the [Neon Console](https://console.neon.tech/), create a project. Click **Connect** and copy the complete **pooled** PostgreSQL connection string (including `sslmode=require`). This app uses the Node.js `pg` driver, so keep its API routes on the default Node.js runtime, not Edge.
2. **Create the tables before deploying.** Set `DATABASE_URL` in your local `.env` to that Neon URL (see `.env.example`). In the project directory, run:

   ```bash
   npm install
   npx drizzle-kit push
   npm run seed
   ```

   `drizzle-kit push` uses the `DATABASE_URL` in your local `.env`. Double-check that it points to the intended Neon database. This is suitable for the first deployment; for subsequent production schema changes, review changes and use versioned migrations rather than blindly pushing to a live database. `npm run seed` populates the starter trading bot and plan catalogs (see below) — it's idempotent, so it's safe to run again later if you ever want to top it back up.
3. **Push this project to GitHub.** Create an empty GitHub repository, then run the commands below in the project directory if it is not already a Git repository:

   ```bash
   git init
   git add .
   git commit -m "Deploy AvaTrades"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/avatrades.git
   git push -u origin main
   ```

   Replace the repository URL with yours. `.gitignore` excludes `.env` and build artifacts; **never commit database passwords**. If you previously committed `.env`, remove it from Git history and rotate the Neon password.
4. **Import the repository in [Vercel](https://vercel.com/new).** Choose **Add New → Project**, import your GitHub repo, and leave the auto-detected **Next.js** framework and default build command (`npm run build`). In **Environment Variables**, add `DATABASE_URL` with the same Neon pooled URL for **Production**. Add `COINGECKO_API_KEY` with a free CoinGecko Demo key for more reliable live prices (see below). Alternatively, connect a Neon database via Vercel Storage's Neon integration, which injects `DATABASE_URL` automatically. For Preview deployments, use a separate Neon branch/database instead of sharing production data.
5. **Click Deploy.** Open `https://YOUR-PROJECT.vercel.app/api/health` and confirm it returns `{"ok":true}`. Then open the site, register, and try a paper trade. If health returns `500`, check Vercel's `DATABASE_URL`, Neon connectivity, and that step 2 created the tables. Adding or changing an environment variable on Vercel requires redeployment to reach existing deployments.

Future pushes to `main` automatically deploy through Vercel. If you change the schema, apply that change to the appropriate Neon database as part of the release before relying on new tables/columns.

## Live market data

AvaTrades reads USD spot market prices, 24-hour and 7-day changes, 7-day sparklines, coin artwork, volumes, market caps, and 24-hour high/low from the [CoinGecko API](https://www.coingecko.com/en/api). The 24H, 7D, 30D, and 1Y charts use CoinGecko historical prices. The browser refreshes the market snapshot every 60 seconds; the server caches provider responses to limit API usage. **Prices are indicative, not an exchange order book or tick-by-tick streaming feed.**

Keyless access may work for local evaluation but is rate-limited by shared IP. For deployment, create a free **Demo API key** in the [CoinGecko Developer Dashboard](https://www.coingecko.com/en/developers/dashboard) and set `COINGECKO_API_KEY` in your local `.env` and in Vercel's environment variables. This is read **only on the server** and sent as the `x-cg-demo-api-key` header. Paid Pro keys can instead be provided as `COINGECKO_PRO_API_KEY`; the app uses the appropriate Pro host and header. Do not expose a key using `NEXT_PUBLIC_`.

The current market snapshot is available at `/api/market`; chart data at `/api/market/chart?symbol=BTC&period=7D`. When provider data is unavailable, old quotes may display as **stale**, but paper trading is paused until fresh quotes return. Portfolio historical charts estimate the value of **today's positions** using past market prices; they are not a ledger-based record of actual historical account value. Market-signal cards reflect observed market momentum and 24-hour ranges, not advice or trading instructions.

## Features

- Registration and login with salted password hashes and HTTP-only database-backed sessions
- Live market data, coin images, candlestick (OHLC) charts with a volume strip, and a paper-trading dashboard
- Full order-ticket trading: Market, Limit, Stop-Loss, and Take-Profit orders with an open-orders book and one-click cancellation — no fees, no slippage, exact fills at the quoted/trigger price
- Margin/leverage trading: isolated-margin long/short positions (2x–100x) with live unrealized P&L, optional take-profit/stop-loss, and automatic liquidation
- Portfolio valuation, server-verified simulated buy/sell execution, and trade history
- Manual, admin-reviewed deposits and withdrawals with a transaction ledger (see below)
- Admin-managed trading bot catalog with paid 7-day subscriptions and user-configured bot instances
- Admin-managed copy traders with paid 7-day subscriptions
- Admin-managed subscription plans with paid 7-day (weekly) subscriptions and per-plan feature lists
- Market observations, and a seed script (`npm run seed`) that populates 10 starter bots and 4 starter plans
- Full admin user management: create users, view/search every account, edit profiles, lock/suspend/limit accounts, send per-user notifications, place trades on a user's behalf, and directly edit balances (see below)
- Admin broadcast announcements to every user at once, in-app + email (see below)
- In-app + email notifications for every notable account/trading event, plus a dedicated paginated/filterable Notifications page (see below)
- Price alerts ("notify me when BTC crosses $X"), a starred-assets watchlist, CSV export on transaction/trade history tables, and search/filter on history tables (see below)
- Email-based password reset (alongside the existing security-question flow), and a referral program with auto-generated shareable codes and a signup bonus for both sides (see below)
- Responsive interface using the AvaTrades blue theme, including a fully mobile-responsive admin panel (sidebar on desktop, hamburger menu on mobile — same pattern as the main dashboard)

**Simulation notice:** Market prices are real provider quotes, but there is no live exchange execution, autonomous bot execution, or automatic trade copying — subscribing to a trading bot or copy trader grants access to configure it / view their published stats for 7 days, it does not execute real trades or mirror real trades. Plan subscriptions are a simulated billing flow and do not enable any live exchange connectivity. Deposits and withdrawals model a real-world manual payment flow — see below.

## Trading: candlestick charts, full order types, and leverage

The **Trade** page simulates a real exchange's order ticket instead of a single buy/sell button:

- **Charts.** The old line chart is replaced by a candlestick (OHLC) chart with a volume bar strip underneath, built from `/api/market/candles` (backed by CoinGecko's `market_chart` endpoint). Intervals: 24H, 7D, 30D, 1Y. Hovering shows open/high/low/close/volume for that candle. *Caveat:* CoinGecko's free tier only exposes a trailing 24h rolling volume per sample, not true per-candle volume, so per-candle volume is approximated as the delta between consecutive rolling-total readings (floored at 0) — it tracks relative activity well but isn't exchange-accurate; disclose this if you ever surface volume as a precise figure.
- **Order types.** Spot orders support **Market** (fills immediately), **Limit** (buy at/under, sell at/over your price), **Stop-Loss** (sell-only, triggers at/under a price), and **Take-Profit** (sell-only, triggers at/over a price). Pending limit/stop/take-profit orders sit in an **open orders** book (visible on the Trade page and under Trade History → Orders) and can be cancelled anytime before they fill. A background sweep (hooked into the `/api/market` and `/api/app` routes, so it runs on normal traffic without a separate cron) checks every open order and position against the latest price and fills/closes/liquidates them automatically.
- **No fees, no slippage, by design.** Every fill is deterministic: a market order fills at the live quoted price; a limit order fills at the better of your limit and the live price (never worse — exactly like a real exchange, but with zero spread since there's one quoted price); a stop-loss/take-profit fills at exactly its trigger price. There are no trading fees anywhere in the app.
- **Reservations.** Placing a sell-side limit/stop-loss/take-profit order reserves that quantity of the asset so it can't be double-sold by a market trade or another order while it's pending (and the same for cash reserved by open buy orders). This is enforced server-side in both the order-ticket endpoints and the plain market-trade endpoint.
- **Margin/leverage.** The **Margin** tab opens isolated-margin long or short positions at 2x–100x leverage. You choose a margin (collateral) amount; position size = margin × leverage ÷ entry price. The ticket shows live notional value and liquidation price before you submit, and optional take-profit/stop-loss trigger prices. Margin is deducted from your cash balance immediately; it's returned (plus/minus P&L) when the position is closed, hits its TP/SL, or is liquidated. Liquidation happens automatically when the price moves against the position by `margin ÷ (quantity)`'s worth (i.e. the position's notional loss would exceed the posted margin) — realized P&L is capped at losing exactly the margin, never more (no negative balance risk). Open positions show live unrealized P&L on the Trade page and under Trade History → Positions; closed/liquidated ones keep their realized P&L and close reason in history.
- **Admin manual trades remain spot/market only** — the admin "place a trade for this user" tool was intentionally not extended to pending order types or leveraged positions, to keep that feature's blast radius small. The admin panel does not currently surface a user's open orders or leveraged positions; a user's pending orders and positions only affect their own cash/asset balances, which the admin can still see and adjust as usual.

## Deposits: manual, admin-reviewed (no payment processor)

Deposits are **not instant and not automatic**. The flow is designed for a business that collects payments outside the app (crypto wallets, bank transfers, PayPal, Cash App, gift cards) and credits balances manually after verifying proof of payment:

1. An admin configures one or more **destination accounts** per method (e.g. a BTC address, a bank account, a PayPal email, a $Cashtag, gift-card instructions) under **Admin panel → Deposit destinations** (`/admin`).
2. A user opens **Deposit**, picks a method, sees the destination to pay into, sends funds *outside* AvaTrades through their own banking/wallet/PayPal/etc., then submits an amount, optional reference, optional note, and a **receipt** (screenshot/photo/PDF, up to 3MB) through the app.
3. The request is stored as `pending` and the user's balance is **untouched**. It shows up for the user under "Your deposit requests" and for admins under **Admin panel → Deposit requests**.
4. An admin opens the receipt, then **Approves** (credits the claimed amount to the user's balance and logs a transaction) or **Rejects** (with a required reason shown to the user). Each request can only be reviewed once.

No card numbers, bank credentials, or payment processor are ever handled by the app — it only stores the receipt file and the destination account admins choose to publish, so there is nothing resembling PCI-scoped data to protect. Receipts are stored as base64 in Postgres to avoid needing extra object-storage infrastructure; if you expect large volumes of large files, swap `receiptData` in `src/db/schema.ts` for a pointer to S3/Vercel Blob/etc. instead (see `src/lib/deposits.ts` for the current size/type limits).

## Withdrawals: manual, admin-reviewed, pay-out to any platform

Withdrawals mirror the deposit flow but run in reverse — the user picks where **they** want to be paid instead of an admin-configured destination:

1. A user opens **Withdraw**, picks a payout method (Cryptocurrency, Bank transfer, PayPal, Cash App, Gift card, or **Other** for anything not listed), and enters where to send the money (their own wallet address, bank details, email, $Cashtag, etc.) plus an amount and optional note.
2. On submission the requested amount is **immediately held** — deducted from the user's available cash balance — so it can't be spent on a trade or withdrawn twice while the request is pending. The request appears under "Your withdrawal requests" and for admins under **Admin panel → Withdrawal requests**.
3. The admin manually sends the payout to the destination the user provided (outside the app, using whatever rails that method requires), then either:
   - **Approves** — finalizes the request and logs it in the transaction ledger. No further balance change happens since the amount was already held.
   - **Rejects** (with a required reason shown to the user) — the held amount is automatically refunded back to the user's available balance.

Each request can only be reviewed once, and nothing is ever paid out automatically — approving only marks that the admin already sent the funds manually.

## Copy trading: admin-managed traders, 7-day paid subscriptions

Copy trading is fully admin-curated — there is no seeded or hardcoded trader roster:

1. An admin adds traders under **Admin panel → Copy traders** (`/admin`), setting their name, handle, avatar color, focus (e.g. "BTC, ETH"), risk level (Low/Moderate/High), reported return %, win rate, and — required — the **subscription price** charged for a 7-day subscription.
2. Users browse the roster on the **Copy Trading** page, which shows each trader's stats, price, and a live **active subscribers** count (computed in real time from non-expired subscriptions, not an admin-entered vanity number).
3. Clicking **Subscribe** charges the trader's current price from the user's paper-trading cash balance (free/$0 traders can be subscribed to with no charge) and logs a `subscription` transaction. The subscription starts immediately and **expires in exactly 7 days** — there is no auto-renewal; users resubscribe once it lapses.
4. A user can only hold one active subscription per trader at a time; re-subscribing before expiry is blocked with a friendly message showing when it unlocks again. Past and current subscriptions are listed in a "My subscriptions" history panel with countdowns.
5. Admins can edit a trader's profile/stats/price at any time (price changes only affect future subscriptions — past subscriptions keep the price that was charged at the time), toggle them active/hidden, or delete them. Deleting is blocked with a clear message if the trader has subscription history; deactivate instead to retire them while preserving records.

## Trading bots: admin-managed catalog, 7-day paid subscriptions, user-configured instances

Like copy trading, the bot catalog is fully admin-curated — `npm run seed` only provides a starting lineup; admins can add, edit, deactivate, or remove bots at any time from **Admin panel → Trading bots** (`/admin`):

1. An admin adds a bot under **Admin panel → Trading bots**, setting its name, description, strategy (DCA, Grid, Momentum, Scalping, Rebalancing, or Yield), risk level (Low/Moderate/High), minimum allocation, and — required — the **subscription price** charged for a 7-day subscription.
2. Users browse the catalog on the **Trading Bot** page, which shows each bot's strategy/risk/minimum allocation, price, and a live **active subscribers** count. Clicking **Subscribe** charges the bot's current price from the user's paper-trading cash balance and starts a 7-day, non-renewing subscription (same pattern as copy trading) — users resubscribe once it lapses to keep configuring/running that bot.
3. Once subscribed, a user can **configure any number of bot instances** for that bot product — e.g. one instance trading BTC and a separate instance trading ETH, each with its own allocation amount and optional name — for as long as the subscription stays active. Instances can be paused/resumed or deleted independently under "My bots"; pausing/deleting does not refund or cancel the underlying subscription.
4. If a bot subscription expires, its existing instances are flagged "Needs resubscribe" and can't be reactivated until the user subscribes again; they are not auto-deleted, so resubscribing picks up existing configurations.
5. Admins can edit a bot's profile/price at any time (price changes only affect future subscriptions), toggle active/hidden, or delete it. Deleting is blocked with a clear message if the bot has subscription history; deactivate instead to retire it while preserving records.

**Seeded starter catalog (10 bots):** Stablecoin Yield Bot ($5/wk, Yield, Low risk), BTC DCA Starter ($9/wk, DCA, Low), Conservative DCA Plus ($12/wk, DCA, Low), ETH Grid Trader ($15/wk, Grid, Moderate), Multi-Asset Rebalancer ($19/wk, Rebalancing, Moderate), Swing Trader AI ($22/wk, Momentum, Moderate), Momentum Surge ($25/wk, Momentum, High), Altcoin Momentum Hunter ($29/wk, Momentum, High), BTC Grid Pro ($35/wk, Grid, Moderate), Scalper Bot ($39/wk, Scalping, High).

## Plans: admin-managed tiers, 7-day (weekly) paid subscriptions

Subscription plans follow the same admin-curated pattern — `npm run seed` provides 4 starter tiers, but admins fully control pricing and feature lists from **Admin panel → Plans** (`/admin`):

1. An admin adds a plan under **Admin panel → Plans**, setting its name, description, weekly price, a feature list (one feature per line), an optional "Most popular" featured flag, and a sort order controlling display order.
2. Users browse tiers on the **Plans** page and click **Choose** to subscribe weekly; the price is charged from the user's cash balance and the subscription runs for exactly 7 days, same non-renewing pattern as bots/copy trading. Users may switch plans at any time; re-choosing the plan that is already their current active one is blocked until it lapses.
3. The "current plan" shown throughout the app (topbar, Plans page) is whichever plan has the most recently started still-active subscription; a user with no active plan subscription is shown "No active plan" rather than a hardcoded default tier.
4. A "My plan subscriptions" history table shows past and current plan subscriptions with their price, start date, and expiry.
5. Admins can edit a plan's price/description/features/feature order/featured flag at any time (price changes only affect future subscriptions), toggle active/hidden, or delete it. Deleting is blocked with a clear message if the plan has subscription history; deactivate instead to retire it while preserving records.

**Seeded starter catalog (4 plans):** Starter ($0/wk — Paper trading dashboard, Market overview, Portfolio tracking, Basic trade history), Pro ($15/wk, featured — adds Trading bot subscriptions, Copy trading subscriptions, Advanced market signals, Priority insights), Elite ($35/wk — adds Unlimited bot instances, All trading signals, Advanced portfolio analytics, VIP experience), Institutional ($75/wk — adds Dedicated account concierge, Early access to new bots & traders, Custom portfolio reporting, Priority support response).

## Admin user management

The admin panel (`/admin`) has a **Users** section for full account management, alongside **Overview** stats and the existing Payments/Catalog tools — all behind the same mobile-responsive sidebar/hamburger shell as the main dashboard.

**Account states.** Every user has an `accountStatus` of:
- **Active** (default) — full access.
- **Limited** — can log in and trade, but an admin may cap trades at a maximum size (`maxTradeAmount`) and/or block withdrawals only. Everything else works normally.
- **Suspended** — can log in, but is view-only: trading, deposits, withdrawals, and all subscriptions (bot/copy/plan) are blocked.
- **Locked** — cannot log in at all. If an already-logged-in user is locked, their next request is rejected with a clear message and their session is ended immediately (rather than silently handing them a fresh demo workspace).

Set these from a user's **Manage users → [user] → Account standing** panel, with an optional reason shown to the user (e.g. "Pending KYC review").

**Creating & editing users.** Admins can create a new user directly (name, email, password, starting balance) from **Manage users → Add user**, or search/browse every existing account in the table. Opening a user shows a full detail view: profile editing (name/email/role), account standing, balance editing, notifications, manual trade placement, their subscriptions (with the ability to end one early), and recent trades/transactions/deposit-withdrawal requests.

**Balance edits.** The "Edit balance" panel lets an admin directly set a user's cash balance to any value. The difference is always logged as an `admin_credit` or `admin_debit` transaction in the user's transaction history (visible to them under Transactions) regardless of whether an admin note is supplied — a note is optional, but the audit trail is not.

**Notifications.** Admins can send a one-off title + message to a single user from their detail view; it appears in that user's notification bell (top-right of the main app), is also emailed to them (see the notification system section below), and is marked read when they open it. There is no broadcast-to-all-users feature — notifications are always addressed to one specific account.

**Manual trade placement.** For users who call or message support asking for a trade to be placed on their behalf, the "Place a manual trade" panel lets an admin buy/sell any asset for that user. It defaults to the current live market price, or an admin can supply a custom fill price (e.g. to honor a price quoted to the user over the phone). These trades bypass that user's own trade-size limit/suspension (the admin is explicitly authorizing it) and are tagged `placedBy` the admin — shown to the user as a small "Placed by support" badge in their trade history, with no admin name disclosed.

**Subscriptions.** A user's active bot/copy/plan subscriptions are listed on their detail page with an "End now" action that ends the subscription immediately (sets its expiry to now) without deleting its history.

### Creating your first admin

There is no admin by default. Set `ADMIN_EMAILS` (comma-separated) in your `.env` / Vercel environment variables to the email address(es) that should have admin access, e.g.:

```env
ADMIN_EMAILS="you@example.com"
```

## User profiles, full registration, and region-based currency

**Registration** is now a two-section form — Personal Information (full name, date of birth, gender, country, state/province, city, address, phone, email, profile photo — all required except gender/state/city/address/photo) and Account Setup (username, password, confirm password, referral/promo code, a free-text security question + answer, and required Terms & Conditions / Privacy Policy checkboxes). Users can log in with either their **email or username**. Accounts created before this feature (seeded/demo users) have all these fields as `null`/defaults and are prompted to fill them in from their profile page; nothing is retroactively required to keep using the app.

**Profile page** (accessible from the account menu) lets a logged-in user view and edit every field above, re-upload their photo (stored as a base64 data URL, same pattern as deposit receipts — no object storage required), change their password, change or set their security question/answer, and change their display currency. Terms/Privacy acceptance timestamps and referral code are shown read-only.

**Currency conversion is a full display conversion, not a label.** The ledger (`cashBalance`, trade amounts, transaction amounts) always stays in USD — nothing about money storage or trading math changed. Every current user, on login/registration, gets a `currency` derived from their selected country (e.g. Nigeria → NGN, UK → GBP), editable independently afterwards from their profile. The app fetches a live USD-based FX rate table (`https://open.er-api.com/v6/latest/USD`, cached server-side) and converts every dollar amount shown to that user — balances, prices, portfolio value, P&L, 24h volume, market cap, chart axes/tooltips — into their chosen currency at render time. Trade amount inputs stay USD-denominated for submission (to keep the ledger and order math simple and exact), with a small "≈ [converted amount]" hint shown under the input when the user's currency isn't USD.

**Admin visibility.** A user's username, phone, country, and display currency are shown read-only on their detail page in `/admin → Manage users`, alongside the existing editable name/email/role fields. These are not editable by an admin — profile changes other than account status/balance/notifications remain the user's own to make.

### New environment variable

None required — the FX rate API used (`open.er-api.com`) is free and keyless. If you'd rather point at a different FX provider or a paid one with higher reliability guarantees, swap the URL in `src/lib/fx-server.ts`.

Registering or logging in with a matching email automatically promotes that account to the `admin` role (see `src/lib/auth.ts`). Admins get an **Admin panel** link in their profile menu, or can go directly to `/admin`.

## Language selector, live translation, tab persistence, and demo-account gating

**Language selector.** A globe icon in the topbar, plus a "Display language" dropdown on the Profile page, let any user switch the app's chrome between English, Español, Français, Português, العربية, हिन्दी, 中文, and Русский. The choice **always defaults to English** and is **only ever set manually** — unlike currency, it's never derived from the user's country. Signed-in users' choice is saved to their account (`users.language`) and re-adopted on any device/browser that doesn't already have its own local choice; guests get a local-only (per-browser) choice.

**Live translation, not a hand-written dictionary.** Translated text comes from MyMemory (`api.mymemory.translated.net`), a free, keyless machine-translation API, called via a small internal `/api/translate` route. Every translated string is cached forever per language in a new `translation_cache` table (keyed by a hash of the source text), so the API is called at most once per unique string per language across the app's whole lifetime — not once per user, not once per session. Any string that fails to translate (daily anonymous-tier quota reached, network error, etc.) falls back to the original English text rather than breaking the UI; raw HTML/markup artifacts that MyMemory's translation-memory lookups occasionally return for very short strings are stripped before caching. Translation coverage focuses on navigation, the topbar, every page's heading/description, and the full login/register/forgot-password/demo-upgrade modals — the highest-visibility chrome, using the same "chrome is translated, raw data stays canonical" scoping already used for currency conversion.

**Tab persistence across refresh.** The active tab is remembered in `localStorage` (`nexa_last_page`) and restored on reload, so refreshing the browser no longer drops you back to Overview.

**Demo-account gating.** Demo/guest users can still browse everything (dashboards, markets, catalogs) with no restriction. The moment a demo user attempts a mutating action — quick/market trade, limit/stop/margin order, deposit, withdrawal, or a bot/copy-trader/plan subscription — a "Create a free account to continue" modal interrupts with Sign up / Sign in / Keep exploring options, enforced both client-side (`requireRealAccount()` guard in `src/app/page.tsx`) and server-side (`blockedActionMessage()` in `src/lib/accounts.ts`, so it can't be bypassed by calling the API directly). The same modal also appears automatically after roughly two minutes of demo browsing, as a proactive nudge.

### New environment variable

None required — MyMemory's translation endpoint is free and keyless. If you want higher translation quality/limits in production, swap the implementation in `src/lib/translate-server.ts` (`translateOne`) for a paid provider (DeepL, Google Cloud Translation, Azure Translator) — the caching layer and the rest of the app don't need to change.

## Notification system: in-app + email

Every notable account/trading event - account created, sign-in, password/security changes, trades, order fills/cancellations, position opens/closes/liquidations, deposit and withdrawal submissions and admin reviews, bot/copy-trader/plan subscriptions and admin cancellations, admin balance credits/debits, account status changes, and direct admin messages - creates a **notification**, visible in the bell icon in the topbar for every user (`src/lib/notify.ts` → `notifyUser()`, called from every relevant route and from the trading engine's fill/close functions). Each type gets its own icon/color in the bell for quick scanning.

**Email, via Resend.** Real (non-demo) accounts with an email on file also get these events emailed, using a shared branded HTML template (`src/lib/email-server.ts`). Sign-ins are always emailed by design, since that's the one event most worth knowing about even away from the app. Email sending uses Next.js's `after()` so it runs after the response is already sent and never adds latency to the request that triggered it - this matters because the trading engine's background sweep can fire fill/liquidation notifications for *other* users while unrelated traffic is being served. Two purely self-initiated, already-on-screen actions (cancelling your own order, manually closing your own position) are logged in-app only and never emailed, to avoid noise.

**Per-user control.** Profile → Notifications has a single "Email me about account activity" toggle (on by default). It's deliberately a simple on/off switch rather than per-category preferences. In-app notifications in the bell always keep working regardless of this toggle, so there's always a complete activity record.

**Works out of the box, even without an email provider.** Without `RESEND_API_KEY` configured, every email is "stubbed" - logged to the server console with `[email:stub]`, and recorded as such on the notification row - so the whole pipeline (including every route's notification logic) runs and is testable with zero external configuration. Setting `RESEND_API_KEY` activates real delivery with no other code changes.

### New environment variables

- `RESEND_API_KEY` (optional) - get a free key at [resend.com](https://resend.com/api-keys). Omit it to keep emails stubbed/logged only.
- `EMAIL_FROM` (optional) - defaults to `AvaTrades <onboarding@resend.dev>`. On Resend's free tier (no verified domain) this must stay as `onboarding@resend.dev`, and mail can only be received at the address you signed up to Resend with; verify a custom domain in Resend for real multi-user delivery.
- `APP_URL` (optional) - your deployed URL, used only to build the "Open AvaTrades" button in emails (and the clickable link in password-reset emails - without it, the email shows a code to paste in instead of a link). Auto-detected from Vercel's `VERCEL_URL` when deployed there.

## Price alerts

The Trade page has a **Price alerts** panel under the order book/position list: pick a direction (above/below) and a target USD price for the asset currently open, and AvaTrades notifies you (in-app + email, same pipeline as everything else) the moment the live quote crosses it. Alerts are one-shot - once triggered they move to history and stop watching; create a new one to keep watching an asset. Evaluation piggybacks on the same opportunistic sweep that already fills orders and liquidates positions (`sweepPriceAlerts` in `src/lib/trading-engine.ts`), so no separate cron/worker is needed. A user can have up to 20 open alerts at a time. API: `GET/POST /api/price-alerts`, `PATCH /api/price-alerts/:id` (cancel).

## Password reset via email

Alongside the existing security-question reset, **Forgot password?** now offers "Email me a reset link instead." This always responds with the same generic message regardless of whether the account/email exists (no user enumeration), and - when a match is found - emails a single-use link that expires in 30 minutes (`users.resetTokenHash`/`resetTokenExpiresAt`, hashed the same way session tokens are). The link opens a standalone `/reset-password?token=...` page (works even if the user isn't logged in anywhere). Resetting a password this way invalidates all existing sessions, exactly like the security-question flow. If `APP_URL` isn't configured, the email includes a plain-text code to paste into the Reset Password page instead of a clickable link.

## Admin broadcast announcements

**Admin panel → Broadcast message** sends a title + message to every real (non-demo) user at once, as an in-app notification (and email, unless that user turned email notifications off) - useful for maintenance windows, new feature announcements, etc. It reuses the existing single-user admin-message notification pipeline, just fanned out to every account. There's a confirmation prompt before sending since it can't be undone. API: `POST /api/admin/notifications/broadcast`.

## Full Notifications page

Beyond the notification bell popover (which still shows the 20 most recent), there's now a dedicated **Notifications** page (in the sidebar, under Account) with the complete history: paginated (20 per page), filterable by category (Trading, Orders, Positions, Deposits, Withdrawals, Price alerts, Referrals, Account, Announcements), with unread items visually distinguished and markable individually or all-at-once. `GET /api/notifications` now accepts `limit`, `offset`, and `type` query params for this; the bell popover keeps using the defaults.

## Watchlist / starred assets

Every asset row on the Markets table and the asset header on the Trade page have a star toggle. Starred assets show up in a dedicated **Watchlist** tab on the Markets page (alongside All assets/Gainers/Losers) for quickly checking on just the coins you care about. Demo/guest users are prompted to create an account before starring (same gate as trading/deposits). API: `GET/POST/DELETE /api/watchlist`.

## CSV export

Transactions, and every tab of Trade History (Trades, Orders, Positions), have an **Export CSV** button that downloads the currently filtered/searched rows as a `.csv` file - entirely client-side (`src/lib/csv.ts`), no server round trip, so it always exports exactly what's on screen.

## Filters & search on history tables

Transactions now has a type filter (All types / deposit / withdrawal / admin_credit / ... ) plus a free-text search box (matches description or type). Trade History's Trades/Orders/Positions tabs share a single symbol search box, plus the existing All/Buy/Sell segmented control for Trades. All filtering happens client-side against data already loaded - no new endpoints needed - so it's instant.

## Referral rewards

Every real (non-demo) account gets its own unique, auto-generated, shareable referral code (`users.referralCode`, 7 characters, e.g. `FFJZY8F`) - shown on the Profile page under "Your referral code" with a one-click copy button and a running count of friends referred. Accounts created before this feature get their code generated the first time they load their Profile page (`GET /api/profile` lazily backfills it). Entering **someone else's** code in the "Referral/Promo Code" field at signup (the same field that existed before but was previously inert) links the two accounts (`users.referredBy`) and credits a flat **$25 bonus** to both the new user and the referrer immediately, each logged as a `referral_bonus` transaction (visible in Transactions) and a notification. Self-referral is impossible since a user's own code can't match their own entry at signup (the lookup happens before the new row exists). The bonus amount is a constant (`REFERRAL_BONUS_AMOUNT` in `src/lib/referrals.ts`) if you want to change it.

## New accounts start at a $0 balance

Registering a real account now starts the user's paper-trading cash balance at **$0.00** instead of a pre-loaded $10,000 - they fund it themselves via **Deposit** (or via a referral signup bonus, see above). This makes the deposit flow meaningful from day one instead of optional. The anonymous/guest **demo workspace** is unaffected and still starts pre-loaded (currently $12,540.50 with a small starter portfolio) so visitors can try trading immediately without creating an account or depositing anything - that balance lives in `createDemoUser()` in `src/lib/auth.ts` if you want to change it. Admin-created accounts (**Admin panel → Manage users → Add user**) already defaulted their "Starting balance" field to `0` and are unchanged.

## Confirmation prompts before mutating actions

Nearly every action that changes stored data - across both the main app and the admin panel - now shows a small "Are you sure?" dialog before it runs, via a shared `<ConfirmProvider>` / `useConfirm()` hook (`src/components/confirm-provider.tsx`) styled to match the rest of the app. This covers: placing/cancelling trades, orders, and leveraged positions; submitting deposits/withdrawals; subscribing to a bot/copy trader/plan; configuring/pausing/removing a bot instance; starring/unstarring an asset; creating/cancelling a price alert; marking a notification (or all notifications) read; signing out; saving profile info, changing your password, and updating your security question; resetting your password (both the security-question and emailed-link flows); and, in the admin panel, every create/edit/delete/activate/deactivate action across users, balances, account status, manual trades, notifications, subscriptions, deposit destinations, copy traders, bots, plans, deposit/withdrawal approvals, and the broadcast tool. Destructive or high-impact actions (delete, lock/suspend an account, set a balance, broadcast, place a trade on a user's behalf, approve a payout) show the dialog in a red "danger" style; everything else uses the neutral style. A couple of flows were deliberately left alone because the dialog would be redundant: signing in/registering (the form submission is already the deliberate action), and the admin's two-step reject flow for deposits/withdrawals (which already requires typing a reason and clicking a button labeled "Confirm reject"). Changing a simple instant-apply preference (display currency, display language, the email-notifications toggle) also isn't gated, to keep those feeling like normal settings controls rather than actions. If any of this scoping feels like too much or too little friction for a particular action, it's a one-line change per action (`if (!(await confirm({ title: "...", message: "..." }))) return;`) to add or remove.
