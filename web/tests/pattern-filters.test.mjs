import assert from "node:assert/strict";
import test from "node:test";

import { defaultPatternPresets, findPatternMatches, matchesPattern, normalizePatternPresets } from "../app/lib/patternFilters.ts";

const candle = (timestamp, open, high, low, close, volume = 100) => ({ timestamp, open, high, low, close, volume });
const breakout = defaultPatternPresets.find((preset) => preset.id === "breakout");
const uptrend = defaultPatternPresets.find((preset) => preset.id === "uptrend");
const uptrendBreakout = defaultPatternPresets.find((preset) => preset.id === "uptrend-breakout");
const bullishEngulfing = defaultPatternPresets.find((preset) => preset.id === "bullish-engulfing");
const contraction = defaultPatternPresets.find((preset) => preset.id === "contraction");

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
