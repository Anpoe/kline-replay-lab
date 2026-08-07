import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateFxHistoryBoundary,
  calculateFxIncrementStart,
  getFx5mBucket,
  isFx5mAligned,
  isFxCandleComplete,
  normalizeFxInstrument,
  resolveFxInstrument,
} from "../app/lib/fxDataContracts.ts";

test("标准化 FX 内部品种并保留供应商映射", () => {
  assert.equal(normalizeFxInstrument("eur/usd"), "EURUSD.FX");
  assert.equal(normalizeFxInstrument("USDJPY.FX"), "USDJPY.FX");
  assert.equal(normalizeFxInstrument("not-a-forex-symbol"), null);

  const instrument = resolveFxInstrument("GBP/USD");
  assert.equal(instrument?.id, "GBPUSD.FX");
  assert.equal(instrument?.dukascopySymbol, "GBPUSD");
  assert.equal(instrument?.twelveDataSymbol, "GBP/USD");
  assert.equal(instrument?.pricePrecision, 5);
});

test("5m 时间桶严格按 UTC epoch 对齐", () => {
  const timestamp = Date.parse("2026-08-06T12:34:59.999Z");
  const bucket = getFx5mBucket(timestamp);

  assert.equal(bucket, Date.parse("2026-08-06T12:30:00.000Z"));
  assert.equal(isFx5mAligned(bucket), true);
  assert.equal(getFx5mBucket(bucket + 1), bucket);
});

test("只把结束时刻已到达的 5m K 线交给增量写入", () => {
  const start = Date.parse("2026-08-06T12:30:00.000Z");
  assert.equal(isFxCandleComplete(start, "5m", start + 5 * 60 * 1000 - 1), false);
  assert.equal(isFxCandleComplete({ timestamp: start }, "5m", start + 5 * 60 * 1000), true);
});

test("历史边界包含 Dukascopy 最后一根，增量起点排他且不回退", () => {
  const first = Date.parse("2026-08-06T12:20:00.000Z");
  const second = Date.parse("2026-08-06T12:25:00.000Z");
  const boundary = calculateFxHistoryBoundary([
    { timestamp: first, open: 1, high: 1, low: 1, close: 1, volume: null, turnover: null },
    { timestamp: second, open: 1, high: 1, low: 1, close: 1, volume: null, turnover: null },
  ], {
    instrumentId: "EURUSD.FX",
    source: "dukascopy",
    asOfTimestamp: second + 5 * 60 * 1000,
    establishedAt: second + 5 * 60 * 1000,
  });

  assert.equal(boundary?.lastCompleteTimestamp, second);
  assert.equal(boundary?.nextStartTimestamp, Date.parse("2026-08-06T12:30:00.000Z"));
  assert.equal(calculateFxIncrementStart(boundary, {
    instrumentId: "EURUSD.FX",
    timeframe: "1m",
    source: "twelvedata",
    lastCompleteTimestamp: first,
    nextStartTimestamp: first,
    cursor: null,
    lastSuccessfulAt: null,
    updatedAt: second,
  }), Date.parse("2026-08-06T12:30:00.000Z"));
});
