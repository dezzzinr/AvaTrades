"use client";

import { useEffect, useState } from "react";
import { BadgeCheck, Check, CircleHelp, KeyRound, Lock, Moon, Sun, UploadCloud, UserRound } from "lucide-react";
import { COUNTRIES, currencyForCountry } from "@/lib/countries";
import { GENDERS, genderLabel } from "@/lib/profile";
import { LANGUAGES, type LanguageCode } from "@/lib/i18n";
import { useLanguage } from "@/components/i18n-provider";
import { useConfirm } from "@/components/confirm-provider";
import { useTheme } from "@/components/theme-provider";

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const CURRENCIES = Array.from(new Set(COUNTRIES.map((c) => c.currency).filter((c): c is string => !!c))).sort();

type Profile = {
  id: string; name: string; email: string | null; username: string | null; isDemo: boolean;
  dateOfBirth: string | null; gender: string | null; country: string | null; state: string | null;
  city: string | null; address: string | null; phone: string | null; profilePhoto: string | null;
  referralCode: string | null; hasSecurityQuestion: boolean; securityQuestion: string | null;
  termsAcceptedAt: string | null; privacyAcceptedAt: string | null; currency: string; language?: string;
  emailNotifications?: boolean; createdAt: string;
};

type Props = {
  onRequireAuth: (mode: "login" | "register") => void;
  onProfileUpdated: () => void;
  notify: (text: string, isError?: boolean) => void;
};

