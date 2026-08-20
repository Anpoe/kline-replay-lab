import { ensureSchema, getRawDb } from "../../../db/runtime";
import type { SnapshotCandle } from "../../lib/dataSnapshots";
import { readLocalDataJson } from "../../lib/localDataService";
import { tradingDate } from "../../lib/marketRules";
import {
  matchesPattern,
  normalizePatternPresets,
  type PatternPreset,
} from "../../lib/patternFilters";
import {
  buildSnapshotChunks,
  buildSnapshotContentHash,
  canonicalStringify,
  getSnapshotByContentHash,
  getSnapshotRow,
  SNAPSHOT_FORMAT_VERSION,
  SNAPSHOT_NORMALIZATION_VERSION,
  snapshotResponse,
  type SnapshotChunk,
  type SnapshotReadRange,
} from "../../lib/snapshotStorage";

// SHA-256 hashing and the legacy storageMode/baseSnapshotId response fields live in snapshotStorage.

type SourceCoverageRow = {
  source: string;
} & SnapshotCandle;

type LocalCandleResponse = {
  instrument: Record<string, unknown>;
  candles: SnapshotCandle[];
  source?: string;
  datasetVersion?: string;
};

type SnapshotDatabase = ReturnType<typeof getRawDb>;
type SnapshotPreparedStatement = ReturnType<SnapshotDatabase["prepare"]>;
const PATTERN_SCAN_BLOCK_BARS = 2_048;
const PATTERN_SCAN_MAX_BLOCKS = 8;
const DEFAULT_REPLAY_FUTURE_BARS = 5_000;
const MAX_REPLAY_FUTURE_BARS = 10_000;

type RandomWindowRequest = {
  length?: number;
  historyBars?: number;
  startDate?: string;
  endDate?: string;
  patternPresets?: unknown;
  patternAttempts?: number;
};

type ReplayWindowRequest = {
  mode?: "free" | "blind" | "range" | "mistake";
  startMode?: "default" | "date" | "bar" | "random";
  startDate?: string;
  startBar?: number;
  endDate?: string;
  length?: number;
  historyBars?: number;
};

type RandomWindowSelection = {
  startCursor: number;
  endCursor: number;
  sourceStartIndex: number;
  sourceEndIndex: number;
  sourceBarCount: number;
  truncated?: boolean;
};

type RandomWindowPatternMatch = {
  timestamp: number;
  presetIds: string[];
  presetNames: string[];
  attempts: number;
};

type RandomWindowResult = {
  candles: SnapshotCandle[];
  selection: RandomWindowSelection;
  patternMatch: RandomWindowPatternMatch | null;
};

type DatabaseRandomWindowResult = {
  sourceBarCount: number;
  window: RandomWindowResult | null;
};

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(parsed) ? Math.round(parsed) : fallback));
}

function randomInteger(minimum: number, maximum: number) {
  const range = maximum - minimum + 1;
  if (range <= 1) return minimum;
  const sample = crypto.getRandomValues(new Uint32Array(1))[0] / 0x1_0000_0000;
  return minimum + Math.floor(sample * range);
}

function validDateKey(value: unknown) {
  const text = String(value ?? "");
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined;
}

function selectedPatternPresets(value: unknown) {
  if (!Array.isArray(value)) return [];
  const requestedIds = new Set(value.flatMap((candidate) => (
    candidate && typeof candidate === "object" && typeof (candidate as { id?: unknown }).id === "string"
      ? [String((candidate as { id: string }).id)]
      : []
  )));
  return normalizePatternPresets(value)
    .filter((preset) => requestedIds.has(preset.id))
    .slice(0, 10);
}

