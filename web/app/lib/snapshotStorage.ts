import type { SnapshotCandle } from "./dataSnapshots";
import type { getRawDb } from "../../db/runtime";

export const SNAPSHOT_FORMAT_VERSION = 2;
export const SNAPSHOT_NORMALIZATION_VERSION = 1;
export const MAX_SNAPSHOT_CHUNK_BYTES = 1_250_000;
export const SNAPSHOT_CHUNK_ENCODING = "compact-json-v1";

type CompactCandle = [number, number, number, number, number, number | null, number | null];

export type SnapshotStatus = "building" | "ready" | "failed";

export type SnapshotRow = {
  id: string;
  contentHash: string;
  instrumentId: string;
  timeframe: string;
  adjustmentType: string;
  instrumentJson: string;
  candlesJson: string;
  barCount: number;
  firstTimestamp: number;
  lastTimestamp: number;
  createdAt: string;
  baseSnapshotId: string | null;
  storageMode: "full" | "delta";
  removedTimestampsJson: string;
  chainDepth: number;
  storedBarCount: number;
  formatVersion: number;
  status: SnapshotStatus;
  sourceJson: string;
  normalizationVersion: number;
  chunkCount: number;
};

export type SnapshotChunk = {
  sequence: number;
  bucketKey: string;
  chunkHash: string;
  encoding: typeof SNAPSHOT_CHUNK_ENCODING;
  payloadJson: string;
  barCount: number;
  firstTimestamp: number;
  lastTimestamp: number;
  byteSize: number;
};

export type SnapshotReadRange = {
  startTimestamp?: number;
  endTimestamp?: number;
  lookbackBars?: number;
};

export type SnapshotCandleWindow = {
  candles: SnapshotCandle[];
  startIndex: number;
  endIndex: number;
  snapshotBarCount: number;
  isPartial: boolean;
};

type SnapshotChunkMap = {
  sequence: number;
  firstTimestamp: number;
  lastTimestamp: number;
  barCount: number;
};

type SnapshotDatabase = ReturnType<typeof getRawDb>;

export const snapshotColumns = `id, content_hash AS contentHash, instrument_id AS instrumentId,
  timeframe, adjustment_type AS adjustmentType, instrument_json AS instrumentJson,
  candles_json AS candlesJson, bar_count AS barCount,
  first_timestamp AS firstTimestamp, last_timestamp AS lastTimestamp,
  created_at AS createdAt, base_snapshot_id AS baseSnapshotId,
  storage_mode AS storageMode, removed_timestamps_json AS removedTimestampsJson,
  chain_depth AS chainDepth, stored_bar_count AS storedBarCount,
  format_version AS formatVersion, status, source_json AS sourceJson,
  normalization_version AS normalizationVersion, chunk_count AS chunkCount`;

const textEncoder = new TextEncoder();

