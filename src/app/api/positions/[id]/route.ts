import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { positions, transactions, users } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { getUser } from "@/lib/auth";
import { getMarketSnapshot } from "@/lib/market-server";
import { positionPnl, realizedPnl, type PositionSide } from "@/lib/trading";
import { notifyUser } from "@/lib/notify";
import { moneyFormatterFor } from "@/lib/fx-server";

export const dynamic = "force-dynamic";
const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getUser(request);
    if (!user) return bad("Session expired. Please refresh the page.", 401);
    // Formats every amount in this request's messages in the user's own
    // display currency (chosen on their profile). Ledger math stays USD.
    const fmt = await moneyFormatterFor(user.currency);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    if (body.action !== "close") return bad("Unknown action.");

    const result = await db.transaction(async (tx) => {
      const [position] = await tx.select().from(positions).where(and(eq(positions.id, id), eq(positions.userId, user.id))).for("update");
      if (!position) throw new Error("Position not found.");
      if (position.status !== "open") throw new Error("This position is already closed.");

      const market = await getMarketSnapshot();
      const asset = market.assets.find((item) => item.symbol === position.symbol);
      if (market.status !== "live" || !asset || asset.price <= 0) throw new Error("Live market pricing is unavailable right now. Try again shortly.");

      const pnl = realizedPnl(Number(position.margin), positionPnl(position.side as PositionSide, Number(position.entryPrice), asset.price, Number(position.quantity)));
      const credit = Math.round((Number(position.margin) + pnl) * 100) / 100;
      await tx.update(users).set({ cashBalance: sql`${users.cashBalance} + ${credit}` }).where(eq(users.id, user.id));
      await tx.update(positions).set({
        status: "closed",
        closePrice: asset.price.toFixed(8),
        closeReason: "manual",
        realizedPnl: pnl.toFixed(2),
        closedAt: new Date(),
      }).where(eq(positions.id, id));
      await tx.insert(transactions).values({
        userId: user.id,
        type: "margin_close",
        amount: pnl.toFixed(2),
        description: `Closed ${Number(position.leverage)}x ${position.side} ${position.symbol} position at ${fmt.marketPrice(asset.price)}`,
      });
      return { pnl, price: asset.price, symbol: position.symbol, side: position.side, leverage: Number(position.leverage) };
    });

    await notifyUser({
      userId: user.id,
      type: "position_closed",
      title: "Position closed",
      message: `Closed your ${result.leverage}x ${result.side} ${result.symbol} position at ${fmt.marketPrice(result.price)} (${result.pnl >= 0 ? "+" : ""}${fmt.money(result.pnl)} P&L).`,
    });

    return NextResponse.json({ success: true, message: `Position closed at ${fmt.marketPrice(result.price)} (${result.pnl >= 0 ? "+" : ""}${fmt.money(result.pnl)} P&L).` });
  } catch (error) {
    console.error("Position close:", error);
    return bad(error instanceof Error ? error.message : "Unable to close this position.", 400);
  }
}
