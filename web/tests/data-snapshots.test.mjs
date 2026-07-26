import assert from "node:assert/strict";
import test from "node:test";
import { computeSnapshotDelta } from "../app/lib/dataSnapshots.ts";

const candle = (timestamp, close) => ({
  timestamp,
  open: close,
  high: close + 1,
  low: close - 1,
  close,
  volume: 100,
  turnover: 1000,
});

test("行情快照只保存新增、修正和删除的差异", () => {
  const previous = [candle(1, 10), candle(2, 11), candle(3, 12)];
  const current = [candle(1, 10), candle(2, 15), candle(4, 13)];
  const delta = computeSnapshotDelta(previous, current);

  assert.deepEqual(delta.changedCandles.map((item) => item.timestamp), [2, 4]);
  assert.deepEqual(delta.removedTimestamps, [3]);
});

test("行情没有变化时不会产生差异内容", () => {
  const bars = [candle(1, 10), candle(2, 11)];
  const delta = computeSnapshotDelta(bars, structuredClone(bars));
  assert.equal(delta.changedCandles.length, 0);
  assert.equal(delta.removedTimestamps.length, 0);
});