function requiredPatternHistory(presets: PatternPreset[]) {
  return Math.min(1_000, Math.max(0, ...presets.map((preset) => {
    const p = preset.parameters;
    if (preset.kind === "uptrend" || preset.kind === "uptrend_breakout") {
      return Math.max(
        Math.round(p.lookback ?? 0),
        Math.round((p.slowPeriod ?? 0) * 4 + (p.slopeLookback ?? 0)),
      );
    }
    if (preset.kind === "always_in_long" || preset.kind === "always_in_short") {
      return Math.round(
        (p.stateLookback ?? 120)
        + (p.emaPeriod ?? 20) * 4
        + (p.pivotStrength ?? 2) * 4
        + (p.followThroughBars ?? 2)
        + (p.emaSlopeBars ?? 3)
        + (p.controlWindow ?? 12),
      );
    }
    if (preset.kind === "trend_pullback") {
      return Math.round(Math.max(p.fastPeriod ?? 0, p.slowPeriod ?? 0) * 4);
    }
    if (preset.kind === "contraction") return Math.round((p.lookback ?? 0) * 2);
    if (preset.kind === "breakout_retest") {
      return Math.round((p.lookback ?? 0) + (p.retestWindow ?? 0));
    }
    if (preset.kind === "breakout" || preset.kind === "failed_breakout") {
      return Math.round(p.lookback ?? 0);
    }
    if (preset.kind === "bullish_engulfing" || preset.kind === "bearish_engulfing") return 1;
    return 0;
  })));
}

function patternMatchAt(candles: SnapshotCandle[], index: number, presets: PatternPreset[], attempts: number) {
  const hits = presets.filter((preset) => matchesPattern(candles, index, preset));
  if (!hits.length) return null;
  return {
    timestamp: candles[index].timestamp,
    presetIds: hits.map((preset) => preset.id),
    presetNames: hits.map((preset) => preset.name),
    attempts,
  } satisfies RandomWindowPatternMatch;
}

function randomizedCandidates(candidates: number[], limit: number) {
  const shuffled = [...candidates];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInteger(0, index);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled.slice(0, limit);
}

function selectLocalRandomWindow(
  sourceCandles: SnapshotCandle[],
  timezone: string,
  request: RandomWindowRequest,
): RandomWindowResult | null {
  const length = boundedInteger(request.length, 25, 1, 5000);
  const historyBars = boundedInteger(request.historyBars, 100, 0, 5000);
  const startDate = validDateKey(request.startDate);
  const endDate = validDateKey(request.endDate);
  const maximumStart = sourceCandles.length - 1 - length;
  const candidates: number[] = [];
  for (let index = 40; index <= maximumStart; index += 1) {
    const date = tradingDate(sourceCandles[index].timestamp, timezone);
    if (startDate && date < startDate) continue;
    if (endDate && date > endDate) continue;
    candidates.push(index);
  }
  if (!candidates.length) return null;
  const presets = selectedPatternPresets(request.patternPresets);
  const attemptLimit = presets.length
    ? Math.min(candidates.length, boundedInteger(request.patternAttempts, 12, 1, 50))
    : 1;
  const patternHistory = requiredPatternHistory(presets);
  let sourceStartIndex: number | null = null;
  let patternMatch: RandomWindowPatternMatch | null = null;
  for (const [attemptIndex, candidate] of randomizedCandidates(candidates, attemptLimit).entries()) {
    if (!presets.length) {
      sourceStartIndex = candidate;
      break;
    }
    const scanStartIndex = Math.max(0, candidate - patternHistory);
    const scanCandles = sourceCandles.slice(scanStartIndex, candidate + 1);
    const match = patternMatchAt(scanCandles, candidate - scanStartIndex, presets, attemptIndex + 1);
    if (!match) continue;
    sourceStartIndex = candidate;
    patternMatch = match;
    break;
  }
  if (sourceStartIndex == null) return null;
  const sourceEndIndex = sourceStartIndex + length;
  const windowStartIndex = Math.max(0, sourceStartIndex - historyBars);
  return {
    candles: sourceCandles.slice(windowStartIndex, sourceEndIndex + 1),
    selection: {
      startCursor: sourceStartIndex - windowStartIndex,
      endCursor: sourceEndIndex - windowStartIndex,
      sourceStartIndex,
      sourceEndIndex,
      sourceBarCount: sourceCandles.length,
    } satisfies RandomWindowSelection,
    patternMatch,
  };
}

function replayFutureBars(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(MAX_REPLAY_FUTURE_BARS, Math.max(1, Math.round(parsed)))
    : DEFAULT_REPLAY_FUTURE_BARS;
}

