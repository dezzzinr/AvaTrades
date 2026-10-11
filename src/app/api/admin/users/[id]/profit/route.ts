import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, transactions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { notifyUser } from "@/lib/notify";

export const dynamic = "force-dynamic";
const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

// Directly set a user's profit balance. Mirrors the cash-balance editor:
// the delta is logged as a profit_credit/profit_debit transaction (visible
// in the user's transaction history) and the user is notified. This balance
// isn't spendable on trades/withdrawals - it's a display figure folded into
// the user's "Total balance" alongside cash + invested assets.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin(request);
    if (!admin) return bad("Admin access required.", 403);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const newProfit = Number(body.newProfit);
    const note = body.note ? String(body.note).trim().slice(0, 300) : "";
    if (!Number.isFinite(newProfit) || newProfit < 0 || newProfit > 100000000) return bad("Enter a valid profit amount.");

    const result = await db.transaction(async (tx) => {
      const [wallet] = await tx.select().from(users).where(eq(users.id, id)).for("update");
      if (!wallet) throw new Error("User not found.");
      const oldProfit = Number(wallet.profitBalance);
      const delta = Math.round((newProfit - oldProfit) * 100) / 100;
      await tx.update(users).set({ profitBalance: newProfit.toFixed(2) }).where(eq(users.id, id));
      if (Math.abs(delta) >= 0.01) {
        await tx.insert(transactions).values({
          userId: id,
          type: delta > 0 ? "profit_credit" : "profit_debit",
          amount: Math.abs(delta).toFixed(2),
          description: note || `Profit balance ${delta > 0 ? "increased" : "decreased"} by admin`,
        });
      }
      return { message: `Profit balance updated to $${newProfit.toFixed(2)}.`, delta };
    });

    if (Math.abs(result.delta) >= 0.01) {
      await notifyUser({
        userId: id,
        type: result.delta > 0 ? "profit_credit" : "profit_debit",
        title: result.delta > 0 ? "Profits credited" : "Profits adjusted",
        message: `An admin ${result.delta > 0 ? "credited" : "debited"} $${Math.abs(result.delta).toFixed(2)} ${result.delta > 0 ? "to" : "from"} your profit balance.${note ? ` Note: ${note}` : ""}`,
      });
    }

    return NextResponse.json({ success: true, message: result.message });
  } catch (error) {
    console.error("Admin profit edit:", error);
    return bad(error instanceof Error ? error.message : "Unable to update profit balance.", 400);
  }
}
