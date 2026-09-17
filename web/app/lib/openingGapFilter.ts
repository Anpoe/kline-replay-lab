export type OpeningGapMode = "off" | "high" | "low";
export type OpeningGapUnit = "percent" | "price";

export type OpeningGapFilter = {
  mode: OpeningGapMode;
  unit: OpeningGapUnit;
  threshold: number;
};

export const DEFAULT_OPENING_GAP_FILTER: OpeningGapFilter = {
  mode: "off",
  unit: "percent",
  threshold: 3,
};

const MAX_OPENING_GAP_THRESHOLD = 1_000_000;

export function nextOpeningGapMode(mode: OpeningGapMode): OpeningGapMode {
  if (mode === "off") return "high";
  if (mode === "high") return "low";
  return "off";
}

export function normalizeOpeningGapFilter(value: unknown): OpeningGapFilter {
  const stored = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<OpeningGapFilter>
    : {};
  const threshold = Number(stored.threshold);
  return {
    mode: stored.mode === "high" || stored.mode === "low" ? stored.mode : "off",
    unit: stored.unit === "price" ? "price" : "percent",
    threshold: Number.isFinite(threshold) && threshold > 0
      ? Math.min(MAX_OPENING_GAP_THRESHOLD, threshold)
      : DEFAULT_OPENING_GAP_FILTER.threshold,
  };
}

export type OpeningGapEvaluation = {
  blocked: boolean;
  gapPrice: number;
  gapPercent: number;
  thresholdPrice: number;
};

export function evaluateOpeningGap(
  previousClose: number,
  openingPrice: number,
  filter: Partial<OpeningGapFilter> | undefined,
): OpeningGapEvaluation {
  const normalized = normalizeOpeningGapFilter(filter);
  const close = Number(previousClose);
  const open = Number(openingPrice);
  const gapPrice = open - close;
  const gapPercent = close > 0 && Number.isFinite(close) && Number.isFinite(open)
    ? gapPrice / close * 100
    : 0;
  const thresholdPrice = normalized.unit === "price"
    ? normalized.threshold
    : close > 0 && Number.isFinite(close)
      ? close * normalized.threshold / 100
      : 0;
  const gapAmount = normalized.mode === "low" ? -gapPrice : gapPrice;
  const directionalGapAmount = normalized.unit === "price" ? gapAmount : normalized.mode === "low" ? -gapPercent : gapPercent;
  const thresholdAmount = normalized.threshold;

  return {
    blocked: normalized.mode !== "off"
      && Number.isFinite(close)
      && close > 0
      && Number.isFinite(open)
      && open > 0
      && directionalGapAmount >= thresholdAmount,
    gapPrice,
    gapPercent,
    thresholdPrice,
  };
}