function selectLocalReplayWindow(
  sourceCandles: SnapshotCandle[],
  timezone: string,
  request: ReplayWindowRequest,
): RandomWindowResult | null {
  const sourceBarCount = sourceCandles.length;
  if (!sourceBarCount) return null;
  const lastIndex = sourceBarCount - 1;
  const historyBars = boundedInteger(request.historyBars, 100, 0, 5000);
  const startDate = validDateKey(request.startDate);
  const endDate = validDateKey(request.endDate);
  let sourceStartIndex: number;
  if ((request.mode === "range" || request.startMode === "date") && startDate) {
    const found = sourceCandles.findIndex((bar) => tradingDate(bar.timestamp, timezone) >= startDate);
    sourceStartIndex = found >= 0 ? found : lastIndex;
  } else if (request.startMode === "bar") {
    sourceStartIndex = Math.min(lastIndex, Math.max(0, Math.round(Number(request.startBar) || 1) - 1));
  } else {
    sourceStartIndex = Math.min(lastIndex, Math.max(0, Math.floor(sourceBarCount * 0.68)));
  }

  let requestedEndIndex = sourceStartIndex + replayFutureBars(request.length);
  if (request.mode === "range" && endDate) {
    requestedEndIndex = sourceStartIndex;
    for (let index = lastIndex; index >= sourceStartIndex; index -= 1) {
      if (tradingDate(sourceCandles[index].timestamp, timezone) <= endDate) {
        requestedEndIndex = index;
        break;
      }
    }
  }
  if (requestedEndIndex < sourceStartIndex) return null;
  const sourceEndIndex = Math.min(lastIndex, sourceStartIndex + MAX_REPLAY_FUTURE_BARS, requestedEndIndex);
  const windowStartIndex = Math.max(0, sourceStartIndex - historyBars);
  const requestedLength = Number(request.length);
  const unboundedLength = !Number.isFinite(requestedLength) || requestedLength <= 0;
  return {
    candles: sourceCandles.slice(windowStartIndex, sourceEndIndex + 1),
    selection: {
      startCursor: sourceStartIndex - windowStartIndex,
      endCursor: sourceEndIndex - windowStartIndex,
      sourceStartIndex,
      sourceEndIndex,
      sourceBarCount,
      truncated: requestedEndIndex > sourceEndIndex
        || (request.mode !== "range" && unboundedLength && sourceEndIndex < lastIndex),
    },
    patternMatch: null,
  };
}

async function dateBoundaryIndex(
  db: SnapshotDatabase,
  instrumentId: string,
  timeframe: string,
  adjustmentType: string,
  timezone: string,
  date: string,
  boundary: "start" | "end",
) {
  const center = Date.parse(`${date}T12:00:00Z`);
  const radius = 8 * 24 * 60 * 60 * 1000;
  const nearby = await db.prepare(`SELECT timestamp FROM candles
    WHERE instrument_id = ? AND timeframe = ? AND adjustment_type = ?
      AND timestamp BETWEEN ? AND ? ORDER BY timestamp ASC`)
    .bind(instrumentId, timeframe, adjustmentType, center - radius, center + radius)
    .all<{ timestamp: number }>();
  const matching = boundary === "start"
    ? nearby.results.find((bar: { timestamp: number }) => tradingDate(Number(bar.timestamp), timezone) >= date)
    : [...nearby.results].reverse().find((bar: { timestamp: number }) => tradingDate(Number(bar.timestamp), timezone) <= date);
  if (!matching) return null;
  const comparison = boundary === "start" ? "<" : "<=";
  const count = await db.prepare(`SELECT COUNT(*) AS count FROM candles
    WHERE instrument_id = ? AND timeframe = ? AND adjustment_type = ? AND timestamp ${comparison} ?`)
    .bind(instrumentId, timeframe, adjustmentType, Number(matching.timestamp))
    .first<{ count: number }>();
  const index = Number(count?.count ?? 0) - (boundary === "end" ? 1 : 0);
  return Math.max(0, index);
}

