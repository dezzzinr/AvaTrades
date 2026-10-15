// Shared constants/helpers for admin-controlled account standing. Statuses
// are set by admins under Admin panel -> Users and enforced server-side on
// every mutating request so they can't be bypassed from the client.
//
// Kept dependency-free (no db/crypto imports) on purpose: this module is
// also imported from client components (e.g. src/app/admin/page.tsx), so
// anything here must be safe to bundle for the browser.

export const ACCOUNT_STATUSES = ["active", "limited", "suspended", "locked"] as const;

// True when this account still needs to complete email verification before
// it can do anything beyond viewing its (empty) dashboard. Demo accounts and
// accounts with no email on file (shouldn't normally happen, but be safe)
// are exempt - there's nothing to verify. Re-exported from
// src/lib/email-verification.ts, which owns the rest of the
// verification-code flow (that module needs db access, so it can't be
// imported here - see note above).
export function needsEmailVerification(user: { isDemo?: boolean; email?: string | null; emailVerifiedAt?: Date | string | null }): boolean {
  return !user.isDemo && !!user.email && !user.emailVerifiedAt;
}
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export function accountStatusLabel(status: string) {
  switch (status) {
    case "limited": return "Limited";
    case "suspended": return "Suspended";
    case "locked": return "Locked";
    default: return "Active";
  }
}

type StatusFields = {
  accountStatus: string;
  maxTradeAmount: string | number | null;
  withdrawalsBlocked: boolean;
  isDemo?: boolean;
  email?: string | null;
  emailVerifiedAt?: Date | string | null;
};

// Call before any mutating action (trade, deposit, withdrawal, subscribe,
// configure a bot instance). Returns a friendly error to show the user, or
// null if the action is allowed. `kind` lets "limited" accounts selectively
// block only withdrawals while still allowing everything else.
export function blockedActionMessage(user: StatusFields, kind: "trade" | "deposit" | "withdraw" | "subscribe" | "configure"): string | null {
  // Demo/guest accounts can look around freely, but any action that would
  // actually move money or create a lasting record requires a real account
  // - enforced here (server-side) in addition to the UI prompting sign-up
  // before even attempting the request.
  if (user.isDemo) {
    return "Create a free account to continue - sign up (it's free) to save your trades, deposits, and subscriptions for good.";
  }
  // A freshly registered account can't do anything until its email is
  // verified (client shows a dedicated code-entry gate for this - this is
  // the server-side backstop so the gate can't be bypassed).
  if (needsEmailVerification(user)) {
    return "Verify your email to continue - enter the 4-digit code we sent you (or resend it from the verification screen).";
  }
  const status = user.accountStatus ?? "active";
  if (status === "locked" || status === "suspended") {
    return "Your account is suspended. Contact support for help.";
  }
  if (status === "limited" && kind === "withdraw" && user.withdrawalsBlocked) {
    return "Withdrawals are currently disabled on your account. Contact support for help.";
  }
  return null;
}


// Specifically for the "trade" action, where the limit is a dollar amount
// rather than an outright block. Returns a friendly error, or null if the
// trade's total value is within bounds (or no limit applies).
// `usdLabel` is optional: pass a currency-aware formatter (e.g. `fmt.usd`
// from moneyFormatterFor) so the cap is shown in the user's own display
// currency alongside the USD ledger value. Without it, plain USD is used.
export function tradeLimitMessage(user: StatusFields, totalValue: number, usdLabel?: (amountUSD: number) => string): string | null {
  if (user.accountStatus !== "limited" || user.maxTradeAmount == null) return null;
  const cap = Number(user.maxTradeAmount);
  if (Number.isFinite(cap) && totalValue > cap + 0.0001) {
    const capLabel = usdLabel ? usdLabel(cap) : `$${cap.toFixed(2)}`;
    return `This account is limited to trades up to ${capLabel}. Contact support to request a higher limit.`;
  }
  return null;
}
