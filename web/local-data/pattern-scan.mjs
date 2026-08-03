function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function emaAt(candles, index, period) {
  const start = Math.max(0, index - period * 4);
  const multiplier = 2 / (period + 1);
  let result = candles[start]?.close ?? 0;
  for (let cursor = start + 1; cursor <= index; cursor += 1) {
    result = candles[cursor].close * multiplier + result * (1 - multiplier);
  }
  return result;
}

function priorExtremes(candles, index, lookback) {
  const previous = candles.slice(Math.max(0, index - lookback), index);
  return {
    high: previous.length ? Math.max(...previous.map((bar) => bar.high)) : Number.NaN,
    low: previous.length ? Math.min(...previous.map((bar) => bar.low)) : Number.NaN,
  };
}

function uptrend(candles, index, p) {
  const fast = Math.round(p.fastPeriod);
  const slow = Math.round(p.slowPeriod);
  const slope = Math.round(p.slopeLookback);
  if (fast >= slow || index < Math.max(slow, slope)) return false;
  const fastEma = emaAt(candles, index, fast);
  const slowEma = emaAt(candles, index, slow);
  const priorSlow = emaAt(candles, index - slope, slow);
  return candles[index].close > fastEma
    && fastEma > slowEma
    && slowEma >= priorSlow * (1 + p.minimumRisePct / 100);
}

function volumeConfirmed(candles, index, lookback, multiplier) {
  if (multiplier <= 0) return true;
  const mean = average(candles.slice(index - lookback, index)
    .map((bar) => finite(bar.volume)).filter((value) => value > 0));
  return mean <= 0 || finite(candles[index].volume) >= mean * multiplier;
}

export function matchesLatestPattern(candles, preset) {
  const index = candles.length - 1;
  const current = candles[index];
  if (!current) return false;
  const p = preset.parameters ?? {};
  if (preset.kind === "breakout") {
    const lookback = Math.round(p.lookback);
    if (index < lookback) return false;
    const edge = priorExtremes(candles, index, lookback);
    const margin = p.minimumBreakoutPct / 100;
    return (current.close > edge.high * (1 + margin) || current.close < edge.low * (1 - margin))
      && volumeConfirmed(candles, index, lookback, p.volumeMultiplier);
  }
  if (preset.kind === "uptrend") return uptrend(candles, index, p);
  if (preset.kind === "uptrend_breakout") {
    const lookback = Math.round(p.lookback);
    if (index < lookback || !uptrend(candles, index, p)) return false;
    return current.close > priorExtremes(candles, index, lookback).high * (1 + p.minimumBreakoutPct / 100)
      && volumeConfirmed(candles, index, lookback, p.volumeMultiplier);
  }
  if (preset.kind === "trend_pullback") {
    const fast = Math.round(p.fastPeriod);
    const slow = Math.round(p.slowPeriod);
    if (index < slow) return false;
    const fastEma = emaAt(candles, index, fast);
    const slowEma = emaAt(candles, index, slow);
    return fastEma > slowEma && current.low <= fastEma * (1 + p.touchTolerancePct / 100)
      && current.close >= fastEma && current.close > current.open;
  }
  if (preset.kind === "contraction") {
    const lookback = Math.round(p.lookback);
    if (index < lookback * 2 - 1) return false;
    const ranges = candles.map((bar) => Math.max(0, bar.high - bar.low));
    const recent = average(ranges.slice(index - lookback + 1, index + 1));
    const previous = average(ranges.slice(index - lookback * 2 + 1, index - lookback + 1));
    return previous > 0 && recent / previous <= p.rangeRatio;
  }
  if (preset.kind === "bullish_engulfing" || preset.kind === "bearish_engulfing") {
    const previous = candles[index - 1];
    if (!previous) return false;
    const ratio = Math.abs(current.close - current.open) / Math.max(current.high - current.low, Number.EPSILON) * 100;
    if (ratio < p.minimumBodyPct) return false;
    return preset.kind === "bullish_engulfing"
      ? previous.close < previous.open && current.close > current.open && current.open <= previous.close && current.close >= previous.open
      : previous.close > previous.open && current.close < current.open && current.open >= previous.close && current.close <= previous.open;
  }
  if (preset.kind === "breakout_retest") {
    const lookback = Math.round(p.lookback);
    const window = Math.round(p.retestWindow);
    if (index < lookback + 1) return false;
    for (let cursor = Math.max(lookback, index - window); cursor < index; cursor += 1) {
      const edge = priorExtremes(candles, cursor, lookback).high;
      const tolerance = p.tolerancePct / 100;
      if (candles[cursor].close > edge && current.low <= edge * (1 + tolerance)
        && current.low >= edge * (1 - tolerance) && current.close >= edge) return true;
    }
    return false;
  }
  if (preset.kind === "failed_breakout") {
    const lookback = Math.round(p.lookback);
    if (index < lookback) return false;
    const edge = priorExtremes(candles, index, lookback);
    const margin = p.minimumPiercePct / 100;
    return (current.high > edge.high * (1 + margin) && current.close < edge.high)
      || (current.low < edge.low * (1 - margin) && current.close > edge.low);
  }
  if (preset.kind === "long_lower_wick") {
    const body = Math.max(Math.abs(current.close - current.open), (current.high - current.low) * 0.03);
    const wick = Math.min(current.open, current.close) - current.low;
    const location = (current.close - current.low) / Math.max(current.high - current.low, Number.EPSILON) * 100;
    return wick / body >= p.wickBodyRatio && location >= p.closeLocationPct;
  }
  return false;
}

export function screenLatestCandles(candles, presets, filters = {}) {
  const latest = candles.at(-1);
  const previous = candles.at(-2);
  if (!latest) return null;
  const averageVolume = average(candles.slice(-20).map((bar) => finite(bar.volume)));
  const averageTurnover = average(candles.slice(-20).map((bar) => finite(bar.turnover)));
  if (filters.minPrice != null && latest.close < filters.minPrice) return null;
  if (filters.maxPrice != null && latest.close > filters.maxPrice) return null;
  if (filters.minAverageVolume != null && averageVolume < filters.minAverageVolume) return null;
  if (filters.minAverageTurnover != null && averageTurnover < filters.minAverageTurnover) return null;
  const hits = presets.filter((preset) => matchesLatestPattern(candles, preset));
  if (presets.length && !hits.length) return null;
  return {
    timestamp: latest.timestamp,
    close: latest.close,
    changePct: previous?.close ? (latest.close / previous.close - 1) * 100 : 0,
    volume: finite(latest.volume),
    turnover: finite(latest.turnover),
    averageVolume,
    averageTurnover,
    presetIds: hits.map((preset) => preset.id),
    presetNames: hits.map((preset) => preset.name),
  };
}
