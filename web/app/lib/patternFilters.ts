export type PatternKind =
  | "breakout"
  | "uptrend"
  | "uptrend_breakout"
  | "always_in_long"
  | "always_in_short"
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
  always_in_long: [
    { key: "emaPeriod", label: "趋势 EMA 周期", min: 5, max: 100, step: 1 },
    { key: "pivotStrength", label: "摆动点左右确认", min: 1, max: 5, step: 1, suffix: "根" },
    { key: "followThroughBars", label: "突破跟进窗口", min: 1, max: 4, step: 1, suffix: "根" },
    { key: "emaSlopeBars", label: "EMA 连续同向", min: 1, max: 10, step: 1, suffix: "根" },
    { key: "stateLookback", label: "状态有效回看", min: 20, max: 500, step: 10, suffix: "根" },
    { key: "recentBreakoutBars", label: "最近有效突破", min: 4, max: 60, step: 1, suffix: "根内" },
    { key: "controlWindow", label: "当前控制窗口", min: 6, max: 40, step: 1, suffix: "根" },
    { key: "minimumTrendCloses", label: "均线正确一侧最少收盘", min: 3, max: 40, step: 1, suffix: "根" },
    { key: "maximumEmaCrosses", label: "窗口内最多穿越 EMA", min: 0, max: 6, step: 1, suffix: "次" },
  ],
  always_in_short: [
    { key: "emaPeriod", label: "趋势 EMA 周期", min: 5, max: 100, step: 1 },
    { key: "pivotStrength", label: "摆动点左右确认", min: 1, max: 5, step: 1, suffix: "根" },
    { key: "followThroughBars", label: "突破跟进窗口", min: 1, max: 4, step: 1, suffix: "根" },
    { key: "emaSlopeBars", label: "EMA 连续同向", min: 1, max: 10, step: 1, suffix: "根" },
    { key: "stateLookback", label: "状态有效回看", min: 20, max: 500, step: 10, suffix: "根" },
    { key: "recentBreakoutBars", label: "最近有效突破", min: 4, max: 60, step: 1, suffix: "根内" },
    { key: "controlWindow", label: "当前控制窗口", min: 6, max: 40, step: 1, suffix: "根" },
    { key: "minimumTrendCloses", label: "均线正确一侧最少收盘", min: 3, max: 40, step: 1, suffix: "根" },
    { key: "maximumEmaCrosses", label: "窗口内最多穿越 EMA", min: 0, max: 6, step: 1, suffix: "次" },
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
  { id: "always-in-long", kind: "always_in_long", name: "Always In Long（严格结构）", description: "HH/HL 后向上突破并跟进，且当前仍在 EMA 上方单边控制；排除过期状态与频繁穿越均线的震荡。", builtIn: true, parameters: { emaPeriod: 20, pivotStrength: 2, followThroughBars: 2, emaSlopeBars: 3, stateLookback: 120, recentBreakoutBars: 18, controlWindow: 12, minimumTrendCloses: 9, maximumEmaCrosses: 1 } },
  { id: "always-in-short", kind: "always_in_short", name: "Always In Short（严格结构）", description: "LH/LL 后向下突破并跟进，且当前仍在 EMA 下方单边控制；排除过期状态与频繁穿越均线的震荡。", builtIn: true, parameters: { emaPeriod: 20, pivotStrength: 2, followThroughBars: 2, emaSlopeBars: 3, stateLookback: 120, recentBreakoutBars: 18, controlWindow: 12, minimumTrendCloses: 9, maximumEmaCrosses: 1 } },
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

function normalizePresetText(value: unknown, fallback: string, maxLength: number) {
  if (typeof value !== "string") return fallback;
  const text = value.trim().slice(0, maxLength);
  if (!text || text.includes("\uFFFD") || [...text].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint >= 0x80 && codePoint <= 0x9f;
  })) return fallback;
  return text;
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
    const builtIn = Boolean(item.builtIn && defaultsById.has(item.id));
    return [{
      id: String(item.id),
      kind: item.kind,
      name: builtIn ? fallback.name : normalizePresetText(item.name, fallback.name, 30),
      description: builtIn ? fallback.description : normalizePresetText(item.description, fallback.description, 160),
      builtIn,
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

type AlwaysInDirection = -1 | 0 | 1;
type SwingPoint = { index: number; price: number };
type PendingBreakout = { index: number; high: number; low: number; pivotIndex: number };

function patternInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, Math.round(finite(value, fallback))));
}

