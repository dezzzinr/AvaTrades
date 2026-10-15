import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, holdings, trades } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { getAsset } from "@/lib/market";
import { getMarketSnapshot } from "@/lib/market-server";
import { moneyFormatterFor, convertPriceToUsd } from "@/lib/fx-server";

export const dynamic = "force-dynamic";
const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

// Place a trade on behalf of a user - e.g. fulfilling a manual trade a user
// requested from live support over phone/chat. Fills at the current live
// quote by default, or at an admin-supplied price override (useful for
// honoring a price quoted to the user earlier). Bypasses the user's own
// account restrictions (trade limit, suspension) since the admin is
// explicitly authorizing this trade themselves.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin(request);
    if (!admin) return bad("Admin access required.", 403);
    // Confirmation text goes back to the admin, so it's formatted in the
    // admin's own display currency. Ledger values stay USD.
    const fmt = await moneyFormatterFor(admin.currency);
    const { id } = await params;
    const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
    if (!target) return bad("User not found.", 404);

    const body = await request.json().catch(() => ({}));
    const symbol = String(body.symbol ?? "").toUpperCase();
    const side = body.side;
    const quantity = Number(body.quantity);
    const adminNote = body.note ? String(body.note).trim().slice(0, 300) : null;

    if (!getAsset(symbol)) return bad("Choose a valid asset.");
    if (!["buy", "sell"].includes(side)) return bad("Choose buy or sell.");
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1000000 || (quantity.toString().split(".")[1]?.length ?? 0) > 8) return bad("Enter a valid trade quantity.");

    // The optional fill price is typed in the admin's own display currency -
    // every price in the admin panel renders converted, so an admin reading a
    // figure off the screen and typing it back would otherwise be double
    // converted. Trades store USD price levels, so convert it here.
    const enteredPrice = body.price === undefined || body.price === null || body.price === "" ? null : Number(body.price);
    let priceOverride: number | null = null;
    if (enteredPrice !== null) {
      if (!Number.isFinite(enteredPrice) || enteredPrice <= 0) return bad("Enter a valid override price.");
      const converted = await convertPriceToUsd(enteredPrice, body.currency);
      if (!converted.ok) return bad(converted.error);
      if (converted.usd > 100000000) return bad("Enter a valid override price.");
      priceOverride = converted.usd;
    }

    let fillPrice = priceOverride;
    if (fillPrice === null) {
      const market = await getMarketSnapshot();
      const asset = market.assets.find((item) => item.symbol === symbol);
      if (market.status !== "live" || !asset || asset.price <= 0) return bad("Live market pricing is unavailable right now. Try again shortly, or set a manual fill price.", 503);
      fillPrice = asset.price;
    }
    const total = Math.round(quantity * fillPrice * 100) / 100;
    if (total < 0.01) return bad(`Minimum trade value is ${fmt.usd(0.01)}.`);

    await db.transaction(async (tx) => {
      const [wallet] = await tx.select().from(users).where(eq(users.id, id)).for("update");
      const [existing] = await tx.select().from(holdings).where(and(eq(holdings.userId, id), eq(holdings.symbol, symbol))).for("update");
      if (side === "buy") {
        if (Number(wallet.cashBalance) < total) throw new Error("This user doesn't have enough available balance for this trade.");
        await tx.update(users).set({ cashBalance: sql`${users.cashBalance} - ${total}` }).where(eq(users.id, id));
        if (existing) {
          const oldQty = Number(existing.quantity);
          const newQty = oldQty + quantity;
          const avgPrice = ((oldQty * Number(existing.avgPrice)) + quantity * fillPrice) / newQty;
          await tx.update(holdings).set({ quantity: newQty.toFixed(8), avgPrice: avgPrice.toFixed(8) }).where(eq(holdings.id, existing.id));
        } else await tx.insert(holdings).values({ userId: id, symbol, quantity: quantity.toFixed(8), avgPrice: fillPrice.toFixed(8) });
      } else {
        if (!existing || Number(existing.quantity) + 0.000000001 < quantity) throw new Error("This user doesn't hold enough of this asset for this trade.");
        await tx.update(users).set({ cashBalance: sql`${users.cashBalance} + ${total}` }).where(eq(users.id, id));
        const remaining = Number(existing.quantity) - quantity;
        if (remaining < 0.00000001) await tx.delete(holdings).where(eq(holdings.id, existing.id));
        else await tx.update(holdings).set({ quantity: remaining.toFixed(8) }).where(eq(holdings.id, existing.id));
      }
      await tx.insert(trades).values({ userId: id, symbol, side, quantity: quantity.toFixed(8), price: fillPrice.toFixed(8), total: total.toFixed(2), placedBy: admin.id, adminNote });
    });

    return NextResponse.json({ success: true, price: fillPrice, total, message: `${side === "buy" ? "Bought" : "Sold"} ${quantity} ${symbol} at ${fmt.marketPrice(fillPrice)} on behalf of this user.` });
  } catch (error) {
    console.error("Admin place trade:", error);
    return bad(error instanceof Error ? error.message : "Unable to place this trade.", 400);
  }
}
