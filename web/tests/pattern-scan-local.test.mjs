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
