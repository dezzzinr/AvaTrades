// Shared subscription-duration constants used by every paid, time-limited
// feature in the app (copy trading, trading bots, and plans). Every
// subscription type uses the same fixed window: pay once, get access for 7
// days, then resubscribe - there is no auto-renewal anywhere in the app.

export const SUBSCRIPTION_DAYS = 7;
export const SUBSCRIPTION_MS = SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000;

// Every user is auto-enrolled in the cheapest active ($0) plan the first
// time they're seen (see /api/app) so there's never a "no plan" state. The
// `plan_subscriptions.expires_at` column is NOT NULL, so this free
// enrollment uses a 100-year "forever" sentinel instead of a real 7-day
// window - it quietly stays the active plan until the user subscribes to a
// paid one, and reappears on its own once that paid plan lapses.
export const DEFAULT_PLAN_SUBSCRIPTION_MS = 100 * 365 * 24 * 60 * 60 * 1000;
