"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, ArrowDownLeft, ArrowDownRight, ArrowLeftRight, ArrowRight, ArrowUpRight, Bell, BellRing, Bot, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock3, Copy, CreditCard, Download, Eye, EyeOff, FileText, Gift, Globe, Hourglass, History, LayoutDashboard, LockKeyhole, LogOut, Menu, MoreHorizontal, Paperclip, Plus, RefreshCw, Search, Settings2, ShieldCheck, Signal, SlidersHorizontal, Sparkles, Star, Moon, Sun, Trash2, TrendingDown, TrendingUp, UploadCloud, UserRound, UsersRound, Wallet, WandSparkles, X, XCircle, Zap } from "lucide-react";
import { assets as catalogAssets, getAsset as getCatalogAsset, type Asset, type Candle, type ChartPoint, type ChartPeriod, type MarketSnapshot } from "@/lib/market";
import { formatMoney, formatMarketPrice, formatCompactMoney } from "@/lib/currency";
import { DEPOSIT_METHODS, MAX_RECEIPT_BYTES, type DepositMethod } from "@/lib/deposits";
import { WITHDRAWAL_METHODS, type WithdrawalMethod } from "@/lib/withdrawals";
import { ORDER_TYPES, LEVERAGE_OPTIONS, MIN_MARGIN, allowedOrderTypesForSide, liquidationPrice, orderTypeLabel, positionPnl, type OrderType, type PositionSide } from "@/lib/trading";
import MarketChart from "@/components/market-chart";
import CandlestickChart from "@/components/candlestick-chart";
import RegisterModal from "@/components/register-modal";
import ForgotPasswordModal from "@/components/forgot-password-modal";
import ProfilePage from "@/components/profile-page";
import { LanguageProvider, useLanguage, readStoredLanguage } from "@/components/i18n-provider";
import { LANGUAGES, isLanguageCode, type LanguageCode } from "@/lib/i18n";
import { downloadCsv } from "@/lib/csv";
import { AVATAR_COLORS } from "@/lib/copy-trading";
import { flagEmoji, countryInfo } from "@/lib/countries";
import { ConfirmProvider, useConfirm } from "@/components/confirm-provider";
import { ThemeProvider, useTheme } from "@/components/theme-provider";

type Page = "Overview" | "Portfolio" | "Trade" | "Trading Bot" | "Markets" | "Plans" | "Copy Trading" | "Deposit" | "Withdraw" | "Trading Signals" | "Transactions" | "Trade History" | "Notifications" | "Profile";
const PAGE_VALUES: Page[] = ["Overview", "Portfolio", "Trade", "Trading Bot", "Markets", "Plans", "Copy Trading", "Deposit", "Withdraw", "Trading Signals", "Transactions", "Trade History", "Notifications", "Profile"];
const LAST_PAGE_KEY = "nexa_last_page";
type DepositAccount = { id: string; method: string; label: string; instructions: string };
type DepositRequest = { id: string; method: string; amount: string; destinationLabel: string | null; reference: string | null; note: string | null; status: string; adminNote: string | null; receiptFilename: string; createdAt: string; reviewedAt: string | null };
type WithdrawalRequest = { id: string; method: string; methodLabel: string | null; amount: string; destination: string; note: string | null; status: string; adminNote: string | null; createdAt: string; reviewedAt: string | null };
type Notification = { id: string; type?: string; title: string; message: string; readAt: string | null; createdAt: string };

