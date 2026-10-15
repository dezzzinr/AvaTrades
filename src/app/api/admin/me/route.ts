import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getFxSnapshot } from "@/lib/fx-server";

export const dynamic = "force-dynamic";

// Lightweight identity check for the admin panel. Deliberately does not
// fall back to creating a demo user the way /api/app does, so visiting
// /admin while signed out or as a regular user never silently provisions
// an account.
//
// Also returns the admin's own display-currency preference plus live FX data,
// the same way /api/app does for the main dashboard - so every money amount
// shown anywhere in the admin panel (totals, user balances, trade history,
// deposit/withdrawal requests, catalog prices, etc.) renders in whatever
// currency the signed-in admin has chosen on their profile, not hardcoded USD.
//
// The full `rates` table is included because admin funding forms let the admin
// pick ANY currency to enter an amount in, and the form previews the resulting
// USD ledger value live as they type. This is preview-only: the authoritative
// conversion always happens server-side in the funding route itself.
export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const currency = admin.currency ?? "USD";
  const snapshot = await getFxSnapshot();
  const raw = currency === "USD" ? 1 : snapshot.rates[currency];
  const hasRate = typeof raw === "number" && Number.isFinite(raw) && raw > 0;
  return NextResponse.json({
    user: { id: admin.id, name: admin.name, email: admin.email, currency },
    fx: {
      currency,
      rate: hasRate ? (raw as number) : 1,
      // Matches getFxRate()'s semantics for the admin's OWN display currency:
      // a code the provider doesn't cover falls back to 1:1 for display and is
      // reported as "unavailable", not "live". (The funding forms judge each
      // candidate currency individually from `rates` below, and refuse to
      // convert without a real rate.)
      status: hasRate ? snapshot.status : "unavailable",
      updatedAt: snapshot.updatedAt,
      // Full USD->X table, so the admin funding forms can preview a conversion
      // for any currency the admin picks. Preview only - the authoritative
      // conversion happens server-side in the funding route.
      rates: snapshot.rates,
    },
  });
}

