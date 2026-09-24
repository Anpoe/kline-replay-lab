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

export const OPENING_GAP_THRESHOLD_DECIMALS = 4;
export const MIN_OPENING_GAP_THRESHOLD = 10 ** -OPENING_GAP_THRESHOLD_DECIMALS;
const MAX_OPENING_GAP_THRESHOLD = 1_000_000;

export function roundOpeningGapThreshold(value: number) {
  return Number(value.toFixed(OPENING_GAP_THRESHOLD_DECIMALS));
}

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
  const normalizedThreshold = Number.isFinite(threshold) && threshold > 0
    ? Math.min(MAX_OPENING_GAP_THRESHOLD, Math.max(MIN_OPENING_GAP_THRESHOLD, threshold))
    : DEFAULT_OPENING_GAP_FILTER.threshold;
  return {
    mode: stored.mode === "high" || stored.mode === "low" ? stored.mode : "off",
    unit: stored.unit === "price" ? "price" : "percent",
    threshold: roundOpeningGapThreshold(normalizedThreshold),
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
  const thresholdLevel = normalized.mode === "low"
    ? close - thresholdPrice
    : close + thresholdPrice;
  const validPrices = Number.isFinite(close)
    && close > 0
    && Number.isFinite(open)
    && open > 0;
  const outsideAllowedRange = normalized.mode === "high"
    ? open < close || open >= thresholdLevel
    : normalized.mode === "low"
      ? open > close || open <= thresholdLevel
      : false;

  return {
    blocked: normalized.mode !== "off"
      && validPrices
      && outsideAllowedRange,
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

/** Convert a dragged guide price back into the configured directional distance. */
export function openingGapThresholdFromPrice(
  previousClose: number,
  guidePrice: number,
  filter: Pick<OpeningGapFilter, "mode" | "unit">,
): number | undefined {
  const close = Number(previousClose);
  const price = Number(guidePrice);
  if (filter.mode === "off"
    || !Number.isFinite(close)
    || close <= 0
    || !Number.isFinite(price)
    || price <= 0) return undefined;

  const distance = filter.mode === "high" ? price - close : close - price;
  if (!Number.isFinite(distance) || distance <= 0) return undefined;
  const threshold = filter.unit === "percent" ? distance / close * 100 : distance;
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > MAX_OPENING_GAP_THRESHOLD) return undefined;
  const rounded = roundOpeningGapThreshold(threshold);
  return rounded >= MIN_OPENING_GAP_THRESHOLD ? rounded : undefined;
}
