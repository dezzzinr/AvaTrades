// Shared constants/helpers for the "verify your email with a 4-digit code"
// signup flow. New (non-demo) accounts are created with emailVerifiedAt =
// null and are blocked from every mutating action (see blockedActionMessage
// in src/lib/accounts.ts) - and shown a dedicated gate screen client-side
// instead of their dashboard - until they enter the code emailed to them.

import { randomInt } from "node:crypto";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { hashToken } from "@/lib/auth";
import { sendEmail, verificationCodeEmailHtml } from "@/lib/email-server";
// needsEmailVerification lives in accounts.ts, which has to stay
// dependency-free for client bundling - re-exported here so callers of this
// module (the server-only half of the feature) can get everything from one
// place.
export { needsEmailVerification } from "@/lib/accounts";

export const VERIFICATION_CODE_LENGTH = 4;
export const VERIFICATION_CODE_TTL_MS = 15 * 60 * 1000; // a code is valid for 15 minutes
export const VERIFICATION_MAX_ATTEMPTS = 5; // wrong guesses allowed per code before a resend is required
export const VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000; // minimum time between user-triggered resends

export function generateVerificationCode(): string {
  return String(randomInt(0, 10 ** VERIFICATION_CODE_LENGTH)).padStart(VERIFICATION_CODE_LENGTH, "0");
}

// Generates a fresh code, stores its hash (resetting expiry/attempts), and
// emails it. Used both right after registration and whenever the user
// requests a resend - callers that allow user-triggered resends should
// check the VERIFICATION_RESEND_COOLDOWN_MS cooldown against
// verificationCodeSentAt themselves before calling this.
export async function issueVerificationCode(user: { id: string; name: string; email: string }) {
  const code = generateVerificationCode();
  const now = new Date();
  await db.update(users).set({
    verificationCodeHash: hashToken(code),
    verificationCodeExpiresAt: new Date(now.getTime() + VERIFICATION_CODE_TTL_MS),
    verificationCodeSentAt: now,
    verificationAttempts: 0,
  }).where(eq(users.id, user.id));
  const { html, text } = verificationCodeEmailHtml({ name: user.name, code });
  const result = await sendEmail({ to: user.email, subject: "Verify your AvaTrades email", html, text });
  if (result.status === "stubbed") console.log(`[email-verify:stub] code for ${user.email}: ${code}`);
  return result;
}
