import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultPatternPresets,
  findPatternMatches,
  isPatternPresetAvailable,
  matchesPattern,
  normalizePatternPresets,
  requiredPatternHistory,
  visiblePatternPresets,
} from "../app/lib/patternFilters.ts";

const candle = (timestamp, open, high, low, close, volume = 100) => ({ timestamp, open, high, low, close, volume });
const breakout = defaultPatternPresets.find((preset) => preset.id === "breakout");
const uptrend = defaultPatternPresets.find((preset) => preset.id === "uptrend");
const uptrendBreakout = defaultPatternPresets.find((preset) => preset.id === "uptrend-breakout");
const alwaysInLong = defaultPatternPresets.find((preset) => preset.id === "always-in-long");
const alwaysInShort = defaultPatternPresets.find((preset) => preset.id === "always-in-short");
const bullishEngulfing = defaultPatternPresets.find((preset) => preset.id === "bullish-engulfing");
const contraction = defaultPatternPresets.find((preset) => preset.id === "contraction");
const usDailyFirstPullback = defaultPatternPresets.find((preset) => preset.id === "us-daily-first-pullback");
const fxFiveMinuteFirstPullback = defaultPatternPresets.find((preset) => preset.id === "fx-5m-hourly-first-pullback");

const DAY_MS = 86_400_000;
const FIVE_MINUTES_MS = 300_000;

const usDailyFirstPullbackBars = () => {
  const bars = Array.from({ length: 40 }, (_, index) => {
    const close = 100 + index * 0.05;
    return candle(index * DAY_MS, close - 0.18, close + 0.35, close - 0.35, close, 1_000);
  });
  bars.push(candle(40 * DAY_MS, 102.05, 103.35, 101.95, 103.2, 1_300));
  bars.push(candle(41 * DAY_MS, 103.1, 103.25, 102.35, 102.55, 900));
  bars.push(candle(42 * DAY_MS, 102.45, 103.45, 102.25, 103.3, 1_100));
  return bars;
};

const fxFiveMinuteFirstPullbackBars = ({ higherTrend = "up" } = {}) => {
  const bars = [];
  for (let index = 0; index < 720; index += 1) {
    const progress = index / 719;
    const close = higherTrend === "up" ? 7 + progress * 2 : 20 - progress * 5;
    bars.push(candle(index * FIVE_MINUTES_MS, close - 0.02, close + 0.04, close - 0.04, close));
  }
  for (const [open, high, low, close] of strictAlwaysInRows) {
    bars.push(candle(bars.length * FIVE_MINUTES_MS, open, high, low, close));
  }
  bars.push(candle(bars.length * FIVE_MINUTES_MS, 14.5, 14.6, 14.05, 14.15));
  bars.push(candle(bars.length * FIVE_MINUTES_MS, 14.12, 14.75, 13.98, 14.7));
  return bars;
};

const structuralAlwaysInBars = () => [
  candle(0, 9.8, 10.5, 9.5, 10),
  candle(1, 10, 12, 9.8, 11.5),
  candle(2, 11.3, 11.4, 9, 10),
  candle(3, 10.3, 13, 10.2, 12.5),
  candle(4, 12, 12.1, 10, 10.5),
  candle(5, 10.5, 13.8, 10.4, 13.5),
  candle(6, 13.4, 14.5, 13.2, 14.2),
  candle(7, 14.1, 14.2, 13, 13.8),
];

const strictAlwaysInRows = [
  [9.3, 9.8, 9.1, 9.5], [9.5, 10.2, 9.3, 10], [10, 10.7, 9.8, 10.5],
  [10.5, 12, 10.3, 11.5], [11.5, 11.6, 10.7, 11], [11, 11.2, 10.2, 10.5],
  [10.4, 10.6, 9, 10.2], [10.2, 10.4, 9.4, 10.25], [10.2, 11.4, 9.8, 11],
  [11, 13, 10.8, 12.5], [12.5, 12.6, 11.7, 12], [12, 12.2, 11, 11.5],
  [11.5, 11.8, 10, 11], [11, 11.3, 10.3, 11.1], [11.1, 12.5, 10.8, 12],
  [12, 14, 11.8, 13.5], [13.4, 14.8, 13.2, 14.5],
];

const alwaysInTestParameters = {
  emaPeriod: 5,
  pivotStrength: 1,
  followThroughBars: 1,
  emaSlopeBars: 1,
  stateLookback: 20,
  recentBreakoutBars: 10,
  controlWindow: 6,
  minimumTrendCloses: 3,
  maximumEmaCrosses: 3,
};

test("repairs replacement and control characters in preset text", () => {
  const normalized = normalizePatternPresets([{
    ...contraction,
    name: "波\uFFFD\u0085收缩",
    description: "近期平均振\uFFFD\u0085显著小于此前同长度窗口，代表价格正在压缩。",
  }]);
  const repaired = normalized.find((preset) => preset.id === "contraction");
  assert.equal(repaired.name, "波幅收缩");
  assert.equal(repaired.description, contraction.description);
});

