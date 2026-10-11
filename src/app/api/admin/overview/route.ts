import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, depositRequests, withdrawalRequests, botSubscriptions, copySubscriptions, planSubscriptions } from "@/db/schema";
import { eq, gt, sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";
const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

// Aggregate counts for the admin Overview landing page.
export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdmin(request);
    if (!admin) return bad("Admin access required.", 403);
    const now = new Date();
    const [[userTotals], [pendingDeposits], [pendingWithdrawals], [activeBots], [activeCopy], [activePlans], [restricted]] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int`, totalCash: sql<string>`coalesce(sum(${users.cashBalance}),0)::text`, totalProfit: sql<string>`coalesce(sum(${users.profitBalance}),0)::text` }).from(users),
      db.select({ count: sql<number>`count(*)::int` }).from(depositRequests).where(eq(depositRequests.status, "pending")),
      db.select({ count: sql<number>`count(*)::int` }).from(withdrawalRequests).where(eq(withdrawalRequests.status, "pending")),
      db.select({ count: sql<number>`count(*)::int` }).from(botSubscriptions).where(gt(botSubscriptions.expiresAt, now)),
      db.select({ count: sql<number>`count(*)::int` }).from(copySubscriptions).where(gt(copySubscriptions.expiresAt, now)),
      db.select({ count: sql<number>`count(*)::int` }).from(planSubscriptions).where(gt(planSubscriptions.expiresAt, now)),
      db.select({ count: sql<number>`count(*)::int` }).from(users).where(sql`${users.accountStatus} != 'active'`),
    ]);
    return NextResponse.json({
      totalUsers: userTotals?.count ?? 0,
      totalCashBalance: userTotals?.totalCash ?? "0",
      totalProfitBalance: userTotals?.totalProfit ?? "0",
      pendingDeposits: pendingDeposits?.count ?? 0,
      pendingWithdrawals: pendingWithdrawals?.count ?? 0,
      activeBotSubscriptions: activeBots?.count ?? 0,
      activeCopySubscriptions: activeCopy?.count ?? 0,
      activePlanSubscriptions: activePlans?.count ?? 0,
      restrictedAccounts: restricted?.count ?? 0,
    });
  } catch (error) {
    console.error("Admin overview GET:", error);
    return bad("Unable to load overview.", 500);
  }
}