async function selectDatabaseReplayWindow(
  db: SnapshotDatabase,
  instrumentId: string,
  timeframe: string,
  adjustmentType: string,
  timezone: string,
  request: ReplayWindowRequest,
): Promise<DatabaseRandomWindowResult> {
  const count = await db.prepare(`SELECT COUNT(*) AS count FROM candles
    WHERE instrument_id = ? AND timeframe = ? AND adjustment_type = ?`)
    .bind(instrumentId, timeframe, adjustmentType)
    .first<{ count: number }>();
  const sourceBarCount = Number(count?.count ?? 0);
  if (!sourceBarCount) return { sourceBarCount, window: null };

  const lastIndex = sourceBarCount - 1;
  const historyBars = boundedInteger(request.historyBars, 100, 0, 5000);
  const startDate = validDateKey(request.startDate);
  const endDate = validDateKey(request.endDate);
  let sourceStartIndex: number;
  if ((request.mode === "range" || request.startMode === "date") && startDate) {
    const found = await dateBoundaryIndex(db, instrumentId, timeframe, adjustmentType, timezone, startDate, "start");
    sourceStartIndex = Math.min(lastIndex, Math.max(0, found ?? lastIndex));
  } else if (request.startMode === "bar") {
    sourceStartIndex = Math.min(lastIndex, Math.max(0, Math.round(Number(request.startBar) || 1) - 1));
  } else {
    sourceStartIndex = Math.min(lastIndex, Math.max(0, Math.floor(sourceBarCount * 0.68)));
  }

  let requestedEndIndex = sourceStartIndex + replayFutureBars(request.length);
  if (request.mode === "range" && endDate) {
    const found = await dateBoundaryIndex(db, instrumentId, timeframe, adjustmentType, timezone, endDate, "end");
    if (found == null) return { sourceBarCount, window: null };
    requestedEndIndex = Math.max(sourceStartIndex, found);
  }
  const sourceEndIndex = Math.min(lastIndex, sourceStartIndex + MAX_REPLAY_FUTURE_BARS, requestedEndIndex);
  const windowStartIndex = Math.max(0, sourceStartIndex - historyBars);
  const queryBarCount = sourceEndIndex - windowStartIndex + 1;
  const result = await db.prepare(`SELECT timestamp, open, high, low, close, volume, turnover, source
    FROM candles WHERE instrument_id = ? AND timeframe = ? AND adjustment_type = ?
    ORDER BY timestamp ASC LIMIT ? OFFSET ?`)
    .bind(instrumentId, timeframe, adjustmentType, queryBarCount, windowStartIndex)
    .all<SourceCoverageRow>();
  if (result.results.length !== queryBarCount) return { sourceBarCount, window: null };
  const requestedLength = Number(request.length);
  const unboundedLength = !Number.isFinite(requestedLength) || requestedLength <= 0;
  return {
    sourceBarCount,
    window: {
      candles: result.results,
      selection: {
        startCursor: sourceStartIndex - windowStartIndex,
        endCursor: sourceEndIndex - windowStartIndex,
        sourceStartIndex,
        sourceEndIndex,
        sourceBarCount,
        truncated: requestedEndIndex > sourceEndIndex
          || (request.mode !== "range" && unboundedLength && sourceEndIndex < lastIndex),
      },
      patternMatch: null,
    },
  };
}

