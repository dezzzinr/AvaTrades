// Central hook for every notable account/trading event. Every call writes
// an in-app notification (always - that's the one channel that can't be
// turned off) and, unless the event type is marked email:false below,
// schedules an email in the background via Resend (see email-server.ts),
// respecting the user's own "Email notifications" toggle and skipping demo
// accounts/accounts with no email on file. Email is sent with `after()` so
// it never adds latency to the request that triggered it, while still
// being allowed to finish even on serverless platforms like Vercel.
import { after } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { notifications, users } from "@/db/schema";
import { sendEmail, notificationEmailHtml } from "@/lib/email-server";

export type NotificationType =
  | "account_created" | "login" | "password_changed" | "security_question_updated"
  | "trade_placed" | "order_placed" | "order_filled" | "order_cancelled"
  | "position_opened" | "position_closed" | "position_auto_closed"
  | "deposit_submitted" | "deposit_approved" | "deposit_rejected"
  | "withdrawal_submitted" | "withdrawal_approved" | "withdrawal_rejected"
  | "bot_subscribed" | "bot_cancelled"
  | "copy_subscribed" | "copy_cancelled"
  | "plan_subscribed" | "plan_cancelled"
  | "admin_credit" | "admin_debit" | "profit_credit" | "profit_debit" | "account_status_changed"
  | "admin_message" | "referral_bonus" | "price_alert_triggered";

// Event types that are purely a self-initiated action the user just saw
// confirmed on screen (e.g. they clicked "Cancel order" and the row
// immediately disappeared) still get logged in-app for a complete activity
// history, but don't also need an email - that would just be noise.
const NO_EMAIL_TYPES: ReadonlySet<NotificationType> = new Set(["order_cancelled", "position_closed"]);

type NotifyInput = {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  sentBy?: string | null; // only set for manual admin messages
};

export async function notifyUser(input: NotifyInput) {
  const [row] = await db.insert(notifications)
    .values({ userId: input.userId, type: input.type, title: input.title, message: input.message, sentBy: input.sentBy ?? null })
    .returning();

  if (NO_EMAIL_TYPES.has(input.type)) return row;

  // Look up email eligibility fresh every time rather than trusting a
  // possibly-stale caller-held user object (most callers only have the
  // *acting* user loaded, not necessarily the notification's recipient -
  // e.g. an admin approving another user's deposit).
  const [recipient] = await db.select({
    email: users.email, name: users.name, isDemo: users.isDemo, emailNotifications: users.emailNotifications,
  }).from(users).where(eq(users.id, input.userId)).limit(1);

  if (!recipient) return row;
  if (!recipient.email || recipient.isDemo) {
    await db.update(notifications).set({ emailStatus: "skipped" }).where(eq(notifications.id, row.id));
    return row;
  }
  if (!recipient.emailNotifications) {
    await db.update(notifications).set({ emailStatus: "disabled" }).where(eq(notifications.id, row.id));
    return row;
  }

  // Deferred to after the response is sent - doesn't slow down the action
  // that triggered it, but (unlike plain fire-and-forget) Vercel keeps the
  // function alive until this finishes instead of freezing/killing it.
  after(async () => {
    const result = await sendEmail({
      to: recipient.email!,
      subject: input.title,
      html: notificationEmailHtml({ name: recipient.name, title: input.title, message: input.message }),
      text: `${input.title}\n\n${input.message}`,
    });
    await db.update(notifications)
      .set({ emailStatus: result.status, emailError: result.status === "failed" ? result.error : null })
      .where(eq(notifications.id, row.id));
  });

  return row;
}
