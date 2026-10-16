export function calculateCloseStandardDeviation(candles, endIndex, lookback) {
  if (!Number.isInteger(lookback) || lookback < 2 || !Number.isInteger(endIndex)
    || endIndex < lookback - 1 || endIndex >= candles.length) return null;
  const closes = candles.slice(endIndex - lookback + 1, endIndex + 1).map((bar) => bar.close);
  if (closes.some((close) => !Number.isFinite(close) || close <= 0)) return null;
  const mean = closes.reduce((sum, close) => sum + close, 0) / closes.length;
  // Population standard deviation: this window is the complete reference range.
  const variance = closes.reduce((sum, close) => sum + (close - mean) ** 2, 0) / closes.length;
  const deviation = Math.sqrt(variance);
  const percentage = deviation / mean * 100;
  return Number.isFinite(mean) && Number.isFinite(percentage) ? { mean, deviation, percentage } : null;
}

export function matchesStandardDeviationCondition(candles, index, parameters) {
  const number = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const period = Math.max(2, Math.min(200, Math.round(number(parameters.period, 20))));
  const endIndex = parameters.window === "previous" ? index - 1 : index;
  const statistics = calculateCloseStandardDeviation(candles, endIndex, period);
  if (!statistics) return false;
  const threshold = Math.max(0, Math.min(100, number(parameters.percentage, 2)));
  return parameters.relation === "at_least"
    ? statistics.percentage >= threshold
    : statistics.percentage <= threshold;
}

/** Additional breakout gates; the existing percentage and volume rules still apply. */
export function matchesBreakoutStandardDeviation(candles, index, lookback, parameters, high, low) {
  const threshold = (value, maximum) => Number.isFinite(value) ? Math.max(0, Math.min(maximum, value)) : 0;
  const maximumPct = threshold(parameters.maximumRangeStdDevPct, 50);
  const minimumMultiple = threshold(parameters.minimumBreakoutStdDev, 10);
  if (maximumPct === 0 && minimumMultiple === 0) return true;
  const statistics = calculateCloseStandardDeviation(candles, index - 1, lookback);
  if (!statistics) return false;
  if (maximumPct > 0 && statistics.percentage > maximumPct) return false;
  if (minimumMultiple === 0) return true;
  const distance = minimumMultiple * statistics.deviation;
  const close = candles[index]?.close;
  return Number.isFinite(close) && (close >= high + distance || close <= low - distance);
}