async function selectDatabaseRandomWindow(
  db: SnapshotDatabase,
  instrumentId: string,
  timeframe: string,
  adjustmentType: string,
  timezone: string,
  request: RandomWindowRequest,
): Promise<DatabaseRandomWindowResult> {
  const count = await db.prepare(`SELECT COUNT(*) AS count FROM candles
    WHERE instrument_id = ? AND timeframe = ? AND adjustment_type = ?`)
    .bind(instrumentId, timeframe, adjustmentType)
    .first<{ count: number }>();
  const sourceBarCount = Number(count?.count ?? 0);
  const length = boundedInteger(request.length, 25, 1, 5000);
  const historyBars = boundedInteger(request.historyBars, 100, 0, 5000);
  let minimumStart = 40;
  let maximumStart = sourceBarCount - 1 - length;
  const startDate = validDateKey(request.startDate);
  const endDate = validDateKey(request.endDate);
  if (startDate) {
    const index = await dateBoundaryIndex(db, instrumentId, timeframe, adjustmentType, timezone, startDate, "start");
    if (index == null) return { sourceBarCount, window: null };
    minimumStart = Math.max(minimumStart, index);
  }
  if (endDate) {
    const index = await dateBoundaryIndex(db, instrumentId, timeframe, adjustmentType, timezone, endDate, "end");
    if (index == null) return { sourceBarCount, window: null };
    maximumStart = Math.min(maximumStart, index);
  }
  if (maximumStart < minimumStart) return { sourceBarCount, window: null };

  const presets = selectedPatternPresets(request.patternPresets);
  const patternHistory = requiredPatternHistory(presets);
  const availableCount = maximumStart - minimumStart + 1;
  const requestedPatternAttempts = presets.length ? boundedInteger(request.patternAttempts, 12, 1, 50) : 1;
  const blockSize = presets.length ? Math.min(PATTERN_SCAN_BLOCK_BARS, availableCount) : 1;
  const blockLimit = presets.length
    ? Math.min(PATTERN_SCAN_MAX_BLOCKS, Math.max(1, Math.ceil(requestedPatternAttempts / 6)))
    : 1;
  const maximumBlockStart = Math.max(minimumStart, maximumStart - blockSize + 1);
  const blockStartCount = maximumBlockStart - minimumStart + 1;
  const blockStarts = blockStartCount <= 1_000
    ? randomizedCandidates(
        Array.from({ length: blockStartCount }, (_, index) => minimumStart + index),
        Math.min(blockStartCount, blockLimit),
      )
    : (() => {
        const sampled = new Set<number>();
        while (sampled.size < Math.min(blockStartCount, blockLimit)) {
          sampled.add(randomInteger(minimumStart, maximumBlockStart));
        }
        return [...sampled];
      })();
  let sourceStartIndex: number | null = null;
  let selectedCandles: SourceCoverageRow[] | null = null;
  let patternMatch: RandomWindowPatternMatch | null = null;
  let scannedCandidates = 0;
  for (const blockStartIndex of blockStarts) {
    const blockEndIndex = Math.min(maximumStart, blockStartIndex + blockSize - 1);
    const outputStartIndex = Math.max(0, blockStartIndex - historyBars);
    const scanStartIndex = presets.length ? Math.max(0, blockStartIndex - patternHistory) : outputStartIndex;
    const queryStartIndex = Math.min(outputStartIndex, scanStartIndex);
    const queryEndIndex = blockEndIndex + length;
    const queryBarCount = queryEndIndex - queryStartIndex + 1;
    const result = await db.prepare(`SELECT timestamp, open, high, low, close, volume, turnover, source
      FROM candles WHERE instrument_id = ? AND timeframe = ? AND adjustment_type = ?
      ORDER BY timestamp ASC LIMIT ? OFFSET ?`)
      .bind(instrumentId, timeframe, adjustmentType, queryBarCount, queryStartIndex)
      .all<SourceCoverageRow>();
    if (result.results.length !== queryBarCount) continue;
    const hits: Array<{ sourceIndex: number; match: RandomWindowPatternMatch }> = [];
    for (let candidate = blockStartIndex; candidate <= blockEndIndex; candidate += 1) {
      scannedCandidates += 1;
      const match = presets.length
        ? patternMatchAt(result.results, candidate - queryStartIndex, presets, scannedCandidates)
        : null;
      if (presets.length && !match) continue;
      hits.push({ sourceIndex: candidate, match: match ?? {
        timestamp: result.results[candidate - queryStartIndex].timestamp,
        presetIds: [],
        presetNames: [],
        attempts: scannedCandidates,
      } });
    }
    if (!hits.length) continue;
    const hit = hits[randomInteger(0, hits.length - 1)];
    sourceStartIndex = hit.sourceIndex;
    patternMatch = presets.length ? hit.match : null;
    const selectedWindowStart = Math.max(0, sourceStartIndex - historyBars);
    const selectedWindowEnd = sourceStartIndex + length;
    selectedCandles = result.results.slice(
      selectedWindowStart - queryStartIndex,
      selectedWindowEnd - queryStartIndex + 1,
    );
    break;
  }
  if (sourceStartIndex == null || !selectedCandles) return { sourceBarCount, window: null };
  const sourceEndIndex = sourceStartIndex + length;
  const windowStartIndex = Math.max(0, sourceStartIndex - historyBars);
  return {
    sourceBarCount,
    window: {
      candles: selectedCandles,
      selection: {
        startCursor: sourceStartIndex - windowStartIndex,
        endCursor: sourceEndIndex - windowStartIndex,
        sourceStartIndex,
        sourceEndIndex,
        sourceBarCount,
      } satisfies RandomWindowSelection,
      patternMatch,
    },
  };
}