function requiredNumber(value: unknown, field: string) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Invalid candle ${field}`);
  return number;
}

function nullableNumber(value: unknown) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compactCandle(candle: SnapshotCandle): CompactCandle {
  return [
    requiredNumber(candle.timestamp, "timestamp"),
    requiredNumber(candle.open, "open"),
    requiredNumber(candle.high, "high"),
    requiredNumber(candle.low, "low"),
    requiredNumber(candle.close, "close"),
    nullableNumber(candle.volume),
    nullableNumber(candle.turnover),
  ];
}

function expandCandle(candle: unknown): SnapshotCandle {
  if (!Array.isArray(candle) || candle.length !== 7) throw new Error("Invalid compact candle payload");
  return {
    timestamp: requiredNumber(candle[0], "timestamp"),
    open: requiredNumber(candle[1], "open"),
    high: requiredNumber(candle[2], "high"),
    low: requiredNumber(candle[3], "low"),
    close: requiredNumber(candle[4], "close"),
    volume: nullableNumber(candle[5]),
    turnover: nullableNumber(candle[6]),
  };
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) result[key] = canonicalValue(child);
    }
    return result;
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

export function canonicalStringify(value: unknown) {
  return JSON.stringify(canonicalValue(value));
}

export async function sha256Text(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function utcDateKey(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function utcWeekKey(timestamp: number) {
  const date = new Date(timestamp);
  const dayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  return utcDateKey(dayStart - daysSinceMonday * 86_400_000);
}

export function snapshotBucketKey(timestamp: number, timeframe: string) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid candle timestamp");
  switch (timeframe.toLowerCase()) {
    case "1m":
      return `day:${utcDateKey(timestamp)}`;
    case "5m":
    case "15m":
    case "30m":
      return `week:${utcWeekKey(timestamp)}`;
    case "1h":
    case "4h":
      return `month:${date.toISOString().slice(0, 7)}`;
    case "1d":
    case "1w":
    case "1mo":
      return `year:${date.getUTCFullYear()}`;
    default:
      return `day:${utcDateKey(timestamp)}`;
  }
}

type PendingChunk = {
  bucketKey: string;
  rows: CompactCandle[];
  rowByteSize: number;
};

function payloadByteSize(rowByteSize: number, rowCount: number) {
  return 2 + rowByteSize + Math.max(0, rowCount - 1);
}

export async function buildSnapshotChunks(
  candles: SnapshotCandle[],
  timeframe: string,
  maxBytes = MAX_SNAPSHOT_CHUNK_BYTES,
): Promise<SnapshotChunk[]> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 2) throw new Error("Invalid snapshot chunk byte limit");
  const sorted = [...candles].sort((left, right) => Number(left.timestamp) - Number(right.timestamp));
  const pending: PendingChunk[] = [];
  let current: PendingChunk | null = null;

  for (const candle of sorted) {
    const compact = compactCandle(candle);
    const bucketKey = snapshotBucketKey(compact[0], timeframe);
    const rowJson = JSON.stringify(compact);
    const rowBytes = textEncoder.encode(rowJson).byteLength;
    if (payloadByteSize(rowBytes, 1) > maxBytes) {
      throw new Error(`A single candle exceeds the ${maxBytes} byte snapshot chunk limit`);
    }
    if (current && (
      current.bucketKey !== bucketKey ||
      payloadByteSize(current.rowByteSize + rowBytes, current.rows.length + 1) > maxBytes
    )) {
      pending.push(current);
      current = null;
    }
    if (!current) current = { bucketKey, rows: [], rowByteSize: 0 };
    current.rows.push(compact);
    current.rowByteSize += rowBytes;
  }
  if (current) pending.push(current);

  return Promise.all(pending.map(async (chunk, sequence) => {
    const payloadJson = JSON.stringify(chunk.rows);
    const byteSize = textEncoder.encode(payloadJson).byteLength;
    if (byteSize > maxBytes) throw new Error("Snapshot chunk split invariant failed");
    return {
      sequence,
      bucketKey: chunk.bucketKey,
      chunkHash: await sha256Text(payloadJson),
      encoding: SNAPSHOT_CHUNK_ENCODING,
      payloadJson,
      barCount: chunk.rows.length,
      firstTimestamp: chunk.rows[0][0],
      lastTimestamp: chunk.rows[chunk.rows.length - 1][0],
      byteSize,
    };
  }));
}

export function decodeSnapshotChunk(payloadJson: string, encoding = SNAPSHOT_CHUNK_ENCODING) {
  if (encoding !== SNAPSHOT_CHUNK_ENCODING) throw new Error(`Unsupported snapshot chunk encoding: ${encoding}`);
  const payload = JSON.parse(payloadJson) as unknown;
  if (!Array.isArray(payload)) throw new Error("Invalid snapshot chunk payload");
  return payload.map(expandCandle);
}

export async function buildSnapshotContentHash(input: {
  instrument: unknown;
  timeframe: string;
  adjustmentType: string;
  source: unknown;
  normalizationVersion?: number;
  chunkHashes: string[];
}) {
  return sha256Text(canonicalStringify({
    formatVersion: SNAPSHOT_FORMAT_VERSION,
    encoding: SNAPSHOT_CHUNK_ENCODING,
    instrument: input.instrument,
    timeframe: input.timeframe,
    adjustmentType: input.adjustmentType,
    source: input.source,
    normalizationVersion: input.normalizationVersion ?? SNAPSHOT_NORMALIZATION_VERSION,
    chunkHashes: input.chunkHashes,
  }));
}

export async function getSnapshotRow(db: SnapshotDatabase, id: string, includeIncomplete = false) {
  return db.prepare(`SELECT ${snapshotColumns} FROM data_snapshots WHERE id = ?${includeIncomplete ? "" : " AND status = 'ready'"}`)
    .bind(id)
    .first<SnapshotRow>();
}

export async function getSnapshotByContentHash(
  db: SnapshotDatabase,
  contentHash: string,
  includeIncomplete = false,
) {
  return db.prepare(`SELECT ${snapshotColumns} FROM data_snapshots WHERE content_hash = ?${includeIncomplete ? "" : " AND status = 'ready'"}`)
    .bind(contentHash)
    .first<SnapshotRow>();
}

export function mergeSnapshotDelta(
  baseCandles: SnapshotCandle[],
  changedCandles: SnapshotCandle[],
  removedTimestamps: number[],
) {
  const merged = new Map(baseCandles.map((candle) => [candle.timestamp, candle]));
  for (const timestamp of removedTimestamps) merged.delete(timestamp);
  for (const candle of changedCandles) merged.set(candle.timestamp, candle);
  return [...merged.values()].sort((left, right) => left.timestamp - right.timestamp);
}

function normalizedRange(row: SnapshotRow, range?: SnapshotReadRange) {
  const startTimestamp = range?.startTimestamp == null
    ? Number(row.firstTimestamp)
    : Number(range.startTimestamp);
  const endTimestamp = range?.endTimestamp == null
    ? Number(row.lastTimestamp)
    : Number(range.endTimestamp);
  const lookbackBars = Math.max(0, Math.floor(Number(range?.lookbackBars) || 0));
  if (!Number.isFinite(startTimestamp) || !Number.isFinite(endTimestamp)) {
    throw new Error("Invalid snapshot read range");
  }
  if (startTimestamp > endTimestamp) throw new Error("Snapshot read range starts after it ends");
  return { startTimestamp, endTimestamp, lookbackBars };
}

function sliceCandleWindow(
  candles: SnapshotCandle[],
  row: SnapshotRow,
  range?: SnapshotReadRange,
): SnapshotCandleWindow {
  if (!range) {
    return {
      candles,
      startIndex: 0,
      endIndex: Math.max(-1, candles.length - 1),
      snapshotBarCount: Number(row.barCount),
      isPartial: false,
    };
  }
  const requested = normalizedRange(row, range);
  const firstInRange = candles.findIndex((candle) => candle.timestamp >= requested.startTimestamp);
  const rangeStart = firstInRange < 0 ? candles.length : firstInRange;
  let rangeEnd = candles.length;
  for (let index = rangeStart; index < candles.length; index += 1) {
    if (candles[index].timestamp > requested.endTimestamp) {
      rangeEnd = index;
      break;
    }
  }
  const start = Math.max(0, rangeStart - requested.lookbackBars);
  const selected = candles.slice(start, rangeEnd);
  return {
    candles: selected,
    startIndex: start,
    endIndex: selected.length ? start + selected.length - 1 : start - 1,
    snapshotBarCount: Number(row.barCount),
    isPartial: start > 0 || rangeEnd < candles.length,
  };
}

async function readV2CandleWindow(
  db: SnapshotDatabase,
  row: SnapshotRow,
  range?: SnapshotReadRange,
): Promise<SnapshotCandleWindow> {
  if (row.status !== "ready") throw new Error("Snapshot is not ready");
  const mapResult = await db.prepare(`SELECT sequence, first_timestamp AS firstTimestamp,
      last_timestamp AS lastTimestamp, bar_count AS barCount
    FROM data_snapshot_chunks
    WHERE snapshot_id = ?
    ORDER BY sequence ASC`)
    .bind(row.id)
    .all<SnapshotChunkMap>();
  const maps = mapResult.results;
  if (maps.length !== Number(row.chunkCount)) throw new Error(`Snapshot ${row.id} has missing chunks`);
  let mappedBarCount = 0;
  for (let index = 0; index < maps.length; index += 1) {
    const map = maps[index];
    if (Number(map.sequence) !== index) throw new Error(`Snapshot ${row.id} has an invalid chunk sequence`);
    mappedBarCount += Number(map.barCount);
  }
  if (mappedBarCount !== Number(row.barCount)) throw new Error(`Snapshot ${row.id} bar count does not match its chunks`);

  const requested = normalizedRange(row, range);
  let firstSequence = maps.findIndex((map) => Number(map.lastTimestamp) >= requested.startTimestamp);
  if (firstSequence < 0) firstSequence = maps.length;
  let lastSequence = -1;
  for (let index = firstSequence; index < maps.length; index += 1) {
    if (Number(maps[index].firstTimestamp) > requested.endTimestamp) break;
    lastSequence = index;
  }
  if (firstSequence >= maps.length || lastSequence < firstSequence) {
    const insertionIndex = maps.slice(0, firstSequence).reduce((sum, map) => sum + Number(map.barCount), 0);
    return {
      candles: [],
      startIndex: insertionIndex,
      endIndex: insertionIndex - 1,
      snapshotBarCount: Number(row.barCount),
      isPartial: true,
    };
  }

  const readChunkRange = async (rangeStart: number, rangeEnd: number) => {
    const result = await db.prepare(`SELECT map.sequence, chunks.encoding, chunks.payload_json AS payloadJson,
        chunks.bar_count AS barCount
      FROM data_snapshot_chunks AS map
      INNER JOIN candle_chunks AS chunks ON chunks.chunk_hash = map.chunk_hash
      WHERE map.snapshot_id = ? AND map.sequence BETWEEN ? AND ?
      ORDER BY map.sequence ASC`)
      .bind(row.id, rangeStart, rangeEnd)
      .all<{ sequence: number; encoding: string; payloadJson: string; barCount: number }>();
    if (result.results.length !== rangeEnd - rangeStart + 1) {
      throw new Error(`Snapshot ${row.id} has missing range chunks`);
    }
    const decodedCandles: SnapshotCandle[] = [];
    for (let index = 0; index < result.results.length; index += 1) {
      const chunk = result.results[index];
      if (Number(chunk.sequence) !== rangeStart + index) {
        throw new Error(`Snapshot ${row.id} has an invalid range chunk sequence`);
      }
      const decoded = decodeSnapshotChunk(chunk.payloadJson, chunk.encoding);
      if (decoded.length !== Number(chunk.barCount)) throw new Error(`Snapshot ${row.id} has a damaged chunk`);
      decodedCandles.push(...decoded);
    }
    return decodedCandles;
  };

  let candles = await readChunkRange(firstSequence, lastSequence);
  const initialFirstInRange = candles.findIndex((candle) => candle.timestamp >= requested.startTimestamp);
  const availableLookback = initialFirstInRange < 0 ? candles.length : initialFirstInRange;
  if (availableLookback < requested.lookbackBars && firstSequence > 0) {
    let missingLookback = requested.lookbackBars - availableLookback;
    let lookbackFirstSequence = firstSequence;
    while (lookbackFirstSequence > 0 && missingLookback > 0) {
      lookbackFirstSequence -= 1;
      missingLookback -= Number(maps[lookbackFirstSequence].barCount);
    }
    candles = [
      ...await readChunkRange(lookbackFirstSequence, firstSequence - 1),
      ...candles,
    ];
    firstSequence = lookbackFirstSequence;
  }
  const globalChunkStart = maps.slice(0, firstSequence).reduce((sum, map) => sum + Number(map.barCount), 0);
  const firstInRange = candles.findIndex((candle) => candle.timestamp >= requested.startTimestamp);
  const rangeStart = firstInRange < 0 ? candles.length : firstInRange;
  let rangeEnd = candles.length;
  for (let index = rangeStart; index < candles.length; index += 1) {
    if (candles[index].timestamp > requested.endTimestamp) {
      rangeEnd = index;
      break;
    }
  }
  const localStart = Math.max(0, rangeStart - requested.lookbackBars);
  const selected = candles.slice(localStart, rangeEnd);
  const startIndex = globalChunkStart + localStart;
  return {
    candles: selected,
    startIndex,
    endIndex: selected.length ? startIndex + selected.length - 1 : startIndex - 1,
    snapshotBarCount: Number(row.barCount),
    isPartial: startIndex > 0 || startIndex + selected.length < Number(row.barCount),
  };
}

export async function materializeSnapshotCandleWindow(
  db: SnapshotDatabase,
  row: SnapshotRow,
  range?: SnapshotReadRange,
  visited = new Set<string>(),
): Promise<SnapshotCandleWindow> {
  if (visited.has(row.id)) throw new Error("Snapshot chain contains a circular reference");
  visited.add(row.id);
  if (Number(row.formatVersion) >= SNAPSHOT_FORMAT_VERSION) return readV2CandleWindow(db, row, range);

  const stored = JSON.parse(row.candlesJson || "[]") as SnapshotCandle[];
  if (row.storageMode !== "delta" || !row.baseSnapshotId) {
    return sliceCandleWindow(stored.sort((left, right) => left.timestamp - right.timestamp), row, range);
  }
  const base = await getSnapshotRow(db, row.baseSnapshotId);
  if (!base) throw new Error(`Snapshot is missing base version ${row.baseSnapshotId}`);
  const removed = JSON.parse(row.removedTimestampsJson || "[]") as number[];
  const baseWindow = await materializeSnapshotCandleWindow(db, base, undefined, visited);
  return sliceCandleWindow(
    mergeSnapshotDelta(baseWindow.candles, stored, removed),
    row,
    range,
  );
}

export async function materializeSnapshotCandles(
  db: SnapshotDatabase,
  row: SnapshotRow,
): Promise<SnapshotCandle[]> {
  return (await materializeSnapshotCandleWindow(db, row)).candles;
}

export async function snapshotResponse(db: SnapshotDatabase, row: SnapshotRow, range?: SnapshotReadRange) {
  const window = await materializeSnapshotCandleWindow(db, row, range);
  return {
    snapshot: {
      id: row.id,
      contentHash: row.contentHash,
      instrumentId: row.instrumentId,
      timeframe: row.timeframe,
      adjustmentType: row.adjustmentType,
      barCount: row.barCount,
      firstTimestamp: row.firstTimestamp,
      lastTimestamp: row.lastTimestamp,
      createdAt: row.createdAt,
      storageMode: row.storageMode,
      storedBarCount: row.storedBarCount,
      baseSnapshotId: row.baseSnapshotId,
      formatVersion: row.formatVersion,
      chunkCount: row.chunkCount,
    },
    instrument: JSON.parse(row.instrumentJson),
    candles: window.candles,
    window: {
      startIndex: window.startIndex,
      endIndex: window.endIndex,
      barCount: window.candles.length,
      snapshotBarCount: window.snapshotBarCount,
      isPartial: window.isPartial,
    },
  };
}
