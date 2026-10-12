import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { db } from "@/db";
import { users, sessions, transactions } from "@/db/schema";
import { eq, or, sql } from "drizzle-orm";
import { checkPassword, clearSession, getUser, hashPassword, hashToken, isAdminEmail, setSession } from "@/lib/auth";
import { calculateAge, isValidEmail, isValidUsername, MIN_SIGNUP_AGE, normalizeSecurityAnswer } from "@/lib/profile";
import { ALLOWED_AVATAR_MIME_TYPES, MAX_AVATAR_BYTES } from "@/lib/profile";
import { parseDataUrl } from "@/lib/deposits";
import { currencyForCountry, countryByCode } from "@/lib/countries";
import { notifyUser } from "@/lib/notify";
import { findReferrer, generateReferralCode, REFERRAL_BONUS_AMOUNT } from "@/lib/referrals";
import { passwordResetEmailHtml, sendEmail } from "@/lib/email-server";
import { issueVerificationCode, needsEmailVerification, VERIFICATION_MAX_ATTEMPTS, VERIFICATION_RESEND_COOLDOWN_MS } from "@/lib/email-verification";

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

// Looks up a user by email OR username (both unique, case-insensitive),
// so the login form can accept either as the "identifier".
async function findByIdentifier(identifier: string) {
  const value = identifier.trim().toLowerCase();
  const [user] = await db.select().from(users).where(or(eq(users.email, value), eq(sql`lower(${users.username})`, value))).limit(1);
  return user ?? null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = String(body.action ?? "");

    if (action === "logout") return await clearSession(request, NextResponse.json({ success: true }));

    if (action === "register") {
      const name = String(body.name ?? "").trim();
      const email = String(body.email ?? "").trim().toLowerCase();
      const usernameInput = String(body.username ?? "").trim().toLowerCase();
      const username = usernameInput || null;
      const password = String(body.password ?? "");
      const confirmPassword = String(body.confirmPassword ?? "");
      const dateOfBirthInput = String(body.dateOfBirth ?? "").trim();
      const dateOfBirth = dateOfBirthInput || null;
      const gender = body.gender ? String(body.gender).trim() : null;
      const country = String(body.country ?? "").trim().toUpperCase();
      const state = body.state ? String(body.state).trim() : null;
      const city = body.city ? String(body.city).trim() : null;
      const address = body.address ? String(body.address).trim() : null;
      const phone = String(body.phone ?? "").trim();
      const profilePhoto = body.profilePhoto ? String(body.profilePhoto) : null;
      const enteredReferralCode = body.referralCode ? String(body.referralCode).trim() : null;
      const securityQuestion = body.securityQuestion ? String(body.securityQuestion).trim() : null;
      const securityAnswer = body.securityAnswer ? String(body.securityAnswer).trim() : null;
      const termsAccepted = body.termsAccepted === true;
      const privacyAccepted = body.privacyAccepted === true;

      // --- Required-field validation -----------------------------------
      // Registration only requires: full name, email, phone, country, and
      // password. Everything else (username, date of birth, gender,
      // address details, profile photo, security question, referral code)
      // is optional at signup and can be filled in later from the Profile
      // page - see src/components/profile-page.tsx.
      if (name.length < 2 || name.length > 80) return bad("Full name must be between 2 and 80 characters.");
      if (!isValidEmail(email)) return bad("Enter a valid email address.");
      if (username && !isValidUsername(username)) return bad("Username must be 3-24 characters and contain only letters, numbers, underscores, or periods.");
      if (password.length < 8) return bad("Password must be at least 8 characters.");
      if (password !== confirmPassword) return bad("Password and confirm password do not match.");
      if (dateOfBirth) {
        if (Number.isNaN(Date.parse(dateOfBirth))) return bad("Enter a valid date of birth.");
        const age = calculateAge(dateOfBirth);
        if (age === null || age < MIN_SIGNUP_AGE) return bad(`You must be at least ${MIN_SIGNUP_AGE} years old to create an account.`);
      }
      if (!countryByCode(country)) return bad("Select a valid country.");
      if (!phone || phone.length < 5 || phone.length > 25) return bad("Enter a valid phone number.");
      if (!termsAccepted) return bad("You must agree to the Terms & Conditions.");
      if (!privacyAccepted) return bad("You must agree to the Privacy Policy.");
      if ((securityQuestion && !securityAnswer) || (!securityQuestion && securityAnswer)) {
        return bad("Enter both a security question and an answer, or leave both blank.");
      }

      let avatarDataUrl: string | null = null;
      if (profilePhoto) {
        const parsed = parseDataUrl(profilePhoto);
        if (!parsed) return bad("Profile photo could not be read. Try a different file.");
        if (!ALLOWED_AVATAR_MIME_TYPES.includes(parsed.mimeType)) return bad("Profile photo must be a JPEG, PNG, WebP, or GIF image.");
        if (parsed.byteLength > MAX_AVATAR_BYTES) return bad(`Profile photo must be under ${Math.round(MAX_AVATAR_BYTES / 1024 / 1024)}MB.`);
        avatarDataUrl = profilePhoto;
      }

      const [existingEmail] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      if (existingEmail) return bad("An account with this email already exists.", 409);
      if (username) {
        const [existingUsername] = await db.select({ id: users.id }).from(users).where(eq(sql`lower(${users.username})`, username)).limit(1);
        if (existingUsername) return bad("That username is already taken.", 409);
      }

      const now = new Date();
      const referrer = enteredReferralCode ? await findReferrer(enteredReferralCode) : null;
      const myReferralCode = await generateReferralCode();
      const [user] = await db.insert(users).values({
        name,
        email,
        username,
        passwordHash: hashPassword(password),
        cashBalance: "0.00",
        role: isAdminEmail(email) ? "admin" : "user",
        dateOfBirth,
        gender,
        country,
        state,
        city,
        address,
        phone,
        profilePhoto: avatarDataUrl,
        referralCode: myReferralCode,
        referredBy: referrer?.id ?? null,
        securityQuestion,
        securityAnswerHash: securityAnswer ? hashPassword(normalizeSecurityAnswer(securityAnswer)) : null,
        termsAcceptedAt: now,
        privacyAcceptedAt: now,
        currency: currencyForCountry(country),
        emailVerifiedAt: null, // gates this account behind the email-verification screen until the 4-digit code is entered
      }).returning();

      await issueVerificationCode(user as { id: string; name: string; email: string });

      if (referrer) {
        // One-time bonus to both sides, paid from nowhere (paper money) -
        // logged as a transaction on each account just like any other
        // balance change, so it shows up in Transactions history.
        await db.transaction(async (tx) => {
          await tx.update(users).set({ cashBalance: sql`${users.cashBalance} + ${REFERRAL_BONUS_AMOUNT}` }).where(eq(users.id, user.id));
          await tx.update(users).set({ cashBalance: sql`${users.cashBalance} + ${REFERRAL_BONUS_AMOUNT}` }).where(eq(users.id, referrer.id));
          await tx.insert(transactions).values([
            { userId: user.id, type: "referral_bonus", amount: REFERRAL_BONUS_AMOUNT.toFixed(2), description: `Referral bonus for signing up with ${referrer.name}'s code` },
            { userId: referrer.id, type: "referral_bonus", amount: REFERRAL_BONUS_AMOUNT.toFixed(2), description: `Referral bonus - ${name} signed up with your code` },
          ]);
        });
        await notifyUser({
          userId: referrer.id,
          type: "referral_bonus",
          title: "Your referral just signed up!",
          message: `${name} created a AvaTrades account using your referral code. You've both been credited $${REFERRAL_BONUS_AMOUNT.toFixed(2)}.`,
        });
      }

      await notifyUser({
        userId: user.id,
        type: "account_created",
        title: "Welcome to AvaTrades!",
        message: referrer
          ? `Your account is ready with a $${REFERRAL_BONUS_AMOUNT.toFixed(2)} referral bonus for signing up with ${referrer.name}'s code already credited to your balance. Make a deposit to add more paper trading funds, then explore the markets, place your first trade, or check out the trading bots and copy trading catalog.`
          : "Your account is ready with a $0.00 balance. Head to Deposit to add paper trading funds, then explore the markets, place your first trade, or check out the trading bots and copy trading catalog whenever you're ready.",
      });
      return await setSession(NextResponse.json({ success: true }), user.id);
    }

    if (action === "login") {
      const identifier = String(body.identifier ?? body.email ?? "").trim();
      const password = String(body.password ?? "");
      if (!identifier || !password) return bad("Enter your email/username and password.");
      const user = await findByIdentifier(identifier);
      if (!user?.passwordHash || !checkPassword(password, user.passwordHash)) return bad("Incorrect email/username or password.", 401);
      if (user.accountStatus === "locked") return bad("This account has been locked. Contact support for help.", 403);
      // Allow promoting an existing account to admin by listing its email in ADMIN_EMAILS.
      if (user.email && isAdminEmail(user.email) && user.role !== "admin") await db.update(users).set({ role: "admin" }).where(eq(users.id, user.id));
      const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null;
      await notifyUser({
        userId: user.id,
        type: "login",
        title: "New sign-in to your account",
        message: `We noticed a new sign-in to your AvaTrades account on ${new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}${ip ? ` from ${ip}` : ""}. If this wasn't you, change your password right away from Profile → Security.`,
      });
      return await setSession(NextResponse.json({ success: true }), user.id);
    }

    // --- Email verification (4-digit code sent at registration) ----------
    if (action === "verifyEmail") {
      const user = await getUser(request);
      if (!user) return bad("Session expired. Please sign in again.", 401);
      if (!needsEmailVerification(user)) return NextResponse.json({ success: true, alreadyVerified: true });
      const code = String(body.code ?? "").trim();
      if (!/^\d{4}$/.test(code)) return bad("Enter the 4-digit code from your email.");
      if (!user.verificationCodeHash || !user.verificationCodeExpiresAt || user.verificationCodeExpiresAt.getTime() < Date.now()) {
        return bad("This code has expired. Request a new one.");
      }
      if (user.verificationAttempts >= VERIFICATION_MAX_ATTEMPTS) {
        return bad("Too many incorrect attempts. Request a new code.");
      }
      if (hashToken(code) !== user.verificationCodeHash) {
        await db.update(users).set({ verificationAttempts: sql`${users.verificationAttempts} + 1` }).where(eq(users.id, user.id));
        const left = VERIFICATION_MAX_ATTEMPTS - (user.verificationAttempts + 1);
        return bad(left > 0 ? `Incorrect code. ${left} attempt${left === 1 ? "" : "s"} left.` : "Too many incorrect attempts. Request a new code.");
      }
      await db.update(users).set({ emailVerifiedAt: new Date(), verificationCodeHash: null, verificationCodeExpiresAt: null, verificationAttempts: 0 }).where(eq(users.id, user.id));
      await notifyUser({
        userId: user.id,
        type: "email_verified",
        title: "Email verified",
        message: "Your email has been verified - you now have full access to your AvaTrades account.",
      });
      return NextResponse.json({ success: true });
    }
    if (action === "resendVerificationCode") {
      const user = await getUser(request);
      if (!user) return bad("Session expired. Please sign in again.", 401);
      if (user.isDemo || !user.email) return bad("No email on file for this account.");
      if (!needsEmailVerification(user)) return NextResponse.json({ success: true, alreadyVerified: true });
      if (user.verificationCodeSentAt && Date.now() - user.verificationCodeSentAt.getTime() < VERIFICATION_RESEND_COOLDOWN_MS) {
        const waitSec = Math.ceil((VERIFICATION_RESEND_COOLDOWN_MS - (Date.now() - user.verificationCodeSentAt.getTime())) / 1000);
        return bad(`Please wait ${waitSec}s before requesting another code.`);
      }
      await issueVerificationCode(user as { id: string; name: string; email: string });
      return NextResponse.json({ success: true, message: "A new code has been sent to your email." });
    }

    // --- Forgot password, via the user-authored security question --------
    if (action === "getSecurityQuestion") {
      const identifier = String(body.identifier ?? "").trim();
      if (!identifier) return bad("Enter your email or username.");
      const user = await findByIdentifier(identifier);
      if (!user || !user.securityQuestion || !user.securityAnswerHash) {
        return bad("No security question is set up for this account. Contact support to reset your password.");
      }
      return NextResponse.json({ success: true, question: user.securityQuestion });
    }
    if (action === "resetPasswordWithSecurityAnswer") {
      const identifier = String(body.identifier ?? "").trim();
      const answer = String(body.answer ?? "");
      const newPassword = String(body.newPassword ?? "");
      if (!identifier || !answer || !newPassword) return bad("Fill in every field.");
      if (newPassword.length < 8) return bad("New password must be at least 8 characters.");
      const user = await findByIdentifier(identifier);
      if (!user || !user.securityAnswerHash || !checkPassword(normalizeSecurityAnswer(answer), user.securityAnswerHash)) {
        return bad("That answer doesn't match our records.", 401);
      }
      await db.update(users).set({ passwordHash: hashPassword(newPassword) }).where(eq(users.id, user.id));
      // Reset invalidates any existing sessions (e.g. on a device someone
      // else was using), matching standard password-reset behavior.
      await db.delete(sessions).where(eq(sessions.userId, user.id));
      await notifyUser({
        userId: user.id,
        type: "password_changed",
        title: "Your password was reset",
        message: "Your AvaTrades password was just reset using your security question. If you didn't do this, contact support immediately.",
      });
      return NextResponse.json({ success: true });
    }

    // --- Forgot password, via an emailed link (fallback when no security
    // question is set, or just preferred). Always responds with the same
    // generic success message regardless of whether the account/email
    // exists, so this endpoint can't be used to enumerate registered users.
    if (action === "requestPasswordReset") {
      const identifier = String(body.identifier ?? "").trim();
      const genericOk = NextResponse.json({ success: true, message: "If an account with an email on file matches that, we've sent a password reset link. Check your inbox (and spam folder)." });
      if (!identifier) return genericOk;
      const user = await findByIdentifier(identifier);
      if (!user || !user.email || user.isDemo) return genericOk;
      const token = randomBytes(32).toString("hex");
      await db.update(users).set({ resetTokenHash: hashToken(token), resetTokenExpiresAt: new Date(Date.now() + 30 * 60 * 1000) }).where(eq(users.id, user.id));
      const { html, text } = passwordResetEmailHtml({ name: user.name, token });
      const result = await sendEmail({ to: user.email, subject: "Reset your AvaTrades password", html, text });
      if (result.status === "stubbed") console.log(`[password-reset:stub] token for ${user.email}: ${token}`);
      return genericOk;
    }
    if (action === "resetPasswordWithToken") {
      const token = String(body.token ?? "").trim();
      const newPassword = String(body.newPassword ?? "");
      if (!token) return bad("This reset link is invalid or has expired. Request a new one.");
      if (newPassword.length < 8) return bad("New password must be at least 8 characters.");
      const tokenHash = hashToken(token);
      const [user] = await db.select().from(users).where(eq(users.resetTokenHash, tokenHash)).limit(1);
      if (!user || !user.resetTokenExpiresAt || user.resetTokenExpiresAt.getTime() < Date.now()) {
        return bad("This reset link is invalid or has expired. Request a new one.");
      }
      await db.update(users).set({ passwordHash: hashPassword(newPassword), resetTokenHash: null, resetTokenExpiresAt: null }).where(eq(users.id, user.id));
      await db.delete(sessions).where(eq(sessions.userId, user.id));
      await notifyUser({
        userId: user.id,
        type: "password_changed",
        title: "Your password was reset",
        message: "Your AvaTrades password was just reset using the emailed reset link. If you didn't do this, contact support immediately.",
      });
      return NextResponse.json({ success: true });
    }

    return bad("Invalid action.");
  } catch (error) {
    console.error("Auth:", error);
    return bad("Unable to process your request.", 500);
  }
}
