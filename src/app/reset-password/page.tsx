"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Check, KeyRound, LockKeyhole } from "lucide-react";
import { ConfirmProvider, useConfirm } from "@/components/confirm-provider";
import { ThemeProvider } from "@/components/theme-provider";

function ResetPasswordForm() {
  const params = useSearchParams();
  const confirm = useConfirm();
  const token = params.get("token") ?? "";
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!token) return setError("This reset link is missing its token. Request a new one from the sign-in page.");
    if (newPassword.length < 8) return setError("New password must be at least 8 characters.");
    if (newPassword !== confirmPassword) return setError("Passwords do not match.");
    if (!(await confirm({ title: "Reset your password?", message: "You'll need this new password the next time you sign in." }))) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "resetPasswordWithToken", token, newPassword }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "This reset link is invalid or has expired.");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-modal" style={{ margin: "0 auto" }}>
      <div className="modal-brand"><div className="brand-icon"><KeyRound size={20} strokeWidth={3} /></div>Ava<span>Trades</span></div>
      {!done ? <>
        <h2>Reset your password</h2>
        <p>{token ? "Choose a new password for your account." : "This link is missing its reset token. Make sure you opened the full link from your email, or request a new one from the sign-in page."}</p>
        <form onSubmit={submit}>
          <label className="input-label">New password</label>
          <input className="text-input" type="password" placeholder="At least 8 characters" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} />
          <label className="input-label">Confirm new password</label>
          <input className="text-input" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={8} />
          {error && <p className="form-error-text">{error}</p>}
          <button className="primary-btn full-btn" disabled={submitting}>{submitting ? "Resetting..." : "Reset password"}<ArrowRight size={17} /></button>
        </form>
      </> : <>
        <h2>Password updated</h2>
        <p>Your password has been reset. You can now close this tab and sign in with your new password.</p>
        <Link className="primary-btn full-btn" href="/" style={{ textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}><Check size={17} /> Go to AvaTrades</Link>
      </>}
      <div className="modal-security"><LockKeyhole size={14} /> Your account is secured with encrypted credentials</div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <ThemeProvider>
      <ConfirmProvider>
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)", padding: "24px 16px" }}>
          <Suspense fallback={null}>
            <ResetPasswordForm />
          </Suspense>
        </div>
      </ConfirmProvider>
    </ThemeProvider>
  );
}
