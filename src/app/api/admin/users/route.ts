import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { desc, ilike, or, sql } from "drizzle-orm";
import { requireAdmin, hashPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";
const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

const PUBLIC_COLUMNS = {
  id: users.id,
  name: users.name,
  email: users.email,
  role: users.role,
  isDemo: users.isDemo,
  cashBalance: users.cashBalance,
  profitBalance: users.profitBalance,
  targetBalance: users.targetBalance,
  targetProgressPercent: users.targetProgressPercent,
  accountStatus: users.accountStatus,
  maxTradeAmount: users.maxTradeAmount,
  withdrawalsBlocked: users.withdrawalsBlocked,
  statusReason: users.statusReason,
  statusUpdatedAt: users.statusUpdatedAt,
  createdAt: users.createdAt,
};

// All users, newest first, with optional ?q= search over name/email.
export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdmin(request);
    if (!admin) return bad("Admin access required.", 403);
    const q = request.nextUrl.searchParams.get("q")?.trim();
    const where = q ? or(ilike(users.name, `%${q}%`), ilike(users.email, `%${q}%`)) : undefined;
    const rows = await db.select(PUBLIC_COLUMNS).from(users).where(where).orderBy(desc(users.createdAt)).limit(300);
    const [totals] = await db.select({ count: sql<number>`count(*)::int`, totalCash: sql<string>`coalesce(sum(${users.cashBalance}),0)::text`, totalProfit: sql<string>`coalesce(sum(${users.profitBalance}),0)::text` }).from(users);
    return NextResponse.json({ users: rows, total: totals?.count ?? rows.length, totalCashBalance: totals?.totalCash ?? "0", totalProfitBalance: totals?.totalProfit ?? "0" });
  } catch (error) {
    console.error("Admin users GET:", error);
    return bad("Unable to load users.", 500);
  }
}

// Create a new user account directly from the admin panel (e.g. for a
// customer who signed up through another channel).
export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin(request);
    if (!admin) return bad("Admin access required.", 403);
    const body = await request.json().catch(() => ({}));
    const name = String(body.name ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const role = body.role === "admin" ? "admin" : "user";
    const cashBalanceInput = body.cashBalance === undefined || body.cashBalance === "" ? 0 : Number(body.cashBalance);
    const profitBalanceInput = body.profitBalance === undefined || body.profitBalance === "" ? 0 : Number(body.profitBalance);

    if (name.length < 2 || name.length > 80) return bad("Name must be between 2 and 80 characters.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad("Enter a valid email address.");
    if (password.length < 8) return bad("Password must be at least 8 characters.");
    if (!Number.isFinite(cashBalanceInput) || cashBalanceInput < 0 || cashBalanceInput > 100000000) return bad("Enter a valid starting balance.");
    if (!Number.isFinite(profitBalanceInput) || profitBalanceInput < 0 || profitBalanceInput > 100000000) return bad("Enter a valid starting profit.");

    const [existing] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
    if (existing) return bad("An account with this email already exists.", 409);

    const [row] = await db.insert(users).values({
      name,
      email,
      passwordHash: hashPassword(password),
      cashBalance: cashBalanceInput.toFixed(2),
      profitBalance: profitBalanceInput.toFixed(2),
      role,
    }).returning(PUBLIC_COLUMNS);

    return NextResponse.json({ success: true, user: row });
  } catch (error) {
    console.error("Admin create user:", error);
    return bad("Unable to create user.", 500);
  }
}
