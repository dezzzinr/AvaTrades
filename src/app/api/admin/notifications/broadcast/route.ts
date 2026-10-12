import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { notifyUser, notifyAdmins } from "@/lib/notify";

export const dynamic = "force-dynamic";
const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

// Sends an announcement to every real (non-demo) user as an in-app
// notification, emailed too unless that user has email notifications off.
export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin(request);
    if (!admin) return bad("Admin access required.", 403);
    const body = await request.json().catch(() => ({}));
    const title = String(body.title ?? "").trim();
    const message = String(body.message ?? "").trim();
    if (!title || !message) return bad("Title and message are required.");
    if (title.length > 120) return bad("Title is too long.");
    if (message.length > 2000) return bad("Message is too long.");

    const recipients = await db.select({ id: users.id }).from(users).where(eq(users.isDemo, false));
    // Fire sequentially-awaited but fully parallel; notifyUser is cheap (one
    // insert + a deferred email) so this comfortably handles a realistic
    // user base for this app without a queue. notifyAdmins is skipped per
    // recipient here (that would flood every admin with one row per user) -
    // a single summary notification is sent to the other admins below
    // instead.
    await Promise.all(recipients.map((u) => notifyUser({
      userId: u.id,
      type: "admin_message",
      title,
      message,
      sentBy: admin.id,
      notifyAdmins: false,
    })));

    await notifyAdmins({
      type: "admin_message",
      title: `Broadcast sent: ${title}`,
      message: `${admin.name} broadcast "${message}" to ${recipients.length} user${recipients.length === 1 ? "" : "s"}.`,
      sentBy: admin.id,
    });

    return NextResponse.json({ success: true, sent: recipients.length });
  } catch (error) {
    console.error("Admin broadcast:", error);
    return bad("Unable to send this broadcast.", 500);
  }
}

