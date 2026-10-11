"use client";

import { useEffect, useState } from "react";
import { Activity, AlertTriangle, ArrowDownLeft, ArrowLeft, ArrowLeftRight, ArrowRight, ArrowUpRight, Bell, Bot, Check, ChevronDown, ChevronRight, Clock3, Copy as CopyIcon, CreditCard, History, LayoutDashboard, LockKeyhole, Menu, Moon, Pencil, Plus, RefreshCw, Search, Send, ShieldAlert, ShieldCheck, Sparkles, Sun, Trash2, TrendingUp, UserPlus, UserRound, UsersRound, Wallet, X } from "lucide-react";
import { DEPOSIT_METHODS, depositMethodLabel, type DepositMethod } from "@/lib/deposits";
import { withdrawalMethodLabel } from "@/lib/withdrawals";
import { AVATAR_COLORS, RISK_LEVELS, SUBSCRIPTION_DURATION_OPTIONS, type AvatarColor, type RiskLevel } from "@/lib/copy-trading";
import { BOT_STRATEGIES, type BotStrategy } from "@/lib/bots";
import { COUNTRIES, DEFAULT_COUNTRY, flagEmoji } from "@/lib/countries";
import { assets as catalogAssets } from "@/lib/market";
import { ACCOUNT_STATUSES, accountStatusLabel, type AccountStatus } from "@/lib/accounts";
import { ConfirmProvider, useConfirm } from "@/components/confirm-provider";
import { ThemeProvider, useTheme } from "@/components/theme-provider";

type AdminUser = { id: string; name: string; email: string | null };
type DepositRequestRow = {
  id: string; method: string; amount: string; destinationLabel: string | null; reference: string | null; note: string | null;
  status: string; adminNote: string | null; receiptFilename: string; receiptMimeType: string; createdAt: string; reviewedAt: string | null;
  userId: string; userName: string; userEmail: string | null;
};
type WithdrawalRequestRow = {
  id: string; method: string; methodLabel: string | null; amount: string; destination: string; note: string | null;
  status: string; adminNote: string | null; createdAt: string; reviewedAt: string | null;
  userId: string; userName: string; userEmail: string | null;
};
type DepositAccountRow = { id: string; method: string; label: string; instructions: string; isActive: boolean; createdAt: string; updatedAt: string };
type CopyTraderRow = { id: string; name: string; handle: string; avatarInitials: string; avatarColor: string; focus: string; bio: string; riskLevel: string; returnPercent: string; winRate: string; subscriptionAmount: string; subscriptionDurationDays: number; rating: string; country: string; photoUrl: string | null; isActive: boolean; activeSubscribers: number; createdAt: string };
type BotProductRow = { id: string; name: string; description: string; strategy: string; riskLevel: string; minAllocation: string; subscriptionAmount: string; subscriptionDurationDays: number; rating: string; country: string; photoUrl: string | null; isActive: boolean; activeSubscribers: number; createdAt: string };
type PlanRow = { id: string; name: string; description: string; priceWeekly: string; features: string[]; isFeatured: boolean; sortOrder: string; isActive: boolean; activeSubscribers: number; createdAt: string };
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

type AdminUserRow = { id: string; name: string; email: string; role: string; isDemo: boolean; cashBalance: string; profitBalance: string; accountStatus: string; maxTradeAmount: string | null; withdrawalsBlocked: boolean; statusReason: string | null; statusUpdatedAt: string | null; createdAt: string; username?: string | null; phone?: string | null; country?: string | null; currency?: string | null };
type SubRow = { id: string; amount: string; startedAt: string; expiresAt: string; botName?: string; traderName?: string; planName?: string };
type UserDetail = {
  user: AdminUserRow;
  holdings: { id: string; symbol: string; quantity: string; avgPrice: string }[];
  trades: { id: string; symbol: string; side: string; quantity: string; price: string; total: string; createdAt: string; placedBy: string | null; adminNote: string | null }[];
  transactions: { id: string; type: string; amount: string; description: string; createdAt: string }[];
  botSubscriptions: SubRow[]; copySubscriptions: SubRow[]; planSubscriptions: SubRow[];
  depositRequests: DepositRequestRow[]; withdrawalRequests: WithdrawalRequestRow[];
  notifications: { id: string; title: string; message: string; createdAt: string; readAt: string | null }[];
};
type Overview = { totalUsers: number; totalCashBalance: string; totalProfitBalance: string; pendingDeposits: number; pendingWithdrawals: number; activeBotSubscriptions: number; activeCopySubscriptions: number; activePlanSubscriptions: number; restrictedAccounts: number };

type Tab = "overview" | "users" | "deposits" | "withdrawals" | "accounts" | "traders" | "bots" | "plans" | "broadcast";
const navGroups: { label: string; items: { name: Tab; label: string; icon: typeof LayoutDashboard }[] }[] = [
  { label: "OVERVIEW", items: [{ name: "overview", label: "Overview", icon: LayoutDashboard }] },
  { label: "USERS", items: [{ name: "users", label: "Manage users", icon: UsersRound }, { name: "broadcast", label: "Broadcast message", icon: Send }] },
  { label: "PAYMENTS", items: [{ name: "deposits", label: "Deposit requests", icon: ArrowDownLeft }, { name: "withdrawals", label: "Withdrawal requests", icon: ArrowUpRight }, { name: "accounts", label: "Deposit destinations", icon: CreditCard }] },
  { label: "CATALOG", items: [{ name: "traders", label: "Copy traders", icon: CopyIcon }, { name: "bots", label: "Trading bots", icon: Bot }, { name: "plans", label: "Plans", icon: Sparkles }] },
];
const tabTitles: Record<Tab, { title: string; description: string }> = {
  overview: { title: "Overview", description: "A quick snapshot of your platform's users, payments, and subscriptions." },
  users: { title: "Manage users", description: "View every account, edit profiles, change access, send notifications, place trades, and adjust balances." },
  deposits: { title: "Deposits & withdrawals", description: "Verify receipts submitted by users and credit their balance." },
  withdrawals: { title: "Deposits & withdrawals", description: "Review payout requests submitted by users." },
  accounts: { title: "Deposit destinations", description: "Manage where users are told to send funds for each payment method." },
  traders: { title: "Copy traders", description: "Curate the traders users can subscribe to follow." },
  bots: { title: "Trading bots", description: "Curate the bot strategies users can subscribe to and configure." },
  plans: { title: "Plans", description: "Curate the weekly plans users can subscribe to." },
  broadcast: { title: "Broadcast message", description: "Send an announcement to every user at once." },
};

export default function AdminPage() {
  return <ThemeProvider><ConfirmProvider><AdminPageInner /></ConfirmProvider></ThemeProvider>;
}

