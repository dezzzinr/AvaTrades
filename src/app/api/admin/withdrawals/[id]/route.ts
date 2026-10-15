import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { withdrawalRequests, users, transactions } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { withdrawalMethodLabel } from "@/lib/withdrawals";
import { notifyUser } from "@/lib/notify";
import { moneyFormatterFor } from "@/lib/fx-server";

export const dynamic = "force-dynamic";
const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

// Approve or reject a pending withdrawal request. The requested amount was
// already held (deducted) when the user submitted the request. Approving
// simply finalizes it and logs the transaction (the admin is expected to
// have actually sent the funds to the user's destination outside the app).
// Rejecting refunds the held amount back to the user's balance.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin(request);
    if (!admin) return bad("Admin access required.", 403);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const decision = String(body.action ?? "");
    if (!["approve", "reject"].includes(decision)) return bad("Invalid action.");
    const adminNote = body.adminNote ? String(body.adminNote).trim().slice(0, 1000) || null : null;
    if (decision === "reject" && !adminNote) return bad("Add a short note explaining why this withdrawal was rejected.");

    const result = await db.transaction(async (tx) => {
      const [row] = await tx.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, id)).for("update");
      if (!row) throw new Error("Withdrawal request not found.");
      if (row.status !== "pending") throw new Error("This request has already been reviewed.");

      if (decision === "approve") {
        await tx.insert(transactions).values({
          userId: row.userId,
          type: "withdrawal",
          amount: row.amount,
          description: `${withdrawalMethodLabel(row.method, row.methodLabel)} withdrawal approved · Sent to ${row.destination}`,
        });
      } else {
        // Refund the held amount back to the user's available balance.
        await tx.update(users).set({ cashBalance: sql`${users.cashBalance} + ${row.amount}` }).where(eq(users.id, row.userId));
      }

      await tx
        .update(withdrawalRequests)
        .set({ status: decision === "approve" ? "approved" : "rejected", adminNote, reviewedBy: admin.id, reviewedAt: new Date() })
        .where(eq(withdrawalRequests.id, id));

      return {
        message: decision === "approve" ? "Withdrawal approved and marked as sent." : "Withdrawal rejected and the held amount was returned to the user's balance.",
        userId: row.userId,
        amount: row.amount,
        method: row.method,
        methodLabel: row.methodLabel,
      };
    });

    // The notification goes to the user who requested the withdrawal, so the
    // amount is written in their own display currency (ledger stays USD).
    const [target] = await db.select({ currency: users.currency }).from(users).where(eq(users.id, result.userId)).limit(1);
    const userFmt = await moneyFormatterFor(target?.currency);

    await notifyUser({
      userId: result.userId,
      type: decision === "approve" ? "withdrawal_approved" : "withdrawal_rejected",
      title: decision === "approve" ? "Withdrawal approved" : "Withdrawal rejected",
      message: decision === "approve"
        ? `Your ${userFmt.money(Number(result.amount))} ${withdrawalMethodLabel(result.method, result.methodLabel)} withdrawal was approved and marked as sent.`
        : `Your ${userFmt.money(Number(result.amount))} ${withdrawalMethodLabel(result.method, result.methodLabel)} withdrawal was rejected and the held amount was returned to your balance.${adminNote ? ` Reason: ${adminNote}` : ""}`,
    });

    return NextResponse.json({ success: true, message: result.message });
  } catch (error) {
    console.error("Admin withdrawal review:", error);
    return bad(error instanceof Error ? error.message : "Something went wrong.", 400);
  }
}
