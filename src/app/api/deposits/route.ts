import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { depositAccounts, depositRequests } from "@/db/schema";
import { desc, eq, and } from "drizzle-orm";
import { getUser } from "@/lib/auth";
import { blockedActionMessage } from "@/lib/accounts";
import { ALLOWED_RECEIPT_MIME_TYPES, DEPOSIT_METHOD_IDS, MAX_RECEIPT_BYTES, parseDataUrl } from "@/lib/deposits";
import { notifyUser } from "@/lib/notify";
import { moneyFormatterFor, convertToUsd, USD_ADVICE_USER } from "@/lib/fx-server";

export const dynamic = "force-dynamic";
const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

// A user's own deposit requests (receipt bytes are excluded from the list;
// fetch /api/deposits/[id]/receipt to view the uploaded file).
export async function GET(request: NextRequest) {
  try {
    const user = await getUser(request);
    if (!user) return bad("Session expired. Please refresh the page.", 401);
    const rows = await db
      .select({
        id: depositRequests.id,
        method: depositRequests.method,
        amount: depositRequests.amount,
        destinationLabel: depositRequests.destinationLabel,
        reference: depositRequests.reference,
        note: depositRequests.note,
        status: depositRequests.status,
        adminNote: depositRequests.adminNote,
        receiptFilename: depositRequests.receiptFilename,
        createdAt: depositRequests.createdAt,
        reviewedAt: depositRequests.reviewedAt,
      })
      .from(depositRequests)
      .where(eq(depositRequests.userId, user.id))
      .orderBy(desc(depositRequests.createdAt))
      .limit(100);
    return NextResponse.json({ requests: rows });
  } catch (error) {
    console.error("Deposits GET:", error);
    return bad("Unable to load your deposit requests.", 500);
  }
}

// Submit a new deposit request: the user claims to have sent funds to one
// of the admin-provided destinations and attaches proof of payment. No
// balance change happens here - an admin must approve it first.
export async function POST(request: NextRequest) {
  try {
    const user = await getUser(request);
    if (!user) return bad("Session expired. Please refresh the page.", 401);
    const blocked = blockedActionMessage(user, "deposit");
    if (blocked) return bad(blocked, 403);
    // Formats every amount in this request's messages in the user's own
    // display currency (chosen on their profile). Ledger math stays USD.
    const fmt = await moneyFormatterFor(user.currency);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return bad("Invalid request.");

    const method = String(body.method ?? "");
    if (!DEPOSIT_METHOD_IDS.includes(method as (typeof DEPOSIT_METHOD_IDS)[number])) return bad("Choose a valid deposit method.");

    // The amount is typed in the user's own display currency (`currency` in the
    // body); the ledger stores USD, so it is converted here on the server rather
    // than trusting a client-computed figure. Bounds are checked against the
    // converted USD value, because that is what the ledger holds - a 10,000,000
    // cap meant "$10M", not "10M naira" (which is only ~$7.5k).
    const entered = Number(body.amount);
    if (!Number.isFinite(entered) || entered <= 0) return bad(`Enter a valid amount of at least ${fmt.usd(1)}.`);
    const conversion = await convertToUsd(entered, body.currency, USD_ADVICE_USER);
    if (!conversion.ok) return bad(conversion.error);
    const amount = conversion.usd;
    if (amount < 1) return bad(`Enter a valid amount of at least ${fmt.usd(1)}.`);
    if (amount > 10000000) return bad("Enter a smaller amount.");

    const depositAccountId = body.depositAccountId ? String(body.depositAccountId) : null;
    let destinationLabel: string | null = null;
    if (depositAccountId) {
      const [account] = await db
        .select()
        .from(depositAccounts)
        .where(and(eq(depositAccounts.id, depositAccountId), eq(depositAccounts.method, method), eq(depositAccounts.isActive, true)))
        .limit(1);
      if (!account) return bad("The selected deposit destination is no longer available. Please choose another.");
      destinationLabel = account.label;
    }

    const reference = body.reference ? String(body.reference).trim().slice(0, 200) || null : null;
    const note = body.note ? String(body.note).trim().slice(0, 1000) || null : null;

    const receiptDataUrl = String(body.receipt ?? "");
    const parsed = parseDataUrl(receiptDataUrl);
    if (!parsed) return bad("Upload a valid receipt image or PDF.");
    if (!ALLOWED_RECEIPT_MIME_TYPES.includes(parsed.mimeType)) return bad("Receipt must be a JPG, PNG, WEBP, HEIC, or PDF file.");
    if (parsed.byteLength > MAX_RECEIPT_BYTES) return bad(`Receipt file is too large. Max size is ${(MAX_RECEIPT_BYTES / (1024 * 1024)).toFixed(0)}MB.`);
    if (parsed.byteLength < 10) return bad("Upload a valid receipt image or PDF.");
    const receiptFilename = body.receiptFilename ? String(body.receiptFilename).trim().slice(0, 200) || "receipt" : "receipt";

    const [row] = await db
      .insert(depositRequests)
      .values({
        userId: user.id,
        method,
        amount: amount.toFixed(2),
        depositAccountId,
        destinationLabel,
        reference,
        note,
        receiptData: receiptDataUrl,
        receiptFilename,
        receiptMimeType: parsed.mimeType,
        status: "pending",
      })
      .returning({ id: depositRequests.id });

    await notifyUser({
      userId: user.id,
      type: "deposit_submitted",
      title: "Deposit request submitted",
      message: `Your ${fmt.money(amount)} deposit request via ${method} was submitted and is awaiting admin review.`,
    });

    return NextResponse.json({ success: true, id: row.id, message: "Deposit request submitted for review. Your balance updates once an admin verifies your receipt." });
  } catch (error) {
    console.error("Deposits POST:", error);
    return bad("Unable to submit your deposit request. Please try again.", 500);
  }
}