function AdminPageInner() {
  const confirm = useConfirm();
  const { theme, toggleTheme } = useTheme();
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [authState, setAuthState] = useState<"loading" | "denied" | "ok">("loading");
  const [tab, setTab] = useState<Tab>("overview");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const notify = (text: string, error = false) => { setToast({ text, error }); setTimeout(() => setToast(null), 4500); };
  const go = (t: Tab) => { setTab(t); setMobileMenu(false); window.scrollTo({ top: 0, behavior: "smooth" }); };

  const [statusFilter, setStatusFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [requests, setRequests] = useState<DepositRequestRow[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  const [wStatusFilter, setWStatusFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [wRequests, setWRequests] = useState<WithdrawalRequestRow[]>([]);
  const [wRequestsLoading, setWRequestsLoading] = useState(false);
  const [wBusyId, setWBusyId] = useState<string | null>(null);
  const [wRejectingId, setWRejectingId] = useState<string | null>(null);
  const [wRejectNote, setWRejectNote] = useState("");

  const [accounts, setAccounts] = useState<DepositAccountRow[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [newMethod, setNewMethod] = useState<DepositMethod>("crypto");
  const [newLabel, setNewLabel] = useState("");
  const [newInstructions, setNewInstructions] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editInstructions, setEditInstructions] = useState("");

  const [traders, setTraders] = useState<CopyTraderRow[]>([]);
  const [tradersLoading, setTradersLoading] = useState(false);
  const [traderCreating, setTraderCreating] = useState(false);
  const emptyTraderForm = { name: "", handle: "", avatarColor: "blue" as AvatarColor, focus: "", bio: "", riskLevel: "Moderate" as RiskLevel, returnPercent: "", winRate: "", subscriptionAmount: "", subscriptionDurationDays: "7", rating: "4.8", country: DEFAULT_COUNTRY, photoUrl: "" };
  const [traderForm, setTraderForm] = useState(emptyTraderForm);
  const [editingTraderId, setEditingTraderId] = useState<string | null>(null);
  const [editTraderForm, setEditTraderForm] = useState(emptyTraderForm);
  const [traderBusyId, setTraderBusyId] = useState<string | null>(null);

  const [botRows, setBotRows] = useState<BotProductRow[]>([]);
  const [botsLoading, setBotsLoading] = useState(false);
  const [botCreating, setBotCreating] = useState(false);
  const emptyBotForm = { name: "", description: "", strategy: "DCA" as BotStrategy, riskLevel: "Moderate" as RiskLevel, minAllocation: "", subscriptionAmount: "", subscriptionDurationDays: "7", rating: "4.8", country: DEFAULT_COUNTRY, photoUrl: "" };
  const [botForm, setBotForm] = useState(emptyBotForm);
  const [editingBotId, setEditingBotId] = useState<string | null>(null);
  const [editBotForm, setEditBotForm] = useState(emptyBotForm);
  const [botBusyId, setBotBusyId] = useState<string | null>(null);

  const [planRows, setPlanRows] = useState<PlanRow[]>([]);
  const [plansLoadingAdmin, setPlansLoadingAdmin] = useState(false);
  const [planCreating, setPlanCreating] = useState(false);
  const emptyPlanForm = { name: "", description: "", priceWeekly: "", features: "", isFeatured: false, sortOrder: "0" };
  const [planForm, setPlanForm] = useState(emptyPlanForm);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [editPlanForm, setEditPlanForm] = useState(emptyPlanForm);
  const [planBusyId, setPlanBusyId] = useState<string | null>(null);

  // --- Broadcast ---
  const [broadcastForm, setBroadcastForm] = useState({ title: "", message: "" });
  const [broadcastSending, setBroadcastSending] = useState(false);
  const [broadcastResult, setBroadcastResult] = useState<number | null>(null);

  // --- Overview ---
  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const loadOverview = async () => {
    setOverviewLoading(true);
    try {
      const res = await fetch("/api/admin/overview", { cache: "no-store" });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Unable to load overview");
      setOverview(result);
    } catch (error) { notify(error instanceof Error ? error.message : "Unable to load overview", true); } finally { setOverviewLoading(false); }
  };
  useEffect(() => { if (authState === "ok" && tab === "overview") void loadOverview(); }, [authState, tab]);

  // --- Users ---
  const [userRows, setUserRows] = useState<AdminUserRow[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [userTotals, setUserTotals] = useState({ total: 0, totalCashBalance: "0", totalProfitBalance: "0" });
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [createUserForm, setCreateUserForm] = useState({ name: "", email: "", password: "", cashBalance: "0", profitBalance: "0" });
  const [createUserBusy, setCreateUserBusy] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [userDetail, setUserDetail] = useState<UserDetail | null>(null);
  const [userDetailLoading, setUserDetailLoading] = useState(false);

  const [editUserForm, setEditUserForm] = useState({ name: "", email: "", role: "user" });
  const [editUserBusy, setEditUserBusy] = useState(false);
  const [statusForm, setStatusForm] = useState({ accountStatus: "active" as AccountStatus, maxTradeAmount: "", withdrawalsBlocked: false, statusReason: "" });
  const [statusBusy, setStatusBusy] = useState(false);
  const [balanceForm, setBalanceForm] = useState({ newBalance: "", note: "" });
  const [balanceBusy, setBalanceBusy] = useState(false);
  const [profitForm, setProfitForm] = useState({ newProfit: "", note: "" });
  const [profitBusy, setProfitBusy] = useState(false);
  const [notifForm, setNotifForm] = useState({ title: "", message: "" });
  const [notifBusy, setNotifBusy] = useState(false);
  const [manualTradeForm, setManualTradeForm] = useState({ symbol: "BTC", side: "buy" as "buy" | "sell", quantity: "", price: "", note: "" });
  const [manualTradeBusy, setManualTradeBusy] = useState(false);
  const [subBusyId, setSubBusyId] = useState<string | null>(null);

  const loadUsers = async (q = userSearch) => {
    setUsersLoading(true);
    try {
      const query = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
      const res = await fetch(`/api/admin/users${query}`, { cache: "no-store" });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Unable to load users");
      setUserRows(result.users ?? []);
      setUserTotals({ total: result.total ?? 0, totalCashBalance: result.totalCashBalance ?? "0", totalProfitBalance: result.totalProfitBalance ?? "0" });
    } catch (error) { notify(error instanceof Error ? error.message : "Unable to load users", true); } finally { setUsersLoading(false); }
  };
  useEffect(() => { if (authState === "ok" && tab === "users" && !selectedUserId) void loadUsers(userSearch); }, [authState, tab, selectedUserId]);
  useEffect(() => {
    if (authState !== "ok" || tab !== "users" || selectedUserId) return;
    const t = window.setTimeout(() => void loadUsers(userSearch), 350);
    return () => window.clearTimeout(t);
  }, [userSearch]);

  const loadUserDetail = async (id: string) => {
    setUserDetailLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${id}`, { cache: "no-store" });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Unable to load this user");
      setUserDetail(result);
      setEditUserForm({ name: result.user.name, email: result.user.email, role: result.user.role });
      setStatusForm({ accountStatus: result.user.accountStatus, maxTradeAmount: result.user.maxTradeAmount ?? "", withdrawalsBlocked: result.user.withdrawalsBlocked, statusReason: result.user.statusReason ?? "" });
      setBalanceForm({ newBalance: result.user.cashBalance, note: "" });
      setProfitForm({ newProfit: result.user.profitBalance, note: "" });
    } catch (error) { notify(error instanceof Error ? error.message : "Unable to load this user", true); setSelectedUserId(null); } finally { setUserDetailLoading(false); }
  };
  const openUser = (id: string) => { setSelectedUserId(id); void loadUserDetail(id); };
  const closeUser = () => { setSelectedUserId(null); setUserDetail(null); void loadUsers(userSearch); };

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (createUserBusy) return;
    if (createUserForm.name.trim().length < 2) return notify("Enter the user's name.", true);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(createUserForm.email.trim())) return notify("Enter a valid email address.", true);
    if (createUserForm.password.length < 8) return notify("Password must be at least 8 characters.", true);
    if (!(await confirm({ title: "Create this user?", message: `Creates an account for ${createUserForm.name.trim()} (${createUserForm.email.trim()}).` }))) return;
    setCreateUserBusy(true);
    try {
      const res = await fetch("/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(createUserForm) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Something went wrong");
      notify(`${result.user?.name ?? "User"} created`);
      setCreateUserForm({ name: "", email: "", password: "", cashBalance: "0", profitBalance: "0" });
      setShowCreateUser(false);
      await loadUsers(userSearch);
    } catch (error) { notify(error instanceof Error ? error.message : "Something went wrong", true); } finally { setCreateUserBusy(false); }
  };

  const saveUserProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserId || editUserBusy) return;
    if (!(await confirm({ title: "Save this user's profile changes?" }))) return;
    setEditUserBusy(true);
    try {
      const res = await fetch(`/api/admin/users/${selectedUserId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editUserForm) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Something went wrong");
      notify("Profile updated");
      await loadUserDetail(selectedUserId);
    } catch (error) { notify(error instanceof Error ? error.message : "Something went wrong", true); } finally { setEditUserBusy(false); }
  };

  const saveUserStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserId || statusBusy) return;
    if (!(await confirm({ title: `Set account standing to "${accountStatusLabel(statusForm.accountStatus as AccountStatus)}"?`, message: statusForm.accountStatus === "locked" ? "The user will be signed out immediately and unable to log back in until you change this." : undefined, danger: statusForm.accountStatus === "locked" || statusForm.accountStatus === "suspended" }))) return;
    setStatusBusy(true);
    try {
      const res = await fetch(`/api/admin/users/${selectedUserId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountStatus: statusForm.accountStatus, maxTradeAmount: statusForm.maxTradeAmount === "" ? null : statusForm.maxTradeAmount, withdrawalsBlocked: statusForm.withdrawalsBlocked, statusReason: statusForm.statusReason || null }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Something went wrong");
      notify("Account standing updated");
      await loadUserDetail(selectedUserId);
    } catch (error) { notify(error instanceof Error ? error.message : "Something went wrong", true); } finally { setStatusBusy(false); }
  };

  const saveBalance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserId || balanceBusy) return;
    const newBalance = Number(balanceForm.newBalance);
    if (!Number.isFinite(newBalance) || newBalance < 0) return notify("Enter a valid balance.", true);
    if (!(await confirm({ title: "Set this user's balance?", message: `This directly sets their cash balance to ${money(newBalance)} and logs the difference as an admin credit/debit.`, confirmLabel: "Set balance", danger: true }))) return;
    setBalanceBusy(true);
    try {
      const res = await fetch(`/api/admin/users/${selectedUserId}/balance`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ newBalance, note: balanceForm.note }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Something went wrong");
      notify(result.message || "Balance updated");
      setBalanceForm({ newBalance: String(newBalance.toFixed(2)), note: "" });
      await loadUserDetail(selectedUserId);
    } catch (error) { notify(error instanceof Error ? error.message : "Something went wrong", true); } finally { setBalanceBusy(false); }
  };

  const saveProfit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserId || profitBusy) return;
    const newProfit = Number(profitForm.newProfit);
    if (!Number.isFinite(newProfit) || newProfit < 0) return notify("Enter a valid profit amount.", true);
    if (!(await confirm({ title: "Set this user's profits?", message: `This directly sets their profit balance to ${money(newProfit)} and logs the difference as a profit credit/debit. It's folded into their total balance.`, confirmLabel: "Set profits", danger: true }))) return;
    setProfitBusy(true);
    try {
      const res = await fetch(`/api/admin/users/${selectedUserId}/profit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ newProfit, note: profitForm.note }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Something went wrong");
      notify(result.message || "Profit balance updated");
      setProfitForm({ newProfit: String(newProfit.toFixed(2)), note: "" });
      await loadUserDetail(selectedUserId);
    } catch (error) { notify(error instanceof Error ? error.message : "Something went wrong", true); } finally { setProfitBusy(false); }
  };

  const sendNotification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserId || notifBusy) return;
    if (notifForm.title.trim().length < 2) return notify("Enter a title.", true);
    if (notifForm.message.trim().length < 2) return notify("Enter a message.", true);
    if (!(await confirm({ title: "Send this notification?", message: "The user will see it in their notification bell and, if they have email notifications on, get an email." }))) return;
    setNotifBusy(true);
    try {
      const res = await fetch(`/api/admin/users/${selectedUserId}/notifications`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(notifForm) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Something went wrong");
      notify("Notification sent");
      setNotifForm({ title: "", message: "" });
      await loadUserDetail(selectedUserId);
    } catch (error) { notify(error instanceof Error ? error.message : "Something went wrong", true); } finally { setNotifBusy(false); }
  };

  const placeManualTrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserId || manualTradeBusy) return;
    const quantity = Number(manualTradeForm.quantity);
    if (!quantity || quantity <= 0) return notify("Enter a valid quantity.", true);
    if (!(await confirm({ title: `Place this ${manualTradeForm.side} trade for the user?`, message: `${manualTradeForm.side === "buy" ? "Buy" : "Sell"} ${quantity} ${manualTradeForm.symbol} on their behalf${manualTradeForm.price ? ` at $${manualTradeForm.price}` : " at the live market price"}.`, confirmLabel: "Place trade", danger: true }))) return;
    setManualTradeBusy(true);
    try {
      const res = await fetch(`/api/admin/users/${selectedUserId}/trades`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol: manualTradeForm.symbol, side: manualTradeForm.side, quantity, price: manualTradeForm.price || undefined, note: manualTradeForm.note }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Something went wrong");
      notify(result.message || "Trade placed");
      setManualTradeForm({ symbol: manualTradeForm.symbol, side: "buy", quantity: "", price: "", note: "" });
      await loadUserDetail(selectedUserId);
    } catch (error) { notify(error instanceof Error ? error.message : "Something went wrong", true); } finally { setManualTradeBusy(false); }
  };

  const cancelSubscription = async (kind: "bot" | "copy" | "plan", id: string) => {
    if (!selectedUserId || subBusyId) return;
    if (!(await confirm({ title: "End this subscription now?", confirmLabel: "End subscription", danger: true }))) return;
    setSubBusyId(id);
    try {
      const res = await fetch(`/api/admin/subscriptions/${kind}/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel" }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Something went wrong");
      notify("Subscription ended");
      await loadUserDetail(selectedUserId);
    } catch (error) { notify(error instanceof Error ? error.message : "Something went wrong", true); } finally { setSubBusyId(null); }
  };

  useEffect(() => {
    fetch("/api/admin/me", { cache: "no-store" }).then(async r => {
      if (!r.ok) { setAuthState("denied"); return; }
      const result = await r.json();
      setAdmin(result.user);
      setAuthState("ok");
    }).catch(() => setAuthState("denied"));
  }, []);

  const loadRequests = async (status = statusFilter) => {
    setRequestsLoading(true);
    try {
      const query = status === "all" ? "" : `?status=${status}`;
      const res = await fetch(`/api/admin/deposits${query}`, { cache: "no-store" });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Unable to load deposit requests");
      setRequests(result.requests ?? []);
    } catch (error) { notify(error instanceof Error ? error.message : "Unable to load deposit requests", true); } finally { setRequestsLoading(false); }
  };
  const loadAccounts = async () => {
    setAccountsLoading(true);
    try {
      const res = await fetch("/api/admin/deposit-accounts", { cache: "no-store" });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Unable to load deposit accounts");
      setAccounts(result.accounts ?? []);
    } catch (error) { notify(error instanceof Error ? error.message : "Unable to load deposit accounts", true); } finally { setAccountsLoading(false); }
  };
  useEffect(() => { if (authState === "ok" && tab === "deposits") void loadRequests(statusFilter); }, [authState, tab, statusFilter]);
  useEffect(() => { if (authState === "ok" && tab === "accounts") void loadAccounts(); }, [authState, tab]);

  const review = async (id: string, action: "approve" | "reject", adminNote?: string) => {
    if (action === "approve" && !(await confirm({ title: "Approve and credit this deposit?", message: "This immediately adds the claimed amount to the user's balance." }))) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/deposits/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, adminNote }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Something went wrong");
      notify(result.message || "Done");
      setRejectingId(null);
      setRejectNote("");
      await loadRequests(statusFilter);
    } catch (error) { notify(error instanceof Error ? error.message : "Something went wrong", true); } finally { setBusyId(null); }
  };

  const loadWithdrawalRequests = async (status = wStatusFilter) => {
    setWRequestsLoading(true);
    try {
      const query = status === "all" ? "" : `?status=${status}`;
      const res = await fetch(`/api/admin/withdrawals${query}`, { cache: "no-store" });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Unable to load withdrawal requests");
      setWRequests(result.requests ?? []);
    } catch (error) { notify(error instanceof Error ? error.message : "Unable to load withdrawal requests", true); } finally { setWRequestsLoading(false); }
  };
  useEffect(() => { if (authState === "ok" && tab === "withdrawals") void loadWithdrawalRequests(wStatusFilter); }, [authState, tab, wStatusFilter]);

  const reviewWithdrawal = async (id: string, action: "approve" | "reject", adminNote?: string) => {
    if (action === "approve" && !(await confirm({ title: "Approve this withdrawal?", message: "Only confirm once you've actually sent the payout to the user's destination yourself - this just finalizes the record." }))) return;
    setWBusyId(id);
    try {
      const res = await fetch(`/api/admin/withdrawals/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, adminNote }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Something went wrong");
      notify(result.message || "Done");
      setWRejectingId(null);
      setWRejectNote("");
      await loadWithdrawalRequests(wStatusFilter);
    } catch (error) { notify(error instanceof Error ? error.message : "Something went wrong", true); } finally { setWBusyId(null); }
  };

  const createAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creating) return;
    if (newLabel.trim().length < 2) return notify("Enter a label for this destination.", true);
    if (newInstructions.trim().length < 2) return notify("Enter the account details users should send funds to.", true);
    if (!(await confirm({ title: "Add this deposit destination?", message: "It becomes visible to every user depositing with this method." }))) return;
    setCreating(true);
    try {
      const res = await fetch("/api/admin/deposit-accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ method: newMethod, label: newLabel, instructions: newInstructions }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Something went wrong");
      notify("Deposit destination added");
      setNewLabel(""); setNewInstructions("");
      await loadAccounts();
    } catch (error) { notify(error instanceof Error ? error.message : "Something went wrong", true); } finally { setCreating(false); }
  };
  const toggleActive = async (account: DepositAccountRow) => {
    if (!(await confirm({ title: account.isActive ? "Deactivate this destination?" : "Activate this destination?" }))) return;
    try {
      const res = await fetch(`/api/admin/deposit-accounts/${account.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !account.isActive }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Something went wrong");
      await loadAccounts();
    } catch (error) { notify(error instanceof Error ? error.message : "Something went wrong", true); }
  };
  const saveEdit = async (id: string) => {
    if (!(await confirm({ title: "Save changes to this destination?" }))) return;
    try {
      const res = await fetch(`/api/admin/deposit-accounts/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: editLabel, instructions: editInstructions }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Something went wrong");
      notify("Deposit destination updated");
      setEditingId(null);
      await loadAccounts();
    } catch (error) { notify(error instanceof Error ? error.message : "Something went wrong", true); }
  };
  const removeAccount = async (id: string) => {
    if (!(await confirm({ title: "Delete this deposit destination?", message: "Past deposit requests keep a record of what was shown at the time.", confirmLabel: "Delete", danger: true }))) return;
    try {
      const res = await fetch(`/api/admin/deposit-accounts/${id}`, { method: "DELETE" });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Something went wrong");
      notify("Deposit destination removed");
      await loadAccounts();
    } catch (error) { notify(error instanceof Error ? error.message : "Something went wrong", true); }
  };

  const loadTraders = async () => {
    setTradersLoading(true);
    try {
      const res = await fetch("/api/admin/copy-traders", { cache: "no-store" });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Unable to load copy traders");
      setTraders(result.traders ?? []);
    } catch (error) { notify(error instanceof Error ? error.message : "Unable to load copy traders", true); } finally { setTradersLoading(false); }
  };
  useEffect(() => { if (authState === "ok" && tab === "traders") void loadTraders(); }, [authState, tab]);

  const createTrader = async (e: React.FormEvent) => {
    e.preventDefault();
    if (traderCreating) return;
    if (traderForm.name.trim().length < 2) return notify("Enter the trader's name.", true);
    if (traderForm.handle.trim().length < 2) return notify("Enter a handle, e.g. @alex.trades.", true);
    if (traderForm.focus.trim().length < 1) return notify("Enter the trader's focus, e.g. BTC, ETH.", true);
    if (traderForm.bio.trim().length < 1) return notify("Enter a short bio for the trader.", true);
    if (!traderForm.subscriptionAmount || Number(traderForm.subscriptionAmount) < 0) return notify("Enter a valid subscription price (0 or more).", true);
    if (!(await confirm({ title: "Add this trader to the roster?" }))) return;
    setTraderCreating(true);
    try {
      const res = await fetch("/api/admin/copy-traders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(traderForm) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Something went wrong");
      notify(`${result.trader?.name ?? "Trader"} added to the roster`);
      setTraderForm(emptyTraderForm);
      await loadTraders();
    } catch (error) { notify(error instanceof Error ? error.message : "Something went wrong", true); } finally { setTraderCreating(false); }
  };
  const toggleTraderActive = async (t: CopyTraderRow) => {
    if (!(await confirm({ title: t.isActive ? `Deactivate ${t.name}?` : `Activate ${t.name}?` }))) return;
    setTraderBusyId(t.id);
    try {
      const res = await fetch(`/api/admin/copy-traders/${t.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !t.isActive }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Something went wrong");
      await loadTraders();
    } catch (error) { notify(error instanceof Error ? error.message : "Something went wrong", true); } finally { setTraderBusyId(null); }
  };
  const saveTraderEdit = async (id: string) => {
    if (!(await confirm({ title: "Save changes to this trader?" }))) return;
    setTraderBusyId(id);
    try {
      const res = await fetch(`/api/admin/copy-traders/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editTraderForm) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Something went wrong");
      notify("Trader profile updated");
      setEditingTraderId(null);
      await loadTraders();
    } catch (error) { notify(error instanceof Error ? error.message : "Something went wrong", true); } finally { setTraderBusyId(null); }
  };
  const removeTrader = async (t: CopyTraderRow) => {
    if (!(await confirm({ title: `Delete ${t.name} from the roster?`, message: "This only works if they have no subscription history.", confirmLabel: "Delete", danger: true }))) return;
    setTraderBusyId(t.id);
    try {
      const res = await fetch(`/api/admin/copy-traders/${t.id}`, { method: "DELETE" });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Something went wrong");
      notify("Trader removed");
      await loadTraders();
    } catch (error) { notify(error instanceof Error ? error.message : "Something went wrong", true); } finally { setTraderBusyId(null); }
  };

  const loadBots = async () => {
    setBotsLoading(true);
    try {
      const res = await fetch("/api/admin/bots", { cache: "no-store" });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Unable to load trading bots");
      setBotRows(result.bots ?? []);
    } catch (error) { notify(error instanceof Error ? error.message : "Unable to load trading bots", true); } finally { setBotsLoading(false); }
  };
  useEffect(() => { if (authState === "ok" && tab === "bots") void loadBots(); }, [authState, tab]);

  const createBot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (botCreating) return;
    if (botForm.name.trim().length < 2) return notify("Enter the bot's name.", true);
    if (botForm.description.trim().length < 1) return notify("Enter a short description.", true);
    if (!botForm.minAllocation || Number(botForm.minAllocation) < 0) return notify("Enter a valid minimum allocation.", true);
    if (!botForm.subscriptionAmount || Number(botForm.subscriptionAmount) < 0) return notify("Enter a valid subscription price (0 or more).", true);
    if (!(await confirm({ title: "Add this bot to the catalog?" }))) return;
    setBotCreating(true);
    try {
      const res = await fetch("/api/admin/bots", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(botForm) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Something went wrong");
      notify(`${result.bot?.name ?? "Bot"} added to the catalog`);
      setBotForm(emptyBotForm);
      await loadBots();
    } catch (error) { notify(error instanceof Error ? error.message : "Something went wrong", true); } finally { setBotCreating(false); }
  };
  const toggleBotActive = async (b: BotProductRow) => {
    if (!(await confirm({ title: b.isActive ? `Deactivate ${b.name}?` : `Activate ${b.name}?` }))) return;
    setBotBusyId(b.id);
    try {
      const res = await fetch(`/api/admin/bots/${b.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !b.isActive }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Something went wrong");
      await loadBots();
    } catch (error) { notify(error instanceof Error ? error.message : "Something went wrong", true); } finally { setBotBusyId(null); }
  };
  const saveBotEdit = async (id: string) => {
    if (!(await confirm({ title: "Save changes to this bot?" }))) return;
    setBotBusyId(id);
    try {
      const res = await fetch(`/api/admin/bots/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editBotForm) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Something went wrong");
      notify("Bot updated");
      setEditingBotId(null);
      await loadBots();
    } catch (error) { notify(error instanceof Error ? error.message : "Something went wrong", true); } finally { setBotBusyId(null); }
  };
  const removeBot = async (b: BotProductRow) => {
    if (!(await confirm({ title: `Delete ${b.name} from the catalog?`, message: "This only works if it has no subscription history.", confirmLabel: "Delete", danger: true }))) return;
    setBotBusyId(b.id);
    try {
      const res = await fetch(`/api/admin/bots/${b.id}`, { method: "DELETE" });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Something went wrong");
      notify("Bot removed");
      await loadBots();
    } catch (error) { notify(error instanceof Error ? error.message : "Something went wrong", true); } finally { setBotBusyId(null); }
  };

  const loadPlansAdmin = async () => {
    setPlansLoadingAdmin(true);
    try {
      const res = await fetch("/api/admin/plans", { cache: "no-store" });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Unable to load plans");
      setPlanRows(result.plans ?? []);
    } catch (error) { notify(error instanceof Error ? error.message : "Unable to load plans", true); } finally { setPlansLoadingAdmin(false); }
  };
  useEffect(() => { if (authState === "ok" && tab === "plans") void loadPlansAdmin(); }, [authState, tab]);

  const createPlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (planCreating) return;
    if (planForm.name.trim().length < 2) return notify("Enter the plan's name.", true);
    if (planForm.description.trim().length < 1) return notify("Enter a short description.", true);
    if (!planForm.priceWeekly || Number(planForm.priceWeekly) < 0) return notify("Enter a valid weekly price (0 or more).", true);
    if (planForm.features.trim().length < 1) return notify("List at least one feature (one per line).", true);
    if (!(await confirm({ title: "Add this plan to the catalog?" }))) return;
    setPlanCreating(true);
    try {
      const res = await fetch("/api/admin/plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(planForm) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Something went wrong");
      notify(`${result.plan?.name ?? "Plan"} added to the catalog`);
      setPlanForm(emptyPlanForm);
      await loadPlansAdmin();
    } catch (error) { notify(error instanceof Error ? error.message : "Something went wrong", true); } finally { setPlanCreating(false); }
  };
  const sendBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (broadcastSending) return;
    if (broadcastForm.title.trim().length < 2) return notify("Enter a title.", true);
    if (broadcastForm.message.trim().length < 1) return notify("Enter a message.", true);
    if (!(await confirm({ title: "Send this announcement to every user right now?", message: "This goes out immediately to every real (non-demo) account, in-app and by email.", confirmLabel: "Send broadcast", danger: true }))) return;
    setBroadcastSending(true);
    setBroadcastResult(null);
    try {
      const res = await fetch("/api/admin/notifications/broadcast", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(broadcastForm) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Something went wrong");
      notify(`Broadcast sent to ${result.sent} user${result.sent === 1 ? "" : "s"}.`);
      setBroadcastResult(result.sent);
      setBroadcastForm({ title: "", message: "" });
    } catch (error) { notify(error instanceof Error ? error.message : "Something went wrong", true); } finally { setBroadcastSending(false); }
  };
  const togglePlanActive = async (p: PlanRow) => {
    if (!(await confirm({ title: p.isActive ? `Deactivate ${p.name}?` : `Activate ${p.name}?` }))) return;
    setPlanBusyId(p.id);
    try {
      const res = await fetch(`/api/admin/plans/${p.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !p.isActive }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Something went wrong");
      await loadPlansAdmin();
    } catch (error) { notify(error instanceof Error ? error.message : "Something went wrong", true); } finally { setPlanBusyId(null); }
  };
  const savePlanEdit = async (id: string) => {
    if (!(await confirm({ title: "Save changes to this plan?" }))) return;
    setPlanBusyId(id);
    try {
      const res = await fetch(`/api/admin/plans/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editPlanForm) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Something went wrong");
      notify("Plan updated");
      setEditingPlanId(null);
      await loadPlansAdmin();
    } catch (error) { notify(error instanceof Error ? error.message : "Something went wrong", true); } finally { setPlanBusyId(null); }
  };
  const removePlan = async (p: PlanRow) => {
    if (!(await confirm({ title: `Delete ${p.name} from the catalog?`, message: "This only works if it has no subscription history.", confirmLabel: "Delete", danger: true }))) return;
    setPlanBusyId(p.id);
    try {
      const res = await fetch(`/api/admin/plans/${p.id}`, { method: "DELETE" });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Something went wrong");
      notify("Plan removed");
      await loadPlansAdmin();
    } catch (error) { notify(error instanceof Error ? error.message : "Something went wrong", true); } finally { setPlanBusyId(null); }
  };

  if (authState === "loading") return <div className="admin-shell admin-center"><Clock3 size={22}/><p>Loading admin panel…</p></div>;
  if (authState === "denied") return <div className="admin-shell admin-center">
    <div className="panel admin-denied">
      <LockKeyhole size={28}/>
      <h2>Admins only</h2>
      <p>You need an admin account to view this page. Sign in with an admin account on the main app, then come back here.</p>
      <a className="primary-btn" href="/"><ArrowLeft size={16}/> Back to NexaTrade</a>
    </div>
  </div>;

  const active = tabTitles[tab];

  return <div className="admin-shell">
    {mobileMenu && <div className="mobile-overlay" onClick={() => setMobileMenu(false)}/>}
    <aside className={`sidebar ${mobileMenu ? "sidebar-open" : ""}`}>
      <div className="brand" onClick={() => go("overview")}><div className="brand-icon"><Activity size={23} strokeWidth={3}/></div><span>Nexa<span>Trade</span></span><button className="mobile-close" onClick={(e) => { e.stopPropagation(); setMobileMenu(false); }}><X size={19}/></button></div>
      <div className="sidebar-body">{navGroups.map(group => <div className="nav-group" key={group.label}><div className="nav-label">{group.label}</div>{group.items.map(item => { const Icon = item.icon; return <button key={item.name} className={`nav-item ${tab === item.name ? "selected" : ""}`} onClick={() => go(item.name)}><Icon size={19} strokeWidth={tab === item.name ? 2.25 : 1.8}/><span>{item.label}</span></button>; })}</div>)}</div>
      <div className="sidebar-bottom">
        <div className="help-card"><span className="help-bubble"><ShieldCheck size={18}/></span><strong>{admin?.name}</strong><p>{admin?.email ?? "Signed in as admin"}</p><a href="/" style={{ display: "flex", alignItems: "center", gap: 5, textDecoration: "none" }}>Exit to app <ArrowRight size={14}/></a></div>
        <div className="sidebar-footer"><ShieldCheck size={15}/> NexaTrade admin panel</div>
      </div>
    </aside>
    <div className="main-shell">
      <header className="topbar">
        <div className="topbar-left"><button className="icon-btn menu-btn" onClick={() => setMobileMenu(true)} aria-label="Open menu"><Menu size={22}/></button><div className="breadcrumb">Admin <ChevronRight size={15}/> <strong>{active.title}</strong></div></div>
        <div className="topbar-right"><button className="theme-toggle" aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} onClick={toggleTheme}>{theme === "dark" ? <Sun size={19}/> : <Moon size={19}/>}</button><span className="admin-whoami"><ShieldCheck size={15}/> {admin?.name} · Admin</span><a href="/" className="outline-btn small"><ArrowLeft size={14}/> Exit to app</a></div>
      </header>
      <main className="admin-content">
        <div className="page-heading"><div><div className="eyebrow">ADMIN PANEL</div><h1>{active.title}</h1><p>{active.description}</p></div></div>

        {tab === "overview" && <>
          {overviewLoading && !overview ? <div className="no-results">Loading overview…</div> : overview && <>
            <div className="stats-grid five">
              <div className="stat-card"><span className="stat-icon blue"><UsersRound size={19}/></span><span className="stat-label">Total users</span><strong className="stat-value">{overview.totalUsers}</strong><div className="stat-foot"><span>{overview.restrictedAccounts} restricted</span></div></div>
              <div className="stat-card"><span className="stat-icon green"><Wallet size={19}/></span><span className="stat-label">Total cash balance</span><strong className="stat-value">{money(Number(overview.totalCashBalance))}</strong><div className="stat-foot"><span>Across all accounts</span></div></div>
              <div className="stat-card"><span className="stat-icon green"><TrendingUp size={19}/></span><span className="stat-label">Total profits</span><strong className="stat-value">{money(Number(overview.totalProfitBalance))}</strong><div className="stat-foot"><span>Across all accounts</span></div></div>
              <div className="stat-card"><span className="stat-icon orange"><ArrowDownLeft size={19}/></span><span className="stat-label">Pending deposits</span><strong className="stat-value">{overview.pendingDeposits}</strong><div className="stat-foot"><button className="text-link" onClick={() => go("deposits")} style={{ fontSize: 11 }}>Review <ArrowRight size={13}/></button></div></div>
              <div className="stat-card"><span className="stat-icon purple"><ArrowUpRight size={19}/></span><span className="stat-label">Pending withdrawals</span><strong className="stat-value">{overview.pendingWithdrawals}</strong><div className="stat-foot"><button className="text-link" onClick={() => go("withdrawals")} style={{ fontSize: 11 }}>Review <ArrowRight size={13}/></button></div></div>
            </div>
            <div className="stats-grid three">
              <div className="stat-card"><span className="stat-icon blue"><Bot size={19}/></span><span className="stat-label">Active bot subscriptions</span><strong className="stat-value">{overview.activeBotSubscriptions}</strong></div>
              <div className="stat-card"><span className="stat-icon purple"><CopyIcon size={19}/></span><span className="stat-label">Active copy subscriptions</span><strong className="stat-value">{overview.activeCopySubscriptions}</strong></div>
              <div className="stat-card"><span className="stat-icon green"><Sparkles size={19}/></span><span className="stat-label">Active plan subscriptions</span><strong className="stat-value">{overview.activePlanSubscriptions}</strong></div>
            </div>
          </>}
          <section className="panel admin-panel" style={{ marginTop: 18, padding: 20 }}>
            <SectionHeadSimple title="Quick actions"/>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", padding: "14px 0 4px" }}>
              <button className="outline-btn" onClick={() => go("users")}><UsersRound size={16}/> Manage users</button>
              <button className="outline-btn" onClick={() => go("deposits")}><ArrowDownLeft size={16}/> Review deposits</button>
              <button className="outline-btn" onClick={() => go("withdrawals")}><ArrowUpRight size={16}/> Review withdrawals</button>
              <button className="outline-btn" onClick={() => { setShowCreateUser(true); go("users"); }}><UserPlus size={16}/> Add a user</button>
            </div>
          </section>
        </>}

        {tab === "users" && !selectedUserId && <>
          <div className="admin-filter-row" style={{ marginBottom: 16, justifyContent: "space-between" }}>
            <div className="top-search" style={{ width: 280 }}><Search size={17}/><input placeholder="Search by name or email…" value={userSearch} onChange={e => setUserSearch(e.target.value)}/></div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span className="subtle-label">{userTotals.total} user{userTotals.total === 1 ? "" : "s"} · {money(Number(userTotals.totalCashBalance))} total balance · {money(Number(userTotals.totalProfitBalance))} total profits</span>
              <button className="outline-btn small" onClick={() => loadUsers(userSearch)}><RefreshCw size={13} className={usersLoading ? "spin" : ""}/> Refresh</button>
              <button className="primary-btn small" onClick={() => setShowCreateUser(s => !s)}><UserPlus size={15}/> Add user</button>
            </div>
          </div>
          {showCreateUser && <section className="panel admin-panel" style={{ marginBottom: 18 }}>
            <div className="section-head"><div><h2>Create a new user</h2><p>Useful for setting up an account for a customer who signed up another way.</p></div></div>
            <form className="admin-account-form" onSubmit={createUser} style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: "0 16px" }}>
              <div><label className="input-label">Full name</label><input className="text-input" value={createUserForm.name} onChange={e => setCreateUserForm({ ...createUserForm, name: e.target.value })} maxLength={80}/></div>
              <div><label className="input-label">Email</label><input className="text-input" type="email" value={createUserForm.email} onChange={e => setCreateUserForm({ ...createUserForm, email: e.target.value })}/></div>
              <div><label className="input-label">Password</label><input className="text-input" type="password" placeholder="At least 8 characters" value={createUserForm.password} onChange={e => setCreateUserForm({ ...createUserForm, password: e.target.value })}/></div>
              <div><label className="input-label">Starting balance ($)</label><input className="text-input" type="number" step="0.01" min="0" value={createUserForm.cashBalance} onChange={e => setCreateUserForm({ ...createUserForm, cashBalance: e.target.value })}/></div>
              <div><label className="input-label">Starting profits ($)</label><input className="text-input" type="number" step="0.01" min="0" value={createUserForm.profitBalance} onChange={e => setCreateUserForm({ ...createUserForm, profitBalance: e.target.value })}/></div>
              <div style={{ gridColumn: "1 / -1", display: "flex", gap: 10, marginTop: 14 }}><button className="primary-btn" disabled={createUserBusy}>{createUserBusy ? "Creating..." : "Create user"}</button><button type="button" className="outline-btn" onClick={() => setShowCreateUser(false)}>Cancel</button></div>
            </form>
          </section>}
          <section className="panel admin-panel">
            <div className="table-scroll"><table className="data-table"><thead><tr><th>User</th><th>Role</th><th>Balance</th><th>Profits</th><th>Status</th><th>Joined</th><th></th></tr></thead><tbody>
              {userRows.map(u => <tr key={u.id} className="clickable-row" onClick={() => openUser(u.id)}>
                <td><div className="coin-cell"><span className="avatar" style={{ width: 34, height: 34, fontSize: 11 }}>{u.name.split(" ").map(n => n[0]).slice(0, 2).join("")}</span><div><strong>{u.name}</strong><span>{u.email}</span></div></div></td>
                <td className="capitalize">{u.role}{u.isDemo ? " · demo" : ""}</td>
                <td className="table-strong">{money(Number(u.cashBalance))}</td>
                <td className="table-strong">{money(Number(u.profitBalance))}</td>
                <td><span className={`status-pill ${u.accountStatus}`}><span/>{accountStatusLabel(u.accountStatus as AccountStatus)}</span></td>
                <td className="muted-cell">{new Date(u.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td>
                <td><button className="outline-btn small" onClick={e => { e.stopPropagation(); openUser(u.id); }}>Manage</button></td>
              </tr>)}
            </tbody></table>{userRows.length === 0 && !usersLoading && <div className="empty-state"><span className="empty-icon"><UsersRound size={27}/></span><h3>No users found</h3><p>Try a different search, or add a new user above.</p></div>}</div>
          </section>
        </>}

        {tab === "users" && selectedUserId && <>
          <button className="outline-btn small" onClick={closeUser} style={{ marginBottom: 16 }}><ArrowLeft size={14}/> Back to all users</button>
          {userDetailLoading && !userDetail ? <div className="no-results">Loading user…</div> : userDetail && <>
            <div className="panel admin-panel" style={{ padding: 20, marginBottom: 18, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <span className="avatar" style={{ width: 48, height: 48, fontSize: 14 }}>{userDetail.user.name.split(" ").map(n => n[0]).slice(0, 2).join("")}</span>
                <div><h2 style={{ margin: 0, fontSize: 18 }}>{userDetail.user.name}</h2><p style={{ margin: "4px 0 0", color: "#8995a9", fontSize: 12 }}>{userDetail.user.email} · {userDetail.user.role}{userDetail.user.isDemo ? " · demo account" : ""}</p></div>
              </div>
              <span className={`status-pill ${userDetail.user.accountStatus}`} style={{ fontSize: 12, padding: "7px 12px" }}><span/>{accountStatusLabel(userDetail.user.accountStatus as AccountStatus)}</span>
            </div>

            <div className="admin-accounts-layout">
              <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                <section className="panel admin-panel">
                  <SectionHeadSimple title="Profile" subtitle="Name, email, and role"/>
                  <form className="admin-account-form" onSubmit={saveUserProfile}>
                    <label className="input-label">Full name</label><input className="text-input" value={editUserForm.name} onChange={e => setEditUserForm({ ...editUserForm, name: e.target.value })} maxLength={80}/>
                    <label className="input-label">Email</label><input className="text-input" type="email" value={editUserForm.email} onChange={e => setEditUserForm({ ...editUserForm, email: e.target.value })}/>
                    <label className="input-label">Role</label>
                    <div className="select-wrap"><select value={editUserForm.role} onChange={e => setEditUserForm({ ...editUserForm, role: e.target.value })}><option value="user">User</option><option value="admin">Admin</option></select><ChevronDown size={16}/></div>
                    <button className="primary-btn full-btn" disabled={editUserBusy} style={{ marginTop: 14 }}><Pencil size={15}/> {editUserBusy ? "Saving..." : "Save profile"}</button>
                  </form>
                  <div className="profile-readonly-row"><span>Username</span><span>{userDetail.user.username ? `@${userDetail.user.username}` : "Not set"}</span></div>
                  <div className="profile-readonly-row"><span>Phone</span><span>{userDetail.user.phone ?? "Not set"}</span></div>
                  <div className="profile-readonly-row"><span>Country</span><span>{userDetail.user.country ?? "Not set"}</span></div>
                  <div className="profile-readonly-row"><span>Display currency</span><span>{userDetail.user.currency ?? "USD"}</span></div>
                </section>

                <section className="panel admin-panel">
                  <SectionHeadSimple title="Account standing" subtitle="Lock, suspend, or limit this account"/>
                  <form className="admin-account-form" onSubmit={saveUserStatus}>
                    <label className="input-label">Status</label>
                    <div className="select-wrap"><select value={statusForm.accountStatus} onChange={e => setStatusForm({ ...statusForm, accountStatus: e.target.value as AccountStatus })}>{ACCOUNT_STATUSES.map(s => <option key={s} value={s}>{accountStatusLabel(s)}</option>)}</select><ChevronDown size={16}/></div>
                    {statusForm.accountStatus === "limited" && <>
                      <label className="input-label">Max trade size ($, optional)</label>
                      <input className="text-input" type="number" step="0.01" min="0" placeholder="No limit" value={statusForm.maxTradeAmount} onChange={e => setStatusForm({ ...statusForm, maxTradeAmount: e.target.value })}/>
                      <label className="checkbox-row"><input type="checkbox" checked={statusForm.withdrawalsBlocked} onChange={e => setStatusForm({ ...statusForm, withdrawalsBlocked: e.target.checked })}/> Block withdrawals</label>
                    </>}
                    <label className="input-label">Reason (optional, shown to user)</label>
                    <textarea className="text-input" rows={2} value={statusForm.statusReason} onChange={e => setStatusForm({ ...statusForm, statusReason: e.target.value })} maxLength={500}/>
                    <button className="primary-btn full-btn" disabled={statusBusy} style={{ marginTop: 14 }}><ShieldAlert size={15}/> {statusBusy ? "Saving..." : "Update standing"}</button>
                  </form>
                </section>

                <section className="panel admin-panel">
                  <SectionHeadSimple title="Edit balance" subtitle="Directly set this user's cash balance"/>
                  <form className="admin-account-form" onSubmit={saveBalance}>
                    <label className="input-label">New balance ($)</label>
                    <input className="text-input" type="number" step="0.01" min="0" value={balanceForm.newBalance} onChange={e => setBalanceForm({ ...balanceForm, newBalance: e.target.value })}/>
                    <label className="input-label">Note (optional)</label>
                    <input className="text-input" placeholder="e.g. Manual correction, bonus credit..." value={balanceForm.note} onChange={e => setBalanceForm({ ...balanceForm, note: e.target.value })} maxLength={300}/>
                    <button className="primary-btn full-btn" disabled={balanceBusy} style={{ marginTop: 14 }}><Wallet size={15}/> {balanceBusy ? "Saving..." : "Update balance"}</button>
                  </form>
                </section>

                <section className="panel admin-panel">
                  <SectionHeadSimple title="Edit profits" subtitle="Directly set this user's profit balance — folded into their total balance"/>
                  <form className="admin-account-form" onSubmit={saveProfit}>
                    <label className="input-label">New profits ($)</label>
                    <input className="text-input" type="number" step="0.01" min="0" value={profitForm.newProfit} onChange={e => setProfitForm({ ...profitForm, newProfit: e.target.value })}/>
                    <label className="input-label">Note (optional)</label>
                    <input className="text-input" placeholder="e.g. Copy trading gains, bonus profit..." value={profitForm.note} onChange={e => setProfitForm({ ...profitForm, note: e.target.value })} maxLength={300}/>
                    <button className="primary-btn full-btn" disabled={profitBusy} style={{ marginTop: 14 }}><TrendingUp size={15}/> {profitBusy ? "Saving..." : "Update profits"}</button>
                  </form>
                </section>

                <section className="panel admin-panel">
                  <SectionHeadSimple title="Send a notification" subtitle="Shown in this user's notification bell"/>
                  <form className="admin-account-form" onSubmit={sendNotification}>
                    <label className="input-label">Title</label>
                    <input className="text-input" value={notifForm.title} onChange={e => setNotifForm({ ...notifForm, title: e.target.value })} maxLength={120}/>
                    <label className="input-label">Message</label>
                    <textarea className="text-input" rows={3} value={notifForm.message} onChange={e => setNotifForm({ ...notifForm, message: e.target.value })} maxLength={1000}/>
                    <button className="primary-btn full-btn" disabled={notifBusy} style={{ marginTop: 14 }}><Send size={15}/> {notifBusy ? "Sending..." : "Send notification"}</button>
                  </form>
                </section>

                <section className="panel admin-panel">
                  <SectionHeadSimple title="Place a manual trade" subtitle="For phone/chat support requests. Defaults to the live price."/>
                  <form className="admin-account-form" onSubmit={placeManualTrade}>
                    <div className="segmented full"><button type="button" className={manualTradeForm.side === "buy" ? "active buy-active" : ""} onClick={() => setManualTradeForm({ ...manualTradeForm, side: "buy" })}>Buy</button><button type="button" className={manualTradeForm.side === "sell" ? "active sell-active" : ""} onClick={() => setManualTradeForm({ ...manualTradeForm, side: "sell" })}>Sell</button></div>
                    <label className="input-label">Asset</label>
                    <div className="select-wrap"><select value={manualTradeForm.symbol} onChange={e => setManualTradeForm({ ...manualTradeForm, symbol: e.target.value })}>{catalogAssets.map(a => <option key={a.symbol} value={a.symbol}>{a.name} ({a.symbol})</option>)}</select><ChevronDown size={16}/></div>
                    <label className="input-label">Quantity</label>
                    <input className="text-input" type="number" step="any" min="0" value={manualTradeForm.quantity} onChange={e => setManualTradeForm({ ...manualTradeForm, quantity: e.target.value })}/>
                    <label className="input-label">Custom fill price ($, optional — defaults to live price)</label>
                    <input className="text-input" type="number" step="0.01" min="0" placeholder="Live market price" value={manualTradeForm.price} onChange={e => setManualTradeForm({ ...manualTradeForm, price: e.target.value })}/>
                    <label className="input-label">Note (optional)</label>
                    <input className="text-input" placeholder="e.g. Quoted over phone at 10:45am" value={manualTradeForm.note} onChange={e => setManualTradeForm({ ...manualTradeForm, note: e.target.value })} maxLength={300}/>
                    <button className="primary-btn full-btn" disabled={manualTradeBusy} style={{ marginTop: 14 }}><ArrowLeftRight size={15}/> {manualTradeBusy ? "Placing..." : "Place trade"}</button>
                  </form>
                </section>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
                <section className="panel admin-panel">
                  <SectionHeadSimple title="Subscriptions" subtitle="Bot, copy trading, and plan subscriptions"/>
                  <div className="admin-account-list">
                    {[...userDetail.botSubscriptions.map(s => ({ ...s, kind: "bot" as const, name: s.botName! })), ...userDetail.copySubscriptions.map(s => ({ ...s, kind: "copy" as const, name: s.traderName! })), ...userDetail.planSubscriptions.map(s => ({ ...s, kind: "plan" as const, name: s.planName! }))]
                      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
                      .map(s => { const activeSub = new Date(s.expiresAt).getTime() > Date.now(); return <div className="admin-account-item" key={`${s.kind}-${s.id}`}>
                        <div className="admin-account-item-top"><strong>{s.name} <span style={{ color: "#9aa4b7", fontWeight: 500, textTransform: "capitalize" }}>· {s.kind}</span></strong><span className={`status-pill ${activeSub ? "approved" : "expired"}`}><span/>{activeSub ? "Active" : "Expired"}</span></div>
                        <p>{money(Number(s.amount))} · started {new Date(s.startedAt).toLocaleDateString()} · expires {new Date(s.expiresAt).toLocaleDateString()}</p>
                        {activeSub && <div className="admin-account-item-actions"><button className="outline-btn small danger-outline" disabled={subBusyId === s.id} onClick={() => cancelSubscription(s.kind, s.id)}><X size={13}/> End now</button></div>}
                      </div>; })}
                    {userDetail.botSubscriptions.length + userDetail.copySubscriptions.length + userDetail.planSubscriptions.length === 0 && <div className="empty-state"><span className="empty-icon"><Sparkles size={27}/></span><h3>No subscriptions</h3><p>This user hasn't subscribed to anything yet.</p></div>}
                  </div>
                </section>

                <section className="panel admin-panel">
                  <SectionHeadSimple title="Recent trades"/>
                  <div className="table-scroll"><table className="data-table"><thead><tr><th>Asset</th><th>Side</th><th>Qty</th><th>Price</th><th>Total</th><th>Date</th></tr></thead><tbody>
                    {userDetail.trades.map(t => <tr key={t.id}><td className="table-strong">{t.symbol}{t.placedBy && <span className="placed-by-support-badge"> <UserRound size={11}/> Admin</span>}</td><td className="capitalize">{t.side}</td><td>{Number(t.quantity)}</td><td>{money(Number(t.price))}</td><td className="table-strong">{money(Number(t.total))}</td><td className="muted-cell">{new Date(t.createdAt).toLocaleDateString()}</td></tr>)}
                  </tbody></table>{userDetail.trades.length === 0 && <div className="empty-state"><span className="empty-icon"><History size={27}/></span><h3>No trades yet</h3><p>&nbsp;</p></div>}</div>
                </section>

                <section className="panel admin-panel">
                  <SectionHeadSimple title="Recent transactions"/>
                  <div className="table-scroll"><table className="data-table"><thead><tr><th>Description</th><th>Type</th><th>Amount</th><th>Date</th></tr></thead><tbody>
                    {userDetail.transactions.map(t => <tr key={t.id}><td>{t.description}</td><td className="capitalize">{t.type.replace("_", " ")}</td><td className="table-strong">{money(Number(t.amount))}</td><td className="muted-cell">{new Date(t.createdAt).toLocaleDateString()}</td></tr>)}
                  </tbody></table>{userDetail.transactions.length === 0 && <div className="empty-state"><span className="empty-icon"><CreditCard size={27}/></span><h3>No transactions yet</h3><p>&nbsp;</p></div>}</div>
                </section>

                <section className="panel admin-panel">
                  <SectionHeadSimple title="Deposit & withdrawal requests"/>
                  <div className="admin-account-list">
                    {[...userDetail.depositRequests.map(r => ({ ...r, kind: "Deposit" })), ...userDetail.withdrawalRequests.map(r => ({ ...r, kind: "Withdrawal" }))].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map(r => <div className="admin-account-item" key={`${r.kind}-${r.id}`}>
                      <div className="admin-account-item-top"><strong>{r.kind} · {money(Number(r.amount))}</strong><span className={`status-pill ${r.status}`}><span/>{r.status}</span></div>
                      <p>{new Date(r.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>
                    </div>)}
                    {userDetail.depositRequests.length + userDetail.withdrawalRequests.length === 0 && <div className="empty-state"><span className="empty-icon"><Wallet size={27}/></span><h3>No requests yet</h3><p>&nbsp;</p></div>}
                  </div>
                </section>

                <section className="panel admin-panel">
                  <SectionHeadSimple title="Notifications sent" subtitle="Admin notifications sent to this user"/>
                  <div className="admin-account-list">
                    {userDetail.notifications.map(n => <div className="admin-account-item" key={n.id}>
                      <div className="admin-account-item-top"><strong>{n.title}</strong><span className={`status-pill ${n.readAt ? "approved" : "pending"}`}><span/>{n.readAt ? "Read" : "Unread"}</span></div>
                      <p>{n.message}</p>
                    </div>)}
                    {userDetail.notifications.length === 0 && <div className="empty-state"><span className="empty-icon"><Bell size={27}/></span><h3>No notifications sent</h3><p>&nbsp;</p></div>}
                  </div>
                </section>
              </div>
            </div>
          </>}
        </>}

        {tab === "deposits" && <section className="panel admin-panel">
          <div className="section-head">
            <div><h2>Deposit requests</h2><p>Approving credits the user&apos;s balance immediately; nothing is credited automatically.</p></div>
            <div className="admin-filter-row">
              <div className="segmented">{(["pending", "approved", "rejected", "all"] as const).map(s => <button key={s} className={statusFilter === s ? "active" : ""} onClick={() => setStatusFilter(s)}>{s[0].toUpperCase() + s.slice(1)}</button>)}</div>
              <button className="outline-btn small" onClick={() => loadRequests(statusFilter)}><RefreshCw size={13} className={requestsLoading ? "spin" : ""}/> Refresh</button>
            </div>
          </div>
          <div className="admin-request-list">
            {requests.length === 0 && !requestsLoading && <div className="empty-state"><span className="empty-icon"><Clock3 size={27}/></span><h3>No {statusFilter === "all" ? "" : statusFilter} deposit requests</h3><p>Submitted deposit requests will appear here.</p></div>}
            {requests.map(r => <div className="admin-request-card" key={r.id}>
              <div className="admin-request-head">
                <div><strong>{money(Number(r.amount))}</strong><span className="admin-request-method">{depositMethodLabel(r.method)}{r.destinationLabel ? ` · ${r.destinationLabel}` : ""}</span></div>
                <span className={`status-pill ${r.status}`}><span/>{r.status === "pending" ? "Pending review" : r.status === "approved" ? "Approved" : "Rejected"}</span>
              </div>
              <div className="admin-request-meta">
                <div><span>User</span><strong>{r.userName}</strong><small>{r.userEmail}</small></div>
                <div><span>Submitted</span><strong>{new Date(r.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</strong></div>
                {r.reference && <div><span>Reference</span><strong>{r.reference}</strong></div>}
                <div><span>Receipt</span><a href={`/api/deposits/${r.id}/receipt`} target="_blank" rel="noreferrer" className="text-link">View file <Activity size={13}/></a></div>
              </div>
              {r.note && <p className="admin-request-note"><strong>User note:</strong> {r.note}</p>}
              {r.adminNote && <p className="admin-request-note admin-note-flag"><AlertTriangle size={13}/> {r.adminNote}</p>}
              {r.status === "pending" && <div className="admin-request-actions">
                {rejectingId === r.id ? <div className="admin-reject-form">
                  <textarea className="text-input" placeholder="Reason for rejection (shown to the user)" value={rejectNote} onChange={e => setRejectNote(e.target.value)} rows={2}/>
                  <div className="admin-reject-buttons">
                    <button className="outline-btn small" onClick={() => { setRejectingId(null); setRejectNote(""); }}>Cancel</button>
                    <button className="primary-btn small reject-btn" disabled={busyId === r.id || !rejectNote.trim()} onClick={() => review(r.id, "reject", rejectNote)}><X size={14}/> Confirm reject</button>
                  </div>
                </div> : <>
                  <button className="primary-btn small" disabled={busyId === r.id} onClick={() => review(r.id, "approve")}><Check size={14}/> Approve &amp; credit</button>
                  <button className="outline-btn small reject-outline" disabled={busyId === r.id} onClick={() => setRejectingId(r.id)}><X size={14}/> Reject</button>
                </>}
              </div>}
            </div>)}
          </div>
        </section>}

        {tab === "withdrawals" && <section className="panel admin-panel">
          <div className="section-head">
            <div><h2>Withdrawal requests</h2><p>The requested amount is already held from the user&apos;s balance. Send the payout yourself, then approve here to finalize, or reject to refund it.</p></div>
            <div className="admin-filter-row">
              <div className="segmented">{(["pending", "approved", "rejected", "all"] as const).map(s => <button key={s} className={wStatusFilter === s ? "active" : ""} onClick={() => setWStatusFilter(s)}>{s[0].toUpperCase() + s.slice(1)}</button>)}</div>
              <button className="outline-btn small" onClick={() => loadWithdrawalRequests(wStatusFilter)}><RefreshCw size={13} className={wRequestsLoading ? "spin" : ""}/> Refresh</button>
            </div>
          </div>
          <div className="admin-request-list">
            {wRequests.length === 0 && !wRequestsLoading && <div className="empty-state"><span className="empty-icon"><Clock3 size={27}/></span><h3>No {wStatusFilter === "all" ? "" : wStatusFilter} withdrawal requests</h3><p>Submitted withdrawal requests will appear here.</p></div>}
            {wRequests.map(r => <div className="admin-request-card" key={r.id}>
              <div className="admin-request-head">
                <div><strong>{money(Number(r.amount))}</strong><span className="admin-request-method">{withdrawalMethodLabel(r.method, r.methodLabel)}</span></div>
                <span className={`status-pill ${r.status}`}><span/>{r.status === "pending" ? "Pending review" : r.status === "approved" ? "Approved" : "Rejected"}</span>
              </div>
              <div className="admin-request-meta">
                <div><span>User</span><strong>{r.userName}</strong><small>{r.userEmail}</small></div>
                <div><span>Submitted</span><strong>{new Date(r.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</strong></div>
                <div><span>Send payout to</span><strong>{r.destination}</strong></div>
              </div>
              {r.note && <p className="admin-request-note"><strong>User note:</strong> {r.note}</p>}
              {r.adminNote && <p className="admin-request-note admin-note-flag"><AlertTriangle size={13}/> {r.adminNote}</p>}
              {r.status === "pending" && <div className="admin-request-actions">
                {wRejectingId === r.id ? <div className="admin-reject-form">
                  <textarea className="text-input" placeholder="Reason for rejection (shown to the user; the held amount is refunded)" value={wRejectNote} onChange={e => setWRejectNote(e.target.value)} rows={2}/>
                  <div className="admin-reject-buttons">
                    <button className="outline-btn small" onClick={() => { setWRejectingId(null); setWRejectNote(""); }}>Cancel</button>
                    <button className="primary-btn small reject-btn" disabled={wBusyId === r.id || !wRejectNote.trim()} onClick={() => reviewWithdrawal(r.id, "reject", wRejectNote)}><X size={14}/> Confirm reject &amp; refund</button>
                  </div>
                </div> : <>
                  <button className="primary-btn small" disabled={wBusyId === r.id} onClick={() => reviewWithdrawal(r.id, "approve")}><Check size={14}/> Approve (I sent it)</button>
                  <button className="outline-btn small reject-outline" disabled={wBusyId === r.id} onClick={() => setWRejectingId(r.id)}><X size={14}/> Reject &amp; refund</button>
                </>}
              </div>}
            </div>)}
          </div>
        </section>}

        {tab === "accounts" && <section className="admin-accounts-layout">
          <section className="panel admin-panel">
            <div className="section-head"><div><h2>Add a deposit destination</h2><p>This is shown to users when they choose this payment method.</p></div></div>
            <form className="admin-account-form" onSubmit={createAccount}>
              <label className="input-label">Method</label>
              <div className="select-wrap"><select value={newMethod} onChange={e => setNewMethod(e.target.value as DepositMethod)}>{DEPOSIT_METHODS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select></div>
              <label className="input-label">Label</label>
              <input className="text-input" placeholder="e.g. Bitcoin (BTC) or Chase Bank - Checking" value={newLabel} onChange={e => setNewLabel(e.target.value)} maxLength={120}/>
              <label className="input-label">Details shown to users</label>
              <textarea className="text-input deposit-textarea" placeholder={"e.g.\nAddress: bc1q...\nNetwork: Bitcoin (BTC only)"} value={newInstructions} onChange={e => setNewInstructions(e.target.value)} rows={4} maxLength={2000}/>
              <button className="primary-btn full-btn" disabled={creating}>{creating ? "Adding..." : "Add destination"}</button>
            </form>
          </section>
          <section className="panel admin-panel">
            <div className="section-head"><div><h2>Current destinations</h2><p>{accounts.length} configured</p></div><button className="outline-btn small" onClick={loadAccounts}><RefreshCw size={13} className={accountsLoading ? "spin" : ""}/> Refresh</button></div>
            <div className="admin-account-list">
              {DEPOSIT_METHODS.map(m => {
                const items = accounts.filter(a => a.method === m.id);
                if (!items.length) return null;
                return <div key={m.id} className="admin-account-group">
                  <h3>{m.label}</h3>
                  {items.map(a => <div className={`admin-account-item ${a.isActive ? "" : "inactive"}`} key={a.id}>
                    {editingId === a.id ? <div className="admin-account-edit">
                      <input className="text-input" value={editLabel} onChange={e => setEditLabel(e.target.value)} maxLength={120}/>
                      <textarea className="text-input deposit-textarea" value={editInstructions} onChange={e => setEditInstructions(e.target.value)} rows={3} maxLength={2000}/>
                      <div className="admin-reject-buttons"><button className="outline-btn small" onClick={() => setEditingId(null)}>Cancel</button><button className="primary-btn small" onClick={() => saveEdit(a.id)}>Save</button></div>
                    </div> : <>
                      <div className="admin-account-item-top"><strong>{a.label}</strong><span className={`status-pill ${a.isActive ? "approved" : "rejected"}`}><span/>{a.isActive ? "Active" : "Hidden"}</span></div>
                      <p>{a.instructions}</p>
                      <div className="admin-account-item-actions">
                        <button className="outline-btn small" onClick={() => { setEditingId(a.id); setEditLabel(a.label); setEditInstructions(a.instructions); }}>Edit</button>
                        <button className="outline-btn small" onClick={() => toggleActive(a)}>{a.isActive ? "Hide" : "Activate"}</button>
                        <button className="outline-btn small danger-outline" onClick={() => removeAccount(a.id)}><Trash2 size={13}/> Delete</button>
                      </div>
                    </>}
                  </div>)}
                </div>;
              })}
              {accounts.length === 0 && !accountsLoading && <div className="empty-state"><span className="empty-icon"><ShieldCheck size={27}/></span><h3>No destinations configured</h3><p>Add one on the left so users know where to send funds.</p></div>}
            </div>
          </section>
        </section>}

        {tab === "traders" && <section className="admin-accounts-layout">
          <section className="panel admin-panel">
            <div className="section-head"><div><h2>Add a copy trader</h2><p>Set their profile, stats, rating, country, photo, and the price &amp; duration of a subscription.</p></div></div>
            <form className="admin-account-form" onSubmit={createTrader}>
              <label className="input-label">Name</label>
              <input className="text-input" placeholder="e.g. Alex Morgan" value={traderForm.name} onChange={e => setTraderForm({ ...traderForm, name: e.target.value })} maxLength={80}/>
              <label className="input-label">Handle</label>
              <input className="text-input" placeholder="e.g. @alex.trades" value={traderForm.handle} onChange={e => setTraderForm({ ...traderForm, handle: e.target.value })} maxLength={40}/>
              <label className="input-label">Avatar color</label>
              <div className="select-wrap"><select value={traderForm.avatarColor} onChange={e => setTraderForm({ ...traderForm, avatarColor: e.target.value as AvatarColor })}>{AVATAR_COLORS.map(c => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}</select></div>
              <label className="input-label">Focus</label>
              <input className="text-input" placeholder="e.g. BTC, ETH" value={traderForm.focus} onChange={e => setTraderForm({ ...traderForm, focus: e.target.value })} maxLength={120}/>
              <label className="input-label">Short bio</label>
              <textarea className="text-input" rows={3} placeholder="A short bio shown on their card" value={traderForm.bio} onChange={e => setTraderForm({ ...traderForm, bio: e.target.value })} maxLength={200}/>
              <label className="input-label">Risk level</label>
              <div className="select-wrap"><select value={traderForm.riskLevel} onChange={e => setTraderForm({ ...traderForm, riskLevel: e.target.value as RiskLevel })}>{RISK_LEVELS.map(r => <option key={r} value={r}>{r}</option>)}</select></div>
              <label className="input-label">Return % (30-day)</label>
              <input className="text-input" type="number" step="0.01" placeholder="e.g. 42.80" value={traderForm.returnPercent} onChange={e => setTraderForm({ ...traderForm, returnPercent: e.target.value })}/>
              <label className="input-label">Win rate %</label>
              <input className="text-input" type="number" step="0.01" min="0" max="100" placeholder="e.g. 78" value={traderForm.winRate} onChange={e => setTraderForm({ ...traderForm, winRate: e.target.value })}/>
              <label className="input-label">Subscription price</label>
              <input className="text-input" type="number" step="0.01" min="0" placeholder="e.g. 49.00" value={traderForm.subscriptionAmount} onChange={e => setTraderForm({ ...traderForm, subscriptionAmount: e.target.value })}/>
              <label className="input-label">Subscription duration</label>
              <div className="select-wrap"><select value={traderForm.subscriptionDurationDays} onChange={e => setTraderForm({ ...traderForm, subscriptionDurationDays: e.target.value })}>{SUBSCRIPTION_DURATION_OPTIONS.map(d => <option key={d} value={d}>{d} days</option>)}</select></div>
              <label className="input-label">Rating (0-5)</label>
              <input className="text-input" type="number" step="0.1" min="0" max="5" placeholder="e.g. 4.8" value={traderForm.rating} onChange={e => setTraderForm({ ...traderForm, rating: e.target.value })}/>
              <label className="input-label">Country</label>
              <div className="select-wrap"><select value={traderForm.country} onChange={e => setTraderForm({ ...traderForm, country: e.target.value })}>{COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}</select></div>
              <label className="input-label">Profile photo URL (optional)</label>
              <div className="admin-photo-row">
                {traderForm.photoUrl && <img src={traderForm.photoUrl} alt="" className="admin-photo-preview" onError={e => { (e.target as HTMLImageElement).style.visibility = "hidden"; }}/>}
                <input className="text-input" type="url" placeholder="https://..." value={traderForm.photoUrl} onChange={e => setTraderForm({ ...traderForm, photoUrl: e.target.value })} maxLength={600}/>
              </div>
              <button className="primary-btn full-btn" disabled={traderCreating}>{traderCreating ? "Adding..." : "Add trader"}</button>
            </form>
          </section>
          <section className="panel admin-panel">
            <div className="section-head"><div><h2>Roster</h2><p>{traders.length} trader{traders.length === 1 ? "" : "s"} · active subscribers shown live</p></div><button className="outline-btn small" onClick={loadTraders}><RefreshCw size={13} className={tradersLoading ? "spin" : ""}/> Refresh</button></div>
            <div className="admin-account-list">
              {traders.map(t => <div className={`admin-account-item ${t.isActive ? "" : "inactive"}`} key={t.id}>
                {editingTraderId === t.id ? <div className="admin-account-edit">
                  <input className="text-input" value={editTraderForm.name} onChange={e => setEditTraderForm({ ...editTraderForm, name: e.target.value })} maxLength={80}/>
                  <input className="text-input" value={editTraderForm.handle} onChange={e => setEditTraderForm({ ...editTraderForm, handle: e.target.value })} maxLength={40}/>
                  <div className="select-wrap"><select value={editTraderForm.avatarColor} onChange={e => setEditTraderForm({ ...editTraderForm, avatarColor: e.target.value as AvatarColor })}>{AVATAR_COLORS.map(c => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}</select></div>
                  <input className="text-input" value={editTraderForm.focus} onChange={e => setEditTraderForm({ ...editTraderForm, focus: e.target.value })} maxLength={120}/>
                  <textarea className="text-input" rows={3} value={editTraderForm.bio} onChange={e => setEditTraderForm({ ...editTraderForm, bio: e.target.value })} placeholder="Short bio" maxLength={200}/>
                  <div className="select-wrap"><select value={editTraderForm.riskLevel} onChange={e => setEditTraderForm({ ...editTraderForm, riskLevel: e.target.value as RiskLevel })}>{RISK_LEVELS.map(r => <option key={r} value={r}>{r}</option>)}</select></div>
                  <input className="text-input" type="number" step="0.01" value={editTraderForm.returnPercent} onChange={e => setEditTraderForm({ ...editTraderForm, returnPercent: e.target.value })} placeholder="Return %"/>
                  <input className="text-input" type="number" step="0.01" value={editTraderForm.winRate} onChange={e => setEditTraderForm({ ...editTraderForm, winRate: e.target.value })} placeholder="Win rate %"/>
                  <input className="text-input" type="number" step="0.01" min="0" value={editTraderForm.subscriptionAmount} onChange={e => setEditTraderForm({ ...editTraderForm, subscriptionAmount: e.target.value })} placeholder="Subscription price"/>
                  <div className="select-wrap"><select value={editTraderForm.subscriptionDurationDays} onChange={e => setEditTraderForm({ ...editTraderForm, subscriptionDurationDays: e.target.value })}>{SUBSCRIPTION_DURATION_OPTIONS.map(d => <option key={d} value={d}>{d} days</option>)}</select></div>
                  <input className="text-input" type="number" step="0.1" min="0" max="5" value={editTraderForm.rating} onChange={e => setEditTraderForm({ ...editTraderForm, rating: e.target.value })} placeholder="Rating (0-5)"/>
                  <div className="select-wrap"><select value={editTraderForm.country} onChange={e => setEditTraderForm({ ...editTraderForm, country: e.target.value })}>{COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}</select></div>
                  <div className="admin-photo-row">
                    {editTraderForm.photoUrl && <img src={editTraderForm.photoUrl} alt="" className="admin-photo-preview" onError={e => { (e.target as HTMLImageElement).style.visibility = "hidden"; }}/>}
                    <input className="text-input" type="url" value={editTraderForm.photoUrl} onChange={e => setEditTraderForm({ ...editTraderForm, photoUrl: e.target.value })} placeholder="Profile photo URL" maxLength={600}/>
                  </div>
                  <div className="admin-reject-buttons"><button className="outline-btn small" onClick={() => setEditingTraderId(null)}>Cancel</button><button className="primary-btn small" disabled={traderBusyId === t.id} onClick={() => saveTraderEdit(t.id)}>Save</button></div>
                </div> : <>
                  <div className="admin-account-item-top"><strong>{flagEmoji(t.country)} {t.name} <span style={{ color: "#9aa4b7", fontWeight: 500 }}>{t.handle}</span></strong><span className={`status-pill ${t.isActive ? "approved" : "rejected"}`}><span/>{t.isActive ? "Active" : "Hidden"}</span></div>
                  <p>{t.bio}</p>
                  <p>{t.focus} · {t.riskLevel} risk · {Number(t.returnPercent) >= 0 ? "+" : ""}{Number(t.returnPercent).toFixed(2)}% return · {Number(t.winRate).toFixed(0)}% win rate · ★ {Number(t.rating).toFixed(1)} · {money(Number(t.subscriptionAmount))}/{t.subscriptionDurationDays}d · {t.activeSubscribers} active subscriber{t.activeSubscribers === 1 ? "" : "s"}</p>
                  <div className="admin-account-item-actions">
                    <button className="outline-btn small" onClick={() => { setEditingTraderId(t.id); setEditTraderForm({ name: t.name, handle: t.handle, avatarColor: t.avatarColor as AvatarColor, focus: t.focus, bio: t.bio, riskLevel: t.riskLevel as RiskLevel, returnPercent: t.returnPercent, winRate: t.winRate, subscriptionAmount: t.subscriptionAmount, subscriptionDurationDays: String(t.subscriptionDurationDays), rating: t.rating, country: t.country, photoUrl: t.photoUrl ?? "" }); }}>Edit</button>
                    <button className="outline-btn small" disabled={traderBusyId === t.id} onClick={() => toggleTraderActive(t)}>{t.isActive ? "Deactivate" : "Activate"}</button>
                    <button className="outline-btn small danger-outline" disabled={traderBusyId === t.id} onClick={() => removeTrader(t)}><Trash2 size={13}/> Delete</button>
                  </div>
                </>}
              </div>)}
              {traders.length === 0 && !tradersLoading && <div className="empty-state"><span className="empty-icon"><UsersRound size={27}/></span><h3>No traders yet</h3><p>Add one on the left to let users subscribe.</p></div>}
            </div>
          </section>
        </section>}

        {tab === "bots" && <section className="admin-accounts-layout">
          <section className="panel admin-panel">
            <div className="section-head"><div><h2>Add a trading bot</h2><p>Set its strategy, risk, rating, country, photo, minimum allocation, and the price &amp; duration of a subscription.</p></div></div>
            <form className="admin-account-form" onSubmit={createBot}>
              <label className="input-label">Name</label>
              <input className="text-input" placeholder="e.g. BTC Grid Pro" value={botForm.name} onChange={e => setBotForm({ ...botForm, name: e.target.value })} maxLength={80}/>
              <label className="input-label">Description</label>
              <textarea className="text-input" rows={3} placeholder="Short description of what this bot does" value={botForm.description} onChange={e => setBotForm({ ...botForm, description: e.target.value })} maxLength={400}/>
              <label className="input-label">Strategy</label>
              <div className="select-wrap"><select value={botForm.strategy} onChange={e => setBotForm({ ...botForm, strategy: e.target.value as BotStrategy })}>{BOT_STRATEGIES.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
              <label className="input-label">Risk level</label>
              <div className="select-wrap"><select value={botForm.riskLevel} onChange={e => setBotForm({ ...botForm, riskLevel: e.target.value as RiskLevel })}>{RISK_LEVELS.map(r => <option key={r} value={r}>{r}</option>)}</select></div>
              <label className="input-label">Minimum allocation ($)</label>
              <input className="text-input" type="number" step="0.01" min="0" placeholder="e.g. 100.00" value={botForm.minAllocation} onChange={e => setBotForm({ ...botForm, minAllocation: e.target.value })}/>
              <label className="input-label">Subscription price</label>
              <input className="text-input" type="number" step="0.01" min="0" placeholder="e.g. 19.00" value={botForm.subscriptionAmount} onChange={e => setBotForm({ ...botForm, subscriptionAmount: e.target.value })}/>
              <label className="input-label">Subscription duration</label>
              <div className="select-wrap"><select value={botForm.subscriptionDurationDays} onChange={e => setBotForm({ ...botForm, subscriptionDurationDays: e.target.value })}>{SUBSCRIPTION_DURATION_OPTIONS.map(d => <option key={d} value={d}>{d} days</option>)}</select></div>
              <label className="input-label">Rating (0-5)</label>
              <input className="text-input" type="number" step="0.1" min="0" max="5" placeholder="e.g. 4.8" value={botForm.rating} onChange={e => setBotForm({ ...botForm, rating: e.target.value })}/>
              <label className="input-label">Country</label>
              <div className="select-wrap"><select value={botForm.country} onChange={e => setBotForm({ ...botForm, country: e.target.value })}>{COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}</select></div>
              <label className="input-label">Profile photo URL (optional)</label>
              <div className="admin-photo-row">
                {botForm.photoUrl && <img src={botForm.photoUrl} alt="" className="admin-photo-preview" onError={e => { (e.target as HTMLImageElement).style.visibility = "hidden"; }}/>}
                <input className="text-input" type="url" placeholder="https://..." value={botForm.photoUrl} onChange={e => setBotForm({ ...botForm, photoUrl: e.target.value })} maxLength={600}/>
              </div>
              <button className="primary-btn full-btn" disabled={botCreating}>{botCreating ? "Adding..." : "Add bot"}</button>
            </form>
          </section>
          <section className="panel admin-panel">
            <div className="section-head"><div><h2>Catalog</h2><p>{botRows.length} bot{botRows.length === 1 ? "" : "s"} · active subscribers shown live</p></div><button className="outline-btn small" onClick={loadBots}><RefreshCw size={13} className={botsLoading ? "spin" : ""}/> Refresh</button></div>
            <div className="admin-account-list">
              {botRows.map(b => <div className={`admin-account-item ${b.isActive ? "" : "inactive"}`} key={b.id}>
                {editingBotId === b.id ? <div className="admin-account-edit">
                  <input className="text-input" value={editBotForm.name} onChange={e => setEditBotForm({ ...editBotForm, name: e.target.value })} maxLength={80}/>
                  <textarea className="text-input" rows={3} value={editBotForm.description} onChange={e => setEditBotForm({ ...editBotForm, description: e.target.value })} maxLength={400}/>
                  <div className="select-wrap"><select value={editBotForm.strategy} onChange={e => setEditBotForm({ ...editBotForm, strategy: e.target.value as BotStrategy })}>{BOT_STRATEGIES.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
                  <div className="select-wrap"><select value={editBotForm.riskLevel} onChange={e => setEditBotForm({ ...editBotForm, riskLevel: e.target.value as RiskLevel })}>{RISK_LEVELS.map(r => <option key={r} value={r}>{r}</option>)}</select></div>
                  <input className="text-input" type="number" step="0.01" min="0" value={editBotForm.minAllocation} onChange={e => setEditBotForm({ ...editBotForm, minAllocation: e.target.value })} placeholder="Minimum allocation"/>
                  <input className="text-input" type="number" step="0.01" min="0" value={editBotForm.subscriptionAmount} onChange={e => setEditBotForm({ ...editBotForm, subscriptionAmount: e.target.value })} placeholder="Subscription price"/>
                  <div className="select-wrap"><select value={editBotForm.subscriptionDurationDays} onChange={e => setEditBotForm({ ...editBotForm, subscriptionDurationDays: e.target.value })}>{SUBSCRIPTION_DURATION_OPTIONS.map(d => <option key={d} value={d}>{d} days</option>)}</select></div>
                  <input className="text-input" type="number" step="0.1" min="0" max="5" value={editBotForm.rating} onChange={e => setEditBotForm({ ...editBotForm, rating: e.target.value })} placeholder="Rating (0-5)"/>
                  <div className="select-wrap"><select value={editBotForm.country} onChange={e => setEditBotForm({ ...editBotForm, country: e.target.value })}>{COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}</select></div>
                  <div className="admin-photo-row">
                    {editBotForm.photoUrl && <img src={editBotForm.photoUrl} alt="" className="admin-photo-preview" onError={e => { (e.target as HTMLImageElement).style.visibility = "hidden"; }}/>}
                    <input className="text-input" type="url" value={editBotForm.photoUrl} onChange={e => setEditBotForm({ ...editBotForm, photoUrl: e.target.value })} placeholder="Profile photo URL" maxLength={600}/>
                  </div>
                  <div className="admin-reject-buttons"><button className="outline-btn small" onClick={() => setEditingBotId(null)}>Cancel</button><button className="primary-btn small" disabled={botBusyId === b.id} onClick={() => saveBotEdit(b.id)}>Save</button></div>
                </div> : <>
                  <div className="admin-account-item-top"><strong>{flagEmoji(b.country)} {b.name}</strong><span className={`status-pill ${b.isActive ? "approved" : "rejected"}`}><span/>{b.isActive ? "Active" : "Hidden"}</span></div>
                  <p>{b.description}</p>
                  <p>{b.strategy} · {b.riskLevel} risk · min {money(Number(b.minAllocation))} · ★ {Number(b.rating).toFixed(1)} · {money(Number(b.subscriptionAmount))}/{b.subscriptionDurationDays}d · {b.activeSubscribers} active subscriber{b.activeSubscribers === 1 ? "" : "s"}</p>
                  <div className="admin-account-item-actions">
                    <button className="outline-btn small" onClick={() => { setEditingBotId(b.id); setEditBotForm({ name: b.name, description: b.description, strategy: b.strategy as BotStrategy, riskLevel: b.riskLevel as RiskLevel, minAllocation: b.minAllocation, subscriptionAmount: b.subscriptionAmount, subscriptionDurationDays: String(b.subscriptionDurationDays), rating: b.rating, country: b.country, photoUrl: b.photoUrl ?? "" }); }}>Edit</button>
                    <button className="outline-btn small" disabled={botBusyId === b.id} onClick={() => toggleBotActive(b)}>{b.isActive ? "Deactivate" : "Activate"}</button>
                    <button className="outline-btn small danger-outline" disabled={botBusyId === b.id} onClick={() => removeBot(b)}><Trash2 size={13}/> Delete</button>
                  </div>
                </>}
              </div>)}
              {botRows.length === 0 && !botsLoading && <div className="empty-state"><span className="empty-icon"><Bot size={27}/></span><h3>No bots yet</h3><p>Add one on the left to let users subscribe.</p></div>}
            </div>
          </section>
        </section>}

        {tab === "plans" && <section className="admin-accounts-layout">
          <section className="panel admin-panel">
            <div className="section-head"><div><h2>Add a plan</h2><p>Set its weekly price and feature list. Users subscribe for a 7-day (weekly) window.</p></div></div>
            <form className="admin-account-form" onSubmit={createPlan}>
              <label className="input-label">Name</label>
              <input className="text-input" placeholder="e.g. Pro" value={planForm.name} onChange={e => setPlanForm({ ...planForm, name: e.target.value })} maxLength={60}/>
              <label className="input-label">Description</label>
              <textarea className="text-input" rows={2} placeholder="Short tagline for this plan" value={planForm.description} onChange={e => setPlanForm({ ...planForm, description: e.target.value })} maxLength={300}/>
              <label className="input-label">Price per week ($)</label>
              <input className="text-input" type="number" step="0.01" min="0" placeholder="e.g. 15.00" value={planForm.priceWeekly} onChange={e => setPlanForm({ ...planForm, priceWeekly: e.target.value })}/>
              <label className="input-label">Features (one per line)</label>
              <textarea className="text-input" rows={5} placeholder={"Trading bot subscriptions\nCopy trading subscriptions\nAdvanced market signals"} value={planForm.features} onChange={e => setPlanForm({ ...planForm, features: e.target.value })}/>
              <label className="input-label">Sort order</label>
              <input className="text-input" type="number" step="1" placeholder="0" value={planForm.sortOrder} onChange={e => setPlanForm({ ...planForm, sortOrder: e.target.value })}/>
              <label className="checkbox-row"><input type="checkbox" checked={planForm.isFeatured} onChange={e => setPlanForm({ ...planForm, isFeatured: e.target.checked })}/> Featured (highlighted) plan</label>
              <button className="primary-btn full-btn" disabled={planCreating}>{planCreating ? "Adding..." : "Add plan"}</button>
            </form>
          </section>
          <section className="panel admin-panel">
            <div className="section-head"><div><h2>Catalog</h2><p>{planRows.length} plan{planRows.length === 1 ? "" : "s"} · active subscribers shown live</p></div><button className="outline-btn small" onClick={loadPlansAdmin}><RefreshCw size={13} className={plansLoadingAdmin ? "spin" : ""}/> Refresh</button></div>
            <div className="admin-account-list">
              {planRows.map(p => <div className={`admin-account-item ${p.isActive ? "" : "inactive"}`} key={p.id}>
                {editingPlanId === p.id ? <div className="admin-account-edit">
                  <input className="text-input" value={editPlanForm.name} onChange={e => setEditPlanForm({ ...editPlanForm, name: e.target.value })} maxLength={60}/>
                  <textarea className="text-input" rows={2} value={editPlanForm.description} onChange={e => setEditPlanForm({ ...editPlanForm, description: e.target.value })} maxLength={300}/>
                  <input className="text-input" type="number" step="0.01" min="0" value={editPlanForm.priceWeekly} onChange={e => setEditPlanForm({ ...editPlanForm, priceWeekly: e.target.value })} placeholder="Price per week"/>
                  <textarea className="text-input" rows={5} value={editPlanForm.features} onChange={e => setEditPlanForm({ ...editPlanForm, features: e.target.value })} placeholder="Features (one per line)"/>
                  <input className="text-input" type="number" step="1" value={editPlanForm.sortOrder} onChange={e => setEditPlanForm({ ...editPlanForm, sortOrder: e.target.value })} placeholder="Sort order"/>
                  <label className="checkbox-row"><input type="checkbox" checked={editPlanForm.isFeatured} onChange={e => setEditPlanForm({ ...editPlanForm, isFeatured: e.target.checked })}/> Featured (highlighted) plan</label>
                  <div className="admin-reject-buttons"><button className="outline-btn small" onClick={() => setEditingPlanId(null)}>Cancel</button><button className="primary-btn small" disabled={planBusyId === p.id} onClick={() => savePlanEdit(p.id)}>Save</button></div>
                </div> : <>
                  <div className="admin-account-item-top"><strong>{p.name}{p.isFeatured && <span style={{ marginLeft: 8, color: "var(--blue)" }}><Sparkles size={13}/></span>}</strong><span className={`status-pill ${p.isActive ? "approved" : "rejected"}`}><span/>{p.isActive ? "Active" : "Hidden"}</span></div>
                  <p>{p.description}</p>
                  <p>{money(Number(p.priceWeekly))}/week · sort {p.sortOrder} · {p.activeSubscribers} active subscriber{p.activeSubscribers === 1 ? "" : "s"}</p>
                  <p style={{ color: "#9aa4b7" }}>{p.features.join(" · ")}</p>
                  <div className="admin-account-item-actions">
                    <button className="outline-btn small" onClick={() => { setEditingPlanId(p.id); setEditPlanForm({ name: p.name, description: p.description, priceWeekly: p.priceWeekly, features: p.features.join("\n"), isFeatured: p.isFeatured, sortOrder: p.sortOrder }); }}>Edit</button>
                    <button className="outline-btn small" disabled={planBusyId === p.id} onClick={() => togglePlanActive(p)}>{p.isActive ? "Deactivate" : "Activate"}</button>
                    <button className="outline-btn small danger-outline" disabled={planBusyId === p.id} onClick={() => removePlan(p)}><Trash2 size={13}/> Delete</button>
                  </div>
                </>}
              </div>)}
              {planRows.length === 0 && !plansLoadingAdmin && <div className="empty-state"><span className="empty-icon"><Plus size={27}/></span><h3>No plans yet</h3><p>Add one on the left to let users subscribe.</p></div>}
            </div>
          </section>
        </section>}

        {tab === "broadcast" && <section className="admin-accounts-layout">
          <section className="panel admin-panel">
            <div className="section-head"><div><h2>Broadcast an announcement</h2><p>Sends an in-app notification (and email, unless the user has email notifications off) to every real user account. Demo accounts are skipped.</p></div></div>
            <form className="admin-account-form" onSubmit={sendBroadcast}>
              <label className="input-label">Title</label>
              <input className="text-input" placeholder="e.g. Scheduled maintenance tonight" value={broadcastForm.title} onChange={e => setBroadcastForm({ ...broadcastForm, title: e.target.value })} maxLength={120}/>
              <label className="input-label">Message</label>
              <textarea className="text-input" rows={5} placeholder="Write the announcement body here..." value={broadcastForm.message} onChange={e => setBroadcastForm({ ...broadcastForm, message: e.target.value })} maxLength={2000}/>
              <button className="primary-btn full-btn" disabled={broadcastSending || !broadcastForm.title.trim() || !broadcastForm.message.trim()}>{broadcastSending ? "Sending..." : "Send to all users"}</button>
              {broadcastResult && <p style={{ color: "var(--green)", fontSize: 13, marginTop: 4 }}>Sent to {broadcastResult} user{broadcastResult === 1 ? "" : "s"}.</p>}
            </form>
          </section>
        </section>}
      </main>
    </div>
    {toast && <div className={`toast ${toast.error ? "error" : ""}`}><span>{toast.error ? <X size={17}/> : <Check size={17}/>}</span>{toast.text}<button onClick={() => setToast(null)}><X size={15}/></button></div>}
  </div>;
}

function SectionHeadSimple({ title, subtitle }: { title: string; subtitle?: string }) {
  return <div className="section-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div></div>;
}
