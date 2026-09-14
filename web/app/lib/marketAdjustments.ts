export type StockAdjustmentType = "qfq" | "hfq" | "all";

/**
 * 股票训练数据只使用经过公司行为调整的价格。
 * A 股默认前复权；美股交给 Alpaca 同时处理拆股、分红和分拆。
 */
export const DEFAULT_CN_ADJUSTMENT_TYPE: StockAdjustmentType = "qfq";
export const DEFAULT_US_ADJUSTMENT_TYPE: StockAdjustmentType = "all";

export function marketCode(market: string | undefined) {
  const normalized = String(market ?? "").trim().toUpperCase();
  if (normalized === "A股") return "CN";
  if (normalized === "美股") return "US";
  return normalized;
}

export function defaultAdjustmentTypeForMarket(market: string | undefined): StockAdjustmentType | "none" {
  const code = marketCode(market);
  if (code === "CN") return DEFAULT_CN_ADJUSTMENT_TYPE;
  if (code === "US") return DEFAULT_US_ADJUSTMENT_TYPE;
  return "none";
}

export function defaultAdjustmentTypeForInstrument(instrumentId: string, market?: string) {
  if (market) return defaultAdjustmentTypeForMarket(market);
  const normalized = String(instrumentId).trim().toUpperCase();
  if (/\.(SH|SZ|BJ)$/.test(normalized)) return DEFAULT_CN_ADJUSTMENT_TYPE;
  if (/\.US$/.test(normalized) || !normalized.includes(".")) return DEFAULT_US_ADJUSTMENT_TYPE;
  return "none" as const;
}

export function normalizeStockAdjustmentType(
  market: string | undefined,
  requested: string | undefined,
) {
  const fallback = defaultAdjustmentTypeForMarket(market);
  if (fallback === "none") return "none" as const;
  if (marketCode(market) === "CN") {
    return requested === "hfq" ? "hfq" : DEFAULT_CN_ADJUSTMENT_TYPE;
  }
  return DEFAULT_US_ADJUSTMENT_TYPE;
}

export function isStockAdjustmentType(value: string | undefined): value is StockAdjustmentType {
  return value === "qfq" || value === "hfq" || value === "all";
}

export function adjustmentLabel(value: string | undefined) {
  if (value === "qfq") return "前复权";
  if (value === "hfq") return "后复权";
  if (value === "all") return "全复权";
  if (value === "none") return "不复权";
  return value || "未标注";
}
