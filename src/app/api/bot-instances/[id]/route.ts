import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { botInstances, botProducts, botSubscriptions } from "@/db/schema";
import { and, eq, gt } from "drizzle-orm";
import { getUser } from "@/lib/auth";
import { blockedActionMessage } from "@/lib/accounts";
import { getAsset } from "@/lib/market";
import { moneyFormatterFor } from "@/lib/fx-server";

export const dynamic = "force-dynamic";
const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

async function hasActiveSubscription(userId: string, botProductId: string) {
  const [row] = await db.select({ id: botSubscriptions.id }).from(botSubscriptions).where(and(eq(botSubscriptions.userId, userId), eq(botSubscriptions.botProductId, botProductId), gt(botSubscriptions.expiresAt, new Date()))).limit(1);
  return !!row;
}

// Reconfigure a bot instance (name/asset/allocation) or toggle it on/off.
// Turning an instance on requires an active (non-expired) subscription to
// its bot product; other edits are always allowed so a user can fix up a
// paused bot before resubscribing.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getUser(request);
    if (!user) return bad("Session expired. Please refresh the page.", 401);
    const { id } = await params;
    const [instance] = await db.select().from(botInstances).where(and(eq(botInstances.id, id), eq(botInstances.userId, user.id))).limit(1);
    if (!instance) return bad("Bot instance not found.", 404);

    const body = await request.json().catch(() => ({}));
    const updates: Record<string, unknown> = {};

    if (body.name !== undefined) {
      const name = String(body.name).trim().slice(0, 80);
      if (!name) return bad("Enter a name for this bot.");
      updates.name = name;
    }
    if (body.symbol !== undefined) {
      const symbol = String(body.symbol).toUpperCase();
      if (!getAsset(symbol)) return bad("Choose a valid asset to trade.");
      updates.symbol = symbol;
    }
    if (body.amount !== undefined) {
      const [product] = await db.select().from(botProducts).where(eq(botProducts.id, instance.botProductId)).limit(1);
      const minAllocation = Number(product?.minAllocation ?? 0);
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount < minAllocation) {
        const fmt = await moneyFormatterFor(user.currency);
        return bad(`Enter an allocation of at least ${fmt.usd(minAllocation)}.`);
      }
      if (amount > 10000000) return bad("Enter a smaller allocation amount.");
      updates.amount = amount.toFixed(2);
    }
    if (typeof body.active === "boolean") {
      if (body.active) {
        const blocked = blockedActionMessage(user, "configure");
        if (blocked) return bad(blocked, 403);
        if (!(await hasActiveSubscription(user.id, instance.botProductId))) return bad("Your subscription to this bot has expired. Resubscribe to resume it.");
      }
      updates.active = body.active;
    }
    if (Object.keys(updates).length === 0) return bad("Nothing to update.");

    const [row] = await db.update(botInstances).set({ ...updates, updatedAt: new Date() }).where(eq(botInstances.id, id)).returning();
    return NextResponse.json({ success: true, instance: row });
  } catch (error) {
    console.error("Bot instance PATCH:", error);
    return bad("Unable to update this bot.", 500);
  }
}

// Remove a configured bot instance. Does not affect the underlying
// subscription or other instances of the same bot.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getUser(request);
    if (!user) return bad("Session expired. Please refresh the page.", 401);
    const { id } = await params;
    const [instance] = await db.select().from(botInstances).where(and(eq(botInstances.id, id), eq(botInstances.userId, user.id))).limit(1);
    if (!instance) return bad("Bot instance not found.", 404);
    await db.delete(botInstances).where(eq(botInstances.id, id));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Bot instance DELETE:", error);
    return bad("Unable to remove this bot.", 500);
  }
}
