export type PatternKind =
  | "breakout"
  | "uptrend"
  | "uptrend_breakout"
  | "trend_pullback"
  | "contraction"
  | "bullish_engulfing"
  | "bearish_engulfing"
  | "breakout_retest"
  | "failed_breakout"
  | "long_lower_wick";

export type PatternPreset = {
  id: string;
  kind: PatternKind;
  name: string;
  description: string;
  builtIn: boolean;
  parameters: Record<string, number>;
};

export type PatternParameterDefinition = {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  suffix?: string;
};

export type PatternCandle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
};

export type PatternMatch = {
  index: number;
  timestamp: number;
  presetIds: string[];
  presetNames: string[];
};

export const patternParameterDefinitions: Record<PatternKind, PatternParameterDefinition[]> = {
  breakout: [
    { key: "lookback", label: "前高/前低回看", min: 5, max: 120, step: 1, suffix: "根" },
    { key: "minimumBreakoutPct", label: "最小突破幅度", min: 0, max: 10, step: 0.1, suffix: "%" },
    { key: "volumeMultiplier", label: "成交量相对均量", min: 0, max: 5, step: 0.1, suffix: "倍" },
  ],
  uptrend: [
    { key: "fastPeriod", label: "短均线周期", min: 3, max: 60, step: 1 },
    { key: "slowPeriod", label: "长均线周期", min: 8, max: 200, step: 1 },
    { key: "slopeLookback", label: "趋势斜率回看", min: 2, max: 60, step: 1, suffix: "根" },
    { key: "minimumRisePct", label: "长均线最小升幅", min: 0, max: 20, step: 0.1, suffix: "%" },
  ],
  uptrend_breakout: [
    { key: "fastPeriod", label: "短均线周期", min: 3, max: 60, step: 1 },
    { key: "slowPeriod", label: "长均线周期", min: 8, max: 200, step: 1 },
    { key: "slopeLookback", label: "趋势斜率回看", min: 2, max: 60, step: 1, suffix: "根" },
    { key: "minimumRisePct", label: "长均线最小升幅", min: 0, max: 20, step: 0.1, suffix: "%" },
    { key: "lookback", label: "突破前高回看", min: 5, max: 120, step: 1, suffix: "根" },
    { key: "minimumBreakoutPct", label: "最小突破幅度", min: 0, max: 10, step: 0.1, suffix: "%" },
    { key: "volumeMultiplier", label: "成交量相对均量", min: 0, max: 5, step: 0.1, suffix: "倍" },
  ],
  trend_pullback: [
    { key: "fastPeriod", label: "短均线周期", min: 3, max: 60, step: 1 },
    { key: "slowPeriod", label: "长均线周期", min: 8, max: 200, step: 1 },
    { key: "touchTolerancePct", label: "回踩容差", min: 0.1, max: 8, step: 0.1, suffix: "%" },
  ],
  contraction: [
    { key: "lookback", label: "收缩窗口", min: 3, max: 40, step: 1, suffix: "根" },
    { key: "rangeRatio", label: "近期/此前波幅上限", min: 0.1, max: 1, step: 0.05 },
  ],
  bullish_engulfing: [
    { key: "minimumBodyPct", label: "实体占整根最低比例", min: 0, max: 100, step: 5, suffix: "%" },
  ],
  bearish_engulfing: [
    { key: "minimumBodyPct", label: "实体占整根最低比例", min: 0, max: 100, step: 5, suffix: "%" },
  ],
  breakout_retest: [
    { key: "lookback", label: "突破基准回看", min: 5, max: 120, step: 1, suffix: "根" },
    { key: "retestWindow", label: "突破后回踩窗口", min: 1, max: 30, step: 1, suffix: "根" },
    { key: "tolerancePct", label: "回踩容差", min: 0.1, max: 8, step: 0.1, suffix: "%" },
  ],
  failed_breakout: [
    { key: "lookback", label: "前高/前低回看", min: 5, max: 120, step: 1, suffix: "根" },
    { key: "minimumPiercePct", label: "最小刺破幅度", min: 0, max: 5, step: 0.1, suffix: "%" },
  ],
  long_lower_wick: [
    { key: "wickBodyRatio", label: "下影/实体最低倍数", min: 1, max: 10, step: 0.25, suffix: "倍" },
    { key: "closeLocationPct", label: "收盘位于振幅上方", min: 40, max: 95, step: 5, suffix: "%" },
  ],
};