test("normalizes modular custom conditions and keeps hidden built-ins out of the available list", () => {
  const normalized = normalizePatternPresets([
    {
      id: "custom-modular",
      kind: "custom",
      name: "自定义趋势",
      description: "价格站上 EMA 且成交量放大",
      builtIn: false,
      parameters: {},
      conditions: [
        { id: "ema", kind: "price_vs_ema", parameters: { period: 20, relation: "above" } },
        { id: "volume", kind: "volume_vs_average", parameters: { lookback: 20, relation: "at_least", multiplier: 1.5 } },
        { id: "unsupported", kind: "not-a-condition", parameters: {} },
      ],
    },
    { ...breakout, enabled: false },
  ]);
  const custom = normalized.find((preset) => preset.id === "custom-modular");
  const hidden = normalized.find((preset) => preset.id === breakout.id);

  assert.equal(custom?.kind, "custom");
  assert.equal(custom?.conditions?.length, 2);
  assert.equal(hidden?.enabled, false);
  assert.equal(isPatternPresetAvailable(hidden), false);
  assert.equal(visiblePatternPresets(normalized).some((preset) => preset.id === breakout.id), false);
  assert.equal(visiblePatternPresets(normalized).some((preset) => preset.id === "custom-modular"), true);
});

test("evaluates modular custom conditions with AND semantics and reserves their history", () => {
  const bars = Array.from({ length: 25 }, (_, index) => {
    const close = 10 + index * 0.2;
    return candle(index, close - 0.05, close + 0.25, close - 0.1, close, 100);
  });
  bars.at(-1).volume = 180;
  const preset = normalizePatternPresets([{
    id: "custom-and",
    kind: "custom",
    name: "模块化 AND",
    description: "",
    builtIn: false,
    parameters: {},
    conditions: [
      { id: "ema", kind: "price_vs_ema", parameters: { period: 5, relation: "above" } },
      { id: "volume", kind: "volume_vs_average", parameters: { lookback: 5, relation: "at_least", multiplier: 1.5 } },
    ],
  }])[0];

  assert.equal(matchesPattern(bars, bars.length - 1, preset), true);
  bars.at(-1).volume = 100;
  assert.equal(matchesPattern(bars, bars.length - 1, preset), false);
  assert.equal(requiredPatternHistory([preset]), 20);
});

test("upgrades saved Always In built-ins with the strict current-control fields", () => {
  const normalized = normalizePatternPresets([{
    id: "always-in-long",
    kind: "always_in_long",
    name: "Always In Long（结构）",
    description: "legacy",
    builtIn: true,
    parameters: { emaPeriod: 20, pivotStrength: 2, followThroughBars: 2, emaSlopeBars: 3, stateLookback: 120 },
  }]);
  const upgraded = normalized.find((preset) => preset.id === "always-in-long");

  assert.equal(upgraded.name, "Always In Long（严格结构）");
  assert.equal(upgraded.parameters.recentBreakoutBars, 18);
  assert.equal(upgraded.parameters.controlWindow, 12);
  assert.equal(upgraded.parameters.minimumTrendCloses, 9);
  assert.equal(upgraded.parameters.maximumEmaCrosses, 1);
});

test("upgrades legacy pattern preferences with the optimized US and FX built-ins", () => {
  const normalized = normalizePatternPresets([breakout]);
  const usDaily = normalized.find((preset) => preset.id === "us-daily-first-pullback");
  const fxFiveMinute = normalized.find((preset) => preset.id === "fx-5m-hourly-first-pullback");

  assert.equal(usDaily?.builtIn, true);
  assert.equal(usDaily?.kind, "us_daily_first_pullback");
  assert.equal(usDaily?.parameters.maximumAtrPct, 8);
  assert.equal(fxFiveMinute?.builtIn, true);
  assert.equal(fxFiveMinute?.kind, "fx_5m_hourly_first_pullback");
  assert.equal(fxFiveMinute?.parameters.higherTimeframeMinutes, 60);
  assert.equal(fxFiveMinute?.parameters.pivotStrength, 1);
  assert.equal(fxFiveMinute?.parameters.controlWindow, 8);
  assert.equal(fxFiveMinute?.parameters.maximumEmaCrosses, 3);
});

test("reserves enough hidden history for optimized first-pullback random windows", async () => {
  const patternFilters = await import("../app/lib/patternFilters.ts");

  assert.equal(typeof patternFilters.requiredPatternHistory, "function");
  assert.equal(patternFilters.requiredPatternHistory([usDailyFirstPullback]), 85);
  assert.equal(patternFilters.requiredPatternHistory([fxFiveMinuteFirstPullback]), 792);
  assert.equal(patternFilters.requiredPatternHistory([breakout]), 20);
});

