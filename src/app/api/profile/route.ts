import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { checkPassword, getUser, hashPassword } from "@/lib/auth";
import { ALLOWED_AVATAR_MIME_TYPES, calculateAge, isValidEmail, isValidUsername, MAX_AVATAR_BYTES, MIN_SIGNUP_AGE, normalizeSecurityAnswer } from "@/lib/profile";
import { parseDataUrl } from "@/lib/deposits";
import { countryByCode } from "@/lib/countries";
import { getFxRate } from "@/lib/fx-server";
import { isLanguageCode } from "@/lib/i18n";
import { notifyUser } from "@/lib/notify";
import { generateReferralCode } from "@/lib/referrals";

export const dynamic = "force-dynamic";
const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

function publicProfile(user: typeof users.$inferSelect) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    username: user.username,
    isDemo: user.isDemo,
    dateOfBirth: user.dateOfBirth,
    gender: user.gender,
    country: user.country,
    state: user.state,
    city: user.city,
    address: user.address,
    phone: user.phone,
    profilePhoto: user.profilePhoto,
    referralCode: user.referralCode,
    hasSecurityQuestion: !!user.securityQuestion,
    securityQuestion: user.securityQuestion,
    termsAcceptedAt: user.termsAcceptedAt,
    privacyAcceptedAt: user.privacyAcceptedAt,
    currency: user.currency,
    language: user.language,
    emailNotifications: user.emailNotifications,
    createdAt: user.createdAt,
  };
}

