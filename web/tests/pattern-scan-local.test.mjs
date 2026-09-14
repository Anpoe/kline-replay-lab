import assert from "node:assert/strict";
import test from "node:test";

import { screenLatestCandles } from "../local-data/pattern-scan.mjs";

function makeCandles(count = 22) {
  return Array.from({ length: count }, (_, index) => ({
    timestamp: Date.UTC(2026, 0, index + 1),
    open: 10 + index * 0.1,
    high: 10.4 + index * 0.1,
    low: 9.8 + index * 0.1,
    close: 10.2 + index * 0.1,
    volume: 1_000_000 + index * 10_000,
    turnover: 10_000_000 + index * 100_000,
  }));
}

test("latest scanner applies price and liquidity gates", () => {
  const candles = makeCandles();
  const accepted = screenLatestCandles(candles, [], {
    minPrice: 11,
    maxPrice: 20,
    minAverageVolume: 900_000,
  });
  assert.ok(accepted);
  assert.equal(accepted.timestamp, candles.at(-1).timestamp);
  assert.equal(screenLatestCandles(candles, [], { minPrice: 20 }), null);
  assert.equal(screenLatestCandles(candles, [], { minAverageVolume: 2_000_000 }), null);
});

test("latest scanner applies the current-day change range", () => {
  const candles = makeCandles();
  candles[candles.length - 2] = { ...candles.at(-2), close: 100 };
  candles[candles.length - 1] = {
    ...candles.at(-1),
    open: 104,
    high: 106,
    low: 99,
    close: 105,
  };

  const accepted = screenLatestCandles(candles, [], { minChangePct: 4, maxChangePct: 6 });
  assert.ok(accepted);
  assert.ok(Math.abs(accepted.changePct - 5) < 1e-9);
  assert.equal(screenLatestCandles(candles, [], { minChangePct: 6 }), null);
  assert.equal(screenLatestCandles(candles, [], { maxChangePct: 4 }), null);
});

test("latest scanner excludes a close at the configured limit-up price", () => {
  const candles = makeCandles();
  candles[candles.length - 2] = {
    ...candles.at(-2),
    open: 10,
    high: 10.5,
    low: 9.8,
    close: 10,
  };
  candles[candles.length - 1] = {
    ...candles.at(-1),
    open: 10.5,
    high: 11,
    low: 10.4,
    close: 11,
  };

  assert.equal(screenLatestCandles(candles, [], {
    excludeLimitUp: true,
    limitUpRatio: 0.1,
  }), null);
  assert.ok(screenLatestCandles(candles.map((candle, index) => index === candles.length - 1
    ? { ...candle, close: 10.99 }
    : candle), [], {
    excludeLimitUp: true,
    limitUpRatio: 0.1,
  }));
  assert.equal(screenLatestCandles(candles.map((candle, index) => index === candles.length - 1
    ? { ...candle, close: 12, high: 12 }
    : candle), [], {
    excludeLimitUp: true,
    limitUpRatio: 0.2,
  }), null);
});

test("selected pattern presets use OR matching and report the hit", () => {
  const candles = makeCandles();
  candles[candles.length - 1] = {
    ...candles.at(-1),
    open: 12.5,
    high: 12.7,
    low: 10,
    close: 12.6,
  };
  const presets = [
    {
      id: "never-breakout",
      name: "不会命中的突破",
      kind: "breakout",
      parameters: { lookback: 20, minimumBreakoutPct: 50, volumeMultiplier: 0 },
    },
    {
      id: "long-wick",
      name: "长下影线",
      kind: "long_lower_wick",
      parameters: { wickBodyRatio: 2, closeLocationPct: 60 },
    },
  ];
  const result = screenLatestCandles(candles, presets);
  assert.ok(result);
  assert.deepEqual(result.presetIds, ["long-wick"]);
  assert.deepEqual(result.presetNames, ["长下影线"]);
});

test("selected patterns reject a symbol when none match", () => {
  const result = screenLatestCandles(makeCandles(), [{
    id: "impossible",
    name: "极端突破",
    kind: "breakout",
    parameters: { lookback: 20, minimumBreakoutPct: 100, volumeMultiplier: 0 },
  }]);
  assert.equal(result, null);
});

test("local scanner recognizes modular custom conditions with AND semantics", () => {
  const candles = makeCandles(25);
  candles[candles.length - 1] = {
    ...candles.at(-1),
    volume: 2_000_000,
  };
  const preset = {
    id: "custom-modular",
    name: "模块化趋势",
    kind: "custom",
    parameters: {},
    conditions: [
      { id: "ema", kind: "price_vs_ema", parameters: { period: 5, relation: "above" } },
      { id: "volume", kind: "volume_vs_average", parameters: { lookback: 5, relation: "at_least", multiplier: 1.5 } },
    ],
  };

  const result = screenLatestCandles(candles, [preset]);
  assert.ok(result);
  assert.deepEqual(result.presetIds, ["custom-modular"]);
  candles[candles.length - 1].volume = 1_000_000;
  assert.equal(screenLatestCandles(candles, [preset]), null);
});

test("local scanner recognizes the structural Always In Long preset", () => {
  const rows = [
    [9.8, 10.5, 9.5, 10],
    [10, 12, 9.8, 11.5],
    [11.3, 11.4, 9, 10],
    [10.3, 13, 10.2, 12.5],
    [12, 12.1, 10, 10.5],
    [10.5, 13.8, 10.4, 13.5],
    [13.4, 14.5, 13.2, 14.2],
    [14.1, 14.2, 13, 13.8],
  ];
  const candles = rows.map(([open, high, low, close], index) => ({
    timestamp: index,
    open,
    high,
    low,
    close,
    volume: 100,
    turnover: 1_000,
  }));
  const preset = {
    id: "always-in-long",
    name: "Always In Long（结构）",
    kind: "always_in_long",
    parameters: {
      emaPeriod: 5,
      pivotStrength: 1,
      followThroughBars: 1,
      emaSlopeBars: 1,
      stateLookback: 20,
      recentBreakoutBars: 10,
      controlWindow: 6,
      minimumTrendCloses: 3,
      maximumEmaCrosses: 3,
    },
  };

  const result = screenLatestCandles(candles, [preset]);
  assert.ok(result);
  assert.deepEqual(result.presetIds, ["always-in-long"]);
});