test("keeps the FX optimized preset locked to its tested one-hour context", () => {
  const normalized = normalizePatternPresets([{
    ...fxFiveMinuteFirstPullback,
    parameters: { ...fxFiveMinuteFirstPullback.parameters, higherTimeframeMinutes: 240 },
  }]);

  assert.equal(normalized.find((preset) => preset.id === fxFiveMinuteFirstPullback.id)?.parameters.higherTimeframeMinutes, 60);
});

test("breakout only uses prior candles and requires all configured conditions", () => {
  const bars = Array.from({ length: 20 }, (_, index) => candle(index, 9.7, 10, 9.4, 9.8, 100));
  bars.push(candle(20, 9.8, 10.5, 9.7, 10.3, 100));
  assert.equal(matchesPattern(bars, 20, breakout), true);
  assert.equal(matchesPattern(bars, 19, breakout), false);

  const volumeConfirmed = { ...breakout, parameters: { ...breakout.parameters, volumeMultiplier: 1.5 } };
  assert.equal(matchesPattern(bars, 20, volumeConfirmed), false);
  bars[20].volume = 200;
  assert.equal(matchesPattern(bars, 20, volumeConfirmed), true);
});

test("multiple selected presets use OR semantics and return the actual hit", () => {
  const bars = [
    candle(1, 10, 10.2, 8.8, 9),
    candle(2, 8.9, 10.7, 8.7, 10.5),
  ];
  const matches = findPatternMatches(bars, [breakout, bullishEngulfing]);
  assert.equal(matches.length, 1);
  assert.deepEqual(matches[0].presetIds, ["bullish-engulfing"]);
});

test("uptrend requires bullish EMA alignment and a rising slow EMA", () => {
  const rising = Array.from({ length: 30 }, (_, index) => {
    const close = 10 + index * 0.2;
    return candle(index, close - 0.08, close + 0.4, close - 0.2, close);
  });
  const falling = Array.from({ length: 30 }, (_, index) => {
    const close = 20 - index * 0.2;
    return candle(index, close + 0.08, close + 0.2, close - 0.4, close);
  });
  assert.equal(matchesPattern(rising, 29, uptrend), true);
  assert.equal(matchesPattern(falling, 29, uptrend), false);
});

test("uptrend breakout requires both the trend and a close above the prior high", () => {
  const bars = Array.from({ length: 30 }, (_, index) => {
    const close = 10 + index * 0.2;
    return candle(index, close - 0.08, close + 0.4, close - 0.2, close, 100);
  });
  assert.equal(matchesPattern(bars, 29, uptrendBreakout), false);
  bars.push(candle(30, 15.9, 16.8, 15.8, 16.7, 100));
  assert.equal(matchesPattern(bars, 30, uptrendBreakout), true);

  const volumeConfirmed = { ...uptrendBreakout, parameters: { ...uptrendBreakout.parameters, volumeMultiplier: 1.5 } };
  assert.equal(matchesPattern(bars, 30, volumeConfirmed), false);
  bars[30].volume = 200;
  assert.equal(matchesPattern(bars, 30, volumeConfirmed), true);
});

test("Always In Long uses confirmed higher swings plus breakout follow-through without percentages", () => {
  const bars = structuralAlwaysInBars();
  const preset = { ...alwaysInLong, parameters: alwaysInTestParameters };
  assert.equal(matchesPattern(bars, 5, preset), false);
  assert.equal(matchesPattern(bars, 6, preset), false, "the event is not enough until current control is clear");
  assert.equal(matchesPattern(bars, 7, preset), true, "a single pullback bar must not erase the state");

  const matches = findPatternMatches(bars, [preset], { cooldownBars: 20 });
  assert.deepEqual(matches.map((match) => match.index), [7]);
});

test("the default Always In Long preset recognizes a conservative two-sided swing structure", () => {
  const bars = strictAlwaysInRows.map(([open, high, low, close], index) => candle(index, open, high, low, close));

  assert.equal(matchesPattern(bars, 15, alwaysInLong), false);
  assert.equal(matchesPattern(bars, 16, alwaysInLong), true);
  assert.equal(Object.keys(alwaysInLong.parameters).some((key) => key.toLowerCase().includes("pct")), false);
});

test("a breakdown immediately disqualifies AIL instead of preserving a stale state", () => {
  const bars = structuralAlwaysInBars();
  bars.push(candle(8, 13.7, 13.9, 8.8, 9));
  bars.push(candle(9, 9, 9.1, 7.7, 8));
  const longPreset = { ...alwaysInLong, parameters: alwaysInTestParameters };

  assert.equal(matchesPattern(bars, 7, longPreset), true);
  assert.equal(matchesPattern(bars, 8, longPreset), false);
  assert.equal(matchesPattern(bars, 9, longPreset), false);
});

