import { pgTable, uuid, text, timestamp, numeric, boolean, integer, uniqueIndex } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  email: text("email").unique(),
  username: text("username").unique(), // optional second login identifier; unique when set
  passwordHash: text("password_hash"),
  cashBalance: numeric("cash_balance", { precision: 18, scale: 2 }).notNull().default("12540.50"),
  // A separate, admin-managed "profits" balance (e.g. trading/copy-trading
  // gains credited manually rather than earned via the paper-trading engine).
  // Not spendable on trades/withdrawals directly - it's a display balance
  // that's folded into the user's "Total balance" alongside cash + holdings.
  // Edited the same way as cashBalance: admin sets it directly, the delta is
  // logged as a profit_credit/profit_debit transaction, and the user is notified.
  profitBalance: numeric("profit_balance", { precision: 18, scale: 2 }).notNull().default("0.00"),
  // A purely informational "goal" figure set by admins (e.g. a savings/growth
  // target shown to the user). Zero by default. Deliberately NOT folded into
  // cashBalance/profitBalance or the dashboard's "Total balance" figure -
  // it's shown as its own separate stat next to Total balance. Only admins
  // can set it (see src/app/api/admin/users/[id]/target-balance/route.ts);
  // there's no ledger/transaction entry since no real money moves.
  targetBalance: numeric("target_balance", { precision: 18, scale: 2 }).notNull().default("0.00"),
  isDemo: boolean("is_demo").notNull().default(false),
  role: text("role").notNull().default("user"),
  // --- Profile: personal information (collected at registration, editable
  // from the Profile page afterwards). All nullable so existing/demo/seed
  // accounts keep working without backfilling this data. ---------------------
  dateOfBirth: text("date_of_birth"), // stored as YYYY-MM-DD (no time zone semantics needed)
  gender: text("gender"), // free-form (e.g. "male" | "female" | "non_binary" | "prefer_not_to_say" | custom)
  country: text("country"), // ISO 3166-1 alpha-2 code, see src/lib/countries.ts
  state: text("state"),
  city: text("city"),
  address: text("address"),
  phone: text("phone"),
  profilePhoto: text("profile_photo"), // base64 data URL, same storage pattern as deposit receipts
  // --- Profile: account setup -------------------------------------------
  // Every user gets their own unique shareable code, generated once at
  // registration (src/lib/referrals.ts); it's never user-chosen. Shown on
  // the Profile page so they can share it with friends.
  referralCode: text("referral_code").unique(),
  // The user whose referral code this account entered at signup, if any.
  // Both sides get a one-time bonus credit (see src/lib/referrals.ts).
  referredBy: uuid("referred_by").references((): any => users.id, { onDelete: "set null" }),
  securityQuestion: text("security_question"), // user-authored question, shown back to them verbatim
  securityAnswerHash: text("security_answer_hash"), // hashed like a password (answer is normalized to lowercase/trim first)
  // Email verification: null means "not verified yet" and gates the user out
  // of their trading account (see src/lib/email-verification.ts) until they
  // enter the 4-digit code emailed at signup. Defaults to "now" so this
  // column doesn't retroactively lock out demo accounts, admin-created
  // accounts, or any account that already existed before this feature
  // shipped - only the register endpoint explicitly sets it to null.
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }).defaultNow(),
  verificationCodeHash: text("verification_code_hash"), // sha256 of the current 4-digit code, like resetTokenHash below
  verificationCodeExpiresAt: timestamp("verification_code_expires_at", { withTimezone: true }),
  verificationCodeSentAt: timestamp("verification_code_sent_at", { withTimezone: true }), // for the resend cooldown
  verificationAttempts: integer("verification_attempts").notNull().default(0), // wrong-guess counter; capped to stop brute-forcing a 4-digit code
  // Email-based "forgot password" flow: a short-lived, single-use token.
  // Only one reset can be pending at a time - requesting a new one replaces
  // it. Stored hashed (like a password) so a database leak alone can't be
  // used to reset anyone's password.
  resetTokenHash: text("reset_token_hash"),
  resetTokenExpiresAt: timestamp("reset_token_expires_at", { withTimezone: true }),
  termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
  privacyAcceptedAt: timestamp("privacy_accepted_at", { withTimezone: true }),
  // Preferred display currency (ISO 4217). Defaults from `country` at signup
  // via src/lib/countries.ts, but can be changed independently afterwards.
  // This only affects how amounts are *displayed* - the ledger stays USD.
  currency: text("currency").notNull().default("USD"),
  // Preferred UI language (ISO 639-1 code, e.g. "en" | "es" | "fr" | "pt" |
  // "ar" | "hi" | "zh" | "ru"). Always defaults to English - unlike currency,
  // this is never auto-derived from country, only ever set by the user from
  // the language switcher. See src/lib/i18n.ts for the supported list.
  language: text("language").notNull().default("en"),
  // Whether this user wants notable account/trading events emailed to them
  // (in addition to always appearing in their in-app notification bell,
  // which can't be turned off). Defaults on; edited from the Profile page.
  // Ignored for demo accounts (no email address to send to) and if no
  // outbound email provider is configured (see src/lib/email-server.ts).
  emailNotifications: boolean("email_notifications").notNull().default(true),
  // Account standing, set by admins under Admin panel -> Users:
  //   active    - normal account, no restrictions
  //   limited   - can log in and trade, but maxTradeAmount caps a single
  //               trade's value and/or withdrawalsBlocked disables withdrawals
  //   suspended - can log in and view data, but all mutating actions (trade,
  //               deposit, withdraw, subscribe) are blocked
  //   locked    - cannot log in at all; existing sessions are terminated
  accountStatus: text("account_status").notNull().default("active"),
  maxTradeAmount: numeric("max_trade_amount", { precision: 18, scale: 2 }), // only enforced while accountStatus = "limited"
  withdrawalsBlocked: boolean("withdrawals_blocked").notNull().default(false), // only enforced while accountStatus = "limited"
  statusReason: text("status_reason"), // admin-entered note shown to other admins (and partially to the user)
  statusUpdatedAt: timestamp("status_updated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const holdings = pgTable("holdings", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  symbol: text("symbol").notNull(),
  quantity: numeric("quantity", { precision: 24, scale: 8 }).notNull(),
  avgPrice: numeric("avg_price", { precision: 24, scale: 8 }).notNull(),
}, (table) => [uniqueIndex("holdings_user_symbol_idx").on(table.userId, table.symbol)]);