function alwaysInStateSeries(
  candles: PatternCandle[],
  maximumIndex: number,
  parameters: Record<string, number>,
) {
  const endIndex = Math.min(candles.length - 1, Math.max(-1, Math.round(maximumIndex)));
  const states = new Int8Array(Math.max(0, endIndex + 1));
  if (endIndex < 0) return states;

  const emaPeriod = patternInteger(parameters.emaPeriod, 20, 5, 100);
  const pivotStrength = patternInteger(parameters.pivotStrength, 2, 1, 5);
  const followThroughBars = patternInteger(parameters.followThroughBars, 2, 1, 4);
  const emaSlopeBars = patternInteger(parameters.emaSlopeBars, 3, 1, 10);
  const stateLookback = patternInteger(parameters.stateLookback, 120, 20, 500);
  const recentBreakoutBars = patternInteger(parameters.recentBreakoutBars, 18, 4, 60);
  const controlWindow = patternInteger(parameters.controlWindow, 12, 6, 40);
  const minimumTrendCloses = patternInteger(parameters.minimumTrendCloses, 9, 3, controlWindow);
  const maximumEmaCrosses = patternInteger(parameters.maximumEmaCrosses, 1, 0, 6);
  const ema = new Float64Array(endIndex + 1);
  const multiplier = 2 / (emaPeriod + 1);
  ema[0] = candles[0].close;
  for (let index = 1; index <= endIndex; index += 1) {
    ema[index] = candles[index].close * multiplier + ema[index - 1] * (1 - multiplier);
  }

  const emaMoves = (index: number, direction: -1 | 1) => {
    if (index < emaSlopeBars) return false;
    for (let cursor = index - emaSlopeBars + 1; cursor <= index; cursor += 1) {
      if (direction === 1 ? ema[cursor] <= ema[cursor - 1] : ema[cursor] >= ema[cursor - 1]) return false;
    }
    return true;
  };
  const isConfirmedPivot = (index: number, direction: -1 | 1, knownIndex: number) => {
    if (index < pivotStrength || index + pivotStrength > knownIndex) return false;
    const price = direction === 1 ? candles[index].high : candles[index].low;
    for (let offset = 1; offset <= pivotStrength; offset += 1) {
      const left = direction === 1 ? candles[index - offset].high : candles[index - offset].low;
      const right = direction === 1 ? candles[index + offset].high : candles[index + offset].low;
      if (direction === 1 ? price <= left || price <= right : price >= left || price >= right) return false;
    }
    return true;
  };

  const swingHighs: SwingPoint[] = [];
  const swingLows: SwingPoint[] = [];
  let state: AlwaysInDirection = 0;
  let lastStateEvent = -1;
  let usedBullPivotIndex = -1;
  let usedBearPivotIndex = -1;
  let pendingBull: PendingBreakout | null = null;
  let pendingBear: PendingBreakout | null = null;

  for (let index = 0; index <= endIndex; index += 1) {
    const pivotIndex = index - pivotStrength;
    if (isConfirmedPivot(pivotIndex, 1, index)) {
      swingHighs.push({ index: pivotIndex, price: candles[pivotIndex].high });
      if (swingHighs.length > 2) swingHighs.shift();
    }
    if (isConfirmedPivot(pivotIndex, -1, index)) {
      swingLows.push({ index: pivotIndex, price: candles[pivotIndex].low });
      if (swingLows.length > 2) swingLows.shift();
    }

    const current = candles[index];
    const bullStructure = swingHighs.length === 2 && swingLows.length === 2
      && swingHighs[1].price > swingHighs[0].price
      && swingLows[1].price > swingLows[0].price;
    const bearStructure = swingHighs.length === 2 && swingLows.length === 2
      && swingHighs[1].price < swingHighs[0].price
      && swingLows[1].price < swingLows[0].price;

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

    const previous = candles[index - 1];
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
      let previousSide = Math.sign(candles[windowStart].close - ema[windowStart]);
      for (let cursor = windowStart; cursor <= index; cursor += 1) {
        const side = Math.sign(candles[cursor].close - ema[cursor]);
        if (state === 1 ? side > 0 : side < 0) trendSideCloses += 1;
        if (cursor > windowStart && side !== 0 && previousSide !== 0 && side !== previousSide) emaCrosses += 1;
        if (side !== 0) previousSide = side;
      }
    }
    const directionStillControls = state !== 0
      && structureMatches
      && lastStateEvent >= 0
      && index - lastStateEvent <= recentBreakoutBars
      && windowStart >= 0
      && trendSideCloses >= minimumTrendCloses
      && emaCrosses <= maximumEmaCrosses
      && (state === 1
        ? current.close > ema[index] && ema[index] > ema[windowStart] && current.close > candles[windowStart].close
        : current.close < ema[index] && ema[index] < ema[windowStart] && current.close < candles[windowStart].close);
    states[index] = directionStillControls ? state : 0;
  }
  return states;
}

function alwaysInDirectionAt(candles: PatternCandle[], index: number, parameters: Record<string, number>) {
  const emaPeriod = patternInteger(parameters.emaPeriod, 20, 5, 100);
  const pivotStrength = patternInteger(parameters.pivotStrength, 2, 1, 5);
  const followThroughBars = patternInteger(parameters.followThroughBars, 2, 1, 4);
  const emaSlopeBars = patternInteger(parameters.emaSlopeBars, 3, 1, 10);
  const stateLookback = patternInteger(parameters.stateLookback, 120, 20, 500);
  const controlWindow = patternInteger(parameters.controlWindow, 12, 6, 40);
  const history = stateLookback + emaPeriod * 4 + pivotStrength * 4 + followThroughBars + emaSlopeBars + controlWindow;
  const startIndex = Math.max(0, index - history);
  const window = candles.slice(startIndex, index + 1);
  const states = alwaysInStateSeries(window, window.length - 1, parameters);
  return (states.at(-1) ?? 0) as AlwaysInDirection;
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
  const alwaysInStates = new Map<PatternPreset, Int8Array>();
  for (const preset of presets) {
    if (preset.kind === "always_in_long" || preset.kind === "always_in_short") {
      alwaysInStates.set(preset, alwaysInStateSeries(candles, maximumIndex, preset.parameters));
    }
  }
  let lastAcceptedIndex = -cooldownBars - 1;
  for (let index = 0; index <= maximumIndex; index += 1) {
    const candle = candles[index];
    if (options.startTimestamp != null && candle.timestamp < options.startTimestamp) continue;
    if (options.endTimestamp != null && candle.timestamp > options.endTimestamp) continue;
    const hitPresets = presets.filter((preset) => {
      const states = alwaysInStates.get(preset);
      if (!states) return matchesPattern(candles, index, preset);
      return preset.kind === "always_in_long" ? states[index] === 1 : states[index] === -1;
    });
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