test("Always In Short mirrors the same strict structural control rules", () => {
  const bars = strictAlwaysInRows.map(([open, high, low, close], index) => (
    candle(index, 30 - open, 30 - low, 30 - high, 30 - close)
  ));

  assert.equal(matchesPattern(bars, 16, alwaysInLong), false);
  assert.equal(matchesPattern(bars, 16, alwaysInShort), true);
});

test("frequent EMA crossings reject an old Always In state inside a trading range", () => {
  const bars = structuralAlwaysInBars();
  const rangeCloses = [13.2, 13.9, 13.1, 13.8, 13, 13.7, 13.05, 13.65, 13.1, 13.6];
  for (const [offset, close] of rangeCloses.entries()) {
    const open = offset % 2 === 0 ? close + 0.35 : close - 0.35;
    bars.push(candle(8 + offset, open, Math.max(open, close) + 0.2, Math.min(open, close) - 0.2, close));
  }
  const preset = { ...alwaysInLong, parameters: alwaysInTestParameters };

  assert.equal(matchesPattern(bars, bars.length - 1, preset), false);
});

test("cooldown removes nearby duplicate pattern hits", () => {
  const preset = { ...bullishEngulfing, parameters: { minimumBodyPct: 20 } };
  const bars = [
    candle(1, 10, 10.2, 8.8, 9),
    candle(2, 8.9, 10.7, 8.7, 10.5),
    candle(3, 10.5, 10.6, 9.1, 9.2),
    candle(4, 9.1, 10.9, 9, 10.7),
  ];
  assert.equal(findPatternMatches(bars, [preset]).length, 2);
  assert.equal(findPatternMatches(bars, [preset], { cooldownBars: 3 }).length, 1);
});

test("US daily optimized preset accepts a normal-volatility strong breakout first pullback", () => {
  const bars = usDailyFirstPullbackBars();

  assert.equal(matchesPattern(bars, bars.length - 1, usDailyFirstPullback), true);
});

test("US daily optimized preset rejects a five-minute chart and an excessive-ATR lookalike", () => {
  const wrongTimeframe = usDailyFirstPullbackBars().map((bar, index) => ({
    ...bar,
    timestamp: index * FIVE_MINUTES_MS,
  }));
  const excessiveAtr = usDailyFirstPullbackBars();
  for (let index = excessiveAtr.length - 20; index < excessiveAtr.length; index += 1) {
    excessiveAtr[index] = {
      ...excessiveAtr[index],
      high: excessiveAtr[index].close + 10,
      low: excessiveAtr[index].close - 10,
    };
  }

  assert.equal(matchesPattern(wrongTimeframe, wrongTimeframe.length - 1, usDailyFirstPullback), false);
  assert.equal(matchesPattern(excessiveAtr, excessiveAtr.length - 1, usDailyFirstPullback), false);
});

test("US daily optimized preset rejects a later pullback after the first resumption already fired", () => {
  const bars = usDailyFirstPullbackBars();
  bars.push(candle(43 * DAY_MS, 103.25, 103.4, 102.45, 102.65, 950));
  bars.push(candle(44 * DAY_MS, 102.6, 103.45, 102.35, 103.35, 1_050));

  assert.equal(matchesPattern(bars, bars.length - 1, usDailyFirstPullback), false);
});

test("FX five-minute optimized preset requires completed-hour alignment plus a strict first pullback trigger", () => {
  const bars = fxFiveMinuteFirstPullbackBars();

  assert.equal(matchesPattern(bars, bars.length - 3, alwaysInLong), true, "the 5-minute direction alone is present before the pullback");
  assert.equal(matchesPattern(bars, bars.length - 3, fxFiveMinuteFirstPullback), false, "Always-In alone is not an entry trigger");
  assert.equal(matchesPattern(bars, bars.length - 1, fxFiveMinuteFirstPullback), true);
});

test("FX five-minute optimized preset rejects a countertrend completed-hour context", () => {
  const bars = fxFiveMinuteFirstPullbackBars({ higherTrend: "down" });

  assert.equal(matchesPattern(bars, bars.length - 1, fxFiveMinuteFirstPullback), false);
});

test("FX hourly confirmation never reads bars after the evaluated five-minute candle", () => {
  const bars = fxFiveMinuteFirstPullbackBars({ higherTrend: "down" });
  const evaluatedIndex = bars.length - 1;
  for (let offset = 0; offset < 48; offset += 1) {
    const close = 30 + offset;
    bars.push(candle(bars.length * FIVE_MINUTES_MS, close - 0.2, close + 0.4, close - 0.4, close));
  }

  assert.equal(matchesPattern(bars, evaluatedIndex, fxFiveMinuteFirstPullback), false);
});
