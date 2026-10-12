// Central hook for every notable account/trading event. Every call writes
// an in-app notification (always - that's the one channel that can't be
// turned off) and, unless the event type is marked email:false below,
// schedules an email in the background via Resend (see email-server.ts),
// respecting the user's own "Email notifications" toggle and skipping demo
// accounts/accounts with no email on file. Email is sent with `after()` so
// it never adds latency to the request that triggered it, while still
// being allowed to finish even on serverless platforms like Vercel.
//
// Every one of these events is also fanned out to every admin account (see
// notifyAdmins below) - so admins see the exact same activity feed users
// do, just about every account instead of just their own, with a little
// extra context (who it happened to) prepended to each message.
import { after } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { notifications, users } from "@/db/schema";
import { sendEmail, notificationEmailHtml } from "@/lib/email-server";

export type NotificationType =
  | "account_created" | "login" | "password_changed" | "security_question_updated" | "email_verified"
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
// history, but don't also need an email - that would just be noise. Applies
// equally to the admin copies of these events.
const NO_EMAIL_TYPES: ReadonlySet<NotificationType> = new Set(["order_cancelled", "position_closed", "email_verified"]);

type NotifyInput = {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  sentBy?: string | null; // only set for manual admin messages/actions
  // Set to false to skip the automatic admin fan-out below - only needed
  // for bulk loops (e.g. broadcasting to every user) where fanning out
  // per-recipient would flood admins with one notification per user
  // instead of a single summary. See /api/admin/notifications/broadcast.
  notifyAdmins?: boolean;
};

export async function notifyUser(input: NotifyInput) {
  const [row] = await db.insert(notifications)
    .values({ userId: input.userId, type: input.type, title: input.title, message: input.message, sentBy: input.sentBy ?? null })
    .returning();

  // Look up the recipient once; used both for the recipient's own email
  // eligibility below and to label the copy fanned out to admins further
  // down. Don't trust a possibly-stale caller-held user object - most
  // callers only have the *acting* user loaded, not necessarily the
  // notification's recipient (e.g. an admin approving another user's
  // deposit).
  const [recipient] = await db.select({
    email: users.email, name: users.name, isDemo: users.isDemo, emailNotifications: users.emailNotifications,
  }).from(users).where(eq(users.id, input.userId)).limit(1);

  if (recipient && !NO_EMAIL_TYPES.has(input.type)) {
    if (!recipient.email || recipient.isDemo) {
      await db.update(notifications).set({ emailStatus: "skipped" }).where(eq(notifications.id, row.id));
    } else if (!recipient.emailNotifications) {
      await db.update(notifications).set({ emailStatus: "disabled" }).where(eq(notifications.id, row.id));
    } else {
      // Deferred to after the response is sent - doesn't slow down the
      // action that triggered it, but (unlike plain fire-and-forget)
      // Vercel keeps the function alive until this finishes instead of
      // freezing/killing it.
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
    }
  }

  // Demo accounts are sandboxes, not real accounts admins need to track -
  // skip the fan-out for them (there'd be a lot of noise and nothing
  // actionable). Everything else fans out to admins by default.
  if (input.notifyAdmins !== false && recipient && !recipient.isDemo) {
    const label = recipient.name + (recipient.email ? ` (${recipient.email})` : "");
    void notifyAdmins({
      type: input.type,
      title: input.title,
      message: `${label}: ${input.message}`,
      sentBy: input.sentBy,
      aboutUserId: input.userId,
    }).catch((error: unknown) => console.error("Admin notification fan-out failed:", error));
  }

  return row;
}

type AdminNotifyInput = {
  type?: NotificationType;
  title: string;
  message: string;
  sentBy?: string | null;
  // The user account this notification is about, if any - lets the admin
  // panel link straight to that account from the notification.
  aboutUserId?: string | null;
};

// Sends a notification to every admin account. Each admin gets their own
// row in the same `notifications` table users read from (just addressed to
// their own id), so the existing /api/notifications endpoints and
// notification bell/page work for admins with no changes. Skips the admin
// who caused the event (sentBy) and the admin whose own account it's about
// (aboutUserId) - they already know.
export async function notifyAdmins(input: AdminNotifyInput) {
  const type = input.type ?? "admin_message";
  const admins = await db.select({
    id: users.id, name: users.name, email: users.email, emailNotifications: users.emailNotifications,
  }).from(users).where(eq(users.role, "admin"));

  await Promise.all(admins.map(async (admin) => {
    if (admin.id === input.aboutUserId) return;
    if (input.sentBy && admin.id === input.sentBy) return;

    const [row] = await db.insert(notifications).values({
      userId: admin.id, type, title: input.title, message: input.message,
      sentBy: input.sentBy ?? null, aboutUserId: input.aboutUserId ?? null,
    }).returning();

    if (NO_EMAIL_TYPES.has(type) || !admin.email || !admin.emailNotifications) return;

    after(async () => {
      const result = await sendEmail({
        to: admin.email!,
        subject: `[Admin] ${input.title}`,
        html: notificationEmailHtml({ name: admin.name, title: `[Admin] ${input.title}`, message: input.message }),
        text: `${input.title}\n\n${input.message}`,
      });
      await db.update(notifications)
        .set({ emailStatus: result.status, emailError: result.status === "failed" ? result.error : null })
        .where(eq(notifications.id, row.id));
    });
  }));
}