export const defaultPatternPresets: PatternPreset[] = [
  { id: "breakout", kind: "breakout", name: "区间突破", description: "收盘有效越过此前区间高点或低点，可附加成交量确认。", builtIn: true, parameters: { lookback: 20, minimumBreakoutPct: 0.2, volumeMultiplier: 0 } },
  { id: "uptrend", kind: "uptrend", name: "上升趋势", description: "价格位于短均线上方、短均线位于长均线上方，并且长均线持续向上。", builtIn: true, parameters: { fastPeriod: 10, slowPeriod: 20, slopeLookback: 5, minimumRisePct: 0.5 } },
  { id: "uptrend-breakout", kind: "uptrend_breakout", name: "上升趋势突破", description: "先确认均线多头和长均线抬升，再要求当前收盘向上突破此前区间高点。", builtIn: true, parameters: { fastPeriod: 10, slowPeriod: 20, slopeLookback: 5, minimumRisePct: 0.5, lookback: 20, minimumBreakoutPct: 0.1, volumeMultiplier: 0 } },
  { id: "trend-pullback", kind: "trend_pullback", name: "趋势回调", description: "短均线保持在长均线之上，价格回踩短均线后重新收在其上方。", builtIn: true, parameters: { fastPeriod: 10, slowPeriod: 20, touchTolerancePct: 1.5 } },
  { id: "contraction", kind: "contraction", name: "波幅收缩", description: "近期平均振幅显著小于此前同长度窗口，代表价格正在压缩。", builtIn: true, parameters: { lookback: 8, rangeRatio: 0.65 } },
  { id: "bullish-engulfing", kind: "bullish_engulfing", name: "看涨吞没", description: "阳线实体完整吞没上一根阴线实体。", builtIn: true, parameters: { minimumBodyPct: 45 } },
  { id: "bearish-engulfing", kind: "bearish_engulfing", name: "看跌吞没", description: "阴线实体完整吞没上一根阳线实体。", builtIn: true, parameters: { minimumBodyPct: 45 } },
  { id: "breakout-retest", kind: "breakout_retest", name: "突破回踩", description: "此前刚完成向上突破，随后回踩旧阻力且收盘仍守在其上方。", builtIn: true, parameters: { lookback: 20, retestWindow: 6, tolerancePct: 1.2 } },
  { id: "failed-breakout", kind: "failed_breakout", name: "失败突破", description: "价格刺破此前区间边界，但收盘重新回到区间内。", builtIn: true, parameters: { lookback: 20, minimumPiercePct: 0.1 } },
  { id: "long-lower-wick", kind: "long_lower_wick", name: "长下影线", description: "下影显著长于实体，同时收盘处于整根 K 线的上部。", builtIn: true, parameters: { wickBodyRatio: 2.5, closeLocationPct: 60 } },
];

