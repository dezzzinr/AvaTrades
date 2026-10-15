import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { priceAlerts } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { getUser } from "@/lib/auth";
import { getAsset } from "@/lib/market";
import { moneyFormatterFor, convertPriceToUsd } from "@/lib/fx-server";

export const dynamic = "force-dynamic";
const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status });
const MAX_OPEN_ALERTS = 20;

// The current user's price alerts (open + history), most recent first.
export async function GET(request: NextRequest) {
  try {
    const user = await getUser(request);
    if (!user) return bad("Session expired. Please refresh the page.", 401);
    const rows = await db.select().from(priceAlerts).where(eq(priceAlerts.userId, user.id)).orderBy(desc(priceAlerts.createdAt)).limit(100);
    return NextResponse.json({
      open: rows.filter((a) => a.status === "open"),
      history: rows.filter((a) => a.status !== "open"),
    });
  } catch (error) {
    console.error("Price alerts GET:", error);
    return bad("Unable to load your price alerts.", 500);
  }
}

// Create a one-shot "notify me when <symbol> goes above/below <price>"
// alert. Not a trading order - it never buys/sells anything, just notifies
// (in-app + email) the next time the sweep sees the condition met.
export async function POST(request: NextRequest) {
  try {
    const user = await getUser(request);
    if (!user) return bad("Session expired. Please refresh the page.", 401);
    // Formats amounts in the user's own display currency (chosen on their
    // profile). Alert trigger prices stay USD in the ledger.
    const fmt = await moneyFormatterFor(user.currency);
    const body = await request.json().catch(() => ({}));
    const symbol = String(body.symbol ?? "").toUpperCase();
    const direction = body.direction;

    if (!getAsset(symbol)) return bad("Choose a valid asset.");
    if (!["above", "below"].includes(direction)) return bad("Choose above or below.");

    // The target price is typed in the user's own display currency - they read
    // the chart in that currency, so they should be able to type the level they
    // see. Converted to a USD price level here (high precision: prices are
    // stored at 8dp and can legitimately be tiny).
    const enteredPrice = Number(body.targetPrice);
    if (!Number.isFinite(enteredPrice) || enteredPrice <= 0) return bad("Enter a valid target price.");
    const priceConversion = await convertPriceToUsd(enteredPrice, body.currency);
    if (!priceConversion.ok) return bad(priceConversion.error);
    const targetPrice = priceConversion.usd;
    if (targetPrice > 100_000_000) return bad("Enter a valid target price.");

    const openCountRows = await db.select({ id: priceAlerts.id }).from(priceAlerts).where(and(eq(priceAlerts.userId, user.id), eq(priceAlerts.status, "open")));
    if (openCountRows.length >= MAX_OPEN_ALERTS) return bad(`You can have up to ${MAX_OPEN_ALERTS} active price alerts at a time. Cancel one first.`);

    const [row] = await db.insert(priceAlerts).values({
      userId: user.id,
      symbol,
      direction,
      targetPrice: targetPrice.toFixed(8),
    }).returning();

    return NextResponse.json({ success: true, alert: row, message: `We'll notify you when ${symbol} goes ${direction} ${fmt.marketPrice(targetPrice)}.` });
  } catch (error) {
    console.error("Price alerts POST:", error);
    return bad("Unable to create this price alert.", 500);
  }
}
