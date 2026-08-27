import assert from "node:assert/strict";
import test from "node:test";

import {
  TIMEFRAME_IDS,
  TIMEFRAME_LABELS,
  canAggregateTimeframe,
  isCalendarTimeframe,
  isSupportedTimeframe,
  timeframeRank,
} from "../app/lib/timeframeCatalog.ts";

test("defines the complete MT4 timeframe order and labels", () => {
  assert.deepEqual(TIMEFRAME_IDS, ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w", "1mo"]);
  assert.deepEqual(TIMEFRAME_IDS.map((id) => TIMEFRAME_LABELS[id]), ["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1", "MN"]);
});

test("compares timeframes by trading scale and identifies calendar periods", () => {
  assert.equal(timeframeRank("1m"), 0);
  assert.equal(timeframeRank("1mo"), 8);
  assert.equal(canAggregateTimeframe("5m", "15m"), true);
  assert.equal(canAggregateTimeframe("1d", "1mo"), true);
  assert.equal(canAggregateTimeframe("1w", "1mo"), false);
  assert.equal(canAggregateTimeframe("1d", "4h"), false);
  assert.equal(canAggregateTimeframe("1h", "1h"), false);
  assert.equal(isCalendarTimeframe("1mo"), true);
  assert.equal(isCalendarTimeframe("1w"), false);
  assert.equal(isSupportedTimeframe("MN"), false);
  assert.equal(isSupportedTimeframe("1mo"), true);
});