function finite(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizePatternPresets(value: unknown): PatternPreset[] {
  if (!Array.isArray(value)) return defaultPatternPresets.map((preset) => ({ ...preset, parameters: { ...preset.parameters } }));
  const defaultsById = new Map(defaultPatternPresets.map((preset) => [preset.id, preset]));
  const normalized = value.flatMap((candidate): PatternPreset[] => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as Partial<PatternPreset>;
    if (!item.id || !item.kind || !(item.kind in patternParameterDefinitions)) return [];
    const fallback = defaultsById.get(item.id) ?? defaultPatternPresets.find((preset) => preset.kind === item.kind);
    if (!fallback) return [];
    const parameters = Object.fromEntries(patternParameterDefinitions[item.kind].map((definition) => {
      const fallbackValue = fallback.parameters[definition.key] ?? definition.min;
      const nextValue = finite(item.parameters?.[definition.key], fallbackValue);
      return [definition.key, Math.max(definition.min, Math.min(definition.max, nextValue))];
    }));
    return [{
      id: String(item.id),
      kind: item.kind,
      name: typeof item.name === "string" && item.name.trim() ? item.name.trim().slice(0, 30) : fallback.name,
      description: typeof item.description === "string" && item.description.trim() ? item.description.trim().slice(0, 160) : fallback.description,
      builtIn: Boolean(item.builtIn && defaultsById.has(item.id)),
      parameters,
    }];
  });
  const found = new Set(normalized.map((preset) => preset.id));
  for (const preset of defaultPatternPresets) {
    if (!found.has(preset.id)) normalized.push({ ...preset, parameters: { ...preset.parameters } });
  }
  return normalized.slice(0, 40);
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function emaAt(candles: PatternCandle[], index: number, period: number) {
  const start = Math.max(0, index - period * 4);
  const multiplier = 2 / (period + 1);
  let result = candles[start]?.close ?? 0;
  for (let cursor = start + 1; cursor <= index; cursor += 1) {
    result = candles[cursor].close * multiplier + result * (1 - multiplier);
  }
  return result;
}

function priorExtremes(candles: PatternCandle[], index: number, lookback: number) {
  const previous = candles.slice(Math.max(0, index - lookback), index);
  return {
    high: previous.length ? Math.max(...previous.map((bar) => bar.high)) : Number.NaN,
    low: previous.length ? Math.min(...previous.map((bar) => bar.low)) : Number.NaN,
  };
}

function isUptrend(candles: PatternCandle[], index: number, parameters: Record<string, number>) {
  const fast = Math.round(parameters.fastPeriod);
  const slow = Math.round(parameters.slowPeriod);
  const slopeLookback = Math.round(parameters.slopeLookback);
  if (fast >= slow || index < Math.max(slow, slopeLookback)) return false;
  const current = candles[index];
  const fastEma = emaAt(candles, index, fast);
  const slowEma = emaAt(candles, index, slow);
  const priorSlowEma = emaAt(candles, index - slopeLookback, slow);
  const minimumRise = parameters.minimumRisePct / 100;
  return current.close > fastEma
    && fastEma > slowEma
    && slowEma >= priorSlowEma * (1 + minimumRise);
}

function hasVolumeConfirmation(candles: PatternCandle[], index: number, lookback: number, multiplier: number) {
  if (multiplier <= 0) return true;
  const current = candles[index];
  if (!Number.isFinite(current?.volume)) return false;
  const volumeAverage = average(candles.slice(index - lookback, index).map((bar) => finite(bar.volume, 0)).filter((value) => value > 0));
  return volumeAverage <= 0 || finite(current.volume, 0) >= volumeAverage * multiplier;
}

export function matchesPattern(candles: PatternCandle[], index: number, preset: PatternPreset) {
  const current = candles[index];
  if (!current) return false;
  const p = preset.parameters;
  if (preset.kind === "breakout") {
    const lookback = Math.round(p.lookback);
    if (index < lookback) return false;
    const boundary = priorExtremes(candles, index, lookback);
    const margin = p.minimumBreakoutPct / 100;
    const broke = current.close > boundary.high * (1 + margin) || current.close < boundary.low * (1 - margin);
    if (!broke) return false;
    return hasVolumeConfirmation(candles, index, lookback, p.volumeMultiplier);
  }
  if (preset.kind === "uptrend") {
    return isUptrend(candles, index, p);
  }
  if (preset.kind === "uptrend_breakout") {
    const lookback = Math.round(p.lookback);
    if (index < lookback || !isUptrend(candles, index, p)) return false;
    const boundary = priorExtremes(candles, index, lookback).high;
    const brokeUp = current.close > boundary * (1 + p.minimumBreakoutPct / 100);
    return brokeUp && hasVolumeConfirmation(candles, index, lookback, p.volumeMultiplier);
  }
  if (preset.kind === "trend_pullback") {
    const fast = Math.round(p.fastPeriod);
    const slow = Math.round(p.slowPeriod);
    if (index < slow) return false;
    const fastEma = emaAt(candles, index, fast);
    const slowEma = emaAt(candles, index, slow);
    const tolerance = p.touchTolerancePct / 100;
    return fastEma > slowEma && current.low <= fastEma * (1 + tolerance) && current.close >= fastEma && current.close > current.open;
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
    const bodyRatio = Math.abs(current.close - current.open) / Math.max(current.high - current.low, Number.EPSILON) * 100;
    if (bodyRatio < p.minimumBodyPct) return false;
    if (preset.kind === "bullish_engulfing") {
      return previous.close < previous.open && current.close > current.open && current.open <= previous.close && current.close >= previous.open;
    }
    return previous.close > previous.open && current.close < current.open && current.open >= previous.close && current.close <= previous.open;
  }
  if (preset.kind === "breakout_retest") {
    const lookback = Math.round(p.lookback);
    const retestWindow = Math.round(p.retestWindow);
    if (index < lookback + 1) return false;
    for (let breakoutIndex = Math.max(lookback, index - retestWindow); breakoutIndex < index; breakoutIndex += 1) {
      const boundary = priorExtremes(candles, breakoutIndex, lookback).high;
      if (!Number.isFinite(boundary) || candles[breakoutIndex].close <= boundary) continue;
      const tolerance = p.tolerancePct / 100;
      if (current.low <= boundary * (1 + tolerance) && current.low >= boundary * (1 - tolerance) && current.close >= boundary) return true;
    }
    return false;
  }
  if (preset.kind === "failed_breakout") {
    const lookback = Math.round(p.lookback);
    if (index < lookback) return false;
    const boundary = priorExtremes(candles, index, lookback);
    const margin = p.minimumPiercePct / 100;
    const failedUp = current.high > boundary.high * (1 + margin) && current.close < boundary.high;
    const failedDown = current.low < boundary.low * (1 - margin) && current.close > boundary.low;
    return failedUp || failedDown;
  }
  if (preset.kind === "long_lower_wick") {
    const body = Math.max(Math.abs(current.close - current.open), (current.high - current.low) * 0.03);
    const lowerWick = Math.min(current.open, current.close) - current.low;
    const closeLocation = (current.close - current.low) / Math.max(current.high - current.low, Number.EPSILON) * 100;
    return lowerWick / body >= p.wickBodyRatio && closeLocation >= p.closeLocationPct;
  }
  return false;
}

export function findPatternMatches(
  candles: PatternCandle[],
  presets: PatternPreset[],
  options: { cooldownBars?: number; startTimestamp?: number; endTimestamp?: number; maximumIndex?: number } = {},
) {
  const matches: PatternMatch[] = [];
  const cooldownBars = Math.max(0, Math.round(options.cooldownBars ?? 0));
  const maximumIndex = Math.min(candles.length - 1, options.maximumIndex ?? candles.length - 1);
  let lastAcceptedIndex = -cooldownBars - 1;
  for (let index = 0; index <= maximumIndex; index += 1) {
    const candle = candles[index];
    if (options.startTimestamp != null && candle.timestamp < options.startTimestamp) continue;
    if (options.endTimestamp != null && candle.timestamp > options.endTimestamp) continue;
    const hitPresets = presets.filter((preset) => matchesPattern(candles, index, preset));
    if (!hitPresets.length || index - lastAcceptedIndex <= cooldownBars) continue;
    matches.push({
      index,
      timestamp: candle.timestamp,
      presetIds: hitPresets.map((preset) => preset.id),
      presetNames: hitPresets.map((preset) => preset.name),
    });
    lastAcceptedIndex = index;
  }
  return matches;
}
