export type ChartPeriod = "24H" | "7D" | "30D" | "1Y";
export type ChartPoint = { timestamp: number; price: number };
export type Candle = { timestamp: number; open: number; high: number; low: number; close: number; volume: number };

export type Asset = {
  id: string;
  symbol: string;
  name: string;
  color: string;
  mark: string;
  image: string | null;
  price: number;
  change: number;
  change7d: number;
  volume: string;
  cap: string;
  volumeUsd: number;
  capUsd: number;
  chart: number[];
  rank: number | null;
  high24h: number | null;
  low24h: number | null;
  updatedAt: string | null;
};

export type MarketSnapshot = {
  assets: Asset[];
  status: "live" | "stale" | "unavailable";
  updatedAt: string | null;
  source: "CoinGecko";
};

// The catalog identifies supported coins; it contains no fabricated market data.
const catalog = [
  { id: "bitcoin", symbol: "BTC", name: "Bitcoin", color: "#F7931A", mark: "₿" },
  { id: "ethereum", symbol: "ETH", name: "Ethereum", color: "#627EEA", mark: "◆" },
  { id: "solana", symbol: "SOL", name: "Solana", color: "#8B5CF6", mark: "≋" },
  { id: "binancecoin", symbol: "BNB", name: "BNB", color: "#F3BA2F", mark: "✦" },
  { id: "avalanche-2", symbol: "AVAX", name: "Avalanche", color: "#E84142", mark: "▲" },
  { id: "chainlink", symbol: "LINK", name: "Chainlink", color: "#2A5ADA", mark: "⬡" },
  { id: "cardano", symbol: "ADA", name: "Cardano", color: "#3468D1", mark: "✳" },
  { id: "dogecoin", symbol: "DOGE", name: "Dogecoin", color: "#C2A633", mark: "Ð" },
] as const;

export const supportedCoins = catalog;
export const assets: Asset[] = catalog.map((coin) => ({
  ...coin,
  image: null,
  price: 0,
  change: 0,
  change7d: 0,
  volume: "—",
  cap: "—",
  volumeUsd: 0,
  capUsd: 0,
  chart: [],
  rank: null,
  high24h: null,
  low24h: null,
  updatedAt: null,
}));

export const getAsset = (symbol: string) => assets.find((asset) => asset.symbol === symbol);

// USD-only formatters. These are for internal/catalog data, NOT for
// anything a signed-in user reads: every user-facing amount must go through
// src/lib/currency.ts (client) or moneyFormatterFor() from src/lib/fx-server.ts
// (server) so it renders in the viewer's chosen display currency.
export const money = (value: number, digits = 2) =>
  Number.isFinite(value)
    ? "$" + value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : "—";

export const marketPrice = (value: number) =>
  value > 0 && Number.isFinite(value)
    ? money(value, value >= 1 ? 2 : value >= 0.1 ? 4 : value >= 0.0001 ? 6 : 8)
    : "—";

export const compactMoney = (value: number) =>
  Number.isFinite(value) && value > 0
    ? "$" + Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value)
    : "—";
