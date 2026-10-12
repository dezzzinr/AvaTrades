// Manifest of English UI strings that get machine-translated when a user
// picks a non-English language (see src/components/i18n-provider.tsx). This
// is NOT a hand-written translation dictionary - every string here still
// only exists in English; /api/translate (backed by a free translation API)
// produces the actual Spanish/French/etc. text at runtime, cached so it's
// only ever translated once per string per language.
//
// Scope: navigation, page headings, primary buttons/CTAs, and the
// registration/login/forgot-password/demo-upgrade flows - the chrome a user
// sees most and the first-touch screens where language matters most.
// Market data (asset names, numbers, dates) and deep admin-only screens are
// intentionally left in English, same boundary as the currency conversion
// work (ledger/raw data stays canonical; display chrome gets localized).
export const UI_STRINGS: string[] = [
  // Nav groups
  "WORKSPACE", "GROW YOUR WEALTH", "ACCOUNT",
  // Nav items (Page names used for display only, never for routing logic)
  "Overview", "Portfolio", "Trade", "Markets", "Trading Bot", "Copy Trading", "Trading Signals", "Plans",
  "Profile", "Deposit", "Withdraw", "Transactions", "Trade History",
  "NEW",
  // Sidebar footer
  "Need a hand?", "Explore the platform with your free demo account.", "Explore signals",
  "Secure paper trading platform",
  // Topbar
  "Workspace", "Search markets...", "Notifications", "No notifications yet", "Admin panel",
  "View profile", "Create an account", "Sign in", "Log out", "Demo account",
  "Exploring in demo mode", "No active plan", "member",
  // Overview page
  "Good to see you,", "Here's what's happening with your portfolio today.",
  "Paper trading", "Add funds",
  // Common buttons / actions
  "Save", "Cancel", "Submit", "Close", "Continue", "Back", "Next", "Confirm",
  "Buy", "Sell", "Place trade", "Place order", "Place position",
  // Auth modals
  "Welcome back", "Sign in to pick up right where you left off.", "Email or username", "Password",
  "Forgot password?", "Please wait...", "New to AvaTrades?",
  "Your account is secured with encrypted credentials",
  "Don't have an account?", "Sign up", "Already have an account?",
  "Full Name", "Date of Birth", "Gender", "Country", "State/Province", "City",
  "Residential Address", "Phone Number", "Email Address", "Profile Photo",
  "Username", "Confirm Password", "Referral/Promo Code", "Security Question",
  "Security Answer", "I agree to the", "Terms & Conditions", "Privacy Policy",
  "Personal Information", "Account Setup", "Create account",
  // Forgot password flow
  "Reset your password", "Enter your email or username", "What's your security question answer?",
  "New password", "Confirm new password", "Reset password",
  "Forgot your password?", "Enter your email or username and we'll ask your security question.",
  "Looking up...", "Answer your security question", "Your answer", "Resetting...",
  "Password updated", "Your password has been reset. You can now sign in with your new password.",
  // Demo upgrade gate
  "Create a free account to continue", "Sign up free", "Maybe later",
  "Your demo trades, deposits, and subscriptions won't be saved until you create a free account.",
  "Keep exploring",
  // Language selector
  "Language",
  // Page headings (PageTitle title/description across the main pages)
  "My portfolio", "Your holdings valued against current market prices.",
  "Trade crypto", "Live candlestick charts, full order types, and leveraged positions — no fees, no slippage.",
  "Explore markets", "Discover assets and find your next opportunity using CoinGecko market data.",
  "Trading bots", "Subscribe to an admin-managed bot strategy for 7 days, then configure it to trade.",
  "Copy trading", "Subscribe to a trader's strategy for 7 days and track your subscription history.",
  "Market signals", "A clearer look at price momentum and today's trading range. Not financial advice.",
  "Choose your plan", "Subscribe weekly to unlock more of the platform. No auto-renewal — resubscribe (or switch) once your week is up.",
  "Add funds", "Send a payment from outside AvaTrades using one of the methods below, then submit your receipt for admin review.",
  "Withdraw funds", "Request a payout to any platform you choose. An admin reviews and sends it before it's final.",
  "Keep track of every deposit, withdrawal, and plan charge.",
  "Trade history", "Review every spot trade, order, and leveraged position in your paper-trading account.",
  // Registration modal
  "Create your account", "Join AvaTrades",
  "Your trading journey starts here. Deposit paper funds anytime to start trading. Fields marked * are required.",
  "Prefer not to specify", "Select your country", "Optional",
  "Your balances will display in", "by default — you can change this later in your profile.",
  "Replace photo", "Upload photo", "Remove",
  "Optional · JPG, PNG, WEBP, or GIF · Max 2MB · can be added later",
  "Re-enter your password", "Optional — e.g. favorite teacher's name",
  "Setting a security question lets you reset your password later without email access.",
  "Creating account...", "Already have an account?",
  "Upload a JPG, PNG, WEBP, or GIF image.", "File is too large. Max size is",
  "Could not read that file. Please try again.",
  "Enter your full name.", "Enter your date of birth.", "Select your country.",
  "Enter your phone number.", "Enter your email address.", "Choose a username.",
  "Password must be at least 8 characters.", "Password and confirm password do not match.",
  "Enter both a security question and an answer, or leave both blank.",
  "You must agree to the Terms & Conditions.", "You must agree to the Privacy Policy.",
  "Registration failed.",
];