function d1SourceMetadata(candles: Array<SnapshotCandle & { source?: string }>) {
  const grouped = new Map<string, { source: string; barCount: number; firstTimestamp: number; lastTimestamp: number }>();
  for (const candle of candles) {
    const source = String(candle.source || "unknown");
    const timestamp = Number(candle.timestamp);
    const current = grouped.get(source);
    if (current) {
      current.barCount += 1;
      current.firstTimestamp = Math.min(current.firstTimestamp, timestamp);
      current.lastTimestamp = Math.max(current.lastTimestamp, timestamp);
    } else {
      grouped.set(source, { source, barCount: 1, firstTimestamp: timestamp, lastTimestamp: timestamp });
    }
  }
  return {
    kind: "d1",
    coverage: [...grouped.values()].sort((left, right) => left.source.localeCompare(right.source)),
  };
}

async function insertChunks(db: SnapshotDatabase, chunks: SnapshotChunk[]) {
  let statements: SnapshotPreparedStatement[] = [];
  let batchBytes = 0;
  const flush = async () => {
    if (statements.length) await db.batch(statements);
    statements = [];
    batchBytes = 0;
  };
  for (const chunk of chunks) {
    if (statements.length && batchBytes + chunk.byteSize > 1_250_000) await flush();
    statements.push(db.prepare(`INSERT OR IGNORE INTO candle_chunks
      (chunk_hash, encoding, payload_json, bar_count, first_timestamp, last_timestamp, byte_size, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        chunk.chunkHash,
        chunk.encoding,
        chunk.payloadJson,
        chunk.barCount,
        chunk.firstTimestamp,
        chunk.lastTimestamp,
        chunk.byteSize,
        new Date().toISOString(),
      ));
    batchBytes += chunk.byteSize;
  }
  await flush();
}

async function mapSnapshotChunks(db: SnapshotDatabase, snapshotId: string, chunks: SnapshotChunk[]) {
  const statements = chunks.map((chunk) => db.prepare(`INSERT OR REPLACE INTO data_snapshot_chunks
    (snapshot_id, sequence, bucket_key, chunk_hash, first_timestamp, last_timestamp, bar_count)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      snapshotId,
      chunk.sequence,
      chunk.bucketKey,
      chunk.chunkHash,
      chunk.firstTimestamp,
      chunk.lastTimestamp,
      chunk.barCount,
    ));
  for (let index = 0; index < statements.length; index += 80) {
    await db.batch(statements.slice(index, index + 80));
  }
}

export async function GET(request: Request) {
  await ensureSchema();
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return Response.json({ error: "缺少数据快照 ID" }, { status: 400 });
  const numberParameter = (name: string) => {
    const value = url.searchParams.get(name);
    if (value == null || value === "") return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error(`无效的快照范围参数：${name}`);
    return parsed;
  };
  let range: SnapshotReadRange | undefined;
  try {
    const startTimestamp = numberParameter("startTimestamp");
    const endTimestamp = numberParameter("endTimestamp");
    const requestedLookback = numberParameter("lookbackBars");
    if (requestedLookback != null && (!Number.isInteger(requestedLookback) || requestedLookback < 0 || requestedLookback > 100_000)) {
      throw new Error("lookbackBars 必须是 0 到 100000 之间的整数");
    }
    if (startTimestamp != null || endTimestamp != null || requestedLookback != null) {
      range = { startTimestamp, endTimestamp, lookbackBars: requestedLookback };
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "无效的快照读取范围" }, { status: 400 });
  }
  const db = getRawDb();
  const row = await getSnapshotRow(db, id);
  if (!row) return Response.json({ error: "数据快照不存在或尚未就绪" }, { status: 404 });
  try {
    return Response.json(await snapshotResponse(db, row, range));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "数据快照读取失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  await ensureSchema();
  const payload = (await request.json()) as {
    instrumentId?: string;
    timeframe?: string;
    adjustmentType?: string;
    randomWindow?: RandomWindowRequest;
    replayWindow?: ReplayWindowRequest;
  };
  if (!payload.instrumentId || !payload.timeframe) {
    return Response.json({ error: "缺少品种或周期" }, { status: 400 });
  }

  const adjustmentType = payload.adjustmentType ?? "none";
  const db = getRawDb();
  let instrument = await db
    .prepare(`SELECT id, symbol, name, market, timezone, price_precision AS pricePrecision
      FROM instruments WHERE id = ?`)
    .bind(payload.instrumentId)
    .first<Record<string, unknown>>();
  const databaseWindowResult = instrument && payload.randomWindow
    ? await selectDatabaseRandomWindow(
        db,
        payload.instrumentId,
        payload.timeframe,
        adjustmentType,
        String(instrument.timezone ?? "UTC"),
        payload.randomWindow,
      )
    : null;
  const databaseReplayWindowResult = instrument && payload.replayWindow
    ? await selectDatabaseReplayWindow(
        db,
        payload.instrumentId,
        payload.timeframe,
        adjustmentType,
        String(instrument.timezone ?? "UTC"),
        payload.replayWindow,
      )
    : null;
  const databaseWindow = databaseWindowResult?.window ?? databaseReplayWindowResult?.window ?? null;
  if (instrument && payload.randomWindow && (databaseWindowResult?.sourceBarCount ?? 0) > 0 && !databaseWindow) {
    const hasPatternFilter = selectedPatternPresets(payload.randomWindow.patternPresets).length > 0;
    return Response.json({
      error: hasPatternFilter
        ? "有界候选窗口内没有符合所选形态的历史位置"
        : "没有足够的 K 线可创建随机训练窗口",
    }, { status: 422 });
  }
  if (instrument && payload.replayWindow && (databaseReplayWindowResult?.sourceBarCount ?? 0) > 0 && !databaseWindow) {
    return Response.json({ error: "没有足够的 K 线可创建 Replay 窗口" }, { status: 422 });
  }
  const boundedWindowRequested = Boolean(payload.randomWindow || payload.replayWindow);
  const candlesResult = boundedWindowRequested ? null : await db
    .prepare(`SELECT timestamp, open, high, low, close, volume, turnover, source
      FROM candles WHERE instrument_id = ? AND timeframe = ? AND adjustment_type = ?
      ORDER BY timestamp ASC`)
    .bind(payload.instrumentId, payload.timeframe, adjustmentType)
    .all<SourceCoverageRow>();
  const d1Candles = databaseWindow?.candles ?? candlesResult?.results ?? [];
  let candles: SnapshotCandle[] = d1Candles;
  let sourceMetadata: unknown = null;
  let windowSelection: RandomWindowSelection | null = databaseWindow?.selection ?? null;
  let randomPatternMatch: RandomWindowPatternMatch | null = databaseWindow?.patternMatch ?? null;

  if (instrument && d1Candles.length) {
    const windowMetadata = payload.randomWindow ? "randomWindow" : "replayWindow";
    sourceMetadata = {
      ...d1SourceMetadata(d1Candles),
      ...(windowSelection ? { [windowMetadata]: windowSelection } : {}),
      ...(randomPatternMatch ? { patternMatch: randomPatternMatch } : {}),
    };
  } else {
    const local = await readLocalDataJson<LocalCandleResponse>(
      `/candles?instrument=${encodeURIComponent(payload.instrumentId)}&timeframe=${encodeURIComponent(payload.timeframe)}`,
      15000,
    );
    if (local?.instrument && local.candles?.length) {
      instrument = local.instrument;
      const localWindow = payload.randomWindow
        ? selectLocalRandomWindow(local.candles, String(local.instrument.timezone ?? "UTC"), payload.randomWindow)
        : payload.replayWindow
          ? selectLocalReplayWindow(local.candles, String(local.instrument.timezone ?? "UTC"), payload.replayWindow)
          : null;
      if (boundedWindowRequested && !localWindow) {
        return Response.json({
          error: payload.randomWindow
            ? "没有足够的 K 线可创建随机训练窗口"
            : "没有足够的 K 线可创建 Replay 窗口",
        }, { status: 422 });
      }
      candles = localWindow?.candles ?? local.candles;
      windowSelection = localWindow?.selection ?? null;
      randomPatternMatch = localWindow?.patternMatch ?? null;
      const windowMetadata = payload.randomWindow ? "randomWindow" : "replayWindow";
      sourceMetadata = {
        kind: "local",
        source: local.source ?? "local-data-service",
        datasetVersion: local.datasetVersion ?? null,
        ...(windowSelection ? { [windowMetadata]: windowSelection } : {}),
        ...(randomPatternMatch ? { patternMatch: randomPatternMatch } : {}),
      };
    }
  }
  if (!instrument || candles.length === 0) {
    return Response.json({
      error: boundedWindowRequested ? "没有足够的 K 线可创建训练窗口" : "没有可创建快照的 K 线数据",
    }, { status: boundedWindowRequested ? 422 : 404 });
  }

  let id: string | null = null;
  try {
    const responseFor = async (row: NonNullable<Awaited<ReturnType<typeof getSnapshotRow>>>) => ({
      ...await snapshotResponse(db, row),
      ...(windowSelection ? { selection: windowSelection } : {}),
      ...(randomPatternMatch ? { patternMatch: randomPatternMatch } : {}),
    });
    const chunks = await buildSnapshotChunks(candles, payload.timeframe);
    const sourceJson = canonicalStringify(sourceMetadata);
    const contentHash = await buildSnapshotContentHash({
      instrument,
      timeframe: payload.timeframe,
      adjustmentType,
      source: sourceMetadata,
      normalizationVersion: SNAPSHOT_NORMALIZATION_VERSION,
      chunkHashes: chunks.map((chunk) => chunk.chunkHash),
    });
    id = `snapshot_${contentHash}`;
    const ready = await getSnapshotByContentHash(db, contentHash);
    if (ready) return Response.json(await responseFor(ready));

    const firstTimestamp = chunks[0].firstTimestamp;
    const lastTimestamp = chunks[chunks.length - 1].lastTimestamp;
    const createdAt = new Date().toISOString();
    await db.prepare(`INSERT OR IGNORE INTO data_snapshots
      (id, content_hash, instrument_id, timeframe, adjustment_type, instrument_json,
        candles_json, bar_count, first_timestamp, last_timestamp, created_at,
        base_snapshot_id, storage_mode, removed_timestamps_json, chain_depth, stored_bar_count,
        format_version, status, source_json, normalization_version, chunk_count)
      VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, NULL, 'full', '[]', 0, ?, ?, 'building', ?, ?, ?)`)
      .bind(
        id,
        contentHash,
        payload.instrumentId,
        payload.timeframe,
        adjustmentType,
        JSON.stringify(instrument),
        candles.length,
        firstTimestamp,
        lastTimestamp,
        createdAt,
        candles.length,
        SNAPSHOT_FORMAT_VERSION,
        sourceJson,
        SNAPSHOT_NORMALIZATION_VERSION,
        chunks.length,
      )
      .run();

    const existing = await getSnapshotByContentHash(db, contentHash, true);
    if (!existing) throw new Error("Snapshot version row was not created");
    if (existing.status === "ready") return Response.json(await responseFor(existing));
    if (existing.status === "failed") {
      await db.prepare("UPDATE data_snapshots SET status = 'building' WHERE id = ? AND status = 'failed'")
        .bind(existing.id)
        .run();
    }
    const snapshotId = existing.id;
    id = snapshotId;

    await insertChunks(db, chunks);
    await mapSnapshotChunks(db, snapshotId, chunks);
    const verification = await db.prepare(`SELECT COUNT(*) AS chunkCount,
        COALESCE(SUM(bar_count), 0) AS barCount
      FROM data_snapshot_chunks WHERE snapshot_id = ?`)
      .bind(snapshotId)
      .first<{ chunkCount: number; barCount: number }>();
    if (Number(verification?.chunkCount) !== chunks.length || Number(verification?.barCount) !== candles.length) {
      throw new Error("Snapshot chunk verification failed");
    }
    await db.prepare(`UPDATE data_snapshots SET status = 'ready', chunk_count = ?
      WHERE id = ? AND status = 'building'`)
      .bind(chunks.length, snapshotId)
      .run();

    const created = await getSnapshotRow(db, snapshotId);
    if (!created) throw new Error("Snapshot creation did not reach ready status");
    return Response.json(await responseFor(created), { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "数据快照创建失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
