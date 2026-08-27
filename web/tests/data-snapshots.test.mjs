import assert from "node:assert/strict";
import test from "node:test";
import { computeSnapshotDelta } from "../app/lib/dataSnapshots.ts";
import {
  buildSnapshotChunks,
  decodeSnapshotChunk,
  MAX_SNAPSHOT_CHUNK_BYTES,
  materializeSnapshotCandleWindow,
  materializeSnapshotCandles,
  snapshotBucketKey,
} from "../app/lib/snapshotStorage.ts";

const candle = (timestamp, close) => ({
  timestamp,
  open: close,
  high: close + 1,
  low: close - 1,
  close,
  volume: 100,
  turnover: 1000,
});

test("snapshot delta stores additions, corrections, and removals", () => {
  const previous = [candle(1, 10), candle(2, 11), candle(3, 12)];
  const current = [candle(1, 10), candle(2, 15), candle(4, 13)];
  const delta = computeSnapshotDelta(previous, current);

  assert.deepEqual(delta.changedCandles.map((item) => item.timestamp), [2, 4]);
  assert.deepEqual(delta.removedTimestamps, [3]);
});

test("unchanged candles produce an empty delta", () => {
  const bars = [candle(1, 10), candle(2, 11)];
  const delta = computeSnapshotDelta(bars, structuredClone(bars));
  assert.equal(delta.changedCandles.length, 0);
  assert.equal(delta.removedTimestamps.length, 0);
});

test("snapshot chunking is deterministic across input order", async () => {
  const start = Date.UTC(2026, 0, 1);
  const bars = Array.from({ length: 20 }, (_, index) => candle(start + index * 60_000, 10 + index));
  const forward = await buildSnapshotChunks(bars, "1m", 300);
  const reversed = await buildSnapshotChunks([...bars].reverse(), "1m", 300);

  assert.deepEqual(
    forward.map(({ bucketKey, chunkHash, barCount }) => ({ bucketKey, chunkHash, barCount })),
    reversed.map(({ bucketKey, chunkHash, barCount }) => ({ bucketKey, chunkHash, barCount })),
  );
});

test("oversized time buckets are split below the configured UTF-8 limit", async () => {
  const start = Date.UTC(2026, 0, 1);
  const bars = Array.from({ length: 60 }, (_, index) => candle(start + index * 60_000, 10 + index / 10));
  const chunks = await buildSnapshotChunks(bars, "1m", 240);

  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.byteSize <= 240));
  assert.ok(chunks.every((chunk) => chunk.bucketKey === "day:2026-01-01"));
});

test("snapshot bucket policy covers every catalog timeframe", () => {
  const timestamp = Date.UTC(2026, 1, 11, 12, 34);

  assert.equal(snapshotBucketKey(timestamp, "1m"), "day:2026-02-11");
  assert.equal(snapshotBucketKey(timestamp, "5m"), "week:2026-02-09");
  assert.equal(snapshotBucketKey(timestamp, "15m"), "week:2026-02-09");
  assert.equal(snapshotBucketKey(timestamp, "30m"), "week:2026-02-09");
  assert.equal(snapshotBucketKey(timestamp, "1h"), "month:2026-02");
  assert.equal(snapshotBucketKey(timestamp, "4h"), "month:2026-02");
  assert.equal(snapshotBucketKey(timestamp, "1d"), "year:2026");
  assert.equal(snapshotBucketKey(timestamp, "1w"), "year:2026");
  assert.equal(snapshotBucketKey(timestamp, "1mo"), "year:2026");
});

test("compact snapshot chunks round-trip candles exactly", async () => {
  const bars = [
    candle(Date.UTC(2026, 0, 1), 10.125),
    { ...candle(Date.UTC(2026, 0, 2), 11.25), volume: null, turnover: null },
  ];
  const chunks = await buildSnapshotChunks(bars, "1d");
  const decoded = chunks.flatMap((chunk) => decodeSnapshotChunk(chunk.payloadJson, chunk.encoding));

  assert.deepEqual(decoded, bars);
});