// Icon + accent color per notification type, for a quick visual scan of the
// bell. Falls back to a generic sparkle for unrecognized/legacy types.
function notificationVisual(type?: string): { Icon: typeof Sparkles; color: string } {
  switch (type) {
    case "account_created": return { Icon: UserRound, color: "purple" };
    case "login": return { Icon: LockKeyhole, color: "blue" };
    case "password_changed":
    case "security_question_updated": return { Icon: ShieldCheck, color: "blue" };
    case "trade_placed":
    case "order_filled": return { Icon: ArrowLeftRight, color: "green" };
    case "order_placed": return { Icon: Clock3, color: "blue" };
    case "order_cancelled": return { Icon: XCircle, color: "red" };
    case "position_opened": return { Icon: TrendingUp, color: "green" };
    case "position_closed": return { Icon: TrendingDown, color: "blue" };
    case "position_auto_closed": return { Icon: AlertTriangle, color: "amber" };
    case "deposit_submitted":
    case "deposit_approved": return { Icon: ArrowDownLeft, color: "green" };
    case "deposit_rejected": return { Icon: XCircle, color: "red" };
    case "withdrawal_submitted":
    case "withdrawal_approved": return { Icon: ArrowUpRight, color: "blue" };
    case "withdrawal_rejected": return { Icon: XCircle, color: "red" };
    case "bot_subscribed": return { Icon: Bot, color: "purple" };
    case "bot_cancelled": return { Icon: Bot, color: "red" };
    case "copy_subscribed": return { Icon: UsersRound, color: "purple" };
    case "copy_cancelled": return { Icon: UsersRound, color: "red" };
    case "plan_subscribed": return { Icon: CreditCard, color: "purple" };
    case "plan_cancelled": return { Icon: CreditCard, color: "red" };
    case "admin_credit": return { Icon: Wallet, color: "green" };
    case "admin_debit": return { Icon: Wallet, color: "red" };
    case "profit_credit": return { Icon: TrendingUp, color: "green" };
    case "profit_debit": return { Icon: TrendingUp, color: "red" };
    case "account_status_changed": return { Icon: AlertTriangle, color: "amber" };
    case "admin_message": return { Icon: ShieldCheck, color: "purple" };
    case "referral_bonus": return { Icon: Gift, color: "green" };
    case "price_alert_triggered": return { Icon: Bell, color: "amber" };
    default: return { Icon: Sparkles, color: "purple" };
  }
}
type AppData = { user: { id: string; name: string; email: string | null; username?: string | null; isDemo: boolean; role: string; cashBalance: number; profitBalance: number; accountStatus: string; maxTradeAmount: number | null; withdrawalsBlocked: boolean; statusReason: string | null; profilePhoto?: string | null; currency?: string; language?: string }; holdings: { id: string; symbol: string; quantity: string; avgPrice: string }[]; trades: { id: string; symbol: string; side: string; quantity: string; price: string; total: string; createdAt: string; placedBy: string | null; adminNote: string | null }[]; transactions: { id: string; type: string; amount: string; description: string; createdAt: string }[]; plan: string | null; planExpiresAt: string | null; planAmount: number | null; notifications: Notification[]; unreadNotifications: number; fx?: { currency: string; rate: number; status: string; updatedAt: string | null } };
type CopyTrader = { id: string; name: string; handle: string; avatarInitials: string; avatarColor: string; focus: string; bio: string; riskLevel: string; returnPercent: string; winRate: string; subscriptionAmount: string; subscriptionDurationDays: number; rating: string; country: string; photoUrl: string | null; activeSubscribers: number; mySubscription: { expiresAt: string; amount: string } | null };
type CopySubscription = { id: string; traderId: string; traderName: string; traderHandle: string; amount: string; startedAt: string; expiresAt: string };
type TradingBot = { id: string; name: string; description: string; strategy: string; riskLevel: string; minAllocation: string; subscriptionAmount: string; subscriptionDurationDays: number; rating: string; country: string; photoUrl: string | null; activeSubscribers: number; mySubscription: { expiresAt: string; amount: string } | null };
type BotSubscription = { id: string; botProductId: string; botName: string; amount: string; startedAt: string; expiresAt: string };
type BotInstance = { id: string; botProductId: string; botName: string; strategy: string; name: string; symbol: string; amount: string; active: boolean; createdAt: string; subscriptionActive: boolean };
type Plan = { id: string; name: string; description: string; priceWeekly: string; features: string[]; isFeatured: boolean; activeSubscribers: number; mySubscription: { expiresAt: string; amount: string; isCurrent: boolean } | null };
type PlanSubscription = { id: string; planId: string; planName: string; amount: string; startedAt: string; expiresAt: string };
type Order = { id: string; symbol: string; side: "buy" | "sell"; type: OrderType; quantity: string; triggerPrice: string; status: string; filledPrice: string | null; filledAt: string | null; cancelledAt: string | null; createdAt: string };
type Position = { id: string; symbol: string; side: PositionSide; leverage: string; margin: string; quantity: string; entryPrice: string; liquidationPrice: string; takeProfitPrice: string | null; stopLossPrice: string | null; status: string; closePrice: string | null; closeReason: string | null; realizedPnl: string | null; createdAt: string; closedAt: string | null; currentPrice?: number; unrealizedPnl?: number };
const preview: AppData = {
  user: { id: "preview", name: "Alex Morgan", email: null, username: null, isDemo: true, role: "user", cashBalance: 12540.50, profitBalance: 0, accountStatus: "active", maxTradeAmount: null, withdrawalsBlocked: false, statusReason: null, profilePhoto: null, currency: "USD" },
  holdings: [{ id: "a", symbol: "BTC", quantity: "0.28450000", avgPrice: "61240.00" }, { id: "b", symbol: "ETH", quantity: "3.25000000", avgPrice: "3180.00" }, { id: "c", symbol: "SOL", quantity: "42.00000000", avgPrice: "148.50" }, { id: "d", symbol: "AVAX", quantity: "80.00000000", avgPrice: "34.20" }],
  trades: [{ id: "t1", symbol: "BTC", side: "buy", quantity: "0.08450000", price: "66421.50", total: "5612.62", createdAt: new Date(Date.now() - 7200000).toISOString(), placedBy: null, adminNote: null }, { id: "t2", symbol: "ETH", side: "buy", quantity: "1.25000000", price: "3482.20", total: "4352.75", createdAt: new Date(Date.now() - 90000000).toISOString(), placedBy: null, adminNote: null }, { id: "t3", symbol: "SOL", side: "sell", quantity: "12.00000000", price: "168.40", total: "2020.80", createdAt: new Date(Date.now() - 259200000).toISOString(), placedBy: null, adminNote: null }],
  transactions: [], plan: null, planExpiresAt: null, planAmount: null, notifications: [], unreadNotifications: 0, fx: { currency: "USD", rate: 1, status: "live", updatedAt: null }
};
const navGroups: { label: string; items: { name: Page; icon: typeof LayoutDashboard }[] }[] = [
  { label: "WORKSPACE", items: [{ name: "Overview", icon: LayoutDashboard }, { name: "Portfolio", icon: Wallet }, { name: "Trade", icon: ArrowLeftRight }, { name: "Markets", icon: Activity }] },
  { label: "GROW YOUR WEALTH", items: [{ name: "Trading Bot", icon: Bot }, { name: "Copy Trading", icon: UsersRound }, { name: "Trading Signals", icon: Signal }, { name: "Plans", icon: Sparkles }] },
  { label: "ACCOUNT", items: [{ name: "Profile", icon: UserRound }, { name: "Deposit", icon: ArrowDownLeft }, { name: "Withdraw", icon: ArrowUpRight }, { name: "Transactions", icon: CreditCard }, { name: "Trade History", icon: History }, { name: "Notifications", icon: Bell }] },
];
const fmtQty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 8 });
function AssetIcon({ asset, size = 38 }: { asset: Asset; size?: number }) {
  const [imageFailed, setImageFailed] = useState(false);
  return <span className="asset-icon" style={{ width: size, height: size, background: asset.image && !imageFailed ? "transparent" : asset.color, fontSize: size * .52 }}>
    {asset.image && !imageFailed ? <img src={asset.image} alt={`${asset.name} logo`} width={size} height={size} loading="lazy" onError={() => setImageFailed(true)}/> : asset.mark}
  </span>;
}
function Sparkline({ values, positive = true, width = 104, height = 40 }: { values: number[]; positive?: boolean; width?: number; height?: number }) {
  if (values.length < 2) return <span className="price-placeholder">—</span>;
  const min = Math.min(...values), max = Math.max(...values);
  const padding = (max - min) * .15 || Math.max(max * .02, 0.000001);
  const points = values.map((v, i) => `${i * width / (values.length - 1)},${height - 4 - ((v - min + padding) / (max - min + 2 * padding)) * (height - 8)}`).join(" ");
  return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-label="Seven day price trend"><polyline points={points} fill="none" stroke={positive ? "#16b981" : "#f05b67"} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function PageTitle({ eyebrow, title, description, children }: { eyebrow?: string; title: string; description: string; children?: React.ReactNode }) { return <div className="page-heading"><div><div className="eyebrow">{eyebrow || "YOUR WORKSPACE"}</div><h1>{title}</h1><p>{description}</p></div>{children && <div className="heading-actions">{children}</div>}</div>; }
function SectionHead({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) { return <div className="section-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>; }
function EmptyState({ icon: Icon, title, text }: { icon: typeof Bot; title: string; text: string }) { return <div className="empty-state"><span className="empty-icon"><Icon size={27}/></span><h3>{title}</h3><p>{text}</p></div>; }

export default function HomePage() {
  return <ThemeProvider><LanguageProvider><ConfirmProvider><HomePageInner /></ConfirmProvider></LanguageProvider></ThemeProvider>;
}

function HomePageInner() {
  const { t, language, setLanguage, translating } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const confirm = useConfirm();
  const [data, setData] = useState<AppData>(preview);
  // Every balance/price/P&L figure users see is converted to their chosen
  // display currency here; the ledger underneath (data.user.cashBalance,
  // trades, transactions, etc.) always stays USD. This shadows the plain
  // USD money()/marketPrice() helpers imported above so the rest of this
  // file's ~60 call sites automatically render in the user's currency.
  const currency = data.fx?.currency ?? data.user.currency ?? "USD";
  const fxRate = data.fx?.rate ?? 1;
  const money = (value: number, digits = 2) => formatMoney(value, currency, fxRate, digits);
  const marketPrice = (value: number) => formatMarketPrice(value, currency, fxRate);
  const compactMoney = (value: number) => formatCompactMoney(value, currency, fxRate);
  // Remember which tab the user was on across browser refreshes - previously
  // every reload silently dumped everyone back to Overview, which felt like
  // the whole app "started over" even though their data was untouched.
  // The initial state must stay "Overview" (matching what the server
  // renders, since localStorage isn't available during SSR) so hydration
  // doesn't mismatch; the saved tab is adopted a moment later, client-side
  // only, in the effect below.
  const [page, setPage] = useState<Page>("Overview");
  useEffect(() => {
    // Wrapped in an inner function so the setState call below isn't a direct
    // child of the effect body - functionally identical, just keeps the
    // stricter React Compiler lint rule happy the same way the rest of this
    // one-time "adopt a saved preference" pattern does elsewhere in the app.
    (() => {
      try {
        const saved = window.localStorage.getItem(LAST_PAGE_KEY);
        if (saved && (PAGE_VALUES as string[]).includes(saved)) setPage(saved as Page);
      } catch { /* ignore quota/availability errors */ }
    })();
  }, []);
  useEffect(() => {
    try { window.localStorage.setItem(LAST_PAGE_KEY, page); } catch { /* ignore quota/availability errors */ }
  }, [page]);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [period, setPeriod] = useState<ChartPeriod>("7D");
  const [market, setMarket] = useState<Omit<MarketSnapshot, "status"> & { status: MarketSnapshot["status"] | "loading" }>({ assets: [], status: "loading", updatedAt: null, source: "CoinGecko" });
  const [marketRefreshing, setMarketRefreshing] = useState(false);
  const [chartPoints, setChartPoints] = useState<ChartPoint[]>([]);
  const [chartStatus, setChartStatus] = useState<"loading" | "ready" | "error">("loading");
  const [chartRefresh, setChartRefresh] = useState(0);
  const [hideBalance, setHideBalance] = useState(false);
  const [search, setSearch] = useState("");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);

  // --- Notifications page (full history, paginated) ---
  const [allNotifications, setAllNotifications] = useState<Notification[]>([]);
  const [notifTotal, setNotifTotal] = useState(0);
  const [notifOffset, setNotifOffset] = useState(0);
  const [notifTypeFilter, setNotifTypeFilter] = useState("");
  const [notifLoading, setNotifLoading] = useState(false);
  const NOTIF_PAGE_SIZE = 20;

  // --- Watchlist ---
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [watchlistLoaded, setWatchlistLoaded] = useState(false);
  const [watchlistBusy, setWatchlistBusy] = useState<string | null>(null);

  // --- Price alerts ---
  type PriceAlertRow = { id: string; symbol: string; direction: "above" | "below"; targetPrice: string; status: string; createdAt: string; triggeredAt: string | null };
  const [priceAlerts, setPriceAlerts] = useState<{ open: PriceAlertRow[]; history: PriceAlertRow[] }>({ open: [], history: [] });
  const [priceAlertsLoaded, setPriceAlertsLoaded] = useState(false);
  const [alertDirection, setAlertDirection] = useState<"above" | "below">("above");
  const [alertTargetPrice, setAlertTargetPrice] = useState("");
  const [creatingAlert, setCreatingAlert] = useState(false);
  const [cancellingAlertId, setCancellingAlertId] = useState<string | null>(null);

  // --- Trade History / Transactions filters ---
  const [txSearch, setTxSearch] = useState("");
  const [txTypeFilter, setTxTypeFilter] = useState("all");
  const [historySearch, setHistorySearch] = useState(""); // shared symbol search box across the Trades/Orders/Positions tabs on Trade History
  const changeLanguage = async (code: LanguageCode) => {
    setLanguage(code);
    setLanguageMenuOpen(false);
    if (!data.user.isDemo) {
      try {
        await fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "updateProfile", language: code }) });
      } catch { /* non-critical: the local choice still applies immediately */ }
    }
  };
  const [authMode, setAuthMode] = useState<"login" | "register" | null>(null);
  const [authIdentifier, setAuthIdentifier] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false);
  // Demo/guest accounts can look around freely, but any action that would
  // actually create a lasting record (trade, deposit, withdrawal,
  // subscription) prompts sign-up instead of silently going through - this
  // is the client-side half of the gate; src/lib/accounts.ts enforces the
  // same rule server-side so it can't be bypassed.
  const [demoGateOpen, setDemoGateOpen] = useState(false);
  const requireRealAccount = (): boolean => {
    if (data.user.isDemo) { setDemoGateOpen(true); return false; }
    return true;
  };
  // Time-based nudge: a demo visitor who just browses (never hits one of the
  // action gates above) still sees the sign-up prompt once after a couple of
  // minutes, rather than being able to explore in demo mode indefinitely
  // without ever being invited to create an account.
  useEffect(() => {
    if (!ready || !data.user.isDemo) return;
    const timer = window.setTimeout(() => setDemoGateOpen(true), 2 * 60 * 1000);
    return () => window.clearTimeout(timer);
  }, [ready, data.user.isDemo]);
  const [symbol, setSymbol] = useState("BTC");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [tradeAmount, setTradeAmount] = useState("");
  const [depositMethod, setDepositMethod] = useState<DepositMethod>("crypto");
  const [depositAccounts, setDepositAccounts] = useState<DepositAccount[]>([]);
  const [depositAccountsLoaded, setDepositAccountsLoaded] = useState(false);
  const [depositAccountId, setDepositAccountId] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [depositReference, setDepositReference] = useState("");
  const [depositNote, setDepositNote] = useState("");
  const [receiptFile, setReceiptFile] = useState<{ name: string; type: string; size: number; dataUrl: string } | null>(null);
  const [receiptError, setReceiptError] = useState("");
  const [depositSubmitting, setDepositSubmitting] = useState(false);
  const [myDeposits, setMyDeposits] = useState<DepositRequest[]>([]);
  const [withdrawalMethod, setWithdrawalMethod] = useState<WithdrawalMethod>("crypto");
  const [withdrawalMethodLabelInput, setWithdrawalMethodLabelInput] = useState("");
  const [withdrawalAmount, setWithdrawalAmount] = useState("");
  const [withdrawalDestination, setWithdrawalDestination] = useState("");
  const [withdrawalNote, setWithdrawalNote] = useState("");
  const [withdrawalSubmitting, setWithdrawalSubmitting] = useState(false);
  const [myWithdrawals, setMyWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [botAmount, setBotAmount] = useState("500");
  const [botStrategy, setBotStrategy] = useState("DCA");
  const [botSymbol, setBotSymbol] = useState("BTC");
  const [copyTraders, setCopyTraders] = useState<CopyTrader[]>([]);
  const [copyTradersLoaded, setCopyTradersLoaded] = useState(false);
  const [mySubscriptions, setMySubscriptions] = useState<CopySubscription[]>([]);
  const [subscribingId, setSubscribingId] = useState("");
  const [tradingBots, setTradingBots] = useState<TradingBot[]>([]);
  const [tradingBotsLoaded, setTradingBotsLoaded] = useState(false);
  const [botSubHistory, setBotSubHistory] = useState<BotSubscription[]>([]);
  const [botInstances, setBotInstances] = useState<BotInstance[]>([]);
  const [botSubscribingId, setBotSubscribingId] = useState("");
  const [configuringBotId, setConfiguringBotId] = useState<string | null>(null);
  const [newInstanceSymbol, setNewInstanceSymbol] = useState("BTC");
  const [newInstanceAmount, setNewInstanceAmount] = useState("");
  const [newInstanceName, setNewInstanceName] = useState("");
  const [instanceCreating, setInstanceCreating] = useState(false);
  const [instanceBusyId, setInstanceBusyId] = useState("");
  const [plansCatalog, setPlansCatalog] = useState<Plan[]>([]);
  const [plansLoaded, setPlansLoaded] = useState(false);
  const [planSubHistory, setPlanSubHistory] = useState<PlanSubscription[]>([]);
  const [planSubscribingId, setPlanSubscribingId] = useState("");
  const [marketTab, setMarketTab] = useState("All assets");
  const [historyTab, setHistoryTab] = useState("All");
  const [historySection, setHistorySection] = useState<"Trades" | "Orders" | "Positions">("Trades");
  const [tradeMode, setTradeMode] = useState<"Spot" | "Margin">("Spot");
  const [orderType, setOrderType] = useState<OrderType>("market");
  const [orderPrice, setOrderPrice] = useState("");
  const [myOrders, setMyOrders] = useState<{ open: Order[]; history: Order[] }>({ open: [], history: [] });
  const [ordersLoaded, setOrdersLoaded] = useState(false);
  const [cancellingOrderId, setCancellingOrderId] = useState("");
  const [positionSide, setPositionSide] = useState<PositionSide>("long");
  const [leverageX, setLeverageX] = useState<number>(10);
  const [marginAmount, setMarginAmount] = useState("");
  const [positionTP, setPositionTP] = useState("");
  const [positionSL, setPositionSL] = useState("");
  const [myPositions, setMyPositions] = useState<{ open: Position[]; history: Position[] }>({ open: [], history: [] });
  const [positionsLoaded, setPositionsLoaded] = useState(false);
  const [openingPosition, setOpeningPosition] = useState(false);
  const [closingPositionId, setClosingPositionId] = useState("");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [candleStatus, setCandleStatus] = useState<"loading" | "ready" | "error">("loading");

  const notify = (text: string, error = false) => { setToast({ text, error }); setTimeout(() => setToast(null), 4500); };
  const refresh = async () => {
    try {
      const response = await fetch("/api/app", { cache: "no-store" });
      if (response.status === 403) {
        const result = await response.json().catch(() => ({}));
        if (result.locked) { notify(result.error || "This account has been locked.", true); return void refresh(); }
      }
      if (!response.ok) throw new Error("Could not load your account");
      setData(await response.json());
      setReady(true);
    } catch { notify("Could not connect to your workspace. Please refresh.", true); }
  };
  useEffect(() => { void refresh(); }, []);
  // A signed-in user's saved language preference (set from their Profile
  // page or this selector on another device) is adopted once, but only if
  // this browser doesn't already have its own explicit local choice -
  // language is never auto-detected, only ever remembered from a past
  // manual pick (here or on the profile page).
  useEffect(() => {
    if (data.user.language && isLanguageCode(data.user.language) && !readStoredLanguage()) {
      setLanguage(data.user.language as LanguageCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.user.language]);
  const refreshMarket = async () => {
    setMarketRefreshing(true);
    try {
      const response = await fetch("/api/market", { cache: "no-store" });
      if (!response.ok) throw new Error("Market request failed");
      const snapshot = await response.json() as MarketSnapshot;
      if (!Array.isArray(snapshot.assets)) throw new Error("Invalid market data");
      setMarket(previous => snapshot.status === "unavailable" && previous.assets.length ? { ...previous, status: "stale" } : snapshot);
    } catch {
      setMarket(previous => ({ ...previous, status: previous.assets.length ? "stale" : "unavailable" }));
    } finally { setMarketRefreshing(false); }
  };
  useEffect(() => {
    void refreshMarket();
    const interval = window.setInterval(() => { if (!document.hidden) void refreshMarket(); }, 60000);
    const onVisible = () => { if (!document.hidden) void refreshMarket(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", onVisible); };
  }, []);
  const holdingsKey = data.holdings.map(h => `${h.symbol}:${h.quantity}`).join(",") + `:${data.user.cashBalance}:${data.user.profitBalance}`;
  useEffect(() => {
    if (!ready || page !== "Overview") return;
    const controller = new AbortController();
    setChartPoints([]);
    setChartStatus("loading");
    const query = new URLSearchParams({ period, mode: "portfolio" });
    fetch(`/api/market/chart?${query}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => { if (!response.ok) throw new Error("Chart unavailable"); return response.json(); })
      .then((result: { points?: ChartPoint[] }) => {
        if (!Array.isArray(result.points) || result.points.length < 2) throw new Error("Chart unavailable");
        setChartPoints(result.points);
        setChartStatus("ready");
      })
      .catch(() => { if (!controller.signal.aborted) setChartStatus("error"); });
    return () => controller.abort();
  }, [page, period, symbol, ready, data.user.id, holdingsKey, chartRefresh]);
  useEffect(() => {
    if (!ready || page !== "Trade") return;
    const controller = new AbortController();
    setCandles([]);
    setCandleStatus("loading");
    const query = new URLSearchParams({ period, symbol });
    fetch(`/api/market/candles?${query}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => { if (!response.ok) throw new Error("Candles unavailable"); return response.json(); })
      .then((result: { candles?: Candle[] }) => {
        if (!Array.isArray(result.candles) || result.candles.length < 2) throw new Error("Candles unavailable");
        setCandles(result.candles);
        setCandleStatus("ready");
      })
      .catch(() => { if (!controller.signal.aborted) setCandleStatus("error"); });
    return () => controller.abort();
  }, [page, period, symbol, ready, chartRefresh]);
  const loadMyOrders = async () => { try { const res = await fetch("/api/orders", { cache: "no-store" }); if (!res.ok) return; const result = await res.json(); setMyOrders({ open: result.open ?? [], history: result.history ?? [] }); } catch { /* ignore */ } finally { setOrdersLoaded(true); } };
  const loadMyPositions = async () => { try { const res = await fetch("/api/positions", { cache: "no-store" }); if (!res.ok) return; const result = await res.json(); setMyPositions({ open: result.open ?? [], history: result.history ?? [] }); } catch { /* ignore */ } finally { setPositionsLoaded(true); } };
  useEffect(() => { if (ready && (page === "Trade" || page === "Trade History")) { void loadMyOrders(); void loadMyPositions(); } }, [ready, page]);
  const loadMyDeposits = async () => { try { const res = await fetch("/api/deposits", { cache: "no-store" }); if (!res.ok) return; const result = await res.json(); if (Array.isArray(result.requests)) setMyDeposits(result.requests); } catch { /* ignore */ } };
  useEffect(() => {
    if (!ready || page !== "Deposit") return;
    void loadMyDeposits();
    if (!depositAccountsLoaded) fetch("/api/deposit-accounts", { cache: "no-store" }).then(r => r.json()).then(result => { if (Array.isArray(result.accounts)) setDepositAccounts(result.accounts); setDepositAccountsLoaded(true); }).catch(() => setDepositAccountsLoaded(true));
  }, [ready, page, depositAccountsLoaded]);
  const methodAccounts = depositAccounts.filter(a => a.method === depositMethod);
  useEffect(() => { setDepositAccountId(methodAccounts[0]?.id ?? ""); }, [depositMethod, depositAccounts.length]);
  const handleReceiptFile = (file: File | null) => {
    setReceiptError("");
    if (!file) { setReceiptFile(null); return; }
    const okType = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"].includes(file.type);
    if (!okType) { setReceiptError("Upload a JPG, PNG, WEBP, HEIC, or PDF file."); setReceiptFile(null); return; }
    if (file.size > MAX_RECEIPT_BYTES) { setReceiptError(`File is too large. Max size is ${(MAX_RECEIPT_BYTES / (1024 * 1024)).toFixed(0)}MB.`); setReceiptFile(null); return; }
    const reader = new FileReader();
    reader.onload = () => setReceiptFile({ name: file.name, type: file.type, size: file.size, dataUrl: String(reader.result) });
    reader.onerror = () => setReceiptError("Could not read that file. Please try again.");
    reader.readAsDataURL(file);
  };
  const submitDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requireRealAccount()) return;
    if (depositSubmitting) return;
    if (methodAccounts.length && !depositAccountId) return notify("Select a destination account.", true);
    if (!receiptFile) return notify("Attach a receipt or screenshot of your payment.", true);
    const amount = Number(depositAmount);
    if (!amount || amount <= 0) return notify("Enter a valid deposit amount.", true);
    if (!(await confirm({ title: "Submit this deposit request?", message: `We'll review your ${money(amount)} deposit and credit it to your balance once your payment is verified.`, confirmLabel: "Submit request" }))) return;
    setDepositSubmitting(true);
    try {
      const res = await fetch("/api/deposits", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ method: depositMethod, amount, depositAccountId: depositAccountId || null, reference: depositReference, note: depositNote, receipt: receiptFile.dataUrl, receiptFilename: receiptFile.name }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Something went wrong");
      notify(result.message || "Deposit request submitted");
      setDepositAmount(""); setDepositReference(""); setDepositNote(""); setReceiptFile(null);
      await loadMyDeposits();
    } catch (error) { notify(error instanceof Error ? error.message : "Something went wrong", true); } finally { setDepositSubmitting(false); }
  };
  const action = async (body: Record<string, unknown>) => { if (loading) return false; setLoading(true); try { const res = await fetch("/api/app", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const result = await res.json(); if (!res.ok) throw new Error(result.error || "Something went wrong"); notify(result.message || "Done successfully"); await refresh(); return true; } catch (error) { notify(error instanceof Error ? error.message : "Something went wrong", true); return false; } finally { setLoading(false); } };
  const authenticate = async (e: React.FormEvent) => { e.preventDefault(); setLoading(true); try { const res = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "login", identifier: authIdentifier, password: authPassword }) }); const result = await res.json(); if (!res.ok) throw new Error(result.error); setAuthMode(null); setAuthPassword(""); setAuthIdentifier(""); setPage("Overview"); await refresh(); notify("Welcome back!"); } catch (error) { notify(error instanceof Error ? error.message : "Authentication failed", true); } finally { setLoading(false); } };
  const handleRegistered = async () => { setAuthMode(null); setPage("Overview"); await refresh(); notify("Welcome to NexaTrade! Your account is ready."); };
  const logout = async () => { if (!(await confirm({ title: "Sign out?" }))) return; await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "logout" }) }); setProfileOpen(false); await refresh(); setPage("Overview"); notify("Switched to a fresh demo workspace"); };
  const toggleNotifications = () => {
    const opening = !notificationsOpen;
    setNotificationsOpen(opening);
    setProfileOpen(false);
    if (opening && data.unreadNotifications > 0) { fetch("/api/notifications", { method: "POST" }).then(() => refresh()).catch(() => {}); }
  };
  const timeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };
  const go = (p: Page) => { setPage(p); setMobileMenu(false); setProfileOpen(false); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const assets: Asset[] = market.assets.length ? market.assets : catalogAssets;
  const getAsset = (ticker: string) => assets.find(a => a.symbol === ticker) ?? getCatalogAsset(ticker);
  const hasQuotes = market.assets.length === catalogAssets.length && market.assets.every(a => a.price > 0);
  const quoteLive = market.status === "live" && hasQuotes && !!market.updatedAt && Date.now() - Date.parse(market.updatedAt) < 10 * 60 * 1000;
  const currentAsset = getAsset(symbol)!;
  const portfolioValue = hasQuotes ? data.holdings.reduce((sum, h) => sum + Number(h.quantity) * (getAsset(h.symbol)?.price ?? 0), 0) : NaN;
  const totalBalance = hasQuotes ? portfolioValue + data.user.cashBalance + data.user.profitBalance : NaN;
  const pnl = hasQuotes ? data.holdings.reduce((sum, h) => sum + Number(h.quantity) * ((getAsset(h.symbol)?.price ?? 0) - Number(h.avgPrice)), 0) : NaN;
  const costBasis = data.holdings.reduce((sum, h) => sum + Number(h.quantity) * Number(h.avgPrice), 0);
  const pnlPercent = hasQuotes && costBasis > 0 ? pnl / costBasis * 100 : 0;
  const periodDelta = chartStatus === "ready" && chartPoints.length > 1 && hasQuotes ? totalBalance - chartPoints[0].price : null;
  const periodPercent = periodDelta !== null && chartPoints[0].price > 0 ? periodDelta / chartPoints[0].price * 100 : null;
  const filteredAssets = assets.filter(a => (marketTab === "Gainers" ? a.price > 0 && a.change > 0 : marketTab === "Losers" ? a.price > 0 && a.change < 0 : marketTab === "Watchlist" ? watchlist.includes(a.symbol) : true) && (a.symbol.toLowerCase().includes(search.toLowerCase()) || a.name.toLowerCase().includes(search.toLowerCase())));
  const signals = market.assets.filter(a => a.price > 0).slice(0, 4);
  const allocations = data.holdings.map((h, i) => ({ symbol: h.symbol, value: Number(h.quantity) * (getAsset(h.symbol)?.price ?? 0), color: ["#3936ee", "#8175f7", "#28b7a4", "#f7b846", "#ec6676", "#4f86ec"][i % 6] })).filter(a => a.value > 0);
  let allocationCursor = 0;
  const allocationBackground = hasQuotes && portfolioValue > 0 ? `conic-gradient(${allocations.map(item => { const start = allocationCursor; allocationCursor += item.value / portfolioValue * 100; return `${item.color} ${start}% ${allocationCursor}%`; }).join(", ")})` : "#edf0f6";
  const asOf = market.updatedAt ? new Date(market.updatedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : null;
  const firstName = data.user.name.split(" ")[0];
  const date = useMemo(() => new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date()), []);
  const placeSpotOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requireRealAccount()) return;
    if (orderType === "market") {
      if (!quoteLive || currentAsset.price <= 0) return notify("Live quotes are unavailable. Paper trading is paused.", true);
      const usd = Number(tradeAmount);
      if (!usd || usd <= 0) return notify("Enter a valid USD amount", true);
      const quantity = Math.floor((usd / currentAsset.price) * 1e8) / 1e8;
      if (!quantity) return notify("Amount is too small for this asset", true);
      if (!(await confirm({ title: `${side === "buy" ? "Buy" : "Sell"} ${symbol}?`, message: `This will ${side} ${quantity} ${symbol} (~${money(usd)}) at the live market price.`, confirmLabel: side === "buy" ? "Buy now" : "Sell now" }))) return;
      const ok = await action({ action: "trade", symbol, side, quantity });
      if (ok) { setTradeAmount(""); void refreshMarket(); void loadMyOrders(); }
      return;
    }
    if (!quoteLive) return notify("Live quotes are unavailable. Paper trading is paused.", true);
    const price = Number(orderPrice);
    if (!price || price <= 0) return notify("Enter a valid price.", true);
    const usd = Number(tradeAmount);
    if (!usd || usd <= 0) return notify("Enter a valid USD amount", true);
    const quantity = Math.floor((usd / price) * 1e8) / 1e8;
    if (!quantity) return notify("Amount is too small for this asset", true);
    if (loading) return;
    if (!(await confirm({ title: `Place ${orderTypeLabel(orderType)} order?`, message: `${side === "buy" ? "Buy" : "Sell"} ${quantity} ${symbol} (~${money(usd)}) when the price reaches $${price.toLocaleString()}. You can cancel it anytime before it fills.`, confirmLabel: "Place order" }))) return;
    setLoading(true);
    try {
      const res = await fetch("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol, side, type: orderType, quantity, triggerPrice: price }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Something went wrong");
      notify(result.message || "Order placed");
      setTradeAmount(""); setOrderPrice("");
      await Promise.all([loadMyOrders(), refresh()]);
    } catch (error) { notify(error instanceof Error ? error.message : "Something went wrong", true); } finally { setLoading(false); }
  };
  const cancelOrder = async (id: string) => {
    if (cancellingOrderId) return;
    if (!(await confirm({ title: "Cancel this order?", message: "This pending order will be removed and won't fill. This can't be undone." }))) return;
    setCancellingOrderId(id);
    try {
      const res = await fetch(`/api/orders/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel" }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Something went wrong");
      notify(result.message || "Order cancelled");
      await loadMyOrders();
    } catch (error) { notify(error instanceof Error ? error.message : "Something went wrong", true); } finally { setCancellingOrderId(""); }
  };
  const openPosition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requireRealAccount()) return;
    if (!quoteLive) return notify("Live quotes are unavailable. Paper trading is paused.", true);
    const margin = Number(marginAmount);
    if (!margin || margin < MIN_MARGIN) return notify(`Enter a margin amount of at least $${MIN_MARGIN}.`, true);
    if (openingPosition) return;
    if (!(await confirm({ title: `Open ${leverageX}x ${positionSide} position?`, message: `Posting ${money(margin)} margin on ${symbol} at ${leverageX}x leverage. You can lose up to your full margin if the price moves against you, including automatic liquidation.`, confirmLabel: "Open position", danger: leverageX >= 20 }))) return;
    setOpeningPosition(true);
    try {
      const res = await fetch("/api/positions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol, side: positionSide, leverage: leverageX, margin, takeProfitPrice: positionTP || null, stopLossPrice: positionSL || null }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Something went wrong");
      notify(result.message || "Position opened");
      setMarginAmount(""); setPositionTP(""); setPositionSL("");
      await Promise.all([loadMyPositions(), refresh()]);
    } catch (error) { notify(error instanceof Error ? error.message : "Something went wrong", true); } finally { setOpeningPosition(false); }
  };
  const quickTrade = async (e: React.FormEvent) => { e.preventDefault(); if (!requireRealAccount()) return; if (!quoteLive || currentAsset.price <= 0) return notify("Live quotes are unavailable. Paper trading is paused.", true); const usd = Number(tradeAmount); if (!usd || usd <= 0) return notify("Enter a valid USD amount", true); const quantity = Math.floor((usd / currentAsset.price) * 1e8) / 1e8; if (!quantity) return notify("Amount is too small for this asset", true); if (!(await confirm({ title: `${side === "buy" ? "Buy" : "Sell"} ${symbol}?`, message: `This will ${side} ${quantity} ${symbol} (~${money(usd)}) at the live market price.`, confirmLabel: side === "buy" ? "Buy now" : "Sell now" }))) return; const ok = await action({ action: "trade", symbol, side, quantity }); if (ok) { setTradeAmount(""); void refreshMarket(); } };
  const closePosition = async (id: string) => {
    if (closingPositionId) return;
    if (!(await confirm({ title: "Close this position?", message: "This realizes its current profit or loss immediately and returns remaining margin to your cash balance." }))) return;
    setClosingPositionId(id);
    try {
      const res = await fetch(`/api/positions/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "close" }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Something went wrong");
      notify(result.message || "Position closed");
      await Promise.all([loadMyPositions(), refresh()]);
    } catch (error) { notify(error instanceof Error ? error.message : "Something went wrong", true); } finally { setClosingPositionId(""); }
  };
  const loadMyWithdrawals = async () => { try { const res = await fetch("/api/withdrawals", { cache: "no-store" }); if (!res.ok) return; const result = await res.json(); if (Array.isArray(result.requests)) setMyWithdrawals(result.requests); } catch { /* ignore */ } };
  useEffect(() => { if (ready && page === "Withdraw") void loadMyWithdrawals(); }, [ready, page]);

  // --- Watchlist ---
  const loadWatchlist = async () => { try { const res = await fetch("/api/watchlist", { cache: "no-store" }); if (!res.ok) return; const result = await res.json(); if (Array.isArray(result.symbols)) setWatchlist(result.symbols); } catch { /* ignore */ } finally { setWatchlistLoaded(true); } };
  useEffect(() => { if (ready && !data.user.isDemo) void loadWatchlist(); }, [ready, data.user.isDemo]);
  const toggleWatchlist = async (sym: string) => {
    if (!requireRealAccount()) return;
    if (watchlistBusy) return;
    const starred = watchlist.includes(sym);
    if (!(await confirm({ title: starred ? `Remove ${sym} from your watchlist?` : `Add ${sym} to your watchlist?` }))) return;
    setWatchlistBusy(sym);
    try {
      if (starred) {
        await fetch(`/api/watchlist?symbol=${encodeURIComponent(sym)}`, { method: "DELETE" });
        setWatchlist((w) => w.filter((s) => s !== sym));
      } else {
        await fetch("/api/watchlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol: sym }) });
        setWatchlist((w) => [...w, sym]);
      }
    } catch { notify("Something went wrong", true); } finally { setWatchlistBusy(null); }
  };

  // --- Price alerts ---
  const loadPriceAlerts = async () => { try { const res = await fetch("/api/price-alerts", { cache: "no-store" }); if (!res.ok) return; const result = await res.json(); setPriceAlerts({ open: result.open ?? [], history: result.history ?? [] }); } catch { /* ignore */ } finally { setPriceAlertsLoaded(true); } };
  useEffect(() => { if (ready && page === "Trade") void loadPriceAlerts(); }, [ready, page]);
  const createPriceAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requireRealAccount()) return;
    const target = Number(alertTargetPrice);
    if (!target || target <= 0) return notify("Enter a valid target price.", true);
    if (creatingAlert) return;
    if (!(await confirm({ title: "Create this price alert?", message: `We'll notify you the moment ${symbol} goes ${alertDirection} $${target.toLocaleString()}.`, confirmLabel: "Create alert" }))) return;
    setCreatingAlert(true);
    try {
      const res = await fetch("/api/price-alerts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol, direction: alertDirection, targetPrice: target }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Something went wrong");
      notify(result.message || "Price alert created");
      setAlertTargetPrice("");
      await loadPriceAlerts();
    } catch (error) { notify(error instanceof Error ? error.message : "Something went wrong", true); } finally { setCreatingAlert(false); }
  };
  const cancelPriceAlert = async (id: string) => {
    if (cancellingAlertId) return;
    if (!(await confirm({ title: "Cancel this price alert?" }))) return;
    setCancellingAlertId(id);
    try {
      const res = await fetch(`/api/price-alerts/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel" }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Something went wrong");
      await loadPriceAlerts();
    } catch (error) { notify(error instanceof Error ? error.message : "Something went wrong", true); } finally { setCancellingAlertId(null); }
  };

  // --- Full Notifications page ---
  const loadAllNotifications = async (offset: number, type: string) => {
    setNotifLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(NOTIF_PAGE_SIZE), offset: String(offset) });
      if (type) params.set("type", type);
      const res = await fetch(`/api/notifications?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) return;
      const result = await res.json();
      setAllNotifications(result.notifications ?? []);
      setNotifTotal(result.total ?? 0);
      setNotifOffset(offset);
    } catch { /* ignore */ } finally { setNotifLoading(false); }
  };
  useEffect(() => { if (ready && page === "Notifications") { void loadAllNotifications(0, notifTypeFilter); if (data.unreadNotifications > 0) fetch("/api/notifications", { method: "POST" }).then(() => refresh()).catch(() => {}); } }, [ready, page]);
  const markOneNotificationRead = async (id: string) => {
    if (!(await confirm({ title: "Mark this notification as read?" }))) return;
    try { await fetch(`/api/notifications/${id}`, { method: "PATCH" }); } catch { /* ignore */ }
    setAllNotifications((rows) => rows.map((n) => n.id === id ? { ...n, readAt: n.readAt ?? new Date().toISOString() } : n));
  };
  const markAllNotificationsRead = async () => {
    if (!(await confirm({ title: "Mark all notifications as read?" }))) return;
    await fetch("/api/notifications", { method: "POST" });
    refresh();
    loadAllNotifications(0, notifTypeFilter);
  };
  const loadCopyTraders = async () => { try { const res = await fetch("/api/copy-traders", { cache: "no-store" }); if (!res.ok) return; const result = await res.json(); if (Array.isArray(result.traders)) setCopyTraders(result.traders); } catch { /* ignore */ } finally { setCopyTradersLoaded(true); } };
  const loadMySubscriptions = async () => { try { const res = await fetch("/api/copy-subscriptions", { cache: "no-store" }); if (!res.ok) return; const result = await res.json(); if (Array.isArray(result.subscriptions)) setMySubscriptions(result.subscriptions); } catch { /* ignore */ } };
  useEffect(() => { if (ready && page === "Copy Trading") { void loadCopyTraders(); void loadMySubscriptions(); } }, [ready, page]);
  const subscribeToTrader = async (trader: CopyTrader) => {
    if (!requireRealAccount()) return;
    if (subscribingId) return;
    if (!(await confirm({ title: `Subscribe to ${trader.name}?`, message: `${Number(trader.subscriptionAmount) > 0 ? `${money(Number(trader.subscriptionAmount))} will be charged from your cash balance for a` : "This starts a"} 7-day subscription.`, confirmLabel: "Subscribe" }))) return;
    setSubscribingId(trader.id);
    try {
      const res = await fetch("/api/copy-subscriptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ traderId: trader.id }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Something went wrong");
      notify(result.message || `Subscribed to ${trader.name}`);
      await Promise.all([loadCopyTraders(), loadMySubscriptions(), refresh()]);
    } catch (error) { notify(error instanceof Error ? error.message : "Something went wrong", true); } finally { setSubscribingId(""); }
  };
  const daysLeft = (expiresAt: string) => Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000));
  const loadTradingBots = async () => { try { const res = await fetch("/api/bots", { cache: "no-store" }); if (!res.ok) return; const result = await res.json(); if (Array.isArray(result.bots)) setTradingBots(result.bots); } catch { /* ignore */ } finally { setTradingBotsLoaded(true); } };
  const loadBotSubHistory = async () => { try { const res = await fetch("/api/bot-subscriptions", { cache: "no-store" }); if (!res.ok) return; const result = await res.json(); if (Array.isArray(result.subscriptions)) setBotSubHistory(result.subscriptions); } catch { /* ignore */ } };
  const loadBotInstances = async () => { try { const res = await fetch("/api/bot-instances", { cache: "no-store" }); if (!res.ok) return; const result = await res.json(); if (Array.isArray(result.instances)) setBotInstances(result.instances); } catch { /* ignore */ } };
  useEffect(() => { if (ready && page === "Trading Bot") { void loadTradingBots(); void loadBotSubHistory(); void loadBotInstances(); } }, [ready, page]);
  const subscribeToBot = async (bot: TradingBot) => {
    if (!requireRealAccount()) return;
    if (botSubscribingId) return;
    if (!(await confirm({ title: `Subscribe to ${bot.name}?`, message: `${Number(bot.subscriptionAmount) > 0 ? `${money(Number(bot.subscriptionAmount))} will be charged from your cash balance for a` : "This starts a"} 7-day subscription.`, confirmLabel: "Subscribe" }))) return;
    setBotSubscribingId(bot.id);
    try {
      const res = await fetch("/api/bot-subscriptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ botProductId: bot.id }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Something went wrong");
      notify(result.message || `Subscribed to ${bot.name}`);
      await Promise.all([loadTradingBots(), loadBotSubHistory(), refresh()]);
    } catch (error) { notify(error instanceof Error ? error.message : "Something went wrong", true); } finally { setBotSubscribingId(""); }
  };
  const openConfigureBot = (bot: TradingBot) => {
    setConfiguringBotId(configuringBotId === bot.id ? null : bot.id);
    setNewInstanceSymbol("BTC");
    setNewInstanceAmount(bot.minAllocation);
    setNewInstanceName("");
  };
  const createBotInstance = async (bot: TradingBot) => {
    if (instanceCreating) return;
    const amount = Number(newInstanceAmount);
    if (!amount || amount < Number(bot.minAllocation)) return notify(`Enter an allocation of at least ${money(Number(bot.minAllocation))}.`, true);
    if (!(await confirm({ title: `Configure this ${bot.name} instance?`, message: `It will track ${newInstanceSymbol} with an allocation of ${money(amount)}.`, confirmLabel: "Configure bot" }))) return;
    setInstanceCreating(true);
    try {
      const res = await fetch("/api/bot-instances", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ botProductId: bot.id, symbol: newInstanceSymbol, amount, name: newInstanceName }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Something went wrong");
      notify(result.message || "Bot configured");
      setConfiguringBotId(null);
      setNewInstanceName("");
      await loadBotInstances();
    } catch (error) { notify(error instanceof Error ? error.message : "Something went wrong", true); } finally { setInstanceCreating(false); }
  };
  const toggleBotInstance = async (instance: BotInstance) => {
    if (instanceBusyId) return;
    if (!(await confirm({ title: instance.active ? `Pause ${instance.name}?` : `Resume ${instance.name}?` }))) return;
    setInstanceBusyId(instance.id);
    try {
      const res = await fetch(`/api/bot-instances/${instance.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !instance.active }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Something went wrong");
      await loadBotInstances();
    } catch (error) { notify(error instanceof Error ? error.message : "Something went wrong", true); } finally { setInstanceBusyId(""); }
  };
  const removeBotInstance = async (instance: BotInstance) => {
    if (instanceBusyId) return;
    if (!(await confirm({ title: `Remove ${instance.name}?`, message: "This only deletes the configuration, not your bot subscription.", confirmLabel: "Remove", danger: true }))) return;
    setInstanceBusyId(instance.id);
    try {
      const res = await fetch(`/api/bot-instances/${instance.id}`, { method: "DELETE" });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Something went wrong");
      await loadBotInstances();
    } catch (error) { notify(error instanceof Error ? error.message : "Something went wrong", true); } finally { setInstanceBusyId(""); }
  };
  const loadPlans = async () => { try { const res = await fetch("/api/plans", { cache: "no-store" }); if (!res.ok) return; const result = await res.json(); if (Array.isArray(result.plans)) setPlansCatalog(result.plans); } catch { /* ignore */ } finally { setPlansLoaded(true); } };
  const loadPlanSubHistory = async () => { try { const res = await fetch("/api/plan-subscriptions", { cache: "no-store" }); if (!res.ok) return; const result = await res.json(); if (Array.isArray(result.subscriptions)) setPlanSubHistory(result.subscriptions); } catch { /* ignore */ } };
  useEffect(() => { if (ready && page === "Plans") { void loadPlans(); void loadPlanSubHistory(); } }, [ready, page]);
  const subscribeToPlan = async (plan: Plan) => {
    if (!requireRealAccount()) return;
    if (planSubscribingId) return;
    if (!(await confirm({ title: `Switch to the ${plan.name} plan?`, message: `${Number(plan.priceWeekly) > 0 ? `${money(Number(plan.priceWeekly))} will be charged from your cash balance for a` : "This starts a"} 7-day subscription.`, confirmLabel: "Confirm" }))) return;
    setPlanSubscribingId(plan.id);
    try {
      const res = await fetch("/api/plan-subscriptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId: plan.id }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Something went wrong");
      notify(result.message || `Subscribed to the ${plan.name} plan for 7 days`);
      await Promise.all([loadPlans(), loadPlanSubHistory(), refresh()]);
    } catch (error) { notify(error instanceof Error ? error.message : "Something went wrong", true); } finally { setPlanSubscribingId(""); }
  };
  const submitWithdrawal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requireRealAccount()) return;
    if (withdrawalSubmitting) return;
    const amount = Number(withdrawalAmount);
    if (!amount || amount <= 0) return notify("Enter a valid withdrawal amount.", true);
    if (amount > data.user.cashBalance) return notify("You can't request more than your available balance.", true);
    if (withdrawalDestination.trim().length < 3) return notify("Tell us where to send your payout.", true);
    if (withdrawalMethod === "other" && withdrawalMethodLabelInput.trim().length < 2) return notify("Tell us the name of the platform you'd like to be paid through.", true);
    if (!(await confirm({ title: "Submit this withdrawal request?", message: `${money(amount)} will be held from your available balance right away and paid out to the destination you provided once an admin reviews it.`, confirmLabel: "Submit request" }))) return;
    setWithdrawalSubmitting(true);
    try {
      const res = await fetch("/api/withdrawals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ method: withdrawalMethod, methodLabel: withdrawalMethodLabelInput, amount, destination: withdrawalDestination, note: withdrawalNote }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Something went wrong");
      notify(result.message || "Withdrawal request submitted");
      setWithdrawalAmount(""); setWithdrawalDestination(""); setWithdrawalNote(""); setWithdrawalMethodLabelInput("");
      await Promise.all([loadMyWithdrawals(), refresh()]);
    } catch (error) { notify(error instanceof Error ? error.message : "Something went wrong", true); } finally { setWithdrawalSubmitting(false); }
  };
  const assetRow = (asset: Asset, i: number, showCap = false) =>
    <tr key={asset.symbol} onClick={() => { setSymbol(asset.symbol); go("Trade"); }} className="clickable-row">
      <td className="rank-cell" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button className="icon-btn" style={{ width: 24, height: 24 }} title={watchlist.includes(asset.symbol) ? "Remove from watchlist" : "Add to watchlist"} disabled={watchlistBusy === asset.symbol} onClick={(e) => { e.stopPropagation(); toggleWatchlist(asset.symbol); }}><Star size={15} fill={watchlist.includes(asset.symbol) ? "#f5a623" : "none"} color={watchlist.includes(asset.symbol) ? "#f5a623" : "currentColor"}/></button>
        {asset.rank ? String(asset.rank).padStart(2, "0") : String(i + 1).padStart(2, "0")}
      </td>
      <td><div className="coin-cell"><AssetIcon asset={asset} size={36}/><div><strong>{asset.name}</strong><span>{asset.symbol}</span></div></div></td>
      <td className="table-strong">{marketPrice(asset.price)}</td>
      <td>{asset.price > 0 ? <span className={`change ${asset.change >= 0 ? "positive" : "negative"}`}>{asset.change >= 0 ? "+" : ""}{asset.change.toFixed(2)}%</span> : <span className="price-placeholder">—</span>}</td>
      <td className="spark-cell"><Sparkline values={asset.chart} positive={asset.change7d >= 0}/></td>
      {showCap && <><td className="muted-cell">{compactMoney(asset.volumeUsd)}</td><td className="muted-cell">{compactMoney(asset.capUsd)}</td></>}
      <td><button className="table-trade" onClick={e => { e.stopPropagation(); setSymbol(asset.symbol); go("Trade"); }}>Trade <ArrowUpRight size={14}/></button></td>
    </tr>;
  const tradeForm = () => <form className="trade-form compact" onSubmit={quickTrade}>
    <div className="segmented full"><button type="button" className={side === "buy" ? "active buy-active" : ""} onClick={() => setSide("buy")}>Buy</button><button type="button" className={side === "sell" ? "active sell-active" : ""} onClick={() => setSide("sell")}>Sell</button></div>
    <label className="input-label">Select asset</label>
    <div className="select-wrap"><AssetIcon asset={currentAsset} size={26}/><select value={symbol} onChange={e => setSymbol(e.target.value)}>{assets.map(a => <option key={a.symbol} value={a.symbol}>{a.name} ({a.symbol})</option>)}</select><ChevronDown size={16}/></div>
    <label className="input-label">Amount in USD</label>
    <div className="amount-input"><span>$</span><input type="number" min="0.01" step="0.01" placeholder="0.00" value={tradeAmount} onChange={e => setTradeAmount(e.target.value)} required/><span>USD</span></div>
    {currency !== "USD" && tradeAmount && Number(tradeAmount) > 0 && <p className="form-hint">≈ {money(Number(tradeAmount))}</p>}
    <div className="trade-details"><div><span>Indicative market price</span><strong>{marketPrice(currentAsset.price)}</strong></div><div><span>You'll {side === "buy" ? "receive" : "sell"}</span><strong>≈ {tradeAmount && currentAsset.price > 0 ? fmtQty(Math.floor((Number(tradeAmount) / currentAsset.price) * 1e8) / 1e8) : "0"} {symbol}</strong></div><div><span>Available</span><strong>{side === "buy" ? money(data.user.cashBalance) : `${fmtQty(Number(data.holdings.find(h => h.symbol === symbol)?.quantity ?? 0))} ${symbol}`}</strong></div></div>
    <button className={`primary-btn full-btn ${side === "sell" ? "sell-btn" : ""}`} disabled={loading || !ready || !quoteLive}>{loading ? "Processing..." : !quoteLive ? "Waiting for live prices" : `${side === "buy" ? "Buy" : "Sell"} ${symbol}`} <ArrowRight size={17}/></button>
    <p className={`trade-quote-note ${quoteLive ? "" : "offline"}`}>{quoteLive ? "Final paper-trade price is verified by the server at execution." : "Paper trading pauses until current market quotes are available."}</p>
    <p className="simulation-note"><ShieldCheck size={13}/> Paper trading only. No real funds involved.</p>
  </form>;
  const spotOrderForm = () => {
    const types = allowedOrderTypesForSide(side);
    const price = orderType === "market" ? currentAsset.price : Number(orderPrice) || 0;
    const qty = tradeAmount && price > 0 ? Math.floor((Number(tradeAmount) / price) * 1e8) / 1e8 : 0;
    return <form className="trade-form" onSubmit={placeSpotOrder}>
      <div className="segmented full"><button type="button" className={side === "buy" ? "active buy-active" : ""} onClick={() => { setSide("buy"); if (!allowedOrderTypesForSide("buy").includes(orderType)) setOrderType("market"); }}>Buy</button><button type="button" className={side === "sell" ? "active sell-active" : ""} onClick={() => setSide("sell")}>Sell</button></div>
      <label className="input-label">Order type</label>
      <div className="segmented full order-type-tabs">{ORDER_TYPES.filter(t => types.includes(t)).map(t => <button type="button" key={t} className={orderType === t ? "active" : ""} onClick={() => setOrderType(t)}>{orderTypeLabel(t)}</button>)}</div>
      <label className="input-label">Select asset</label>
      <div className="select-wrap"><AssetIcon asset={currentAsset} size={26}/><select value={symbol} onChange={e => setSymbol(e.target.value)}>{assets.map(a => <option key={a.symbol} value={a.symbol}>{a.name} ({a.symbol})</option>)}</select><ChevronDown size={16}/></div>
      {orderType !== "market" && <>
        <label className="input-label">{orderType === "limit" ? "Limit price" : orderType === "stop_loss" ? "Stop trigger price" : "Take-profit trigger price"}</label>
        <div className="amount-input"><span>$</span><input type="number" min="0.00000001" step="any" placeholder={currentAsset.price > 0 ? String(currentAsset.price) : "0.00"} value={orderPrice} onChange={e => setOrderPrice(e.target.value)} required/><span>USD</span></div>
      </>}
      <label className="input-label">Amount in USD</label>
      <div className="amount-input"><span>$</span><input type="number" min="0.01" step="0.01" placeholder="0.00" value={tradeAmount} onChange={e => setTradeAmount(e.target.value)} required/><span>USD</span></div>
      {currency !== "USD" && tradeAmount && Number(tradeAmount) > 0 && <p className="form-hint">≈ {money(Number(tradeAmount))}</p>}
      <div className="trade-details">
        <div><span>{orderType === "market" ? "Indicative market price" : "Order price"}</span><strong>{price > 0 ? marketPrice(price) : "—"}</strong></div>
        <div><span>You'll {side === "buy" ? "receive" : "sell"}</span><strong>≈ {qty ? fmtQty(qty) : "0"} {symbol}</strong></div>
        <div><span>Available</span><strong>{side === "buy" ? money(data.user.cashBalance) : `${fmtQty(Number(data.holdings.find(h => h.symbol === symbol)?.quantity ?? 0))} ${symbol}`}</strong></div>
      </div>
      <button className={`primary-btn full-btn ${side === "sell" ? "sell-btn" : ""}`} disabled={loading || !ready || !quoteLive}>{loading ? "Processing..." : !quoteLive ? "Waiting for live prices" : orderType === "market" ? `${side === "buy" ? "Buy" : "Sell"} ${symbol}` : `Place ${orderTypeLabel(orderType)} order`} <ArrowRight size={17}/></button>
      <p className={`trade-quote-note ${quoteLive ? "" : "offline"}`}>{quoteLive ? (orderType === "market" ? "Final paper-trade price is verified by the server at execution." : "Your order sits in the open-orders book until the trigger price is reached.") : "Paper trading pauses until current market quotes are available."}</p>
      <p className="simulation-note"><ShieldCheck size={13}/> No trading fees, no slippage — fills happen at the exact quoted price.</p>
    </form>;
  };
  const marginOrderForm = () => {
    const entryPreview = currentAsset.price;
    const marginNum = Number(marginAmount) || 0;
    const notional = marginNum * leverageX;
    const qtyPreview = entryPreview > 0 ? notional / entryPreview : 0;
    const liqPreview = entryPreview > 0 && marginNum > 0 ? liquidationPrice(entryPreview, leverageX, positionSide) : 0;
    return <form className="trade-form" onSubmit={openPosition}>
      <div className="segmented full"><button type="button" className={positionSide === "long" ? "active buy-active" : ""} onClick={() => setPositionSide("long")}>Long</button><button type="button" className={positionSide === "short" ? "active sell-active" : ""} onClick={() => setPositionSide("short")}>Short</button></div>
      <label className="input-label">Select asset</label>
      <div className="select-wrap"><AssetIcon asset={currentAsset} size={26}/><select value={symbol} onChange={e => setSymbol(e.target.value)}>{assets.map(a => <option key={a.symbol} value={a.symbol}>{a.name} ({a.symbol})</option>)}</select><ChevronDown size={16}/></div>
      <label className="input-label">Leverage</label>
      <div className="leverage-row">{LEVERAGE_OPTIONS.map(l => <button type="button" key={l} className={leverageX === l ? "active" : ""} onClick={() => setLeverageX(l)}>{l}x</button>)}</div>
      <label className="input-label">Margin (collateral)</label>
      <div className="amount-input"><span>$</span><input type="number" min={MIN_MARGIN} step="0.01" placeholder="100.00" value={marginAmount} onChange={e => setMarginAmount(e.target.value)} required/><span>USD</span></div>
      {currency !== "USD" && marginAmount && Number(marginAmount) > 0 && <p className="form-hint">≈ {money(Number(marginAmount))}</p>}
      <div className="trade-details">
        <div><span>Entry price</span><strong>{marketPrice(entryPreview)}</strong></div>
        <div><span>Position size</span><strong>≈ {qtyPreview ? fmtQty(qtyPreview) : "0"} {symbol}</strong></div>
        <div><span>Notional value</span><strong>{money(notional)}</strong></div>
        <div><span>Liquidation price</span><strong className="negative-text">{liqPreview > 0 ? marketPrice(liqPreview) : "—"}</strong></div>
      </div>
      <label className="input-label">Take-profit price (optional)</label>
      <div className="amount-input"><span>$</span><input type="number" min="0" step="any" placeholder="Optional" value={positionTP} onChange={e => setPositionTP(e.target.value)}/><span>USD</span></div>
      <label className="input-label">Stop-loss price (optional)</label>
      <div className="amount-input"><span>$</span><input type="number" min="0" step="any" placeholder="Optional" value={positionSL} onChange={e => setPositionSL(e.target.value)}/><span>USD</span></div>
      <button className={`primary-btn full-btn ${positionSide === "short" ? "sell-btn" : ""}`} disabled={openingPosition || !ready || !quoteLive}>{openingPosition ? "Opening..." : !quoteLive ? "Waiting for live prices" : `Open ${leverageX}x ${positionSide}`} <ArrowRight size={17}/></button>
      <p className={`trade-quote-note ${quoteLive ? "" : "offline"}`}>{quoteLive ? "Position opens at the live market price. Margin is deducted from your available balance immediately." : "Paper trading pauses until current market quotes are available."}</p>
      <p className="margin-risk-note"><AlertTriangle size={13}/> High risk: leveraged positions can be liquidated, losing your full margin. No fees, no slippage — closes happen at the exact trigger price.</p>
    </form>;
  };
  const openOrdersPanel = () => <section className="panel" style={{ marginTop: 20 }}>
    <SectionHead title="Open orders" subtitle="Pending limit, stop-loss, and take-profit orders"/>
    {!ordersLoaded ? <div className="no-results">Loading orders...</div> : myOrders.open.length === 0 ? <EmptyState icon={Clock3} title="No open orders" text="Place a limit, stop-loss, or take-profit order above to see it here."/> : <div className="table-scroll"><table className="data-table"><thead><tr><th>Asset</th><th>Type</th><th>Side</th><th>Quantity</th><th>Trigger price</th><th>Placed</th><th></th></tr></thead><tbody>{myOrders.open.map(o => { const a = getAsset(o.symbol); return <tr key={o.id}>
      <td><div className="coin-cell">{a && <AssetIcon asset={a} size={30}/>}<div><strong>{a?.name ?? o.symbol}</strong><span>{o.symbol}</span></div></div></td>
      <td>{orderTypeLabel(o.type)}</td>
      <td><span className={`type-pill ${o.side}`}>{o.side === "buy" ? <ArrowDownLeft size={13}/> : <ArrowUpRight size={13}/>} {o.side}</span></td>
      <td className="table-strong">{fmtQty(Number(o.quantity))} {o.symbol}</td>
      <td>{marketPrice(Number(o.triggerPrice))}</td>
      <td className="muted-cell">{timeAgo(o.createdAt)}</td>
      <td><button className="icon-btn" title="Cancel order" disabled={cancellingOrderId === o.id} onClick={() => cancelOrder(o.id)}>{cancellingOrderId === o.id ? <RefreshCw size={16} className="spin"/> : <Trash2 size={16}/>}</button></td>
    </tr>; })}</tbody></table></div>}
  </section>;
  const openPositionsPanel = () => <section className="panel" style={{ marginTop: 20 }}>
    <SectionHead title="Open positions" subtitle="Leveraged long/short positions · live P&L"/>
    {!positionsLoaded ? <div className="no-results">Loading positions...</div> : myPositions.open.length === 0 ? <EmptyState icon={Zap} title="No open positions" text="Open a leveraged long or short position above to see it here."/> : <div className="table-scroll"><table className="data-table"><thead><tr><th>Asset</th><th>Side</th><th>Leverage</th><th>Margin</th><th>Entry</th><th>Mark price</th><th>Liquidation</th><th>P&L</th><th></th></tr></thead><tbody>{myPositions.open.map(p => { const a = getAsset(p.symbol); const pnl = p.unrealizedPnl ?? positionPnl(p.side, Number(p.entryPrice), p.currentPrice ?? Number(p.entryPrice), Number(p.quantity)); return <tr key={p.id}>
      <td><div className="coin-cell">{a && <AssetIcon asset={a} size={30}/>}<div><strong>{a?.name ?? p.symbol}</strong><span>{p.symbol}</span></div></div></td>
      <td><span className={`type-pill ${p.side === "long" ? "buy" : "sell"}`}>{p.side === "long" ? <ArrowUpRight size={13}/> : <ArrowDownLeft size={13}/>} {p.side}</span></td>
      <td className="table-strong">{Number(p.leverage)}x</td>
      <td>{money(Number(p.margin))}</td>
      <td>{marketPrice(Number(p.entryPrice))}</td>
      <td>{marketPrice(p.currentPrice ?? Number(p.entryPrice))}</td>
      <td className="liquidation-cell">{marketPrice(Number(p.liquidationPrice))}</td>
      <td className={`table-strong position-pnl ${pnl >= 0 ? "positive-text" : "negative-text"}`}>{pnl >= 0 ? "+" : ""}{money(pnl)}</td>
      <td><button className="icon-btn" title="Close position" disabled={closingPositionId === p.id} onClick={() => closePosition(p.id)}>{closingPositionId === p.id ? <RefreshCw size={16} className="spin"/> : <XCircle size={16}/>}</button></td>
    </tr>; })}</tbody></table></div>}
  </section>;
  const priceAlertsPanel = () => <section className="panel" style={{ marginTop: 20 }}>
    <SectionHead title="Price alerts" subtitle={`Get notified when ${symbol} crosses a price you choose`}/>
    <form className="admin-account-form" style={{ display: "flex", flexDirection: "row", alignItems: "flex-end", gap: 10, padding: "0 20px 20px", flexWrap: "wrap" }} onSubmit={createPriceAlert}>
      <div style={{ flex: "0 0 auto" }}>
        <label className="input-label">Direction</label>
        <div className="segmented"><button type="button" className={alertDirection === "above" ? "active" : ""} onClick={() => setAlertDirection("above")}>Above</button><button type="button" className={alertDirection === "below" ? "active" : ""} onClick={() => setAlertDirection("below")}>Below</button></div>
      </div>
      <div style={{ flex: "1 1 160px" }}>
        <label className="input-label">Target price (USD)</label>
        <div className="amount-input"><span>$</span><input type="number" min="0" step="any" placeholder={currentAsset.price > 0 ? currentAsset.price.toFixed(2) : "0.00"} value={alertTargetPrice} onChange={(e) => setAlertTargetPrice(e.target.value)}/></div>
      </div>
      <button className="primary-btn" style={{ height: 42 }} disabled={creatingAlert}>{creatingAlert ? "Creating..." : "Create alert"}<Bell size={16}/></button>
    </form>
    {!priceAlertsLoaded ? <div className="no-results">Loading price alerts...</div> : priceAlerts.open.length === 0 ? <EmptyState icon={BellRing} title="No active price alerts" text="Create one above to get notified the moment an asset hits your target."/> : <div className="table-scroll"><table className="data-table"><thead><tr><th>Asset</th><th>Condition</th><th>Created</th><th></th></tr></thead><tbody>{priceAlerts.open.map(alert => { const a = getAsset(alert.symbol); return <tr key={alert.id}>
      <td><div className="coin-cell">{a && <AssetIcon asset={a} size={30}/>}<div><strong>{a?.name ?? alert.symbol}</strong><span>{alert.symbol}</span></div></div></td>
      <td>{alert.direction === "above" ? "Goes above" : "Drops below"} {marketPrice(Number(alert.targetPrice))}</td>
      <td className="muted-cell">{timeAgo(alert.createdAt)}</td>
      <td><button className="icon-btn" title="Cancel alert" disabled={cancellingAlertId === alert.id} onClick={() => cancelPriceAlert(alert.id)}>{cancellingAlertId === alert.id ? <RefreshCw size={16} className="spin"/> : <Trash2 size={16}/>}</button></td>
    </tr>; })}</tbody></table></div>}
  </section>;
  const marketTable = (items: Asset[], full = false) => <div className="table-scroll"><table className="data-table market-table"><thead><tr><th>#</th><th>Asset</th><th>Price</th><th>24h Change</th><th>Last 7 days</th>{full && <><th>Volume (24h)</th><th>Market Cap</th></>}<th></th></tr></thead><tbody>{items.map((a, i) => assetRow(a, i, full))}</tbody></table>{items.length === 0 && <div className="no-results">{marketTab === "Watchlist" ? "Your watchlist is empty — click the star on any asset to add it." : "No assets match your search."}</div>}</div>;
  const supportBadge = (t: { placedBy: string | null }) => t.placedBy ? <span className="placed-by-support-badge" title="Placed by an admin on your behalf"><UserRound size={11}/> Placed by support</span> : null;
  const tradeTable = (limit?: number) => <div className="table-scroll"><table className="data-table"><thead><tr><th>Asset</th><th>Type</th><th>Amount</th><th>Price</th><th>Total</th><th>Date</th><th>Status</th></tr></thead><tbody>{data.trades.slice(0, limit).map(t => { const a = getAsset(t.symbol); return <tr key={t.id}><td><div className="coin-cell">{a && <AssetIcon asset={a} size={32}/>}<div><strong>{a?.name ?? t.symbol}</strong><span>{t.symbol}{supportBadge(t)}</span></div></div></td><td><span className={`type-pill ${t.side}`}>{t.side === "buy" ? <ArrowDownLeft size={13}/> : <ArrowUpRight size={13}/>} {t.side === "buy" ? "Buy" : "Sell"}</span></td><td className="table-strong">{fmtQty(Number(t.quantity))} {t.symbol}</td><td>{marketPrice(Number(t.price))}</td><td className="table-strong">{money(Number(t.total))}</td><td className="muted-cell">{new Date(t.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td><td><span className="status-pill"><span/>Completed</span></td></tr>; })}</tbody></table>{data.trades.length === 0 && <EmptyState icon={History} title="No trades yet" text="Your completed trades will appear here."/>}</div>;
  const card = (icon: typeof Wallet, label: string, value: string, foot: React.ReactNode, tone = "blue") => { const Icon = icon; return <div className="stat-card"><div className="stat-top"><span className={`stat-icon ${tone}`}><Icon size={19}/></span><MoreHorizontal size={20} className="dots-icon"/></div><span className="stat-label">{label}</span><strong className="stat-value">{hideBalance ? "••••••" : value}</strong><div className="stat-foot">{foot}</div></div>; };

  return <div className="app-shell">
    {mobileMenu && <div className="mobile-overlay" onClick={() => setMobileMenu(false)}/>}
    <aside className={`sidebar ${mobileMenu ? "sidebar-open" : ""}`}><div className="brand" onClick={() => go("Overview")}><div className="brand-icon"><Activity size={23} strokeWidth={3}/></div><span>Nexa<span>Trade</span></span><button className="mobile-close" onClick={(e) => { e.stopPropagation(); setMobileMenu(false); }}><X size={19}/></button></div><div className="sidebar-body">{navGroups.map(group => <div className="nav-group" key={group.label}><div className="nav-label">{t(group.label)}</div>{group.items.map(item => { const Icon = item.icon; return <button key={item.name} className={`nav-item ${page === item.name ? "selected" : ""}`} onClick={() => go(item.name)}><Icon size={19} strokeWidth={page === item.name ? 2.25 : 1.8}/><span>{t(item.name)}</span>{item.name === "Trading Signals" && <span className="nav-new">{t("NEW")}</span>}</button>; })}</div>)}</div><div className="sidebar-bottom"><div className="help-card"><span className="help-bubble"><CircleHelp size={18}/></span><strong>{t("Need a hand?")}</strong><p>{t("Explore the platform with your free demo account.")}</p><button onClick={() => { go("Trading Signals"); }}>{t("Explore signals")} <ArrowRight size={14}/></button></div><div className="sidebar-footer"><ShieldCheck size={15}/> {t("Secure paper trading platform")}</div></div></aside>
    <div className="main-shell"><header className="topbar"><div className="topbar-left"><button className="icon-btn menu-btn" onClick={() => setMobileMenu(true)} aria-label="Open menu"><Menu size={22}/></button><div className="breadcrumb"><span className="breadcrumb-prefix">{t("Workspace")} <ChevronRight size={15}/></span> <strong>{t(page)}</strong></div></div><div className="topbar-right"><div className={`market-status ${market.status}`} title={market.updatedAt ? `CoinGecko quote updated ${new Date(market.updatedAt).toLocaleString()}` : "CoinGecko market data"} aria-live="polite"><i/><span className="market-status-label">{market.status === "live" ? `Live · ${asOf}` : market.status === "loading" ? "Loading markets" : market.status === "stale" ? "Stale quotes" : "Prices offline"}</span><button className="market-refresh" title="Refresh prices and chart" aria-label="Refresh prices and chart" onClick={() => { void refreshMarket(); setChartRefresh(n => n + 1); }}><RefreshCw size={13} className={marketRefreshing ? "spin" : ""}/></button></div><div className="top-search"><Search size={18}/><input placeholder={t("Search markets...")} value={search} onChange={e => { setSearch(e.target.value); if (e.target.value) setPage("Markets"); }} onFocus={() => {}}/><span>⌘ K</span></div><span className="topbar-divider"/><button className="theme-toggle" aria-label={theme === "dark" ? t("Switch to light mode") : t("Switch to dark mode")} title={theme === "dark" ? t("Switch to light mode") : t("Switch to dark mode")} onClick={toggleTheme}>{theme === "dark" ? <Sun size={19}/> : <Moon size={19}/>}</button><div className="notification-wrap"><button className="icon-btn notif-btn" aria-label={t("Language")} title={t("Language")} onClick={() => { setLanguageMenuOpen(!languageMenuOpen); setNotificationsOpen(false); setProfileOpen(false); }}><Globe size={20}/></button>{languageMenuOpen && <div className="popover language-popover"><div className="popover-title">{t("Language")}{translating && <span className="language-translating">…</span>}</div>{LANGUAGES.map(l => <button key={l.code} className={`language-option ${language === l.code ? "selected" : ""}`} onClick={() => changeLanguage(l.code)}><span className="language-flag">{l.flag}</span><span className="language-name">{l.nativeLabel}</span>{language === l.code && <Check size={15}/>}</button>)}</div>}</div><div className="notification-wrap"><button className="icon-btn notif-btn" aria-label="Notifications" onClick={toggleNotifications}><Bell size={20}/>{data.unreadNotifications > 0 && <i/>}</button>{notificationsOpen && <div className="popover notification-popover"><div className="popover-title">{t("Notifications")} {data.unreadNotifications > 0 && <span>{data.unreadNotifications} new</span>}</div>{data.notifications.length === 0 ? <div className="notification-empty"><Bell size={18}/><p>{t("No notifications yet")}</p></div> : data.notifications.map(n => { const { Icon, color } = notificationVisual(n.type); return <div className={`notification-item ${n.readAt ? "" : "unread"}`} key={n.id}><span className={`notification-icon ${color}`}><Icon size={16}/></span><div><strong>{n.title}</strong><p>{n.message}</p><small>{timeAgo(n.createdAt)}</small></div></div>; })}<button className="notification-see-all" onClick={() => { setNotificationsOpen(false); go("Notifications"); }}>{t("See all notifications")} <ArrowRight size={13}/></button></div>}</div><div className="profile-wrap"><button className="profile-button" onClick={() => { setProfileOpen(!profileOpen); setNotificationsOpen(false); }}><span className="avatar">{data.user.profilePhoto ? <img src={data.user.profilePhoto} alt="" style={{width:"100%",height:"100%",borderRadius:"50%",objectFit:"cover"}}/> : data.user.name.split(" ").map(n => n[0]).slice(0, 2).join("")}</span><span className="profile-meta"><strong>{data.user.name}</strong><small>{data.user.isDemo ? t("Demo account") : (data.plan ? data.plan + " " + t("member") : t("No active plan"))}</small></span><ChevronDown size={16}/></button>{profileOpen && <div className="popover profile-popover"><div className="profile-pop-head"><strong>{data.user.name}</strong><span>{data.user.email ?? t("Exploring in demo mode")}</span></div>{data.user.role === "admin" && <a href="/admin" className="admin-link-btn"><ShieldCheck size={17}/> {t("Admin panel")}</a>}{!data.user.isDemo && <button onClick={() => { setPage("Profile"); setProfileOpen(false); }}><UserRound size={17}/> {t("View profile")}</button>}{data.user.isDemo ? <><button onClick={() => { setAuthMode("register"); setProfileOpen(false); }}><UserRound size={17}/> {t("Create an account")}</button><button onClick={() => { setAuthMode("login"); setProfileOpen(false); }}><LockKeyhole size={17}/> {t("Sign in")}</button></> : <button onClick={logout}><LogOut size={17}/> {t("Log out")}</button>}</div>}</div></div></header>
    <main className="content">
      {(market.status === "stale" || market.status === "unavailable") && <div className="market-alert" role="status"><Clock3 size={17}/><span><strong>{market.status === "stale" ? "Market data is stale." : "Market prices are temporarily unavailable."}</strong> {market.status === "stale" ? `Showing last known CoinGecko quotes${asOf ? ` from ${asOf}` : ""}.` : "Check the connection or try again shortly."} Paper trading is paused until live prices return.</span><button onClick={() => void refreshMarket()}>Retry</button></div>}
      {data.user.accountStatus !== "active" && <div className={`account-status-banner ${data.user.accountStatus}`} role="status">
        <AlertTriangle size={17}/>
        <span>
          <strong>{data.user.accountStatus === "suspended" ? "Your account is suspended." : "Your account has limited access."}</strong>{" "}
          {data.user.accountStatus === "suspended"
            ? "Trading, deposits, withdrawals, and subscriptions are disabled on this account."
            : <>{data.user.maxTradeAmount !== null && `Trades are capped at ${money(data.user.maxTradeAmount)}. `}{data.user.withdrawalsBlocked && "Withdrawals are disabled. "}</>}
          {data.user.statusReason && <> Reason: {data.user.statusReason}.</>} Contact support for help.
        </span>
      </div>}
      {page === "Overview" && <>
        <div className="welcome-row"><div><div className="eyebrow">{date.toUpperCase()}</div><h1>{t("Good to see you,")} {firstName} <span className="wave">✌️</span></h1><p>{t("Here's what's happening with your portfolio today.")}</p></div><div className="welcome-actions"><span className="demo-badge"><span/> {data.user.isDemo ? t("Demo account") : t("Paper trading")}</span><button className="outline-btn" onClick={() => go("Deposit")}><Plus size={17}/> {t("Add funds")}</button></div></div>
        <div className="stats-grid five">
          {card(Wallet, "Total balance", money(totalBalance), <span>Cash, invested assets, and profits</span>, "blue")}
          {card(Activity, "Portfolio value", money(portfolioValue), <span>{data.holdings.length} assets held</span>, "purple")}
          {card(CreditCard, "Available cash", money(data.user.cashBalance), <span>Ready for paper trades</span>, "orange")}
          {card(Gift, "Profits", money(data.user.profitBalance), <span>Credited by admin</span>, "green")}
          {card(TrendingUp, "Unrealized profit / loss", Number.isFinite(pnl) ? `${pnl >= 0 ? "+" : "-"}${money(Math.abs(pnl))}` : "—", <>{hasQuotes && costBasis > 0 && <span className={pnl >= 0 ? "up-tag" : "negative-tag"}>{pnl >= 0 ? <ArrowUpRight size={13}/> : <ArrowDownRight size={13}/>} {pnl >= 0 ? "+" : ""}{pnlPercent.toFixed(2)}%</span>}<span>vs. your average buy price</span></>, "green")}
        </div>
        <div className="dashboard-grid">
          <div className="dashboard-main">
            <section className="panel performance-panel">
              <div className="section-head"><div><h2>Portfolio performance</h2><p>Estimated value of your current holdings</p></div><div className="periods">{(["24H", "7D", "30D", "1Y"] as ChartPeriod[]).map(p => <button key={p} className={period === p ? "active" : ""} onClick={() => setPeriod(p)}>{p}</button>)}</div></div>
              <div className="performance-number"><strong>{hideBalance ? "••••••" : money(totalBalance)}</strong>{periodPercent !== null && <span className={periodDelta! >= 0 ? "up-tag" : "negative-tag"}>{periodDelta! >= 0 ? <ArrowUpRight size={14}/> : <ArrowDownRight size={14}/>} {periodPercent >= 0 ? "+" : ""}{periodPercent.toFixed(2)}%</span>}<button aria-label={hideBalance ? "Show balance" : "Hide balance"} className="eye-btn" onClick={() => setHideBalance(!hideBalance)}>{hideBalance ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div>
              <div className="performance-sub">{periodDelta === null ? "Based on your current positions" : <><span className={periodDelta >= 0 ? "positive-text" : "negative-text"}>{periodDelta >= 0 ? "+" : "-"}{money(Math.abs(periodDelta))}</span> estimated over {period}</>}</div>
              <MarketChart points={chartPoints} period={period} status={chartStatus} label="Estimated portfolio value" currency={currency} rate={fxRate}/>
              <div className="overview-chart-caption">Current holdings valued at historical market prices; not actual account history.</div>
            </section>
            <section className="panel market-panel"><SectionHead title="Market overview" subtitle={market.status === "live" ? `Live CoinGecko quotes · Updated ${asOf}` : market.status === "loading" ? "Loading market prices…" : "Last known CoinGecko quotes"} action={<button className="text-link" onClick={() => go("Markets")}>View all markets <ArrowRight size={16}/></button>}/>{marketTable(assets.slice(0, 4))}</section>
          </div>
          <div className="dashboard-right">
            <section className="panel quick-trade-panel"><SectionHead title="Quick trade" subtitle="Paper trade at the current quote"/>{tradeForm()}</section>
            <section className="panel allocation-panel"><SectionHead title="Your allocation" subtitle="Portfolio breakdown"/><div className="allocation-content"><div className="donut" style={{ background: allocationBackground }}><div><small>Total value</small><strong>{money(portfolioValue, 0)}</strong></div></div><div className="allocation-legend">{allocations.length && hasQuotes ? allocations.map(item => <div key={item.symbol}><span><i style={{ background: item.color }}/>{item.symbol}</span><strong>{(item.value / portfolioValue * 100).toFixed(1)}%</strong></div>) : <span className="allocation-empty">{hasQuotes ? "No assets held yet" : "Waiting for prices"}</span>}</div></div></section>
          </div>
        </div>
        <section className="panel recent-panel"><SectionHead title="Recent activity" subtitle="Your latest trades and transactions" action={<button className="text-link" onClick={() => go("Trade History")}>View history <ArrowRight size={16}/></button>}/>{tradeTable(3)}</section>
      </>}
      {page === "Portfolio" && <>
        <PageTitle title={t("My portfolio")} description={t("Your holdings valued against current market prices.")}><button className="outline-btn" onClick={() => go("Trade")}><Plus size={17}/> New trade</button></PageTitle>
        <div className="stats-grid">
          {card(Wallet, "Total portfolio", money(totalBalance), <span>Cash + invested assets + profits</span>)}
          {card(TrendingUp, "Invested value", money(portfolioValue), <span>{data.holdings.length} assets held</span>, "purple")}
          {card(CreditCard, "Available to trade", money(data.user.cashBalance), <span>In your paper USD wallet</span>, "green")}
          {card(Gift, "Profits", money(data.user.profitBalance), <span>Credited by admin</span>, "orange")}
        </div>
        <div className="two-col portfolio-layout">
          <section className="panel"><SectionHead title="Your assets" subtitle={market.status === "live" ? `Valued using CoinGecko quotes · ${asOf}` : "Waiting for current market quotes"}/>
            {data.holdings.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Asset</th><th>Holdings</th><th>Avg. buy price</th><th>Current price</th><th>Value</th><th>Profit / Loss</th></tr></thead><tbody>
              {data.holdings.map(h => { const a = getAsset(h.symbol); if (!a) return null; const gain = hasQuotes ? Number(h.quantity) * (a.price - Number(h.avgPrice)) : NaN; return <tr key={h.id} className="clickable-row" onClick={() => { setSymbol(h.symbol); go("Trade"); }}><td><div className="coin-cell"><AssetIcon asset={a} size={36}/><div><strong>{a.name}</strong><span>{a.symbol}</span></div></div></td><td className="table-strong">{fmtQty(Number(h.quantity))} {h.symbol}</td><td>{marketPrice(Number(h.avgPrice))}</td><td>{marketPrice(a.price)}</td><td className="table-strong">{hasQuotes ? money(Number(h.quantity) * a.price) : "—"}</td><td className={Number.isFinite(gain) ? (gain >= 0 ? "positive-text" : "negative-text") : "muted-cell"}>{Number.isFinite(gain) ? `${gain >= 0 ? "+" : "-"}${money(Math.abs(gain))}` : "—"}</td></tr>; })}
            </tbody></table></div> : <EmptyState icon={Wallet} title="No holdings yet" text="Buy your first asset to start building your portfolio."/>}
          </section>
          <section className="panel portfolio-side"><SectionHead title="Asset allocation" subtitle="How your investments are distributed"/><div className="allocation-content column"><div className="donut large" style={{ background: allocationBackground }}><div><small>Invested</small><strong>{money(portfolioValue, 0)}</strong></div></div><div className="allocation-legend">{allocations.length && hasQuotes ? allocations.map(item => <div key={item.symbol}><span><i style={{ background: item.color }}/>{getAsset(item.symbol)?.name}</span><strong>{(item.value / portfolioValue * 100).toFixed(1)}%</strong></div>) : <span className="allocation-empty">{hasQuotes ? "No assets held yet" : "Waiting for prices"}</span>}</div></div></section>
        </div>
      </>}
      {page === "Trade" && <>
        <PageTitle title={t("Trade crypto")} description={t("Live candlestick charts, full order types, and leveraged positions — no fees, no slippage.")}/>
        <div className="trade-layout">
          <section className="panel trade-asset-panel">
            <div className="trade-asset-head"><div className="coin-cell"><AssetIcon asset={currentAsset} size={48}/><div><h2>{currentAsset.name} <span>{symbol}</span></h2><p>Market data by CoinGecko · paper trading</p></div></div><div style={{ display: "flex", alignItems: "center", gap: 10 }}><button className="icon-btn" title={watchlist.includes(symbol) ? "Remove from watchlist" : "Add to watchlist"} disabled={watchlistBusy === symbol} onClick={() => toggleWatchlist(symbol)}><Star size={20} fill={watchlist.includes(symbol) ? "#f5a623" : "none"} color={watchlist.includes(symbol) ? "#f5a623" : "currentColor"}/></button><span className={`market-open ${quoteLive ? "" : "offline"}`}><span/>{quoteLive ? "Live quote" : "Trading paused"}</span></div></div>
            <div className="asset-price"><strong>{marketPrice(currentAsset.price)}</strong>{currentAsset.price > 0 && <span className={currentAsset.change >= 0 ? "positive-text" : "negative-text"}>{currentAsset.change >= 0 ? "+" : ""}{currentAsset.change.toFixed(2)}% today</span>}</div>
            <div className="large-chart"><CandlestickChart candles={candles} period={period} status={candleStatus} label={`${currentAsset.name} price`} currency={currency} rate={fxRate}/></div>
            <div className="periods chart-periods">{(["24H", "7D", "30D", "1Y"] as ChartPeriod[]).map(p => <button key={p} className={period === p ? "active" : ""} onClick={() => setPeriod(p)}>{p}</button>)}</div>
            <div className="asset-facts"><div><span>24h volume</span><strong>{compactMoney(currentAsset.volumeUsd)}</strong></div><div><span>Market cap</span><strong>{compactMoney(currentAsset.capUsd)}</strong></div><div><span>24h change</span><strong className={currentAsset.price > 0 ? (currentAsset.change >= 0 ? "positive-text" : "negative-text") : "muted-cell"}>{currentAsset.price > 0 ? `${currentAsset.change >= 0 ? "+" : ""}${currentAsset.change.toFixed(2)}%` : "—"}</strong></div></div>
          </section>
          <section className="panel trade-order-panel">
            <div className="segmented full trade-mode-toggle"><button className={tradeMode === "Spot" ? "active" : ""} onClick={() => setTradeMode("Spot")}>Spot</button><button className={tradeMode === "Margin" ? "active" : ""} onClick={() => setTradeMode("Margin")}>Margin</button></div>
            {tradeMode === "Spot"
              ? <><SectionHead title="Place an order" subtitle="Server-verified paper execution · no fees, no slippage"/>{spotOrderForm()}</>
              : <><SectionHead title="Open a leveraged position" subtitle="Isolated margin · no fees, no slippage"/>{marginOrderForm()}</>}
          </section>
        </div>
        {tradeMode === "Spot" ? openOrdersPanel() : openPositionsPanel()}
        {priceAlertsPanel()}
      </>}
      {page === "Markets" && <>
        <PageTitle title={t("Explore markets")} description={t("Discover assets and find your next opportunity using CoinGecko market data.")}><button className="outline-btn" onClick={() => { setSearch(""); setMarketTab("All assets"); }}><SlidersHorizontal size={17}/> Reset filters</button></PageTitle>
        <div className="market-highlights">{assets.slice(0, 3).map(a => <button className="highlight-card" key={a.symbol} onClick={() => { setSymbol(a.symbol); go("Trade"); }}><div className="highlight-top"><div className="coin-cell"><AssetIcon asset={a} size={37}/><div><strong>{a.name}</strong><span>{a.symbol}</span></div></div><ArrowUpRight size={17}/></div><div className="highlight-bottom"><div><strong>{marketPrice(a.price)}</strong>{a.price > 0 ? <span className={a.change >= 0 ? "positive-text" : "negative-text"}>{a.change >= 0 ? "+" : ""}{a.change.toFixed(2)}% today</span> : <span className="price-placeholder">Waiting for quotes</span>}</div><Sparkline values={a.chart} positive={a.change7d >= 0} width={112} height={44}/></div></button>)}</div>
        <section className="panel"><div className="section-head market-section-head"><div><h2>All cryptocurrencies</h2><p>{market.status === "live" ? `Live prices · updated ${asOf}` : market.status === "loading" ? "Loading prices from CoinGecko…" : "Last known prices · trading paused"}</p></div><div className="market-controls"><div className="market-search"><Search size={17}/><input placeholder="Search assets" value={search} onChange={e => setSearch(e.target.value)}/></div><div className="segmented">{["All assets", "Gainers", "Losers", "Watchlist"].map(t => <button key={t} className={marketTab === t ? "active" : ""} onClick={() => setMarketTab(t)}>{t === "Watchlist" ? `${t} (${watchlist.length})` : t}</button>)}</div></div></div>{marketTable(filteredAssets, true)}<p className="market-data-note"><Activity size={13}/> Aggregated market data by CoinGecko. Prices are indicative; trades remain simulated.</p></section>
      </>}
      {page === "Trading Bot" && <>
        <PageTitle title={t("Trading bots")} description={t("Subscribe to an admin-managed bot strategy, then configure it to trade.")}><span className="demo-badge"><span/> Simulation mode</span></PageTitle>
        <div className="feature-banner bot-banner"><div className="feature-icon"><Bot size={26}/></div><div><span className="banner-eyebrow">TRADE SMARTER, NOT HARDER</span><h2>Put your strategy on autopilot.</h2><p>Browse admin-curated bot strategies, subscribe for the period shown on each card, then configure any number of instances to trade with.</p></div><div className="banner-art"><Bot size={100} strokeWidth={1}/></div></div>
        <div className="section-title-row"><div><h2>Available bots</h2><p>Each subscription runs for the duration shown on its card, starting the moment you subscribe</p></div><span className="subtle-label">{tradingBots.filter(b=>b.mySubscription).length} active</span></div>
        {!tradingBotsLoaded ? <div className="no-results">Loading bots...</div> : tradingBots.length === 0 ? <EmptyState icon={Bot} title="No bots available yet" text="Check back soon — an admin hasn't added any trading bots yet."/> : <div className="trader-grid">{tradingBots.map((b,botIdx)=>{
          const subscribed = !!b.mySubscription;
          const left = b.mySubscription ? daysLeft(b.mySubscription.expiresAt) : 0;
          const price = Number(b.subscriptionAmount);
          const coverColor = AVATAR_COLORS[botIdx % AVATAR_COLORS.length];
          return <div className="panel trader-card" key={b.id}>
            <div className="trader-cover-wrap">
              {b.photoUrl ? <img className="trader-cover-photo" src={b.photoUrl} alt={b.name} onError={e=>{(e.target as HTMLImageElement).style.display="none";}}/> : <div className={`trader-cover ${coverColor}`}><span className="trader-cover-glyph"><Bot size={34}/></span></div>}
              <span className="trader-cover-flag" title={countryInfo(b.country).name}>{flagEmoji(b.country)}</span>
            </div>
            <div className="trader-body">
              <div className="trader-name-row"><h3>{b.name}</h3><CheckCircle2 size={15} className="verified-tick"/></div>
              <p className="trader-sub">{b.strategy} strategy · {b.riskLevel} risk · min {money(Number(b.minAllocation))}</p>
              <p className="trader-bio">{b.description}</p>
              <div className="trader-stats-row">
                <div><strong><Star size={12} color="#f5a623" fill="#f5a623"/> {Number(b.rating).toFixed(1)}</strong><span>Rating</span></div>
                <div className="stat-divider"/>
                <div><strong>{b.activeSubscribers}</strong><span>Subscribers</span></div>
                <div className="stat-divider"/>
                <div><strong>{price > 0 ? money(price) : "Free"}</strong><span>/ {b.subscriptionDurationDays}d</span></div>
              </div>
              {subscribed ? <button className="outline-btn full-btn trader-cta" onClick={()=>openConfigureBot(b)}><Settings2 size={17}/> Subscribed · {left}d left · {configuringBotId===b.id ? "Close" : "Configure"}</button>
                : <button className="primary-btn full-btn trader-cta" disabled={loading || !ready || botSubscribingId === b.id} onClick={()=>subscribeToBot(b)}>{botSubscribingId === b.id ? "Subscribing..." : <><Copy size={17}/> Subscribe</>}</button>}
              {subscribed && configuringBotId===b.id && <div className="bot-configure-form">
                <label className="input-label">Asset to trade</label>
                <div className="select-wrap"><AssetIcon asset={getAsset(newInstanceSymbol)!} size={24}/><select value={newInstanceSymbol} onChange={e=>setNewInstanceSymbol(e.target.value)}>{assets.map(a=><option key={a.symbol} value={a.symbol}>{a.name} ({a.symbol})</option>)}</select><ChevronDown size={16}/></div>
                <label className="input-label">Allocation (min {money(Number(b.minAllocation))})</label>
                <div className="amount-input"><span>$</span><input type="number" min={b.minAllocation} step="0.01" value={newInstanceAmount} onChange={e=>setNewInstanceAmount(e.target.value)}/><span>USD</span></div>
                <label className="input-label">Name (optional)</label>
                <input className="text-input" placeholder={`${b.name} · ${newInstanceSymbol}`} value={newInstanceName} onChange={e=>setNewInstanceName(e.target.value)} maxLength={80}/>
                <button className="primary-btn full-btn" disabled={instanceCreating} onClick={()=>createBotInstance(b)}>{instanceCreating ? "Adding..." : <>Add bot instance <Plus size={16}/></>}</button>
              </div>}
            </div>
          </div>;
        })}</div>}
        <div className="copy-note"><ShieldCheck size={19}/><span>Bots are configurations only and do not execute live trades. Subscribing charges your demo cash balance for that bot&apos;s subscription period; resubscribe once it lapses to keep running your bots.</span></div>
        <div className="section-title-row"><div><h2>My bots</h2><p>Configured instances across your subscribed bots</p></div></div>
        {botInstances.length === 0 ? <EmptyState icon={Bot} title="No bots configured yet" text="Subscribe to a bot above, then configure an instance to see it here."/> : <div className="panel bot-list">{botInstances.map(bot=><div className="bot-item" key={bot.id}>
          <div className="bot-item-top"><span className="bot-item-icon"><Bot size={22}/></span><span className={`bot-status ${bot.active && bot.subscriptionActive ? "running":"paused"}`}><span/>{bot.active && bot.subscriptionActive ? "Active" : bot.active && !bot.subscriptionActive ? "Needs resubscribe" : "Paused"}</span></div>
          <h3>{bot.name}</h3><p>{bot.botName} · {bot.strategy} strategy · {bot.symbol} · Allocation {money(Number(bot.amount))}</p>
          {!bot.subscriptionActive && <p className="admin-request-note admin-note-flag"><AlertTriangle size={13}/> Subscription expired — resubscribe above to resume this bot.</p>}
          <div className="bot-item-bottom"><span>Created {new Date(bot.createdAt).toLocaleDateString()}</span><div style={{display:"flex",gap:8}}><button className="outline-btn small" disabled={instanceBusyId === bot.id || (!bot.active && !bot.subscriptionActive)} onClick={()=>toggleBotInstance(bot)}>{bot.active ? "Pause":"Resume"}</button><button className="outline-btn small danger-outline" disabled={instanceBusyId === bot.id} onClick={()=>removeBotInstance(bot)}><Trash2 size={13}/></button></div></div>
        </div>)}</div>}
        <div className="section-title-row"><div><h2>My bot subscriptions</h2><p>Your trading bot subscription history</p></div></div>
        {botSubHistory.length === 0 ? <EmptyState icon={History} title="No subscriptions yet" text="Subscribe to a bot above to see your history here."/> : <div className="table-scroll"><table className="data-table"><thead><tr><th>Bot</th><th>Amount</th><th>Started</th><th>Expires</th><th>Status</th></tr></thead><tbody>{botSubHistory.map(s=>{
          const left = daysLeft(s.expiresAt);
          const active = new Date(s.expiresAt).getTime() > Date.now();
          return <tr key={s.id}><td><div className="coin-cell"><div><strong>{s.botName}</strong></div></div></td><td className="table-strong">{money(Number(s.amount))}</td><td className="muted-cell">{new Date(s.startedAt).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</td><td className="muted-cell">{new Date(s.expiresAt).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</td><td>{active ? <span className="status-pill"><span/>Active · {left}d left</span> : <span className="status-pill expired"><span/>Expired</span>}</td></tr>;
        })}</tbody></table></div>}
      </>}
      {page === "Copy Trading" && <>
        <PageTitle title={t("Copy trading")} description={t("Subscribe to a trader's strategy and track your subscription history.")}/>
        <div className="feature-banner copy-banner"><div className="feature-icon"><UsersRound size={25}/></div><div><span className="banner-eyebrow">LEARN FROM THE BEST</span><h2>Great minds trade alike.</h2><p>Browse admin-curated traders and subscribe to follow their strategy for the period shown on each card.</p></div><div className="banner-art"><UsersRound size={105} strokeWidth={1}/></div></div>
        <div className="section-title-row"><div><h2>Available traders</h2><p>Each subscription runs for the duration shown on its card, starting the moment you subscribe</p></div><span className="subtle-label">{copyTraders.filter(t=>t.mySubscription).length} active</span></div>
        {!copyTradersLoaded ? <div className="no-results">Loading traders...</div> : copyTraders.length === 0 ? <EmptyState icon={UsersRound} title="No traders available yet" text="Check back soon — an admin hasn't added any copy traders yet."/> : <div className="trader-grid">{copyTraders.map(t=>{
          const subscribed = !!t.mySubscription;
          const left = t.mySubscription ? daysLeft(t.mySubscription.expiresAt) : 0;
          const price = Number(t.subscriptionAmount);
          return <div className="panel trader-card" key={t.id}>
            <div className="trader-cover-wrap">
              {t.photoUrl ? <img className="trader-cover-photo" src={t.photoUrl} alt={t.name} onError={e=>{(e.target as HTMLImageElement).style.display="none";}}/> : <div className={`trader-cover ${t.avatarColor}`}><span className="trader-cover-glyph">{t.avatarInitials}</span></div>}
              <span className="trader-cover-flag" title={countryInfo(t.country).name}>{flagEmoji(t.country)}</span>
            </div>
            <div className="trader-body">
              <div className="trader-name-row"><h3>{t.name}</h3><CheckCircle2 size={15} className="verified-tick"/></div>
              <p className="trader-sub">{t.handle} · Focus: {t.focus} · {t.riskLevel} risk</p>
              <p className="trader-bio">{t.bio}</p>
              <div className="trader-stats-row">
                <div><strong><Star size={12} color="#f5a623" fill="#f5a623"/> {Number(t.rating).toFixed(1)}</strong><span>Rating</span></div>
                <div className="stat-divider"/>
                <div><strong>{t.activeSubscribers}</strong><span>Subscribers</span></div>
                <div className="stat-divider"/>
                <div><strong>{price > 0 ? money(price) : "Free"}</strong><span>/ {t.subscriptionDurationDays}d</span></div>
              </div>
              <button className={subscribed ? "outline-btn full-btn trader-cta" : "primary-btn full-btn trader-cta"} disabled={loading || !ready || subscribed || subscribingId === t.id} onClick={()=>subscribeToTrader(t)}>
                {subscribed ? <><Check size={17}/> Subscribed · {left}d left</> : subscribingId === t.id ? "Subscribing..." : <><Copy size={17}/> Subscribe</>}
              </button>
            </div>
          </div>;
        })}</div>}
        <div className="copy-note"><ShieldCheck size={19}/><span>Subscribing charges your demo cash balance and grants 7 days of access to that trader's strategy. There is no auto-renewal — resubscribe once your access expires.</span></div>
        <div className="section-title-row"><div><h2>My subscriptions</h2><p>Your copy trading subscription history</p></div></div>
        {mySubscriptions.length === 0 ? <EmptyState icon={History} title="No subscriptions yet" text="Subscribe to a trader above to see your history here."/> : <div className="table-scroll"><table className="data-table"><thead><tr><th>Trader</th><th>Amount</th><th>Started</th><th>Expires</th><th>Status</th></tr></thead><tbody>{mySubscriptions.map(s=>{
          const left = daysLeft(s.expiresAt);
          const active = new Date(s.expiresAt).getTime() > Date.now();
          return <tr key={s.id}><td><div className="coin-cell"><div><strong>{s.traderName}</strong><span>{s.traderHandle}</span></div></div></td><td className="table-strong">{money(Number(s.amount))}</td><td className="muted-cell">{new Date(s.startedAt).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</td><td className="muted-cell">{new Date(s.expiresAt).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</td><td>{active ? <span className="status-pill"><span/>Active · {left}d left</span> : <span className="status-pill expired"><span/>Expired</span>}</td></tr>;
        })}</tbody></table></div>}
      </>}
      {page === "Trading Signals" && <>
        <PageTitle title={t("Market signals")} description={t("A clearer look at price momentum and today's trading range. Not financial advice.")}><span className="demo-badge"><span/> {quoteLive ? `Live · ${asOf}` : "Waiting for market data"}</span></PageTitle>
        <div className="signal-summary"><div><span className="signal-summary-icon"><Signal size={24}/></span><span><strong>Market intelligence, simplified.</strong><small>Momentum observations calculated from current CoinGecko prices and 24-hour ranges, not buy or sell recommendations.</small></span></div><button className="outline-btn" onClick={() => go("Markets")}>Explore markets <ArrowRight size={16}/></button></div>
        {signals.length ? <div className="signal-grid">{signals.map(a => {
          const rangePosition = a.high24h !== null && a.low24h !== null && a.high24h > a.low24h ? Math.max(0, Math.min(100, Math.round((a.price - a.low24h) / (a.high24h - a.low24h) * 100))) : null;
          return <div className="panel signal-card" key={a.symbol}>
            <div className="signal-card-top"><div className="coin-cell"><AssetIcon asset={a} size={42}/><div><strong>{a.name}</strong><span>{a.symbol}/USD</span></div></div><span className={`signal-type ${a.change >= 0 ? "buy" : "sell"}`}>{a.change >= 0 ? <TrendingUp size={14}/> : <TrendingDown size={14}/>} {a.change >= 0 ? "Rising" : "Falling"}</span></div>
            <p>{a.name} has {a.change >= 0 ? "gained" : "declined"} {Math.abs(a.change).toFixed(2)}% over 24 hours and {a.change7d >= 0 ? "gained" : "declined"} {Math.abs(a.change7d).toFixed(2)}% over 7 days.</p>
            <div className="confidence-row"><span>Position in today's price range</span><strong>{rangePosition === null ? "—" : `${rangePosition}%`}</strong></div><div className="confidence-track"><span style={{ width: `${rangePosition ?? 0}%` }}/></div>
            <div className="signal-levels"><div><span>Current quote</span><strong>{marketPrice(a.price)}</strong></div><div><span>24h low</span><strong>{a.low24h === null ? "—" : marketPrice(a.low24h)}</strong></div><div><span>24h high</span><strong>{a.high24h === null ? "—" : marketPrice(a.high24h)}</strong></div></div>
            <div className="signal-bottom"><span><Clock3 size={14}/> Updated {a.updatedAt ? new Date(a.updatedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "recently"}</span><button onClick={() => { setSymbol(a.symbol); go("Trade"); }}>View chart <ArrowRight size={15}/></button></div>
          </div>;
        })}</div> : <div className="panel"><EmptyState icon={Signal} title="Market observations unavailable" text="Live market prices have not loaded yet. Try refreshing in a moment."/></div>}
        <p className="disclaimer">CoinGecko provides market data, not trading advice. All trades and account balances on NexaTrade are simulated.</p>
      </>}
      {page === "Plans" && <>
        <PageTitle title={t("Choose your plan")} description={t("Subscribe weekly to unlock more of the platform. No auto-renewal — resubscribe (or switch) once your week is up.")}/>
        <div className="plans-intro"><span><Sparkles size={19}/></span> Your current plan is <strong>{data.plan ?? "No active plan"}</strong>{data.planExpiresAt && !!data.planAmount && <> · renews by {new Date(data.planExpiresAt).toLocaleDateString()}</>}. Plan charges are simulated and deducted from your demo balance.</div>
        {!plansLoaded ? <div className="no-results">Loading plans...</div> : plansCatalog.length === 0 ? <EmptyState icon={Sparkles} title="No plans available yet" text="Check back soon — an admin hasn't added any plans yet."/> : <div className="plans-grid">{plansCatalog.map(p=>{
          const isCurrent = !!p.mySubscription?.isCurrent;
          const left = p.mySubscription ? daysLeft(p.mySubscription.expiresAt) : 0;
          const price = Number(p.priceWeekly);
          return <div className={`plan-card panel ${p.isFeatured ? "featured":""}`} key={p.id}>
            {p.isFeatured && <span className="popular-label"><Zap size={13}/> MOST POPULAR</span>}
            <span className="plan-icon">{price === 0 ?<Wallet size={24}/>:p.isFeatured?<Zap size={24}/>:<WandSparkles size={24}/>}</span>
            <h2>{p.name}</h2><p>{p.description}</p>
            <div className="plan-price"><strong>{price > 0 ? money(price) : "Free"}</strong><span>/ week</span></div>
            <button className={isCurrent ? "outline-btn full-btn":"primary-btn full-btn"} disabled={isCurrent || loading || !ready || planSubscribingId === p.id} onClick={()=>subscribeToPlan(p)}>{isCurrent ? <><Check size={17}/> Current plan{price > 0 && <> · {left}d left</>}</>:planSubscribingId===p.id?"Subscribing...":<>Choose {p.name} <ArrowRight size={17}/></>}</button>
            <div className="plan-features"><span>WHAT&apos;S INCLUDED</span>{p.features.map(f=><div key={f}><Check size={16}/>{f}</div>)}</div>
            <p className="subtle-label" style={{marginTop:10}}>{p.activeSubscribers} active subscriber{p.activeSubscribers===1?"":"s"}</p>
          </div>;
        })}</div>}
        <p className="disclaimer">This is a simulation. No real billing occurs and plans do not enable live exchange connectivity.</p>
        <div className="section-title-row"><div><h2>My plan subscriptions</h2><p>Your plan subscription history</p></div></div>
        {planSubHistory.length === 0 ? <EmptyState icon={History} title="No subscriptions yet" text="Choose a plan above to see your history here."/> : <div className="table-scroll"><table className="data-table"><thead><tr><th>Plan</th><th>Amount</th><th>Started</th><th>Expires</th><th>Status</th></tr></thead><tbody>{planSubHistory.map(s=>{
          const left = daysLeft(s.expiresAt);
          const active = new Date(s.expiresAt).getTime() > Date.now();
          const isFree = Number(s.amount) === 0;
          return <tr key={s.id}><td><div className="coin-cell"><div><strong>{s.planName}</strong></div></div></td><td className="table-strong">{money(Number(s.amount))}</td><td className="muted-cell">{new Date(s.startedAt).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</td><td className="muted-cell">{isFree ? "No expiry" : new Date(s.expiresAt).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</td><td>{active ? <span className="status-pill"><span/>Active{!isFree && <> · {left}d left</>}</span> : <span className="status-pill expired"><span/>Expired</span>}</td></tr>;
        })}</tbody></table></div>}
      </>}
      {page === "Profile" && <ProfilePage notify={notify} onRequireAuth={(mode) => setAuthMode(mode)} onProfileUpdated={() => { void refresh(); }}/>}
      {page === "Deposit" && <>
        <PageTitle title={t("Add funds")} description={t("Send a payment from outside NexaTrade using one of the methods below, then submit your receipt for admin review.")}/>
        <div className="deposit-note-banner"><Hourglass size={17}/><span>Deposits are <strong>not instant</strong>. Send funds to the destination shown, upload proof of payment, and an admin will verify and credit your balance — usually within a few hours.</span></div>
        <div className="deposit-layout">
          <section className="panel deposit-panel">
            <SectionHead title="1. Choose a payment method" subtitle="Pick how you'll send funds"/>
            <div className="deposit-method-grid">
              {DEPOSIT_METHODS.map(m => <button type="button" key={m.id} className={`deposit-method-btn ${depositMethod === m.id ? "chosen" : ""}`} onClick={() => setDepositMethod(m.id)}>
                {m.id === "crypto" ? <Wallet size={18}/> : m.id === "bank_transfer" ? <CreditCard size={18}/> : m.id === "paypal" ? <ArrowLeftRight size={18}/> : m.id === "cashapp" ? <Activity size={18}/> : <Sparkles size={18}/>}
                <span>{m.label}</span>
              </button>)}
            </div>
            <p className="deposit-method-blurb">{DEPOSIT_METHODS.find(m => m.id === depositMethod)?.blurb}</p>
            <SectionHead title="2. Send funds to" subtitle="Admin-provided destination for this method"/>
            {!depositAccountsLoaded ? <div className="deposit-accounts-empty">Loading destination accounts…</div> : methodAccounts.length === 0 ? <div className="deposit-accounts-empty"><AlertTriangle size={16}/> No destination has been configured for this method yet. Please choose another method or check back soon.</div> : <div className="deposit-account-list">
              {methodAccounts.map(acc => <label key={acc.id} className={`deposit-account-card ${depositAccountId === acc.id ? "chosen" : ""}`}>
                <input type="radio" name="depositAccount" checked={depositAccountId === acc.id} onChange={() => setDepositAccountId(acc.id)}/>
                <div><strong>{acc.label}</strong><p>{acc.instructions}</p></div>
              </label>)}
            </div>}
            <form className="deposit-form" onSubmit={submitDeposit}>
              <label className="input-label">3. Amount you sent (USD)</label>
              <div className="amount-input funding-input"><span>$</span><input type="number" min="1" step="0.01" placeholder="0.00" value={depositAmount} onChange={e => setDepositAmount(e.target.value)} required/><span>USD</span></div>
              <label className="input-label">Reference (sender name, tx hash, last 4 digits — optional)</label>
              <input className="text-input" placeholder="e.g. Transaction ID or sender name" value={depositReference} onChange={e => setDepositReference(e.target.value)} maxLength={200}/>
              <label className="input-label">4. Upload your receipt</label>
              <label className="receipt-dropzone">
                <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf" onChange={e => handleReceiptFile(e.target.files?.[0] ?? null)} hidden/>
                {receiptFile ? <><FileText size={22}/><strong>{receiptFile.name}</strong><span>{(receiptFile.size / 1024).toFixed(0)} KB · Tap to replace</span></> : <><UploadCloud size={22}/><strong>Click to upload a screenshot, photo, or PDF</strong><span>JPG, PNG, WEBP, HEIC, or PDF · Max {(MAX_RECEIPT_BYTES / (1024 * 1024)).toFixed(0)}MB</span></>}
              </label>
              {receiptError && <p className="receipt-error"><XCircle size={13}/> {receiptError}</p>}
              <label className="input-label">Note for the admin (optional)</label>
              <textarea className="text-input deposit-textarea" placeholder="Anything else the reviewer should know" value={depositNote} onChange={e => setDepositNote(e.target.value)} maxLength={1000} rows={3}/>
              <button className="primary-btn full-btn" disabled={depositSubmitting || !ready}><Paperclip size={16}/>{depositSubmitting ? "Submitting..." : "Submit deposit for review"}</button>
              <p className="simulation-note"><ShieldCheck size={13}/> Your balance only updates after an admin verifies this receipt. No automatic crediting occurs.</p>
            </form>
          </section>
          <section className="panel deposit-history-panel">
            <SectionHead title="Your deposit requests" subtitle={`${myDeposits.length} submitted`}/>
            {myDeposits.length ? <div className="deposit-request-list">{myDeposits.map(r => <div className="deposit-request-item" key={r.id}>
              <div className="deposit-request-top"><strong>{money(Number(r.amount))}</strong><span className={`status-pill ${r.status}`}><span/>{r.status === "pending" ? "Pending review" : r.status === "approved" ? "Approved" : "Rejected"}</span></div>
              <p>{DEPOSIT_METHODS.find(m => m.id === r.method)?.label ?? r.method}{r.destinationLabel ? ` · ${r.destinationLabel}` : ""}</p>
              {r.adminNote && r.status === "rejected" && <p className="deposit-admin-note"><AlertTriangle size={13}/> {r.adminNote}</p>}
              <div className="deposit-request-bottom"><span>{new Date(r.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span><a href={`/api/deposits/${r.id}/receipt`} target="_blank" rel="noreferrer">View receipt</a></div>
            </div>)}</div> : <EmptyState icon={ArrowDownLeft} title="No deposit requests yet" text="Submit your first deposit above and it will show up here while it's reviewed."/>}
          </section>
        </div>
      </>}
      {page === "Withdraw" && <>
        <PageTitle title={t("Withdraw funds")} description={t("Request a payout to any platform you choose. An admin reviews and sends it before it's final.")}/>
        <div className="deposit-note-banner"><Hourglass size={17}/><span>The requested amount is <strong>reserved from your available balance</strong> right away. An admin manually sends your payout, then approves the request here — or rejects it and the amount is returned to your balance.</span></div>
        <div className="deposit-layout">
          <section className="panel deposit-panel">
            <SectionHead title="1. Choose a payout method" subtitle="Pick how you'd like to receive funds"/>
            <div className="deposit-method-grid">
              {WITHDRAWAL_METHODS.map(m => <button type="button" key={m.id} className={`deposit-method-btn ${withdrawalMethod === m.id ? "chosen" : ""}`} onClick={() => setWithdrawalMethod(m.id)}>
                {m.id === "crypto" ? <Wallet size={18}/> : m.id === "bank_transfer" ? <CreditCard size={18}/> : m.id === "paypal" ? <ArrowLeftRight size={18}/> : m.id === "cashapp" ? <Activity size={18}/> : m.id === "giftcard" ? <Sparkles size={18}/> : <SlidersHorizontal size={18}/>}
                <span>{m.label}</span>
              </button>)}
            </div>
            <p className="deposit-method-blurb">{WITHDRAWAL_METHODS.find(m => m.id === withdrawalMethod)?.blurb}</p>
            <form className="deposit-form" onSubmit={submitWithdrawal}>
              {withdrawalMethod === "other" && <><label className="input-label">Platform name</label><input className="text-input" placeholder="e.g. Skrill, Payoneer, Zelle..." value={withdrawalMethodLabelInput} onChange={e => setWithdrawalMethodLabelInput(e.target.value)} maxLength={60}/></>}
              <label className="input-label">2. Where should we send it?</label>
              <textarea className="text-input deposit-textarea" placeholder={WITHDRAWAL_METHODS.find(m => m.id === withdrawalMethod)?.placeholder} value={withdrawalDestination} onChange={e => setWithdrawalDestination(e.target.value)} rows={3} maxLength={500} required/>
              <label className="input-label">3. Amount to withdraw (USD)</label>
              <div className="amount-input funding-input"><span>$</span><input type="number" min="1" step="0.01" placeholder="0.00" value={withdrawalAmount} onChange={e => setWithdrawalAmount(e.target.value)} required/><span>USD</span></div>
              <div className="quick-amounts">{[100, 500, 1000, 5000].map(n => <button type="button" key={n} onClick={() => setWithdrawalAmount(String(n))}>${n.toLocaleString()}</button>)}</div>
              <div className="funding-balance"><span>Available wallet balance</span><strong>{money(data.user.cashBalance)}</strong></div>
              <label className="input-label">Note for the admin (optional)</label>
              <textarea className="text-input deposit-textarea" placeholder="Anything else the reviewer should know" value={withdrawalNote} onChange={e => setWithdrawalNote(e.target.value)} maxLength={1000} rows={2}/>
              <button className="primary-btn full-btn" disabled={withdrawalSubmitting || !ready}>{withdrawalSubmitting ? "Submitting..." : "Submit withdrawal for review"}<ArrowRight size={17}/></button>
              <p className="simulation-note"><ShieldCheck size={13}/> No automatic payout is sent. Funds leave only after an admin verifies and approves this request.</p>
            </form>
          </section>
          <section className="panel deposit-history-panel">
            <SectionHead title="Your withdrawal requests" subtitle={`${myWithdrawals.length} submitted`}/>
            {myWithdrawals.length ? <div className="deposit-request-list">{myWithdrawals.map(r => <div className="deposit-request-item" key={r.id}>
              <div className="deposit-request-top"><strong>{money(Number(r.amount))}</strong><span className={`status-pill ${r.status}`}><span/>{r.status === "pending" ? "Pending review" : r.status === "approved" ? "Approved" : "Rejected"}</span></div>
              <p>{WITHDRAWAL_METHODS.find(m => m.id === r.method)?.id === "other" ? (r.methodLabel || "Other") : WITHDRAWAL_METHODS.find(m => m.id === r.method)?.label}{" · "}{r.destination}</p>
              {r.adminNote && r.status === "rejected" && <p className="deposit-admin-note"><AlertTriangle size={13}/> {r.adminNote}</p>}
              <div className="deposit-request-bottom"><span>{new Date(r.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span></div>
            </div>)}</div> : <EmptyState icon={ArrowUpRight} title="No withdrawal requests yet" text="Submit your first withdrawal above and it will show up here while it's reviewed."/>}
          </section>
        </div>
      </>}
      {page === "Transactions" && (() => {
        const txTypes = Array.from(new Set(data.transactions.map(t => t.type)));
        const filteredTransactions = data.transactions.filter(t =>
          (txTypeFilter === "all" || t.type === txTypeFilter) &&
          (txSearch.trim() === "" || t.description.toLowerCase().includes(txSearch.toLowerCase()) || t.type.toLowerCase().includes(txSearch.toLowerCase()))
        );
        const isCreditType = (type: string) => type === "deposit" || type === "admin_credit" || type === "profit_credit" || type === "referral_bonus";
        const exportTransactions = () => downloadCsv("transactions", filteredTransactions.map(t => ({ Date: new Date(t.createdAt).toISOString(), Type: t.type, Description: t.description, Amount: (isCreditType(t.type) ? "+" : "-") + Number(t.amount).toFixed(2) })));
        return <>
          <PageTitle title={t("Transactions")} description={t("Keep track of every deposit, withdrawal, and plan charge.")}><button className="outline-btn" onClick={()=>go("Deposit")}><Plus size={17}/> Add funds</button></PageTitle>
          <div className="stats-grid three">{card(ArrowDownLeft,"Total deposited",money(data.transactions.filter(t=>t.type==="deposit").reduce((s,t)=>s+Number(t.amount),0)),<span>All time</span>, "green")}{card(ArrowUpRight,"Total withdrawn",money(data.transactions.filter(t=>t.type==="withdrawal").reduce((s,t)=>s+Number(t.amount),0)),<span>All time</span>, "orange")}{card(Wallet,"Current cash balance",money(data.user.cashBalance),<span>Available to trade</span>)}</div>
          <section className="panel">
            <SectionHead title="Transaction history" subtitle="A record of your wallet activity" action={
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <div className="market-search" style={{ height: 37 }}><Search size={15}/><input placeholder="Search" value={txSearch} onChange={e => setTxSearch(e.target.value)}/></div>
                <div className="select-wrap" style={{ height: 37 }}><select value={txTypeFilter} onChange={e => setTxTypeFilter(e.target.value)}><option value="all">All types</option>{txTypes.map(ty => <option key={ty} value={ty}>{ty.replace(/_/g, " ")}</option>)}</select></div>
                <button className="outline-btn" disabled={filteredTransactions.length === 0} onClick={exportTransactions}><Download size={15}/> Export CSV</button>
              </div>
            }/>
            {filteredTransactions.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Transaction</th><th>Type</th><th>Date</th><th>Amount</th><th>Status</th></tr></thead><tbody>{filteredTransactions.map(t=>{const isCredit=isCreditType(t.type);return <tr key={t.id}><td><div className="transaction-cell"><span className={`transaction-icon ${t.type}`}>{t.type==="deposit"?<ArrowDownLeft size={19}/>:t.type==="withdrawal"?<ArrowUpRight size={19}/>:t.type==="admin_credit"?<Plus size={19}/>:t.type==="admin_debit"?<MoreHorizontal size={19}/>:t.type==="profit_credit"||t.type==="profit_debit"?<TrendingUp size={19}/>:t.type==="referral_bonus"?<Gift size={19}/>:<Sparkles size={19}/>}</span><strong>{t.description}</strong></div></td><td className="capitalize">{t.type.replace(/_/g," ")}</td><td className="muted-cell">{new Date(t.createdAt).toLocaleString("en-US",{month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"})}</td><td className={`table-strong ${isCredit?"positive-text":""}`}>{isCredit?"+":"-"}{money(Number(t.amount))}</td><td><span className="status-pill"><span/>Completed</span></td></tr>;})}</tbody></table></div> : (data.transactions.length ? <div className="no-results">No transactions match your search.</div> : <EmptyState icon={CreditCard} title="No transactions yet" text="Deposits and withdrawals will show up here."/>)}
          </section>
        </>;
      })()}
      {page === "Notifications" && (() => {
        const notifFilterOptions: { label: string; value: string }[] = [
          { label: "All", value: "" },
          { label: "Trading", value: "trade_placed" },
          { label: "Orders", value: "order_filled" },
          { label: "Positions", value: "position_auto_closed" },
          { label: "Deposits", value: "deposit_approved" },
          { label: "Withdrawals", value: "withdrawal_approved" },
          { label: "Price alerts", value: "price_alert_triggered" },
          { label: "Referrals", value: "referral_bonus" },
          { label: "Account", value: "login" },
          { label: "Announcements", value: "admin_message" },
        ];
        const page1 = notifOffset + 1;
        const pageCount = Math.max(Math.ceil(notifTotal / NOTIF_PAGE_SIZE), 1);
        const currentPageNum = Math.floor(notifOffset / NOTIF_PAGE_SIZE) + 1;
        return <>
          <PageTitle title={t("Notifications")} description={t("Everything NexaTrade has told you, in one place.")}>
            {data.unreadNotifications > 0 && <button className="outline-btn" onClick={() => void markAllNotificationsRead()}><Check size={16}/> Mark all read</button>}
          </PageTitle>
          <section className="panel">
            <SectionHead title="All notifications" subtitle={`${notifTotal} total`} action={
              <div className="notifications-page-filters">
                <div className="select-wrap" style={{ height: 37 }}><select value={notifTypeFilter} onChange={(e) => { setNotifTypeFilter(e.target.value); void loadAllNotifications(0, e.target.value); }}>{notifFilterOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
              </div>
            }/>
            {notifLoading ? <div className="no-results">Loading notifications...</div> : allNotifications.length === 0 ? <EmptyState icon={Bell} title="No notifications" text="Nothing here yet — activity on your account will show up in this list."/> : <>
              <div className="notifications-page-list">{allNotifications.map(n => { const { Icon, color } = notificationVisual(n.type); return <div className={`notification-item ${n.readAt ? "" : "unread"}`} key={n.id} onClick={() => !n.readAt && markOneNotificationRead(n.id)} style={{ cursor: n.readAt ? "default" : "pointer" }}>
                <span className={`notification-icon ${color}`}><Icon size={16}/></span>
                <div><strong>{n.title}</strong><p>{n.message}</p><small>{new Date(n.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</small></div>
              </div>; })}</div>
              <div className="notifications-pagination">
                <button className="outline-btn small" disabled={page1 <= 1} onClick={() => loadAllNotifications(Math.max(notifOffset - NOTIF_PAGE_SIZE, 0), notifTypeFilter)}><ChevronLeft size={14}/> Previous</button>
                <span>Page {currentPageNum} of {pageCount}</span>
                <button className="outline-btn small" disabled={notifOffset + NOTIF_PAGE_SIZE >= notifTotal} onClick={() => loadAllNotifications(notifOffset + NOTIF_PAGE_SIZE, notifTypeFilter)}>Next <ChevronRight size={14}/></button>
              </div>
            </>}
          </section>
        </>;
      })()}
      {page === "Trade History" && (() => {
        const matchesSearch = (symbol: string) => historySearch.trim() === "" || symbol.toLowerCase().includes(historySearch.trim().toLowerCase());
        const searchBox = <div className="market-search" style={{ height: 37 }}><Search size={15}/><input placeholder="Search by symbol" value={historySearch} onChange={e => setHistorySearch(e.target.value)}/></div>;
        const visibleTrades = data.trades.filter(t => (historyTab === "All" || t.side === historyTab.toLowerCase()) && matchesSearch(t.symbol));
        const visibleOrders = [...myOrders.open, ...myOrders.history].filter(o => matchesSearch(o.symbol));
        const visiblePositions = [...myPositions.open, ...myPositions.history].filter(p => matchesSearch(p.symbol));
        return <>
        <PageTitle title={t("Trade history")} description={t("Review every spot trade, order, and leveraged position in your paper-trading account.")}><button className="outline-btn" onClick={()=>go("Trade")}><Plus size={17}/> New trade</button></PageTitle>
        <div className="segmented" style={{ marginBottom: 18 }}>{(["Trades", "Orders", "Positions"] as const).map(s => <button key={s} className={historySection === s ? "active" : ""} onClick={() => setHistorySection(s)}>{s}</button>)}</div>
        {historySection === "Trades" && <>
          <div className="stats-grid three">{card(ArrowLeftRight,"Total trades",String(data.trades.length),<span>Completed orders</span>)}{card(ArrowDownLeft,"Buy orders",String(data.trades.filter(t=>t.side==="buy").length),<span>Assets purchased</span>,"green")}{card(ArrowUpRight,"Sell orders",String(data.trades.filter(t=>t.side==="sell").length),<span>Assets sold</span>,"orange")}</div>
          <section className="panel"><div className="section-head"><div><h2>All trades</h2><p>Your complete order history</p></div><div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>{searchBox}<div className="segmented">{["All","Buy","Sell"].map(t=><button key={t} className={historyTab===t?"active":""} onClick={()=>setHistoryTab(t)}>{t}</button>)}</div><button className="outline-btn" disabled={visibleTrades.length === 0} onClick={() => downloadCsv("trades", visibleTrades.map(t => ({ Date: new Date(t.createdAt).toISOString(), Symbol: t.symbol, Side: t.side, Quantity: t.quantity, Price: t.price, Total: t.total })))}><Download size={15}/> Export CSV</button></div></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Asset</th><th>Type</th><th>Quantity</th><th>Price</th><th>Total</th><th>Date</th><th>Status</th></tr></thead><tbody>{visibleTrades.map(t=>{const a=getAsset(t.symbol);return <tr key={t.id}><td><div className="coin-cell">{a&&<AssetIcon asset={a} size={34}/>}<div><strong>{a?.name}</strong><span>{t.symbol}{supportBadge(t)}</span></div></div></td><td><span className={`type-pill ${t.side}`}>{t.side==="buy"?<ArrowDownLeft size={13}/>:<ArrowUpRight size={13}/>} {t.side}</span></td><td className="table-strong">{fmtQty(Number(t.quantity))} {t.symbol}</td><td>{marketPrice(Number(t.price))}</td><td className="table-strong">{money(Number(t.total))}</td><td className="muted-cell">{new Date(t.createdAt).toLocaleString("en-US",{month:"short",day:"numeric",year:"numeric"})}</td><td><span className="status-pill"><span/>Completed</span></td></tr>})}</tbody></table>{visibleTrades.length===0&&<EmptyState icon={History} title="No trades found" text="Your completed orders will appear here."/>}</div></section>
        </>}
        {historySection === "Orders" && <>
          <div className="stats-grid three">{card(Clock3,"Open orders",String(myOrders.open.length),<span>Awaiting trigger price</span>)}{card(CheckCircle2,"Filled orders",String(myOrders.history.filter(o=>o.status==="filled").length),<span>Executed limit/stop/TP orders</span>,"green")}{card(X,"Cancelled orders",String(myOrders.history.filter(o=>o.status==="cancelled").length),<span>Withdrawn before filling</span>,"orange")}</div>
          <section className="panel"><SectionHead title="All orders" subtitle="Limit, stop-loss, and take-profit orders — market orders fill instantly and appear under Trades" action={<div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>{searchBox}<button className="outline-btn" disabled={visibleOrders.length === 0} onClick={() => downloadCsv("orders", visibleOrders.map(o => ({ Placed: new Date(o.createdAt).toISOString(), Symbol: o.symbol, Type: o.type, Side: o.side, Quantity: o.quantity, TriggerPrice: o.triggerPrice, Status: o.status })))}><Download size={15}/> Export CSV</button></div>}/>
            {!ordersLoaded ? <div className="no-results">Loading orders...</div> : visibleOrders.length === 0 ? <EmptyState icon={Clock3} title="No orders found" text="Place a limit, stop-loss, or take-profit order from the Trade page to see it here."/> : <div className="table-scroll"><table className="data-table"><thead><tr><th>Asset</th><th>Type</th><th>Side</th><th>Quantity</th><th>Trigger price</th><th>Placed</th><th>Status</th><th></th></tr></thead><tbody>{visibleOrders.map(o => { const a = getAsset(o.symbol); return <tr key={o.id}>
              <td><div className="coin-cell">{a && <AssetIcon asset={a} size={32}/>}<div><strong>{a?.name ?? o.symbol}</strong><span>{o.symbol}</span></div></div></td>
              <td>{orderTypeLabel(o.type)}</td>
              <td><span className={`type-pill ${o.side}`}>{o.side === "buy" ? <ArrowDownLeft size={13}/> : <ArrowUpRight size={13}/>} {o.side}</span></td>
              <td className="table-strong">{fmtQty(Number(o.quantity))} {o.symbol}</td>
              <td>{marketPrice(Number(o.triggerPrice))}</td>
              <td className="muted-cell">{new Date(o.createdAt).toLocaleString("en-US",{month:"short",day:"numeric",year:"numeric"})}</td>
              <td><span className={`status-pill ${o.status}`}><span/>{o.status[0].toUpperCase()+o.status.slice(1)}</span></td>
              <td>{o.status === "open" && <button className="icon-btn" title="Cancel order" disabled={cancellingOrderId === o.id} onClick={() => cancelOrder(o.id)}>{cancellingOrderId === o.id ? <RefreshCw size={16} className="spin"/> : <Trash2 size={16}/>}</button>}</td>
            </tr>; })}</tbody></table></div>}
          </section>
        </>}
        {historySection === "Positions" && <>
          <div className="stats-grid three">{card(Zap,"Open positions",String(myPositions.open.length),<span>Live leveraged exposure</span>)}{card(TrendingUp,"Closed in profit",String(myPositions.history.filter(p=>Number(p.realizedPnl)>0).length),<span>Manually closed or take-profit</span>,"green")}{card(TrendingDown,"Liquidated",String(myPositions.history.filter(p=>p.status==="liquidated").length),<span>Lost full margin</span>,"orange")}</div>
          <section className="panel"><SectionHead title="All positions" subtitle="Leveraged long/short positions, open and closed" action={<div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>{searchBox}<button className="outline-btn" disabled={visiblePositions.length === 0} onClick={() => downloadCsv("positions", visiblePositions.map(p => ({ Symbol: p.symbol, Side: p.side, Leverage: p.leverage, Margin: p.margin, Entry: p.entryPrice, Liquidation: p.liquidationPrice, ClosedAt: p.closedAt ? new Date(p.closedAt).toISOString() : "", Status: p.status })))}><Download size={15}/> Export CSV</button></div>}/>
            {!positionsLoaded ? <div className="no-results">Loading positions...</div> : visiblePositions.length === 0 ? <EmptyState icon={Zap} title="No positions found" text="Open a leveraged long or short position from the Trade page to see it here."/> : <div className="table-scroll"><table className="data-table"><thead><tr><th>Asset</th><th>Side</th><th>Leverage</th><th>Margin</th><th>Entry</th><th>Liquidation</th><th>Closed at</th><th>P&L</th><th>Status</th><th></th></tr></thead><tbody>{visiblePositions.map(p => { const a = getAsset(p.symbol); const pnl = p.status === "open" ? (p.unrealizedPnl ?? positionPnl(p.side, Number(p.entryPrice), p.currentPrice ?? Number(p.entryPrice), Number(p.quantity))) : Number(p.realizedPnl ?? 0); return <tr key={p.id}>
              <td><div className="coin-cell">{a && <AssetIcon asset={a} size={32}/>}<div><strong>{a?.name ?? p.symbol}</strong><span>{p.symbol}</span></div></div></td>
              <td><span className={`type-pill ${p.side === "long" ? "buy" : "sell"}`}>{p.side === "long" ? <ArrowUpRight size={13}/> : <ArrowDownLeft size={13}/>} {p.side}</span></td>
              <td className="table-strong">{Number(p.leverage)}x</td>
              <td>{money(Number(p.margin))}</td>
              <td>{marketPrice(Number(p.entryPrice))}</td>
              <td className="liquidation-cell">{marketPrice(Number(p.liquidationPrice))}</td>
              <td className="muted-cell">{p.closedAt ? new Date(p.closedAt).toLocaleString("en-US",{month:"short",day:"numeric",year:"numeric"}) : "—"}</td>
              <td className={`table-strong position-pnl ${pnl >= 0 ? "positive-text" : "negative-text"}`}>{pnl >= 0 ? "+" : ""}{money(pnl)}</td>
              <td><span className={`status-pill ${p.status}`}><span/>{p.status[0].toUpperCase()+p.status.slice(1)}</span></td>
              <td>{p.status === "open" && <button className="icon-btn" title="Close position" disabled={closingPositionId === p.id} onClick={() => closePosition(p.id)}>{closingPositionId === p.id ? <RefreshCw size={16} className="spin"/> : <XCircle size={16}/>}</button>}</td>
            </tr>; })}</tbody></table></div>}
          </section>
        </>}
        </>;
      })()}
      <footer className="main-footer"><span>© 2026 NexaTrade. Built for curious traders.</span><span><ShieldCheck size={14}/> Simulation only · Not financial advice</span></footer>
    </main></div>
    {toast && <div className={`toast ${toast.error ? "error":""}`}><span>{toast.error ? <X size={17}/>:<Check size={17}/>}</span>{toast.text}<button onClick={()=>setToast(null)}><X size={15}/></button></div>}
    {authMode==="login" && <div className="modal-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setAuthMode(null);}}><div className="auth-modal"><button className="modal-close" onClick={()=>setAuthMode(null)} aria-label="Close"><X size={20}/></button><div className="modal-brand"><div className="brand-icon"><Activity size={23} strokeWidth={3}/></div>Nexa<span>Trade</span></div><h2>{t("Welcome back")}</h2><p>{t("Sign in to pick up right where you left off.")}</p><form onSubmit={authenticate}><label className="input-label">{t("Email or username")}</label><input className="text-input" placeholder="you@example.com or username" value={authIdentifier} onChange={e=>setAuthIdentifier(e.target.value)} required/><label className="input-label">{t("Password")}</label><input className="text-input" type="password" placeholder="At least 8 characters" value={authPassword} onChange={e=>setAuthPassword(e.target.value)} required/><div className="modal-forgot"><button type="button" onClick={()=>{setAuthMode(null);setForgotPasswordOpen(true);}}>{t("Forgot password?")}</button></div><button className="primary-btn full-btn" disabled={loading}>{loading?t("Please wait..."):t("Sign in")}<ArrowRight size={17}/></button></form><div className="modal-switch">{t("New to NexaTrade?")} <button onClick={()=>setAuthMode("register")}>{t("Create account")}</button></div><div className="modal-security"><LockKeyhole size={14}/> {t("Your account is secured with encrypted credentials")}</div></div></div>}
    {authMode==="register" && <RegisterModal onClose={()=>setAuthMode(null)} onSwitchToLogin={()=>setAuthMode("login")} onRegistered={handleRegistered}/>}
    {forgotPasswordOpen && <ForgotPasswordModal onClose={()=>setForgotPasswordOpen(false)} onSwitchToLogin={()=>{setForgotPasswordOpen(false);setAuthMode("login");}}/>}
    {demoGateOpen && <div className="modal-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setDemoGateOpen(false);}}><div className="demo-gate-modal"><button className="modal-close" onClick={()=>setDemoGateOpen(false)} aria-label="Close"><X size={20}/></button><div className="demo-gate-icon"><UserRound size={24}/></div><h2>{t("Create a free account to continue")}</h2><p>{t("Your demo trades, deposits, and subscriptions won't be saved until you create a free account.")}</p><div className="demo-gate-actions"><button className="primary-btn" onClick={() => { setDemoGateOpen(false); setAuthMode("register"); }}>{t("Sign up free")} <ArrowRight size={16}/></button><button className="outline-btn" onClick={() => { setDemoGateOpen(false); setAuthMode("login"); }}>{t("Sign in")}</button><button className="outline-btn" onClick={() => setDemoGateOpen(false)}>{t("Keep exploring")}</button></div></div></div>}
  </div>;
}
