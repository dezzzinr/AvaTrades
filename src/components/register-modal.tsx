"use client";

import { useEffect, useState } from "react";
import { ArrowRight, LockKeyhole, UserRound, X } from "lucide-react";
import { COUNTRIES, currencyForCountry } from "@/lib/countries";
import { useLanguage } from "@/components/i18n-provider";

type Props = {
  onClose: () => void;
  onSwitchToLogin: () => void;
  onRegistered: () => void | Promise<void>;
};

export default function RegisterModal({ onClose, onSwitchToLogin, onRegistered }: Props) {
  const { t } = useLanguage();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);

  // Picked up silently from a ?ref=CODE link (e.g. shared from a friend's
  // Profile page) so the referral bonus still works without needing a
  // visible field on this simplified form.
  const [referralCode, setReferralCode] = useState("");
  useEffect(() => {
    try {
      const ref = new URLSearchParams(window.location.search).get("ref");
      if (ref && ref.trim()) setReferralCode(ref.trim());
    } catch {
      // ignore - referral capture is a nice-to-have, never block the form
    }
  }, []);

  const selectedCountry = COUNTRIES.find((c) => c.code === country) ?? null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!name.trim() || name.trim().length < 2) return setError(t("Enter your full name."));
    if (!email.trim()) return setError(t("Enter your email address."));
    if (!phone.trim()) return setError(t("Enter your phone number."));
    if (!country) return setError(t("Select your country."));
    if (password.length < 8) return setError(t("Password must be at least 8 characters."));
    if (password !== confirmPassword) return setError(t("Password and confirm password do not match."));
    if (!termsAccepted) return setError(t("You must agree to the Terms & Conditions."));
    if (!privacyAccepted) return setError(t("You must agree to the Privacy Policy."));

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "register",
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          country,
          password,
          confirmPassword,
          referralCode: referralCode.trim() || undefined,
          termsAccepted,
          privacyAccepted,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || t("Registration failed."));
      await onRegistered();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Registration failed."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="register-modal">
        <button className="modal-close" onClick={onClose} aria-label="Close"><X size={20} /></button>
        <div className="modal-brand"><div className="brand-icon"><UserRound size={20} strokeWidth={3} /></div>{t("Create your account")}</div>
        <h2>{t("Join AvaTrades")}</h2>
        <p>{t("Your trading journey starts here. Just the basics for now — you can add your photo, username, date of birth, and more anytime from your Profile page.")}</p>

        <form onSubmit={submit}>
          <div className="form-section">
            <div className="form-grid">
              <div className="form-field"><label className="input-label">{t("Full Name")} *</label><input className="text-input" placeholder="Alex Morgan" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} /></div>
              <div className="form-field"><label className="input-label">{t("Email Address")} *</label><input className="text-input" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
              <div className="form-field"><label className="input-label">{t("Phone Number")} *</label><input className="text-input" type="tel" placeholder={selectedCountry ? `${selectedCountry.dial} ...` : "+1 555 123 4567"} value={phone} onChange={(e) => setPhone(e.target.value)} required /></div>
              <div className="form-field">
                <label className="input-label">{t("Country")} *</label>
                <div className="select-wrap"><select value={country} onChange={(e) => setCountry(e.target.value)} required><option value="">{t("Select your country")}</option>{COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></div>
                {selectedCountry && <p className="form-hint">{t("Your balances will display in")} {currencyForCountry(selectedCountry.code)} {t("by default — you can change this later in your profile.")}</p>}
              </div>
              <div className="form-field"><label className="input-label">{t("Password")} *</label><input className="text-input" type="password" placeholder="At least 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} /></div>
              <div className="form-field"><label className="input-label">{t("Confirm Password")} *</label><input className="text-input" type="password" placeholder={t("Re-enter your password")} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={8} /></div>
            </div>
          </div>

          <div className="register-checkboxes">
            <label className="checkbox-row"><input type="checkbox" checked={termsAccepted} onChange={(e) => setTermsAccepted(e.target.checked)} required /> {t("I agree to the")} <a href="#" onClick={(e) => e.preventDefault()}>{t("Terms & Conditions")}</a> *</label>
            <label className="checkbox-row"><input type="checkbox" checked={privacyAccepted} onChange={(e) => setPrivacyAccepted(e.target.checked)} required /> {t("I agree to the")} <a href="#" onClick={(e) => e.preventDefault()}>{t("Privacy Policy")}</a> *</label>
          </div>

          {error && <p className="form-error-text">{error}</p>}
          <button className="primary-btn full-btn" disabled={submitting}>{submitting ? t("Creating account...") : t("Create account")}<ArrowRight size={17} /></button>
        </form>
        <div className="modal-switch">{t("Already have an account?")} <button onClick={onSwitchToLogin}>{t("Sign in")}</button></div>
        <div className="modal-security"><LockKeyhole size={14} /> {t("Your account is secured with encrypted credentials")}</div>
      </div>
    </div>
  );
}
