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

/**
 * Returns the price level where the next opening would reach the configured
 * directional gap threshold. The level is only useful when it is a positive,
 * finite market price; disabled filters and impossible low-side levels return
 * undefined.
 */
export function openingGapThresholdPrice(
  previousClose: number,
  filter: Partial<OpeningGapFilter> | undefined,
): number | undefined {
  const normalized = normalizeOpeningGapFilter(filter);
  if (normalized.mode === "off") return undefined;

  const close = Number(previousClose);
  if (!Number.isFinite(close) || close <= 0) return undefined;

  const amount = normalized.unit === "price"
    ? normalized.threshold
    : close * normalized.threshold / 100;
  const directionalPrice = normalized.mode === "high"
    ? close + amount
    : close - amount;
  return Number.isFinite(directionalPrice) && directionalPrice > 0
    ? directionalPrice
    : undefined;
}
