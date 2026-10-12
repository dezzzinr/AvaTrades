# Applying this update: 8 new features, confirm-before-acting, and $0 starting balance

This zip contains the full AvaTrades project with **8 new features**, a global **confirmation dialog before mutating actions**, and a change to **new accounts starting at $0**, all added on top of everything delivered previously (trading overhaul, user profiles/registration, region-based currency, language selector, demo-account gating, the in-app + email notification system). Since I don't have push access to your GitHub repo, apply it manually:

1. **Price alerts** — "notify me when BTC goes above/below $X"
2. **Email-based password reset** — alongside the existing security-question flow
3. **Admin broadcast announcements** — message every user at once
4. **Full Notifications page** — paginated, filterable history beyond the bell popover
5. **Watchlist / starred assets** — star any coin, filter Markets down to just those
6. **CSV export** — on Transactions and every Trade History tab
7. **Filter/search on history tables** — Transactions and Trade History
8. **Referral rewards** — auto-generated shareable codes, $25 bonus for both sides
9. **Confirmation prompts** — a styled "Are you sure?" dialog before nearly every mutating action, in both the main app and the admin panel (see the README's "Confirmation prompts before mutating actions" section for the exact scope)
10. **New accounts start at $0** — real signups no longer get a pre-loaded $10,000; they deposit or earn a referral bonus to fund their balance. The demo/guest workspace is unchanged.

## 1. Copy the files into your repo

```bash
# from a fresh copy of your repo
rsync -a --exclude='.git' --exclude='node_modules' --exclude='.env' --exclude='.next' /path/to/unzipped/nexatrade/ /path/to/your/repo/
cd /path/to/your/repo
git status   # review the changes before committing
git add -A
git commit -m "Add price alerts, watchlist, CSV export, history filters, referrals, admin broadcast, email password reset, full notifications page"
git push
```

Do **not** overwrite your `.env`.

## 2. Apply the new database schema

Additive only, nothing destructive to existing data:

- `price_alerts` (new table) — one-shot "notify me when `<symbol>` goes above/below `<price>`" alerts.
- `watchlist_items` (new table) — a user's starred asset symbols, unique per `(user_id, symbol)`.
- `users.referral_code` — now **unique** (was free text before). Existing rows keep their old value if it happens to still be unique, otherwise this still applies fine since it was rarely populated; every user gets a proper auto-generated code lazily the next time they load their Profile page.
- `users.referred_by` (uuid, nullable, FK → `users.id`) — who referred this account, if anyone.
- `users.reset_token_hash` / `users.reset_token_expires_at` (text / timestamp, nullable) — the emailed password-reset flow's single-use token.

```bash
npm install
npx drizzle-kit push
```

If `drizzle-kit push` warns about the `referral_code` uniqueness change because of a pre-existing duplicate value in your database (unlikely, since it was free text before and rarely used meaningfully), clear the conflicting values first with `UPDATE users SET referral_code = NULL WHERE referral_code = '...';` and re-run.

## 3. Nothing new to configure

All 8 features work out of the box with your existing `.env` — no new required environment variables. Password-reset emails reuse the same `RESEND_API_KEY` / `EMAIL_FROM` / `APP_URL` setup as the rest of the notification system (see the main README's "Notification system" section). Without `APP_URL` set, the reset email includes a short code to paste into the Reset Password page instead of a clickable link — still fully functional.

## 4. Rebuild and redeploy

```bash
npm run build
```

`npx tsc --noEmit` passes cleanly. `npx eslint .` only flags the same pre-existing, non-blocking issues in `src/app/page.tsx` / `src/app/admin/page.tsx` that predate this update (mostly the new Next.js 16 React Compiler lint rules flagging the whole app's existing `useEffect`-based data-fetching pattern — not a regression introduced here, and not a runtime bug).

## 5. Testing it yourself

1. **Price alerts** — on the Trade page, scroll to "Price alerts," create one with a target price near the current live price, then reload any page a few times (the sweep runs opportunistically on normal traffic). Confirm it moves to "triggered" and you get a bell notification + email.
2. **Password reset** — from the sign-in modal, click "Forgot password?" → "Email me a reset link instead," enter your email, then (without `RESEND_API_KEY` set) check the server console for a `[password-reset:stub] token for ...` line, and open `/reset-password?token=<that token>` to set a new password. Confirm the old password no longer works and all sessions were logged out.
3. **Admin broadcast** — as an admin, go to `/admin` → Broadcast message, send an announcement, and confirm every other real user (not demo accounts) gets it in their bell + email.
4. **Notifications page** — click "Notifications" in the sidebar, confirm pagination and the category filter dropdown both work, and that clicking an unread one marks it read.
5. **Watchlist** — star a coin from the Markets table or the Trade page's asset header, then switch to the Markets page's "Watchlist" tab and confirm only starred coins show up.
6. **CSV export** — on Transactions and each Trade History tab, apply a search/filter, click "Export CSV," and confirm the downloaded file matches exactly what's on screen.
7. **Filters/search** — type into the search boxes on Transactions and Trade History and confirm the tables narrow down live, with no page reload.
8. **Referrals** — register a new account, go to Profile, confirm "Your referral code" shows a freshly generated code. Register a second account entering that code in "Referral/Promo Code" at signup. Confirm both accounts got a $25 `referral_bonus` transaction and a notification, and the referrer's Profile page shows "Friends referred: 1".
9. **Confirmation prompts** — try a handful of actions spread across the app (place a trade, cancel an order, star a coin, sign out, save your profile, delete a bot in the admin panel) and confirm a dialog appears each time asking you to confirm, with a Cancel option that backs out without doing anything.
10. **$0 starting balance** — register a brand-new account (not using a referral code) and confirm its balance is $0.00 and it shows up as $0 everywhere (topbar, Overview, Trade). Then open the app as a guest (no login) and confirm the demo workspace still shows its usual pre-loaded balance and sample portfolio, unaffected.

No real money, card data, or payment processor is involved anywhere in this app — it remains a paper-trading simulation, as before.
