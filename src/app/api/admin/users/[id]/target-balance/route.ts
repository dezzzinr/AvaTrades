import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { notifyUser } from "@/lib/notify";

export const dynamic = "force-dynamic";
const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

// Directly sets a user's "Target" - a purely informational goal amount and
// progress percentage shown as a banner above their balance on the
// dashboard. Both the target amount AND the progress bar fill are
// independently admin-set; progress is never derived from the user's actual
// balance/holdings. Unlike cash/profit balance edits, this never moves real
// (paper) money, so there's no transaction/ledger entry - just the stored
// values and a notification.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin(request);
    if (!admin) return bad("Admin access required.", 403);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const newTarget = Number(body.newTarget);
    if (!Number.isFinite(newTarget) || newTarget < 0 || newTarget > 100000000) return bad("Enter a valid target amount.");
    const newProgress = Number(body.newProgress ?? 0);
    if (!Number.isFinite(newProgress) || newProgress < 0 || newProgress > 100) return bad("Enter a valid progress percentage (0-100).");

    const [row] = await db.update(users).set({ targetBalance: newTarget.toFixed(2), targetProgressPercent: newProgress.toFixed(2) }).where(eq(users.id, id)).returning({ id: users.id, targetBalance: users.targetBalance, targetProgressPercent: users.targetProgressPercent });
    if (!row) return bad("User not found.", 404);

    await notifyUser({
      userId: id,
      type: "target_balance_updated",
      title: "Your Target was updated",
      message: `An admin set your Target to $${newTarget.toFixed(2)} (${newProgress.toFixed(0)}% progress). It's shown as a banner above your balance on the dashboard and isn't included in your total balance.`,
    });

    return NextResponse.json({ success: true, message: `Target updated to $${newTarget.toFixed(2)} at ${newProgress.toFixed(0)}% progress.`, targetBalance: row.targetBalance, targetProgressPercent: row.targetProgressPercent });
  } catch (error) {
    console.error("Admin target edit:", error);
    return bad(error instanceof Error ? error.message : "Unable to update target.", 400);
  }
}
