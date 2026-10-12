// Shared icon + accent color per notification type, for a quick visual scan
// of the bell. Used by both the user-facing notification bell/page
// (src/app/page.tsx) and the admin notification bell/page
// (src/app/admin/page.tsx) so the two stay visually consistent. Falls back
// to a generic sparkle for unrecognized/legacy types.
import {
  AlertTriangle, ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Bell, Bot, Clock3, CreditCard, Gift,
  LockKeyhole, Mail, ShieldCheck, Sparkles, Target, TrendingDown, TrendingUp, UserRound, UsersRound, Wallet,
  XCircle,
} from "lucide-react";

export function notificationVisual(type?: string): { Icon: typeof Sparkles; color: string } {
  switch (type) {
    case "account_created": return { Icon: UserRound, color: "purple" };
    case "login": return { Icon: LockKeyhole, color: "blue" };
    case "password_changed":
    case "security_question_updated": return { Icon: ShieldCheck, color: "blue" };
    case "email_verified": return { Icon: Mail, color: "green" };
    case "trade_placed":
    case "order_filled": return { Icon: ArrowLeftRight, color: "green" };
    case "order_placed": return { Icon: Clock3, color: "blue" };
    case "order_cancelled": return { Icon: XCircle, color: "red" };
    case "position_opened": return { Icon: TrendingUp, color: "green" };
    case "position_closed": return { Icon: TrendingDown, color: "blue" };
    case "position_auto_closed": return { Icon: AlertTriangle, color: "amber" };
    case "deposit_submitted":
    case "deposit_approved": return { Icon: ArrowDownLeft, color: "green" };
    case "deposit_rejected": return { Icon: XCircle, color: "red" };
    case "withdrawal_submitted":
    case "withdrawal_approved": return { Icon: ArrowUpRight, color: "blue" };
    case "withdrawal_rejected": return { Icon: XCircle, color: "red" };
    case "bot_subscribed": return { Icon: Bot, color: "purple" };
    case "bot_cancelled": return { Icon: Bot, color: "red" };
    case "copy_subscribed": return { Icon: UsersRound, color: "purple" };
    case "copy_cancelled": return { Icon: UsersRound, color: "red" };
    case "plan_subscribed": return { Icon: CreditCard, color: "purple" };
    case "plan_cancelled": return { Icon: CreditCard, color: "red" };
    case "admin_credit": return { Icon: Wallet, color: "green" };
    case "admin_debit": return { Icon: Wallet, color: "red" };
    case "profit_credit": return { Icon: TrendingUp, color: "green" };
    case "profit_debit": return { Icon: TrendingUp, color: "red" };
    case "account_status_changed": return { Icon: AlertTriangle, color: "amber" };
    case "admin_message": return { Icon: ShieldCheck, color: "purple" };
    case "referral_bonus": return { Icon: Gift, color: "green" };
    case "target_balance_updated": return { Icon: Target, color: "amber" };
    case "price_alert_triggered": return { Icon: Bell, color: "amber" };
    default: return { Icon: Sparkles, color: "purple" };
  }
}

// Shared "2h ago" / "3d ago" style relative-time formatter for notification
// lists (used in both the compact popover and the full notifications page).
export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return "Just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
