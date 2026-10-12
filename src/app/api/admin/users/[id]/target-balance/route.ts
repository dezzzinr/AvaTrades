import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { notifyUser } from "@/lib/notify";

export const dynamic = "force-dynamic";
const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

// Directly set a user's "Target balance" - a purely informational goal
// figure shown next to their Total balance on the dashboard. Unlike
// cash/profit balance edits, this never moves real (paper) money, so there's
// no transaction/ledger entry - just the stored value and a notification.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin(request);
    if (!admin) return bad("Admin access required.", 403);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const newTarget = Number(body.newTarget);
    if (!Number.isFinite(newTarget) || newTarget < 0 || newTarget > 100000000) return bad("Enter a valid target amount.");

    const [row] = await db.update(users).set({ targetBalance: newTarget.toFixed(2) }).where(eq(users.id, id)).returning({ id: users.id, targetBalance: users.targetBalance });
    if (!row) return bad("User not found.", 404);

    await notifyUser({
      userId: id,
      type: "target_balance_updated",
      title: "Your target balance was updated",
      message: `An admin set your target balance to $${newTarget.toFixed(2)}. This is a goal figure shown on your dashboard and isn't included in your total balance.`,
    });

    return NextResponse.json({ success: true, message: `Target balance updated to $${newTarget.toFixed(2)}.`, targetBalance: row.targetBalance });
  } catch (error) {
    console.error("Admin target balance edit:", error);
    return bad(error instanceof Error ? error.message : "Unable to update target balance.", 400);
  }
}
