import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { db } from "@/db";
import { users, sessions, holdings, trades, transactions } from "@/db/schema";
import { eq, and, gt } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

const COOKIE = "nexa_session";
const days30 = 30 * 24 * 60 * 60 * 1000;
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
export function checkPassword(password: string, stored: string) {
  try {
    const [salt, hash] = stored.split(":");
    return timingSafeEqual(Buffer.from(hash, "hex"), scryptSync(password, salt, 64));
  } catch { return false; }
}
export async function getUser(request: NextRequest) {
  const token = request.cookies.get(COOKIE)?.value;
  if (!token) return null;
  const rows = await db.select({ user: users }).from(sessions).innerJoin(users, eq(sessions.userId, users.id)).where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date()))).limit(1);
  return rows[0]?.user ?? null;
}
export function isAdminEmail(email: string) {
  const list = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return list.includes(email.trim().toLowerCase());
}
export async function requireAdmin(request: NextRequest) {
  const user = await getUser(request);
  if (!user || user.role !== "admin") return null;
  return user;
}
export async function setSession(response: NextResponse, userId: string) {
  const token = randomBytes(32).toString("hex");
  await db.insert(sessions).values({ tokenHash: hashToken(token), userId, expiresAt: new Date(Date.now() + days30) });
  response.cookies.set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: days30 / 1000 });
  return response;
}
export async function clearSession(request: NextRequest, response: NextResponse) {
  const token = request.cookies.get(COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  response.cookies.delete(COOKIE);
  return response;
}
// Every anonymous visitor without a valid session used to get their own
// brand-new "Alex Morgan" demo user row - on a public site that meant a
// fresh (never-cleaned-up) row per visit, forever. Instead there is now
// exactly one shared demo account (name/username "demo"): if it already
// exists we just reuse it, and only the very first visitor ever creates it
// (seeding its sample holdings/trades/transaction exactly once).
export async function createDemoUser() {
  const [existing] = await db.select().from(users).where(eq(users.isDemo, true)).limit(1);
  if (existing) return existing;

  try {
    return await seedDemoUser();
  } catch {
    // Lost a race with another concurrent first-ever request also trying
    // to create the singleton demo user (the unique "demo" username
    // constraint rejected the second insert) - just reuse whichever one
    // won.
    const [fallback] = await db.select().from(users).where(eq(users.isDemo, true)).limit(1);
    if (fallback) return fallback;
    throw new Error("Unable to create the demo account.");
  }
}

async function seedDemoUser() {
  const [user] = await db.insert(users).values({ name: "demo", username: "demo", isDemo: true, cashBalance: "12540.50" }).returning();
  await db.insert(holdings).values([
    { userId: user.id, symbol: "BTC", quantity: "0.28450000", avgPrice: "61240.00" },
    { userId: user.id, symbol: "ETH", quantity: "3.25000000", avgPrice: "3180.00" },
    { userId: user.id, symbol: "SOL", quantity: "42.00000000", avgPrice: "148.50" },
    { userId: user.id, symbol: "AVAX", quantity: "80.00000000", avgPrice: "34.20" },
  ]);
  await db.insert(trades).values([
    { userId: user.id, symbol: "BTC", side: "buy", quantity: "0.08450000", price: "66421.50", total: "5612.62", createdAt: new Date(Date.now() - 2 * 3600000) },
    { userId: user.id, symbol: "ETH", side: "buy", quantity: "1.25000000", price: "3482.20", total: "4352.75", createdAt: new Date(Date.now() - 25 * 3600000) },
    { userId: user.id, symbol: "SOL", side: "sell", quantity: "12.00000000", price: "168.40", total: "2020.80", createdAt: new Date(Date.now() - 72 * 3600000) },
  ]);
  await db.insert(transactions).values({ userId: user.id, type: "deposit", amount: "25000.00", description: "Demo funds added", createdAt: new Date(Date.now() - 6 * 86400000) });
  return user;
}

