import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, transactions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { notifyUser } from "@/lib/notify";
import { moneyFormatterFor, convertToUsd, convertedAmountLabel } from "@/lib/fx-server";

export const dynamic = "force-dynamic";
const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

// Directly set a user's profit balance. Mirrors the cash-balance editor:
// the delta is logged as a profit_credit/profit_debit transaction (visible
// in the user's transaction history) and the user is notified. This balance
// isn't spendable on trades/withdrawals - it's a display figure folded into
// the user's "Total balance" alongside cash + invested assets.
//
// As with the balance editor, the admin may enter the amount in any currency
// and it is converted to the USD ledger here on the server.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin(request);
    if (!admin) return bad("Admin access required.", 403);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const entered = Number(body.newProfit);
    const note = body.note ? String(body.note).trim().slice(0, 300) : "";
    if (!Number.isFinite(entered) || entered < 0) return bad("Enter a valid profit amount.");

    const conversion = await convertToUsd(entered, body.currency);
    if (!conversion.ok) return bad(conversion.error);
    const newProfit = conversion.usd;
    if (newProfit > 100000000) return bad("Enter a valid profit amount.");

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
      return { delta, currency: wallet.currency };
    });

    // The notification is rendered in the affected user's display currency; the
    // ledger value stays USD either way. The admin's own confirmation reports
    // the USD amount stored plus what they entered and the rate applied.
    const userFmt = await moneyFormatterFor(result.currency);

    if (Math.abs(result.delta) >= 0.01) {
      await notifyUser({
        userId: id,
        type: result.delta > 0 ? "profit_credit" : "profit_debit",
        title: result.delta > 0 ? "Profits credited" : "Profits adjusted",
        message: `An admin ${result.delta > 0 ? "credited" : "debited"} ${userFmt.money(Math.abs(result.delta))} ${result.delta > 0 ? "to" : "from"} your profit balance.${note ? ` Note: ${note}` : ""}`,
      });
    }

    return NextResponse.json({
      success: true,
      message: `Profit balance updated to ${convertedAmountLabel(conversion, entered)}.`,
      usd: newProfit,
      entered: { amount: entered, currency: conversion.currency, rate: conversion.rate, status: conversion.status },
    });
  } catch (error) {
    console.error("Admin profit edit:", error);
    return bad(error instanceof Error ? error.message : "Unable to update profit balance.", 400);
  }
}
