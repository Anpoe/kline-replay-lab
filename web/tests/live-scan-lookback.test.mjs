import assert from "node:assert/strict";
import test from "node:test";
import { findRecentCandleMatch, normalizeLiveScanLookbackDays, restrictMatchesToMarketDays } from "../app/lib/liveScanLookback.mjs";
import { screenRecentCandles } from "../local-data/pattern-scan.mjs";

const candles = [
  { timestamp: Date.UTC(2026, 9, 1), open: 10, high: 11, low: 9, close: 10, volume: 100, turnover: 1000 },
  { timestamp: Date.UTC(2026, 9, 8), open: 10, high: 11, low: 9, close: 11, volume: 200, turnover: 2000 },
  { timestamp: Date.UTC(2026, 9, 9), open: 11, high: 11, low: 9, close: 10, volume: 100, turnover: 1000 },
];
const presets = [{ id: "bull", name: "阳线", kind: "custom", conditions: [
  { kind: "candle_body", parameters: { direction: "bullish", minimumPct: 40 } },
] }];

test("lookback defaults to latest only and is bounded", () => {
  for (const value of [undefined, "bad", 0, -1, null]) assert.equal(normalizeLiveScanLookbackDays(value), 1);
  assert.equal(normalizeLiveScanLookbackDays("5"), 5);
  assert.equal(normalizeLiveScanLookbackDays(1000), 60);
});

test("recent scanner finds past signals, keeps current prices, and includes the boundary", () => {
  assert.equal(screenRecentCandles(candles, presets), null);
  const match = screenRecentCandles(candles, presets, {}, 2);
  assert.equal(match.matchedTimestamp, candles[1].timestamp);
  assert.equal(match.lagTradingDays, 1);
  assert.equal(match.timestamp, candles[2].timestamp);
  assert.equal(match.close, 10);
  assert.deepEqual(match.presetIds, ["bull"]);
  assert.equal(screenRecentCandles([...candles, { ...candles[2], timestamp: Date.UTC(2026, 9, 12) }], presets, {}, 2), null);
});

test("all filters must hold on the same signal day and use only its past liquidity", () => {
  assert.ok(screenRecentCandles(candles, presets, { minPrice: 11, minChangePct: 9, minAverageVolume: 150 }, 2));
  assert.equal(screenRecentCandles(candles, presets, { maxPrice: 10 }, 2), null);
  assert.equal(screenRecentCandles(candles, presets, { minAverageVolume: 151 }, 2), null);
  assert.equal(screenRecentCandles(candles, presets, { excludeLimitUp: true, limitUpRatio: 0.1, priceTick: 0.01 }, 2), null);
});

test("most recent full match wins and future bars are never passed to evaluation", () => {
  const observed = [];
  const match = findRecentCandleMatch(candles, 3, (history, applyFilters) => {
    observed.push([history.length, applyFilters]);
    const bar = history.at(-1);
    return applyFilters && history.length === 3 ? null : { ...bar, presetIds: [], presetNames: [] };
  });
  assert.equal(match.matchedTimestamp, candles[1].timestamp);
  assert.deepEqual(observed, [[3, false], [3, true], [2, true]]);
  assert.equal(screenRecentCandles([], [], {}, 5), null);
  assert.equal(screenRecentCandles(candles, [], {}, 5).lagTradingDays, 0);
});

test("suspension gaps do not extend the market trading-day window", () => {
  const results = [{ instrumentId: "a", matchedTimestamp: 10 }, { instrumentId: "b", matchedTimestamp: 30 }];
  assert.deepEqual(restrictMatchesToMarketDays(results, [10, 20, 30, 40, 40], 2), [
    { instrumentId: "b", matchedTimestamp: 30, lagTradingDays: 1 },
  ]);
});