// Current user's full profile, plus a live FX rate for their chosen currency
// so the client can render converted amounts without a second round trip.
export async function GET(request: NextRequest) {
  try {
    let user = await getUser(request);
    if (!user) return bad("Session expired. Please refresh the page.", 401);
    // Backfill a shareable referral code for accounts created before the
    // referral program existed (including seeded/demo accounts don't need
    // one - demo never persists anyway).
    if (!user.referralCode && !user.isDemo) {
      const code = await generateReferralCode();
      const [updated] = await db.update(users).set({ referralCode: code }).where(eq(users.id, user.id)).returning();
      user = updated;
    }
    const [fx, referralCountRow] = await Promise.all([
      getFxRate(user.currency),
      db.select({ count: sql<number>`count(*)::int` }).from(users).where(eq(users.referredBy, user.id)),
    ]);
    return NextResponse.json({ profile: publicProfile(user), fx, referralCount: referralCountRow[0]?.count ?? 0 });
  } catch (error) {
    console.error("Profile GET:", error);
    return bad("Unable to load your profile.", 500);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await getUser(request);
    if (!user) return bad("Session expired. Please refresh the page.", 401);
    const body = await request.json();
    const action = String(body.action ?? "updateProfile");

    if (action === "updateProfile") {
      if (user.isDemo) return bad("Create an account to save a profile.");
      const updates: Partial<typeof users.$inferInsert> = {};

      if (body.name !== undefined) {
        const name = String(body.name).trim();
        if (name.length < 2 || name.length > 80) return bad("Full name must be between 2 and 80 characters.");
        updates.name = name;
      }
      if (body.email !== undefined) {
        const email = String(body.email).trim().toLowerCase();
        if (!isValidEmail(email)) return bad("Enter a valid email address.");
        if (email !== user.email) {
          const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
          if (existing) return bad("Another account already uses that email.", 409);
        }
        updates.email = email;
      }
      if (body.username !== undefined) {
        const username = String(body.username).trim().toLowerCase();
        if (!isValidUsername(username)) return bad("Username must be 3-24 characters and contain only letters, numbers, underscores, or periods.");
        if (username !== (user.username ?? "").toLowerCase()) {
          const [existing] = await db.select({ id: users.id }).from(users).where(eq(sql`lower(${users.username})`, username)).limit(1);
          if (existing) return bad("That username is already taken.", 409);
        }
        updates.username = username;
      }
      if (body.dateOfBirth !== undefined) {
        const dob = String(body.dateOfBirth).trim();
        if (!dob || Number.isNaN(Date.parse(dob))) return bad("Enter a valid date of birth.");
        const age = calculateAge(dob);
        if (age === null || age < MIN_SIGNUP_AGE) return bad(`You must be at least ${MIN_SIGNUP_AGE} years old.`);
        updates.dateOfBirth = dob;
      }
      if (body.gender !== undefined) updates.gender = body.gender ? String(body.gender).trim() : null;
      if (body.country !== undefined) {
        const country = String(body.country).trim().toUpperCase();
        if (!countryByCode(country)) return bad("Select a valid country.");
        updates.country = country;
      }
      if (body.state !== undefined) updates.state = body.state ? String(body.state).trim() : null;
      if (body.city !== undefined) updates.city = body.city ? String(body.city).trim() : null;
      if (body.address !== undefined) updates.address = body.address ? String(body.address).trim() : null;
      if (body.phone !== undefined) {
        const phone = String(body.phone).trim();
        if (!phone || phone.length < 5 || phone.length > 25) return bad("Enter a valid phone number.");
        updates.phone = phone;
      }
      if (body.currency !== undefined) {
        const currency = String(body.currency).trim().toUpperCase();
        if (!/^[A-Z]{3}$/.test(currency)) return bad("Select a valid currency.");
        updates.currency = currency;
      }
      if (body.language !== undefined) {
        const language = String(body.language).trim().toLowerCase();
        if (!isLanguageCode(language)) return bad("Select a supported language.");
        updates.language = language;
      }
      if (typeof body.emailNotifications === "boolean") updates.emailNotifications = body.emailNotifications;
      if (body.profilePhoto !== undefined) {
        if (body.profilePhoto === null) {
          updates.profilePhoto = null;
        } else {
          const parsed = parseDataUrl(String(body.profilePhoto));
          if (!parsed) return bad("Profile photo could not be read. Try a different file.");
          if (!ALLOWED_AVATAR_MIME_TYPES.includes(parsed.mimeType)) return bad("Profile photo must be a JPEG, PNG, WebP, or GIF image.");
          if (parsed.byteLength > MAX_AVATAR_BYTES) return bad(`Profile photo must be under ${Math.round(MAX_AVATAR_BYTES / 1024 / 1024)}MB.`);
          updates.profilePhoto = String(body.profilePhoto);
        }
      }
      if (Object.keys(updates).length === 0) return bad("Nothing to update.");
      const [updated] = await db.update(users).set(updates).where(eq(users.id, user.id)).returning();
      // When the display currency changes, send back a fresh rate for it so
      // the "1 USD ≈ X" hint (and every converted amount on the page)
      // updates immediately instead of showing the previous currency's rate
      // until the next full reload.
      const fx = updates.currency ? await getFxRate(updated.currency) : null;
      return NextResponse.json({ success: true, profile: publicProfile(updated), ...(fx ? { fx } : {}) });
    }

    if (action === "changePassword") {
      if (user.isDemo) return bad("Create an account to set a password.");
      const currentPassword = String(body.currentPassword ?? "");
      const newPassword = String(body.newPassword ?? "");
      const confirmPassword = String(body.confirmPassword ?? "");
      if (!user.passwordHash || !checkPassword(currentPassword, user.passwordHash)) return bad("Current password is incorrect.", 401);
      if (newPassword.length < 8) return bad("New password must be at least 8 characters.");
      if (newPassword !== confirmPassword) return bad("New password and confirmation do not match.");
      await db.update(users).set({ passwordHash: hashPassword(newPassword) }).where(eq(users.id, user.id));
      await notifyUser({
        userId: user.id,
        type: "password_changed",
        title: "Your password was changed",
        message: "Your AvaTrades password was just changed. If you didn't make this change, contact support immediately.",
      });
      return NextResponse.json({ success: true });
    }

    if (action === "updateSecurity") {
      if (user.isDemo) return bad("Create an account to set a security question.");
      const currentPassword = String(body.currentPassword ?? "");
      const securityQuestion = String(body.securityQuestion ?? "").trim();
      const securityAnswer = String(body.securityAnswer ?? "").trim();
      if (!user.passwordHash || !checkPassword(currentPassword, user.passwordHash)) return bad("Current password is incorrect.", 401);
      if (!securityQuestion || !securityAnswer) return bad("Enter both a security question and an answer.");
      await db.update(users).set({ securityQuestion, securityAnswerHash: hashPassword(normalizeSecurityAnswer(securityAnswer)) }).where(eq(users.id, user.id));
      await notifyUser({
        userId: user.id,
        type: "security_question_updated",
        title: "Security question updated",
        message: "Your AvaTrades account recovery question was just updated. If you didn't make this change, contact support immediately.",
      });
      return NextResponse.json({ success: true });
    }

    if (action === "removeSecurity") {
      const currentPassword = String(body.currentPassword ?? "");
      if (!user.passwordHash || !checkPassword(currentPassword, user.passwordHash)) return bad("Current password is incorrect.", 401);
      await db.update(users).set({ securityQuestion: null, securityAnswerHash: null }).where(eq(users.id, user.id));
      return NextResponse.json({ success: true });
    }

    return bad("Invalid action.");
  } catch (error) {
    console.error("Profile PATCH:", error);
    return bad("Unable to update your profile.", 500);
  }
}
