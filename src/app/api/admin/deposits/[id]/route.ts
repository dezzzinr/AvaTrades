import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { depositRequests, users, transactions } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { depositMethodLabel } from "@/lib/deposits";
import { notifyUser } from "@/lib/notify";
import { moneyFormatterFor } from "@/lib/fx-server";

export const dynamic = "force-dynamic";
const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

// Approve or reject a pending deposit request. Approving is the ONLY place
// a deposit ever credits a user's balance, and only after admin review.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin(request);
    if (!admin) return bad("Admin access required.", 403);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const decision = String(body.action ?? "");
    if (!["approve", "reject"].includes(decision)) return bad("Invalid action.");
    const adminNote = body.adminNote ? String(body.adminNote).trim().slice(0, 1000) || null : null;
    if (decision === "reject" && !adminNote) return bad("Add a short note explaining why this deposit was rejected.");

    const result = await db.transaction(async (tx) => {
      const [row] = await tx.select().from(depositRequests).where(eq(depositRequests.id, id)).for("update");
      if (!row) throw new Error("Deposit request not found.");
      if (row.status !== "pending") throw new Error("This request has already been reviewed.");

      if (decision === "approve") {
        await tx.update(users).set({ cashBalance: sql`${users.cashBalance} + ${row.amount}` }).where(eq(users.id, row.userId));
        await tx.insert(transactions).values({
          userId: row.userId,
          type: "deposit",
          amount: row.amount,
          description: `${depositMethodLabel(row.method)} deposit approved${row.reference ? ` · Ref ${row.reference}` : ""}`,
        });
      }

      await tx
        .update(depositRequests)
        .set({ status: decision === "approve" ? "approved" : "rejected", adminNote, reviewedBy: admin.id, reviewedAt: new Date() })
        .where(eq(depositRequests.id, id));

      return {
        message: decision === "approve" ? "Deposit approved and credited to the user's balance." : "Deposit request rejected.",
        userId: row.userId,
        amount: row.amount,
        method: row.method,
      };
    });

    // The notification goes to the user who made the deposit, so the amount
    // is written in their own display currency (the ledger value stays USD).
    const [target] = await db.select({ currency: users.currency }).from(users).where(eq(users.id, result.userId)).limit(1);
    const userFmt = await moneyFormatterFor(target?.currency);

    await notifyUser({
      userId: result.userId,
      type: decision === "approve" ? "deposit_approved" : "deposit_rejected",
      title: decision === "approve" ? "Deposit approved" : "Deposit rejected",
      message: decision === "approve"
        ? `Your ${userFmt.money(Number(result.amount))} ${depositMethodLabel(result.method)} deposit was approved and credited to your balance.`
        : `Your ${userFmt.money(Number(result.amount))} ${depositMethodLabel(result.method)} deposit was rejected.${adminNote ? ` Reason: ${adminNote}` : ""}`,
    });

    return NextResponse.json({ success: true, message: result.message });
  } catch (error) {
    console.error("Admin deposit review:", error);
    return bad(error instanceof Error ? error.message : "Something went wrong.", 400);
  }
}