export default function ProfilePage({ onRequireAuth, onProfileUpdated, notify }: Props) {
  const { setLanguage } = useLanguage();
  const { theme, setTheme } = useTheme();
  const confirm = useConfirm();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingLanguage, setSavingLanguage] = useState(false);
  const [savingEmailNotifications, setSavingEmailNotifications] = useState(false);
  const [fx, setFx] = useState<{ rate: number; status: string } | null>(null);
  const [referralCount, setReferralCount] = useState(0);
  const [referralCopied, setReferralCopied] = useState(false);

  const [form, setForm] = useState<Partial<Profile>>({});
  const [savingInfo, setSavingInfo] = useState(false);
  const [savingCurrency, setSavingCurrency] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);

  const [securityEditing, setSecurityEditing] = useState(false);
  const [secCurrentPassword, setSecCurrentPassword] = useState("");
  const [secQuestion, setSecQuestion] = useState("");
  const [secAnswer, setSecAnswer] = useState("");
  const [securitySaving, setSecuritySaving] = useState(false);

  const load = () => {
    setLoading(true);
    fetch("/api/profile", { cache: "no-store" })
      .then((r) => r.json())
      .then((result) => {
        if (result.profile) {
          setProfile(result.profile);
          setForm(result.profile);
          setFx(result.fx ?? null);
          setReferralCount(result.referralCount ?? 0);
        }
      })
      .finally(() => setLoading(false));
  };
  useEffect(() => { void Promise.resolve().then(load); }, []);

  const patch = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || "Update failed.");
    return result;
  };

  const saveInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    if (!(await confirm({ title: "Save profile changes?" }))) return;
    setSavingInfo(true);
    try {
      const result = await patch({
        action: "updateProfile",
        name: form.name, email: form.email, username: form.username, dateOfBirth: form.dateOfBirth,
        gender: form.gender ?? "", country: form.country, state: form.state ?? "", city: form.city ?? "",
        address: form.address ?? "", phone: form.phone,
      });
      setProfile(result.profile);
      setForm(result.profile);
      notify("Profile updated.");
      onProfileUpdated();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Update failed.", true);
    } finally {
      setSavingInfo(false);
    }
  };

  const saveCurrency = async (currency: string) => {
    setSavingCurrency(true);
    try {
      const result = await patch({ action: "updateProfile", currency });
      setProfile(result.profile);
      setForm((f) => ({ ...f, currency: result.profile.currency }));
      notify(`Display currency set to ${currency}.`);
      onProfileUpdated();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Update failed.", true);
    } finally {
      setSavingCurrency(false);
    }
  };

  const saveLanguage = async (language: string) => {
    setSavingLanguage(true);
    try {
      const result = await patch({ action: "updateProfile", language });
      setProfile(result.profile);
      setForm((f) => ({ ...f, language: result.profile.language }));
      setLanguage(language as LanguageCode);
      notify("Display language updated.");
      onProfileUpdated();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Update failed.", true);
    } finally {
      setSavingLanguage(false);
    }
  };

  const saveEmailNotifications = async (emailNotifications: boolean) => {
    setSavingEmailNotifications(true);
    try {
      const result = await patch({ action: "updateProfile", emailNotifications });
      setProfile(result.profile);
      setForm((f) => ({ ...f, emailNotifications: result.profile.emailNotifications }));
      notify(emailNotifications ? "Email notifications turned on." : "Email notifications turned off.");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Update failed.", true);
      setForm((f) => ({ ...f, emailNotifications: !emailNotifications }));
    } finally {
      setSavingEmailNotifications(false);
    }
  };

  const handlePhotoFile = (file: File | null) => {
    if (!file) return;
    if (!ALLOWED_AVATAR_TYPES.includes(file.type)) return notify("Upload a JPG, PNG, WEBP, or GIF image.", true);
    if (file.size > MAX_AVATAR_BYTES) return notify(`File is too large. Max size is ${(MAX_AVATAR_BYTES / (1024 * 1024)).toFixed(0)}MB.`, true);
    const reader = new FileReader();
    reader.onload = async () => {
      setPhotoBusy(true);
      try {
        const result = await patch({ action: "updateProfile", profilePhoto: String(reader.result) });
        setProfile(result.profile);
        setForm(result.profile);
        notify("Profile photo updated.");
        onProfileUpdated();
      } catch (err) {
        notify(err instanceof Error ? err.message : "Could not update photo.", true);
      } finally {
        setPhotoBusy(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const removePhoto = async () => {
    if (!(await confirm({ title: "Remove your profile photo?" }))) return;
    setPhotoBusy(true);
    try {
      const result = await patch({ action: "updateProfile", profilePhoto: null });
      setProfile(result.profile);
      setForm(result.profile);
      onProfileUpdated();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not remove photo.", true);
    } finally {
      setPhotoBusy(false);
    }
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) return notify("New password must be at least 8 characters.", true);
    if (newPassword !== confirmNewPassword) return notify("New password and confirmation do not match.", true);
    if (!(await confirm({ title: "Change your password?", message: "You'll need your new password the next time you sign in." }))) return;
    setPasswordSaving(true);
    try {
      await patch({ action: "changePassword", currentPassword, newPassword, confirmPassword: confirmNewPassword });
      setCurrentPassword(""); setNewPassword(""); setConfirmNewPassword("");
      notify("Password changed.");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not change password.", true);
    } finally {
      setPasswordSaving(false);
    }
  };

  const saveSecurity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!secQuestion.trim() || !secAnswer.trim()) return notify("Enter both a question and an answer.", true);
    if (!(await confirm({ title: "Save this security question?" }))) return;
    setSecuritySaving(true);
    try {
      await patch({ action: "updateSecurity", currentPassword: secCurrentPassword, securityQuestion: secQuestion, securityAnswer: secAnswer });
      setSecCurrentPassword(""); setSecQuestion(""); setSecAnswer(""); setSecurityEditing(false);
      notify("Security question updated.");
      load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not update security question.", true);
    } finally {
      setSecuritySaving(false);
    }
  };

  if (loading) return <div className="page-heading"><div><div className="eyebrow">YOUR WORKSPACE</div><h1>Profile</h1><p>Loading your profile...</p></div></div>;

  if (!profile || profile.isDemo) {
    return (
      <>
        <div className="page-heading"><div><div className="eyebrow">YOUR WORKSPACE</div><h1>Profile</h1><p>Manage your personal information, security, and currency preferences.</p></div></div>
        <div className="panel"><div className="empty-state">
          <span className="empty-icon"><UserRound size={27} /></span>
          <h3>Create an account to set up your profile</h3>
          <p>You&apos;re exploring AvaTrades in demo mode. Create a free account to save your profile details, change your password, and set your preferred currency.</p>
          <button className="primary-btn" style={{ marginTop: 14 }} onClick={() => onRequireAuth("register")}>Create an account</button>
        </div></div>
      </>
    );
  }

  const selectedCountry = COUNTRIES.find((c) => c.code === form.country) ?? null;
  const initials = profile.name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();

  return (
    <>
      <div className="page-heading"><div><div className="eyebrow">YOUR WORKSPACE</div><h1>Profile</h1><p>Manage your personal information, security, and currency preferences.</p></div></div>

      <div className="panel profile-header-card">
        <span className="profile-avatar-lg">{profile.profilePhoto ? <img src={profile.profilePhoto} alt="Your profile" /> : initials}</span>
        <div className="profile-header-info">
          <h2>{profile.name}</h2>
          <p>{profile.email}{profile.username ? ` · @${profile.username}` : ""}</p>
          <div className="profile-header-pills">
            <span className="status-pill"><span />Member since {new Date(profile.createdAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })}</span>
            {profile.currency && <span className="status-pill approved">Displaying in {profile.currency}</span>}
          </div>
        </div>
        <div className="avatar-upload-actions">
          <label className="outline-btn" style={{ cursor: "pointer" }}>
            <UploadCloud size={15} /> {photoBusy ? "Uploading..." : profile.profilePhoto ? "Replace photo" : "Upload photo"}
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={photoBusy} onChange={(e) => handlePhotoFile(e.target.files?.[0] ?? null)} hidden />
          </label>
          {profile.profilePhoto && <button className="outline-btn" disabled={photoBusy} onClick={removePhoto}>Remove photo</button>}
        </div>
      </div>

      <div className="profile-grid">
        <div className="panel" style={{ gridColumn: "1 / -1" }}>
          <h3>Personal information</h3><p className="panel-subtitle">Keep your details up to date. Required fields are marked *.</p>
          <form onSubmit={saveInfo}>
            <div className="form-grid">
              <div className="form-field"><label className="input-label">Full name *</label><input className="text-input" value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} /></div>
              <div className="form-field"><label className="input-label">Username *</label><input className="text-input" value={form.username ?? ""} onChange={(e) => setForm({ ...form, username: e.target.value })} required minLength={3} maxLength={24} /></div>
              <div className="form-field"><label className="input-label">Email address *</label><input className="text-input" type="email" value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></div>
              <div className="form-field"><label className="input-label">Phone number *</label><input className="text-input" value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} required /></div>
              <div className="form-field"><label className="input-label">Date of birth *</label><input className="text-input" type="date" value={form.dateOfBirth ?? ""} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} required /></div>
              <div className="form-field"><label className="input-label">Gender</label><div className="select-wrap"><select value={form.gender ?? ""} onChange={(e) => setForm({ ...form, gender: e.target.value })}><option value="">Prefer not to specify</option>{GENDERS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}</select></div></div>
              <div className="form-field"><label className="input-label">Country *</label><div className="select-wrap"><select value={form.country ?? ""} onChange={(e) => setForm({ ...form, country: e.target.value })} required><option value="">Select country</option>{COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></div></div>
              <div className="form-field"><label className="input-label">State / Province</label><input className="text-input" value={form.state ?? ""} onChange={(e) => setForm({ ...form, state: e.target.value })} /></div>
              <div className="form-field"><label className="input-label">City</label><input className="text-input" value={form.city ?? ""} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
              <div className="form-field field-full"><label className="input-label">Residential address</label><input className="text-input" value={form.address ?? ""} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
            </div>
            {selectedCountry && <p className="form-hint">Country of {selectedCountry.name} — local currency {currencyForCountry(selectedCountry.code)}. Your display currency is set separately below.</p>}
            <div className="profile-save-row"><button className="primary-btn" disabled={savingInfo}>{savingInfo ? "Saving..." : "Save changes"}</button></div>
          </form>
        </div>

        <div className="panel">
          <h3>Display currency</h3><p className="panel-subtitle">Balances, prices, and profit/loss are converted for display using a live exchange rate. Your real ledger always stays in USD.</p>
          <div className="select-wrap"><select data-testid="currency-select" value={form.currency ?? "USD"} disabled={savingCurrency} onChange={(e) => { setForm({ ...form, currency: e.target.value }); void saveCurrency(e.target.value); }}>{CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
          {fx && <p className="form-hint">1 USD ≈ {fx.rate.toLocaleString("en-US", { maximumFractionDigits: 4 })} {profile.currency} {fx.status !== "live" && "(rate may be slightly delayed)"}</p>}
        </div>

        <div className="panel">
          <h3>Display language</h3><p className="panel-subtitle">Translates the app&apos;s menus, buttons, and headings. Market data and numbers are unaffected.</p>
          <div className="select-wrap"><select data-testid="language-select" value={form.language ?? "en"} disabled={savingLanguage} onChange={(e) => { setForm({ ...form, language: e.target.value }); void saveLanguage(e.target.value); }}>{LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.flag} {l.nativeLabel}</option>)}</select></div>
        </div>

        <div className="panel">
          <h3>Appearance</h3><p className="panel-subtitle">Choose how AvaTrades looks on this device. Saved locally, so other devices keep their own preference.</p>
          <div className="theme-row" style={{ padding: 0 }}>
            <div className="theme-row-label"><strong>Theme</strong><span>{theme === "dark" ? "Dark mode is on" : "Light mode is on"}</span></div>
            <div className="theme-switch" data-testid="theme-switch">
              <button type="button" className={theme === "light" ? "active" : ""} aria-label="Light mode" title="Light mode" onClick={() => setTheme("light")}><Sun size={16}/></button>
              <button type="button" className={theme === "dark" ? "active" : ""} aria-label="Dark mode" title="Dark mode" onClick={() => setTheme("dark")}><Moon size={16}/></button>
            </div>
          </div>
        </div>

        <div className="panel">
          <h3>Notifications</h3>
          <p className="panel-subtitle">Notable account and trading activity always appears in your notification bell. Turn this on to also get it by email.</p>
          <label className="toggle-row" style={{ display: "flex", alignItems: "center", gap: 10, cursor: savingEmailNotifications ? "default" : "pointer" }}>
            <input
              type="checkbox"
              data-testid="email-notifications-toggle"
              checked={form.emailNotifications ?? true}
              disabled={savingEmailNotifications}
              onChange={(e) => { setForm({ ...form, emailNotifications: e.target.checked }); void saveEmailNotifications(e.target.checked); }}
            />
            <span>Email me about account activity (sign-ins, trades, deposits/withdrawals, subscriptions, and more)</span>
          </label>
        </div>

        {!profile.isDemo && <div className="panel">
          <h3>Your referral code</h3><p className="panel-subtitle">Share this with a friend. When they sign up with it, you both get a $25 trading bonus.</p>
          {profile.referralCode ? <>
            <div className="referral-code-box" style={{ marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <span style={{ letterSpacing: 1, fontWeight: 800 }}>{profile.referralCode}</span>
              <button
                type="button"
                className="outline-btn small"
                onClick={() => { navigator.clipboard?.writeText(profile.referralCode ?? ""); setReferralCopied(true); setTimeout(() => setReferralCopied(false), 1800); }}
              >{referralCopied ? "Copied!" : "Copy"}</button>
            </div>
            <div className="profile-readonly-row"><span>Friends referred</span><span>{referralCount}</span></div>
          </> : <p className="form-hint">Your code is being generated - refresh this page in a moment.</p>}
        </div>}

        <div className="panel">
          <h3>Agreements</h3><p className="panel-subtitle">Read-only account record.</p>
          <div className="profile-readonly-row"><span>Terms &amp; Conditions</span><span>{profile.termsAcceptedAt ? <><Check size={13} style={{ verticalAlign: -2 }} /> Accepted {new Date(profile.termsAcceptedAt).toLocaleDateString()}</> : "Not yet accepted"}</span></div>
          <div className="profile-readonly-row"><span>Privacy Policy</span><span>{profile.privacyAcceptedAt ? <><Check size={13} style={{ verticalAlign: -2 }} /> Accepted {new Date(profile.privacyAcceptedAt).toLocaleDateString()}</> : "Not yet accepted"}</span></div>
        </div>

        <div className="panel">
          <h3><Lock size={14} style={{ verticalAlign: -2 }} /> Change password</h3><p className="panel-subtitle">Choose a strong password you don&apos;t use elsewhere.</p>
          <form onSubmit={changePassword}>
            <label className="input-label">Current password</label>
            <input className="text-input" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
            <label className="input-label">New password</label>
            <input className="text-input" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} />
            <label className="input-label">Confirm new password</label>
            <input className="text-input" type="password" value={confirmNewPassword} onChange={(e) => setConfirmNewPassword(e.target.value)} required minLength={8} />
            <div className="profile-save-row"><button className="primary-btn" disabled={passwordSaving}>{passwordSaving ? "Saving..." : "Update password"}</button></div>
          </form>
        </div>

        <div className="panel">
          <h3><CircleHelp size={14} style={{ verticalAlign: -2 }} /> Security question</h3><p className="panel-subtitle">Used to reset your password if you forget it.</p>
          {!securityEditing ? (
            <>
              <div className="profile-readonly-row"><span>Status</span><span>{profile.hasSecurityQuestion ? <><BadgeCheck size={13} style={{ verticalAlign: -2 }} /> Set</> : "Not set"}</span></div>
              {profile.hasSecurityQuestion && <div className="profile-readonly-row"><span>Question</span><span>{profile.securityQuestion}</span></div>}
              <div className="profile-save-row"><button className="outline-btn" onClick={() => setSecurityEditing(true)}><KeyRound size={15} /> {profile.hasSecurityQuestion ? "Update" : "Set up"} security question</button></div>
            </>
          ) : (
            <form onSubmit={saveSecurity}>
              <label className="input-label">Current password</label>
              <input className="text-input" type="password" value={secCurrentPassword} onChange={(e) => setSecCurrentPassword(e.target.value)} required />
              <label className="input-label">Security question</label>
              <input className="text-input" placeholder="e.g. favorite teacher's name" value={secQuestion} onChange={(e) => setSecQuestion(e.target.value)} required />
              <label className="input-label">Answer</label>
              <input className="text-input" value={secAnswer} onChange={(e) => setSecAnswer(e.target.value)} required />
              <div className="profile-save-row">
                <button type="button" className="outline-btn" onClick={() => setSecurityEditing(false)}>Cancel</button>
                <button className="primary-btn" disabled={securitySaving}>{securitySaving ? "Saving..." : "Save"}</button>
              </div>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
