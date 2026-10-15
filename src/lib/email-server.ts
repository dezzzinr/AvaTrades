// Outbound email, server-only. Uses Resend (https://resend.com) over plain
// fetch (no SDK dependency needed - it's a single JSON POST). If no API key
// is configured, every send is "stubbed": logged to the server console and
// recorded as such on the notification row, so the whole notification
// pipeline works out of the box in any environment (including this sandbox)
// without requiring a real email account, and starts actually delivering
// the moment RESEND_API_KEY is added to .env - no other code changes.
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || "AvaTrades <onboarding@resend.dev>";

export type SendEmailResult =
  | { status: "sent" }
  | { status: "stubbed" }
  | { status: "failed"; error: string };

export async function sendEmail(input: { to: string; subject: string; html: string; text: string }): Promise<SendEmailResult> {
  if (!RESEND_API_KEY) {
    console.log(`[email:stub] to=${input.to} subject="${input.subject}" (set RESEND_API_KEY in .env to actually send this)`);
    return { status: "stubbed" };
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: EMAIL_FROM, to: input.to, subject: input.subject, html: input.html, text: input.text }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[email:failed]", res.status, body.slice(0, 500));
      return { status: "failed", error: `Resend ${res.status}: ${body.slice(0, 300)}` };
    }
    return { status: "sent" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown email error";
    console.error("[email:failed]", message);
    return { status: "failed", error: message.slice(0, 300) };
  }
}

// Base URL used for the "Open AvaTrades" link in emails. Falls back to
// Vercel's auto-populated host if APP_URL isn't set, and omits the button
// entirely if neither is available (e.g. local dev with no env set).
export function appUrl(): string | null {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return null;
}

// Shared branded wrapper for every notification email - a simple, readable
// card rather than per-event bespoke HTML, so all the emails look and feel
// consistent and new event types are just a title/message away.
export function notificationEmailHtml(input: { name: string; title: string; message: string }): string {
  const link = appUrl();
  const button = link
    ? `<tr><td style="padding-top:24px;"><a href="${link}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:8px;">Open AvaTrades</a></td></tr>`
    : "";
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:32px 16px;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
    <tr><td style="background:#4f46e5;padding:20px 28px;">
      <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-0.02em;">AvaTrades</span>
    </td></tr>
    <tr><td style="padding:28px;">
      <table role="presentation" width="100%">
        <tr><td style="font-size:13px;color:#6b7280;padding-bottom:6px;">Hi ${escapeHtml(input.name)},</td></tr>
        <tr><td style="font-size:17px;font-weight:700;color:#111827;padding-bottom:10px;">${escapeHtml(input.title)}</td></tr>
        <tr><td style="font-size:14px;line-height:1.6;color:#374151;">${escapeHtml(input.message)}</td></tr>
        ${button}
      </table>
    </td></tr>
    <tr><td style="padding:16px 28px;background:#f9fafb;border-top:1px solid #f0f0f0;">
      <span style="font-size:11px;color:#9ca3af;">You're receiving this because notable account activity notifications are on for your AvaTrades account. Turn these off anytime from Profile → Notifications.</span>
    </td></tr>
  </table>
</body>
</html>`;
}

// Dedicated template for the "reset your password" email - needs its own
// CTA (a tokenized link, or a plain-text code to paste in if no APP_URL is
// configured in this environment) rather than the generic "Open AvaTrades"
// button every other notification uses.
export function passwordResetEmailHtml(input: { name: string; token: string }): { html: string; text: string } {
  const base = appUrl();
  const link = base ? `${base}/reset-password?token=${input.token}` : null;
  const action = link
    ? `<tr><td style="padding-top:24px;"><a href="${link}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:8px;">Reset your password</a></td></tr>
       <tr><td style="padding-top:14px;font-size:12px;color:#9ca3af;word-break:break-all;">Or paste this link into your browser: ${link}</td></tr>`
    : `<tr><td style="padding-top:18px;font-size:13px;color:#374151;">Open the Reset Password page in AvaTrades and paste in this code:</td></tr>
       <tr><td style="padding-top:10px;"><span style="display:inline-block;font-family:monospace;font-size:16px;letter-spacing:1px;background:#f3f4f6;border:1px solid #e5e7eb;border-radius:8px;padding:10px 16px;">${input.token}</span></td></tr>`;
  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:32px 16px;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
    <tr><td style="background:#4f46e5;padding:20px 28px;">
      <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-0.02em;">AvaTrades</span>
    </td></tr>
    <tr><td style="padding:28px;">
      <table role="presentation" width="100%">
        <tr><td style="font-size:13px;color:#6b7280;padding-bottom:6px;">Hi ${escapeHtml(input.name)},</td></tr>
        <tr><td style="font-size:17px;font-weight:700;color:#111827;padding-bottom:10px;">Reset your password</td></tr>
        <tr><td style="font-size:14px;line-height:1.6;color:#374151;">We received a request to reset your AvaTrades password. This link expires in 30 minutes. If you didn't request this, you can safely ignore this email - your password won't change.</td></tr>
        ${action}
      </table>
    </td></tr>
    <tr><td style="padding:16px 28px;background:#f9fafb;border-top:1px solid #f0f0f0;">
      <span style="font-size:11px;color:#9ca3af;">This is a paper-trading simulation - no real money is involved.</span>
    </td></tr>
  </table>
</body>
</html>`;
  const text = link
    ? `Hi ${input.name},\n\nWe received a request to reset your AvaTrades password. This link expires in 30 minutes:\n${link}\n\nIf you didn't request this, you can ignore this email.`
    : `Hi ${input.name},\n\nWe received a request to reset your AvaTrades password. Open the Reset Password page in AvaTrades and enter this code (expires in 30 minutes): ${input.token}\n\nIf you didn't request this, you can ignore this email.`;
  return { html, text };
}