export const trades = pgTable("trades", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),
  quantity: numeric("quantity", { precision: 24, scale: 8 }).notNull(),
  price: numeric("price", { precision: 24, scale: 8 }).notNull(),
  total: numeric("total", { precision: 18, scale: 2 }).notNull(),
  // Set when an admin placed this trade on the user's behalf (e.g. a phone
  // support request); null for trades the user placed themselves.
  placedBy: uuid("placed_by").references(() => users.id, { onDelete: "set null" }),
  adminNote: text("admin_note"), // optional note the admin left when placing the trade
  // Set when this trade is the fill of a pending limit/stop-loss/take-profit
  // order; null for trades that executed immediately (market orders, or
  // trades placed by an admin on the user's behalf).
  orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// A spot order ticket. Market orders execute immediately and never appear
// here (they go straight into `trades`). Limit, stop-loss, and take-profit
// orders start "open" and sit in a book until the live price crosses their
// trigger, at which point they fill (status "filled", a row is written to
// `trades`) or the user cancels them (status "cancelled"). There are no
// trading fees and no simulated slippage: every fill happens at the exact
// limit/trigger price. Stop-loss and take-profit orders are protective
// sell orders against an existing holding (spot has no shorting), so their
// side is always "sell"; limit orders may be buy or sell.
export const orders = pgTable("orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(), // buy | sell
  type: text("type").notNull(), // limit | stop_loss | take_profit
  quantity: numeric("quantity", { precision: 24, scale: 8 }).notNull(),
  // The limit price for "limit" orders, or the trigger level for
  // "stop_loss"/"take_profit" orders. Fills happen at exactly this price.
  triggerPrice: numeric("trigger_price", { precision: 24, scale: 8 }).notNull(),
  status: text("status").notNull().default("open"), // open | filled | cancelled
  filledPrice: numeric("filled_price", { precision: 24, scale: 8 }),
  filledAt: timestamp("filled_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// A leveraged margin position: long or short exposure on a symbol funded by
// a cash margin deposit multiplied by a leverage factor. Margin is deducted
// from cashBalance the moment the position opens and is credited back (plus
// or minus realized P&L) when it closes. There are no fees and no slippage:
// the position closes at exactly the current price (manual close) or at
// exactly the take-profit/stop-loss/liquidation trigger price. Realized
// loss is always floored at -margin, so a user's cash balance can never go
// negative because of a position.
export const positions = pgTable("positions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(), // long | short
  leverage: numeric("leverage", { precision: 6, scale: 2 }).notNull(),
  margin: numeric("margin", { precision: 18, scale: 2 }).notNull(), // USD collateral locked from cashBalance
  quantity: numeric("quantity", { precision: 24, scale: 8 }).notNull(), // position size in asset units = margin*leverage/entryPrice
  entryPrice: numeric("entry_price", { precision: 24, scale: 8 }).notNull(),
  liquidationPrice: numeric("liquidation_price", { precision: 24, scale: 8 }).notNull(),
  takeProfitPrice: numeric("take_profit_price", { precision: 24, scale: 8 }),
  stopLossPrice: numeric("stop_loss_price", { precision: 24, scale: 8 }),
  status: text("status").notNull().default("open"), // open | closed | liquidated
  closePrice: numeric("close_price", { precision: 24, scale: 8 }),
  closeReason: text("close_reason"), // manual | take_profit | stop_loss | liquidation
  realizedPnl: numeric("realized_pnl", { precision: 18, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
});

export const transactions = pgTable("transactions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  description: text("description").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Admin-managed trading bot catalog. Admins curate the roster and set the
// price users pay for a 7-day subscription; "active subscribers" is
// computed from botSubscriptions rather than stored here.
export const botProducts = pgTable("bot_products", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  strategy: text("strategy").notNull(), // DCA | Grid | Momentum | Scalping | Rebalancing | Yield
  riskLevel: text("risk_level").notNull().default("Moderate"), // Low | Moderate | High
  minAllocation: numeric("min_allocation", { precision: 18, scale: 2 }).notNull().default("10"),
  subscriptionAmount: numeric("subscription_amount", { precision: 18, scale: 2 }).notNull(), // price for a subscription
  subscriptionDurationDays: integer("subscription_duration_days").notNull().default(7), // length of one subscription period
  rating: numeric("rating", { precision: 2, scale: 1 }).notNull().default("4.8"), // 0-5 stars, admin-set
  country: text("country").notNull().default("US"), // ISO 3166-1 alpha-2 code, flag derived from it
  photoUrl: text("photo_url"), // optional image URL; falls back to a color glyph when unset
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// A user's paid subscription granting access to configure a bot product for
// a fixed 7-day window. Each renewal is its own row so history is preserved
// even as prices change. "Active" = expiresAt is in the future.
export const botSubscriptions = pgTable("bot_subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  botProductId: uuid("bot_product_id").notNull().references(() => botProducts.id),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(), // price paid, snapshot at subscribe time
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// A user-configured running bot instance. Users may create multiple
// instances of the same bot product (e.g. one per asset) while they hold an
// active (non-expired) subscription to that product. Instances persist
// across renewals; turning one back on after a lapsed subscription requires
// resubscribing first.
export const botInstances = pgTable("bot_instances", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  botProductId: uuid("bot_product_id").notNull().references(() => botProducts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  symbol: text("symbol").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Admin-managed copy-trading profiles. Admins curate the roster and set the
// price users pay to subscribe; "active subscribers" is computed from
// copySubscriptions rather than stored here.
export const copyTraders = pgTable("copy_traders", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  handle: text("handle").notNull(), // e.g. "@olivia.trades"
  avatarInitials: text("avatar_initials").notNull(),
  avatarColor: text("avatar_color").notNull().default("blue"), // purple | orange | pink | blue | green | red
  focus: text("focus").notNull(), // e.g. "BTC, ETH"
  bio: text("bio").notNull().default(""), // short admin-written bio shown on the trader's card
  riskLevel: text("risk_level").notNull().default("Moderate"), // Low | Moderate | High
  returnPercent: numeric("return_percent", { precision: 6, scale: 2 }).notNull().default("0"), // e.g. 42.80 for "+42.80%"
  winRate: numeric("win_rate", { precision: 5, scale: 2 }).notNull().default("0"), // 0-100
  subscriptionAmount: numeric("subscription_amount", { precision: 18, scale: 2 }).notNull(), // price for a subscription
  subscriptionDurationDays: integer("subscription_duration_days").notNull().default(7), // length of one subscription period
  rating: numeric("rating", { precision: 2, scale: 1 }).notNull().default("4.8"), // 0-5 stars, admin-set
  country: text("country").notNull().default("US"), // ISO 3166-1 alpha-2 code, flag derived from it
  photoUrl: text("photo_url"), // optional image URL; falls back to a color glyph when unset
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// A user's paid subscription to copy a trader's strategy for a fixed
// 7-day window. Each renewal is its own row so history is preserved even
// as prices change. "Active" = expiresAt is in the future.
export const copySubscriptions = pgTable("copy_subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  traderId: uuid("trader_id").notNull().references(() => copyTraders.id),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(), // price paid, snapshot at subscribe time
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// Admin-managed subscription plans. Admins set the weekly price and a list
// of feature bullet points shown to users; "active subscribers" is computed
// from planSubscriptions rather than stored here.
export const plans = pgTable("plans", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  priceWeekly: numeric("price_weekly", { precision: 18, scale: 2 }).notNull(),
  features: text("features").array().notNull().default([]),
  isFeatured: boolean("is_featured").notNull().default(false),
  sortOrder: numeric("sort_order", { precision: 10, scale: 0 }).notNull().default("0"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// A user's paid subscription to a plan for a fixed 7-day (weekly) window.
// Each renewal/switch is its own row so history is preserved even as plan
// prices change. "Current plan" = the most recent row where expiresAt is in
// the future.
export const planSubscriptions = pgTable("plan_subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  planId: uuid("plan_id").notNull().references(() => plans.id),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(), // price paid, snapshot at subscribe time
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});


// Notifications shown in a user's notification bell - both system-generated
// (account created, login, trade placed, deposit/withdrawal reviewed, bot/
// copy/plan subscribed or cancelled, balance adjusted, etc.) and admin-sent
// manual messages. Each row is addressed to exactly one user; sentBy is set
// only for manual admin messages (null for every system-generated event).
export const notifications = pgTable("notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // Machine-readable category (see NotificationType in src/lib/notify.ts),
  // used to pick an icon/color in the notification bell. Defaults to
  // "admin_message" so existing rows from before this column existed keep
  // rendering exactly as before.
  type: text("type").notNull().default("admin_message"),
  title: text("title").notNull(),
  message: text("message").notNull(),
  sentBy: uuid("sent_by").references(() => users.id, { onDelete: "set null" }),
  // Set only on the admin-fan-out copies created by notifyAdmins() (see
  // src/lib/notify.ts) - the user account this notification is about, so
  // the admin panel can link straight from the notification to that
  // account. Null for a user's own notifications about themselves.
  aboutUserId: uuid("about_user_id").references(() => users.id, { onDelete: "set null" }),
  readAt: timestamp("read_at", { withTimezone: true }),
  // Outcome of trying to also email this notification: "sent" | "failed" |
  // "skipped" (no email on file / demo account) | "disabled" (user turned
  // off email notifications) | "stubbed" (no email provider configured in
  // this environment) | null (this event type never emails, e.g. a routine
  // self-initiated cancellation the user already saw confirmed on screen).
  emailStatus: text("email_status"),
  emailError: text("email_error"), // short diagnostic when emailStatus = "failed"
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// A user's starred assets for quick access from Markets (a "Watchlist" tab)
// and a star toggle on every asset row. Purely a convenience list - it has
// no effect on trading.
export const watchlistItems = pgTable("watchlist_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  symbol: text("symbol").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("watchlist_user_symbol_idx").on(table.userId, table.symbol)]);

// "Notify me when BTC goes above/below $X." Evaluated by the same
// opportunistic sweep as order fills/liquidations (src/lib/trading-engine.ts)
// against live prices; triggering fires a notification (and optional email)
// then marks the alert "triggered" - it's one-shot, not a standing order.
export const priceAlerts = pgTable("price_alerts", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  symbol: text("symbol").notNull(),
  direction: text("direction").notNull(), // "above" | "below"
  targetPrice: numeric("target_price", { precision: 18, scale: 8 }).notNull(),
  status: text("status").notNull().default("open"), // "open" | "triggered" | "cancelled"
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  triggeredAt: timestamp("triggered_at", { withTimezone: true }),
});

// Admin-managed destination accounts shown to users for a given deposit
// method (e.g. a specific crypto wallet address, bank account, PayPal
// email, Cashapp tag, or gift card instructions). Users send funds to one
// of these outside the app, then submit a deposit request + receipt.
export const depositAccounts = pgTable("deposit_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  method: text("method").notNull(), // crypto | bank_transfer | paypal | cashapp | giftcard
  label: text("label").notNull(), // e.g. "Bitcoin (BTC)" or "Chase Bank - Checking"
  instructions: text("instructions").notNull(), // address / account details / steps shown to the user
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// A user-submitted claim that they sent funds to one of the destination
// accounts above, along with proof of payment. Nothing is credited to the
// user's balance until an admin reviews and approves the request.
export const depositRequests = pgTable("deposit_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  method: text("method").notNull(), // crypto | bank_transfer | paypal | cashapp | giftcard
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  depositAccountId: uuid("deposit_account_id").references(() => depositAccounts.id, { onDelete: "set null" }),
  destinationLabel: text("destination_label"), // snapshot of the account label at submission time
  reference: text("reference"), // sender name / transaction id / last 4 digits, optional
  note: text("note"), // optional note from the user
  receiptData: text("receipt_data").notNull(), // base64 data URL of the uploaded receipt image/PDF
  receiptFilename: text("receipt_filename").notNull(),
  receiptMimeType: text("receipt_mime_type").notNull(),
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  adminNote: text("admin_note"), // reason for rejection / note from admin
  reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// A user-submitted request to pay funds OUT to a destination they choose
// (their own crypto wallet, bank account, PayPal, Cash App, gift card, or
// any other platform). The requested amount is held (deducted from
// cashBalance) immediately on submission so it can't be spent or withdrawn
// twice while pending; it is refunded automatically if an admin rejects the
// request, or finalized (ledgered as a withdrawal) if approved.
export const withdrawalRequests = pgTable("withdrawal_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  method: text("method").notNull(), // crypto | bank_transfer | paypal | cashapp | giftcard | other
  methodLabel: text("method_label"), // user-provided platform name when method = "other"
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  destination: text("destination").notNull(), // where the user wants funds sent (address/account/email/tag/etc.)
  note: text("note"), // optional note from the user
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  adminNote: text("admin_note"), // reason for rejection / note from admin
  reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Server-side cache of machine-translated UI strings, keyed by target
// language + a hash of the English source text. Populated lazily the first
// time any user requests a given language (see /api/translate) so the
// translation API is only ever called once per unique string per language,
// no matter how many users or sessions request it afterwards.
export const translationCache = pgTable("translation_cache", {
  id: uuid("id").defaultRandom().primaryKey(),
  language: text("language").notNull(),
  sourceHash: text("source_hash").notNull(),
  sourceText: text("source_text").notNull(),
  translatedText: text("translated_text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  uniqueLangHash: uniqueIndex("translation_cache_lang_hash_idx").on(table.language, table.sourceHash),
}));