test("multi-megabyte FX history never produces a D1-sized chunk", async () => {
  const start = Date.UTC(2026, 0, 1);
  const bars = Array.from({ length: 40_000 }, (_, index) => ({
    timestamp: start + index * 60_000,
    open: 1.075 + index / 10_000_000,
    high: 1.076 + index / 10_000_000,
    low: 1.074 + index / 10_000_000,
    close: 1.0755 + index / 10_000_000,
    volume: 1000 + index,
    turnover: null,
  }));
  const chunks = await buildSnapshotChunks(bars, "1m");
  const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.byteSize, 0);

  assert.ok(totalBytes > 2_000_000);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.byteSize <= MAX_SNAPSHOT_CHUNK_BYTES));
  assert.equal(chunks.reduce((sum, chunk) => sum + chunk.barCount, 0), bars.length);
});

test("range reads fetch only intersecting v2 chunks and preserve global indices", async () => {
  const start = Date.UTC(2026, 0, 1);
  const bars = Array.from({ length: 80 }, (_, index) => candle(start + index * 60_000, 10 + index));
  const chunks = await buildSnapshotChunks(bars, "1m", 260);
  const payloadQueries = [];
  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async all() {
              if (!sql.includes("INNER JOIN")) {
                return {
                  results: chunks.map((chunk) => ({
                    sequence: chunk.sequence,
                    firstTimestamp: chunk.firstTimestamp,
                    lastTimestamp: chunk.lastTimestamp,
                    barCount: chunk.barCount,
                  })),
                };
              }
              const firstSequence = Number(args[1]);
              const lastSequence = Number(args[2]);
              payloadQueries.push([firstSequence, lastSequence]);
              return {
                results: chunks
                  .filter((chunk) => chunk.sequence >= firstSequence && chunk.sequence <= lastSequence)
                  .map((chunk) => ({
                    sequence: chunk.sequence,
                    encoding: chunk.encoding,
                    payloadJson: chunk.payloadJson,
                    barCount: chunk.barCount,
                  })),
              };
            },
          };
        },
      };
    },
  };
  const row = legacyRow({
    id: "v2-range",
    barCount: bars.length,
    firstTimestamp: bars[0].timestamp,
    lastTimestamp: bars.at(-1).timestamp,
    storedBarCount: bars.length,
    formatVersion: 2,
    chunkCount: chunks.length,
  });
  const window = await materializeSnapshotCandleWindow(db, row, {
    startTimestamp: bars[40].timestamp,
    endTimestamp: bars[49].timestamp,
    lookbackBars: 5,
  });

  assert.deepEqual(window.candles, bars.slice(35, 50));
  assert.equal(window.startIndex, 35);
  assert.equal(window.endIndex, 49);
  assert.equal(window.snapshotBarCount, bars.length);
  assert.equal(window.isPartial, true);
  const loadedChunkCount = payloadQueries.reduce((sum, [first, last]) => sum + last - first + 1, 0);
  assert.ok(payloadQueries.length <= 2);
  assert.ok(loadedChunkCount < chunks.length);
});

test("legacy delta snapshots remain materializable", async () => {
  const baseBars = [candle(1, 10), candle(2, 11), candle(3, 12)];
  const changedBars = [candle(2, 15), candle(4, 13)];
  const rows = new Map([
    ["base", legacyRow({ id: "base", candlesJson: JSON.stringify(baseBars) })],
  ]);
  const db = {
    prepare() {
      return {
        bind(id) {
          return { first: async () => rows.get(id) ?? null };
        },
      };
    },
  };
  const delta = legacyRow({
    id: "delta",
    storageMode: "delta",
    baseSnapshotId: "base",
    candlesJson: JSON.stringify(changedBars),
    removedTimestampsJson: "[3]",
  });

  assert.deepEqual(
    (await materializeSnapshotCandles(db, delta)).map((item) => [item.timestamp, item.close]),
    [[1, 10], [2, 15], [4, 13]],
  );
});

function legacyRow(overrides = {}) {
  return {
    id: "legacy",
    contentHash: "legacy-hash",
    instrumentId: "TEST",
    timeframe: "1d",
    adjustmentType: "none",
    instrumentJson: "{}",
    candlesJson: "[]",
    barCount: 0,
    firstTimestamp: 0,
    lastTimestamp: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    baseSnapshotId: null,
    storageMode: "full",
    removedTimestampsJson: "[]",
    chainDepth: 0,
    storedBarCount: 0,
    formatVersion: 1,
    status: "ready",
    sourceJson: "{}",
    normalizationVersion: 1,
    chunkCount: 0,
    ...overrides,
  };
}
