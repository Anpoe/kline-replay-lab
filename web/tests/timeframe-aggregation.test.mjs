import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateCandlesToTimeframe,
  canAggregateTimeframe,
} from "../app/lib/timeframeAggregation.ts";
import { aggregateCandles as aggregateFxCandles } from "../app/lib/fx/dukascopyAggregation.ts";

function candle(timestamp, open, high, low, close, volume, turnover) {
  return { timestamp, open, high, low, close, volume, turnover };
}

test("aggregates lower-period candles into a higher-period OHLCV bar", () => {
  const start = Date.parse("2026-01-05T09:30:00Z");
  const result = aggregateCandlesToTimeframe([
    candle(start, 10, 11, 9, 10.5, 2, 20),
    candle(start + 5 * 60_000, 10.5, 12, 10, 11.5, 3, 33),
    candle(start + 10 * 60_000, 11.5, 13, 10.5, 12, 4, 48),
  ], "1h", "UTC");

  assert.deepEqual(result, [{
    timestamp: start,
    open: 10,
    high: 13,
    low: 9,
    close: 12,
    volume: 9,
    turnover: 101,
  }]);
});

test("groups daily and weekly candles by the requested timezone", () => {
  const result = aggregateCandlesToTimeframe([
    candle(Date.parse("2026-01-05T23:30:00Z"), 10, 11, 9, 10, 1, 10),
    candle(Date.parse("2026-01-06T00:30:00Z"), 10, 12, 8, 11, 2, 22),
    candle(Date.parse("2026-01-12T05:30:00Z"), 11, 13, 10, 12, 3, 36),
  ], "1w", "America/New_York");

  assert.equal(result.length, 2);
  assert.deepEqual(result.map((bar) => bar.timestamp), [
    Date.parse("2026-01-05T23:30:00Z"),
    Date.parse("2026-01-12T05:30:00Z"),
  ]);
  assert.equal(result[0].high, 12);
  assert.equal(result[0].volume, 3);
});

test("keeps elapsed intraday buckets distinct across a daylight-saving fallback", () => {
  const result = aggregateCandlesToTimeframe([
    candle(Date.parse("2026-11-01T05:30:00Z"), 10, 11, 9, 10, 1, 10),
    candle(Date.parse("2026-11-01T06:30:00Z"), 10, 12, 8, 11, 2, 22),
  ], "1h", "America/New_York");

  assert.equal(result.length, 2);
  assert.deepEqual(result.map((bar) => bar.volume), [1, 2]);
});

test("uses the FX session rollover when deriving daily candles", () => {
  const result = aggregateFxCandles([
    candle(Date.parse("2026-01-05T21:30:00Z"), 10, 11, 9, 10, 1, 10),
    candle(Date.parse("2026-01-05T22:30:00Z"), 10, 12, 8, 11, 2, 22),
  ], "1d", {
    timeZone: "America/New_York",
    sessionStartHour: 17,
    sessionStartMinute: 0,
    weekStartsOn: 0,
  });

  assert.deepEqual(result.map((bar) => bar.timestamp), [
    Date.parse("2026-01-04T22:00:00Z"),
    Date.parse("2026-01-05T22:00:00Z"),
  ]);
  assert.deepEqual(result.map((bar) => bar.volume), [1, 2]);
});

test("only allows aggregation from a lower period to a higher period", () => {
  assert.equal(canAggregateTimeframe("5m", "1h"), true);
  assert.equal(canAggregateTimeframe("1d", "1w"), true);
  assert.equal(canAggregateTimeframe("1h", "5m"), false);
  assert.equal(canAggregateTimeframe("1d", "1d"), false);
});
