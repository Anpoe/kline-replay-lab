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

test("aggregates 15-minute, 30-minute, and four-hour buckets", () => {
  const start = Date.parse("2026-01-05T09:00:00Z");
  const candles = Array.from({ length: 4 }, (_, index) => candle(
    start + index * 15 * 60_000,
    10 + index,
    11 + index,
    9 + index,
    10.5 + index,
    index + 1,
    (index + 1) * 10,
  ));

  assert.deepEqual(aggregateCandlesToTimeframe(candles, "30m").map((bar) => ({
    timestamp: bar.timestamp,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    turnover: bar.turnover,
  })), [{
    timestamp: start,
    open: 10,
    high: 12,
    low: 9,
    close: 11.5,
    volume: 3,
    turnover: 30,
  }, {
    timestamp: start + 30 * 60_000,
    open: 12,
    high: 14,
    low: 11,
    close: 13.5,
    volume: 7,
    turnover: 70,
  }]);
  assert.deepEqual(aggregateCandlesToTimeframe([
    ...candles,
    candle(start + 4 * 60 * 60_000, 20, 21, 19, 20.5, 5, 50),
  ], "4h").map((bar) => ({
    timestamp: bar.timestamp,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    turnover: bar.turnover,
  })), [{
    timestamp: start,
    open: 10,
    high: 14,
    low: 9,
    close: 13.5,
    volume: 10,
    turnover: 100,
  }, {
    timestamp: start + 4 * 60 * 60_000,
    open: 20,
    high: 21,
    low: 19,
    close: 20.5,
    volume: 5,
    turnover: 50,
  }]);
});

test("groups monthly candles by local calendar month", () => {
  const result = aggregateCandlesToTimeframe([
    candle(Date.parse("2026-01-31T23:30:00Z"), 10, 11, 9, 10, 1, 10),
    candle(Date.parse("2026-02-01T00:30:00Z"), 10, 12, 8, 11, 2, 22),
    candle(Date.parse("2026-02-28T23:30:00Z"), 11, 13, 10, 12, 3, 36),
  ], "1mo", "UTC");

  assert.equal(result.length, 2);
  assert.deepEqual(result.map((bar) => bar.timestamp), [
    Date.parse("2026-01-31T23:30:00Z"),
    Date.parse("2026-02-01T00:30:00Z"),
  ]);
  assert.deepEqual(result.map((bar) => [bar.high, bar.low, bar.close, bar.volume, bar.turnover]), [
    [11, 9, 10, 1, 10],
    [13, 8, 12, 5, 58],
  ]);
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