// Dedicated template for the signup "verify your email" code - a big,
// easy-to-read 4-digit code rather than a link, since it's meant to be
// retyped into the app.
export function verificationCodeEmailHtml(input: { name: string; code: string }): { html: string; text: string } {
  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:32px 16px;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
    <tr><td style="background:#4f46e5;padding:20px 28px;">
      <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-0.02em;">AvaTrades</span>
    </td></tr>
    <tr><td style="padding:28px;">
      <table role="presentation" width="100%">
        <tr><td style="font-size:13px;color:#6b7280;padding-bottom:6px;">Hi ${escapeHtml(input.name)},</td></tr>
        <tr><td style="font-size:17px;font-weight:700;color:#111827;padding-bottom:10px;">Verify your email</td></tr>
        <tr><td style="font-size:14px;line-height:1.6;color:#374151;">Enter this code in AvaTrades to activate your account. It expires in 15 minutes.</td></tr>
        <tr><td style="padding-top:20px;"><span style="display:inline-block;font-family:monospace;font-size:32px;font-weight:700;letter-spacing:10px;background:#f3f4f6;border:1px solid #e5e7eb;border-radius:10px;padding:14px 20px;color:#111827;">${escapeHtml(input.code)}</span></td></tr>
        <tr><td style="padding-top:18px;font-size:12px;color:#9ca3af;">If you didn't create a AvaTrades account, you can safely ignore this email.</td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:16px 28px;background:#f9fafb;border-top:1px solid #f0f0f0;">
      <span style="font-size:11px;color:#9ca3af;">This is a paper-trading simulation - no real money is involved.</span>
    </td></tr>
  </table>
</body>
</html>`;
  const text = `Hi ${input.name},\n\nEnter this code in AvaTrades to activate your account (expires in 15 minutes): ${input.code}\n\nIf you didn't create a AvaTrades account, you can ignore this email.`;
  return { html, text };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
