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

function patternInteger(value, fallback, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Math.round(finite(value, fallback))));
}

function alwaysInDirectionAt(candles, targetIndex, parameters) {
  const emaPeriod = patternInteger(parameters.emaPeriod, 20, 5, 100);
  const pivotStrength = patternInteger(parameters.pivotStrength, 2, 1, 5);
  const followThroughBars = patternInteger(parameters.followThroughBars, 2, 1, 4);
  const emaSlopeBars = patternInteger(parameters.emaSlopeBars, 3, 1, 10);
  const stateLookback = patternInteger(parameters.stateLookback, 120, 20, 500);
  const recentBreakoutBars = patternInteger(parameters.recentBreakoutBars, 18, 4, 60);
  const controlWindow = patternInteger(parameters.controlWindow, 12, 6, 40);
  const minimumTrendCloses = patternInteger(parameters.minimumTrendCloses, 9, 3, controlWindow);
  const maximumEmaCrosses = patternInteger(parameters.maximumEmaCrosses, 1, 0, 6);
  const history = stateLookback + emaPeriod * 4 + pivotStrength * 4 + followThroughBars + emaSlopeBars + controlWindow;
  const startIndex = Math.max(0, targetIndex - history);
  const bars = candles.slice(startIndex, targetIndex + 1);
  if (!bars.length) return 0;

  const ema = new Float64Array(bars.length);
  const multiplier = 2 / (emaPeriod + 1);
  ema[0] = bars[0].close;
  for (let index = 1; index < bars.length; index += 1) {
    ema[index] = bars[index].close * multiplier + ema[index - 1] * (1 - multiplier);
  }
  const emaMoves = (index, direction) => {
    if (index < emaSlopeBars) return false;
    for (let cursor = index - emaSlopeBars + 1; cursor <= index; cursor += 1) {
      if (direction === 1 ? ema[cursor] <= ema[cursor - 1] : ema[cursor] >= ema[cursor - 1]) return false;
    }
    return true;
  };
  const isConfirmedPivot = (index, direction, knownIndex) => {
    if (index < pivotStrength || index + pivotStrength > knownIndex) return false;
    const price = direction === 1 ? bars[index].high : bars[index].low;
    for (let offset = 1; offset <= pivotStrength; offset += 1) {
      const left = direction === 1 ? bars[index - offset].high : bars[index - offset].low;
      const right = direction === 1 ? bars[index + offset].high : bars[index + offset].low;
      if (direction === 1 ? price <= left || price <= right : price >= left || price >= right) return false;
    }
    return true;
  };

  const swingHighs = [];
  const swingLows = [];
  let state = 0;
  let lastStateEvent = -1;
  let usedBullPivotIndex = -1;
  let usedBearPivotIndex = -1;
  let pendingBull = null;
  let pendingBear = null;
  let qualifiedState = 0;

  for (let index = 0; index < bars.length; index += 1) {
    const pivotIndex = index - pivotStrength;
    if (isConfirmedPivot(pivotIndex, 1, index)) {
      swingHighs.push({ index: pivotIndex, price: bars[pivotIndex].high });
      if (swingHighs.length > 2) swingHighs.shift();
    }
    if (isConfirmedPivot(pivotIndex, -1, index)) {
      swingLows.push({ index: pivotIndex, price: bars[pivotIndex].low });
      if (swingLows.length > 2) swingLows.shift();
    }

    const current = bars[index];
    const bullStructure = swingHighs.length === 2 && swingLows.length === 2
      && swingHighs[1].price > swingHighs[0].price && swingLows[1].price > swingLows[0].price;
    const bearStructure = swingHighs.length === 2 && swingLows.length === 2
      && swingHighs[1].price < swingHighs[0].price && swingLows[1].price < swingLows[0].price;

    if (pendingBull) {
      const age = index - pendingBull.index;
      if (current.close < pendingBull.low || age > followThroughBars) {
        pendingBull = null;
      } else if (age >= 1 && current.close > pendingBull.high && current.close > current.open
        && current.close > ema[index] && emaMoves(index, 1) && bullStructure) {
        state = 1;
        lastStateEvent = index;
        usedBullPivotIndex = pendingBull.pivotIndex;
        pendingBull = null;
        pendingBear = null;
      }
    }
    if (pendingBear) {
      const age = index - pendingBear.index;
      if (current.close > pendingBear.high || age > followThroughBars) {
        pendingBear = null;
      } else if (age >= 1 && current.close < pendingBear.low && current.close < current.open
        && current.close < ema[index] && emaMoves(index, -1) && bearStructure) {
        state = -1;
        lastStateEvent = index;
        usedBearPivotIndex = pendingBear.pivotIndex;
        pendingBear = null;
        pendingBull = null;
      }
    }

    if (state !== 0 && lastStateEvent >= 0 && index - lastStateEvent > stateLookback) state = 0;
    const previous = bars[index - 1];
    const latestHigh = swingHighs.at(-1);
    const latestLow = swingLows.at(-1);
    if (!pendingBull && latestHigh && latestHigh.index > usedBullPivotIndex && previous
      && previous.close <= latestHigh.price && current.close > latestHigh.price && current.close > current.open) {
      pendingBull = { index, high: current.high, low: current.low, pivotIndex: latestHigh.index };
    }
    if (!pendingBear && latestLow && latestLow.index > usedBearPivotIndex && previous
      && previous.close >= latestLow.price && current.close < latestLow.price && current.close < current.open) {
      pendingBear = { index, high: current.high, low: current.low, pivotIndex: latestLow.index };
    }

    const structureMatches = state === 1 ? bullStructure : state === -1 ? bearStructure : false;
    const windowStart = index - controlWindow + 1;
    let trendSideCloses = 0;
    let emaCrosses = 0;
    if (state !== 0 && windowStart >= 0) {
      let previousSide = Math.sign(bars[windowStart].close - ema[windowStart]);
      for (let cursor = windowStart; cursor <= index; cursor += 1) {
        const side = Math.sign(bars[cursor].close - ema[cursor]);
        if (state === 1 ? side > 0 : side < 0) trendSideCloses += 1;
        if (cursor > windowStart && side !== 0 && previousSide !== 0 && side !== previousSide) emaCrosses += 1;
        if (side !== 0) previousSide = side;
      }
    }
    const directionStillControls = state !== 0 && structureMatches && lastStateEvent >= 0
      && index - lastStateEvent <= recentBreakoutBars && windowStart >= 0
      && trendSideCloses >= minimumTrendCloses && emaCrosses <= maximumEmaCrosses
      && (state === 1
        ? current.close > ema[index] && ema[index] > ema[windowStart] && current.close > bars[windowStart].close
        : current.close < ema[index] && ema[index] < ema[windowStart] && current.close < bars[windowStart].close);
    qualifiedState = directionStillControls ? state : 0;
  }
  return qualifiedState;
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

function roundToTick(value, tick) {
  const precision = String(tick).includes(".") ? String(tick).length - String(tick).indexOf(".") - 1 : 0;
  return Number((Math.round((value + Number.EPSILON) / tick) * tick).toFixed(precision));
}

function isLimitUpCandle(latest, previous, ratio = 0.1, tick = 0.01) {
  const referenceClose = finite(previous?.close, Number.NaN);
  const close = finite(latest?.close, Number.NaN);
  const parsedRatio = Number(ratio);
  const parsedTick = Number(tick);
  if (
    !Number.isFinite(referenceClose)
    || referenceClose <= 0
    || !Number.isFinite(close)
    || !Number.isFinite(parsedRatio)
    || parsedRatio <= 0
    || !Number.isFinite(parsedTick)
    || parsedTick <= 0
  ) return false;
  const upper = roundToTick(referenceClose * (1 + parsedRatio), parsedTick);
  return close >= upper - parsedTick / 10;
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
  if (preset.kind === "always_in_long" || preset.kind === "always_in_short") {
    const direction = alwaysInDirectionAt(candles, index, p);
    return preset.kind === "always_in_long" ? direction === 1 : direction === -1;
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
  if (filters.excludeLimitUp && isLimitUpCandle(latest, previous, filters.limitUpRatio, filters.priceTick)) return null;
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
