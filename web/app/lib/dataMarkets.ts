export type DataMarket = "CN" | "US" | "FX" | "GOLD";

export const dataMarkets: Array<{ id: DataMarket; label: string; description: string }> = [
  { id: "CN", label: "A股", description: "沪深京股票、指数、基金与可转债" },
  { id: "US", label: "美股", description: "Alpaca 免费历史行情" },
  { id: "FX", label: "外汇", description: "主要与交叉货币对" },
  { id: "GOLD", label: "黄金", description: "现货黄金与贵金属" },
];

export function marketRuleCode(market: string) {
  const normalized = market.trim().toUpperCase();
  if (normalized === "CN" || normalized === "A股") return "CN";
  if (normalized === "US" || normalized === "美股") return "US";
  if (normalized === "FX" || normalized === "FOREX" || normalized === "外汇") return "FX";
  if (normalized === "GOLD" || normalized === "METAL" || normalized === "黄金") return "GOLD";
  return normalized;
}

export function marketSelectionLabel(market: string | undefined) {
  const code = marketRuleCode(market ?? "");
  if (code === "CN") return "A股";
  if (code === "US") return "美股";
  if (code === "FX") return "FX";
  if (code === "GOLD") return "GOLD";
  return market?.trim() ?? "";
}
