import assert from "node:assert/strict";
import test from "node:test";

import {
  randomEligibleStartIndices,
  trailingAverageDailyDollarVolume,
} from "../app/lib/randomLiquidity.ts";

const day = 24 * 60 * 60 * 1000;
const candles = (volume) => Array.from({ length: 90 }, (_, index) => ({
  timestamp: Date.parse("2025-01-01T21:00:00Z") + index * day,
  close: 100,
  volume,
}));
const config = {
  instrumentMode: "market",
  anchorInstrumentId: "AAPL",
  market: "美股",
  timeframeMode: "fixed",
  anchorTimeframe: "1d",
  fixedTimeframe: "1d",
  dateMode: "all",
  length: 20,
  includeIndices: false,
  usLiquidityFilter: true,
  usMinAverageDailyDollarVolume: 1000000,
};

test("filters a sparse US partition using only trailing dollar volume", () => {
  const sparse = candles(100);
  assert.equal(trailingAverageDailyDollarVolume(sparse, 40, "America/New_York", "1d"), 10000);
  assert.deepEqual(randomEligibleStartIndices(
    sparse,
    "America/New_York",
    "1d",
    20,
    config,
    "美股",
  ), []);
});

test("keeps liquid US history and leaves other markets unaffected", () => {
  const liquid = candles(20000);
  assert.ok(randomEligibleStartIndices(
    liquid,
    "America/New_York",
    "1d",
    20,
    config,
    "US",
  ).length > 0);
  assert.ok(randomEligibleStartIndices(
    candles(0),
    "Asia/Shanghai",
    "1d",
    20,
    config,
    "A股",
  ).length > 0);
});

test("can disable the US liquidity filter without changing stored candles", () => {
  const starts = randomEligibleStartIndices(
    candles(0),
    "America/New_York",
    "1d",
    20,
    { ...config, usLiquidityFilter: false },
    "美股",
  );
  assert.ok(starts.length > 0);
});
