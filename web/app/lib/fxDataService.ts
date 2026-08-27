import {
  GOLD_INSTRUMENT_CATALOG,
  FX_INSTRUMENT_CATALOG,
  FX_TIMEFRAME_MS,
  getFxCandleEndTimestamp,
  getMarketInstrumentDefinition,
  type MarketInstrumentDefinition,
  type MarketInstrumentId,
  type FxInstrumentId,
  type FxTimeframe,
} from "./fxDataContracts.ts";
import { TIMEFRAME_IDS, timeframeLabel } from "./timeframeCatalog.ts";
import {
  aggregate5mToTimeframe,
  aggregateM1To5m,
  bucketStartTimestamp,
  findFxCandleGaps,
  type FxCandle,
} from "./fx/dukascopyAggregation.ts";
import {
  createDukascopyQueryUrlBuilder,
  DukascopyHistoricalClient,
} from "./fx/dukascopyClient.ts";
import {
  DukascopyOfficialClient,
  type DukascopyOfficialParseResult,
} from "./fx/dukascopyOfficialClient.ts";
import type { DukascopyQualityReport } from "./fx/dukascopyCsv.ts";
import {
  fetchTwelveDataOneMinuteChunk,
  type TwelveDataCursor,
} from "./fx/twelveDataClient.ts";
import { loadProviderSecrets } from "./providerCredentials.ts";

export type FxTaskMode = "initialize" | "update";
export type FxTaskStatus = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";
export type FxTaskStage = "queued" | "download" | "parse" | "aggregate" | "validate" | "persist" | "snapshot" | "completed";

export type FxTaskRow = {
  id: string;
  mode: FxTaskMode;
  instrumentId: MarketInstrumentId;
  pairLabel: string;
  vendorSymbol: string;
  dukascopySymbol: string;
  twelveDataSymbol: string;
  startDate: string;
  endDate: string;
  rawTimeframe: string;
  targetTimeframesJson: string;
  keepRawCsv: number;
  status: FxTaskStatus;
  stage: FxTaskStage;
  stageProgress: number;
  progressJson: string;
  cursorJson: string;
  qualityReportJson: string;
  insertedCount: number;
  message: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type FxTaskView = {
  id: string;
  mode: FxTaskMode;
  pairId: MarketInstrumentId;
  pairLabel: string;
  status: FxTaskStatus;
  stage: FxTaskStage;
  stageProgress: number;
  message: string | null;
  error: string | null;
  progress: Record<string, unknown>;
  quality: Record<string, unknown> | null;
  updatedAt: string;
};

type FxTaskCreateInput = {
  pairId?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  rawTimeframe?: unknown;
  targetTimeframes?: unknown;
  keepRawCsv?: unknown;
};

type FxTaskCursor = {
  twelveData?: TwelveDataCursor;
  twelveDataInterval?: "1min";
  historyNextStartDate?: string;
  officialMinuteFrom?: number | null;
  historyBoundary?: number | null;
  lastCompleteTimestamp?: number | null;
  nextStartTimestamp?: number | null;
};

type QualitySummary = {
  acceptedRows: number;
  insertedBars: number;
  correctedBars: number;
  invalidRows: number;
  duplicateRows: number;
  missingIntervals: number;
  abnormalJumps: number;
  earliestTimestamp: string | null;
  latestTimestamp: string | null;
  historyBoundary: string | null;
  source: string;
  checkedAt: string;
};

const DEFAULT_TARGET_TIMEFRAMES = [...TIMEFRAME_IDS] as const;
const VALID_TARGET_TIMEFRAMES = new Set(DEFAULT_TARGET_TIMEFRAMES);
const FX_DERIVED_TIMEFRAME_LABELS = TIMEFRAME_IDS
  .filter((timeframe) => timeframe !== "1m" && timeframe !== "5m")
  .map((timeframe) => timeframeLabel(timeframe))
  .join("、");
const FX_SOURCE_DUKASCOPY = "dukascopy";
const FX_SOURCE_TWELVE_DATA = "twelvedata";
const DEFAULT_DATE = "1970-01-01";
// Keep each browser-driven request small enough that local D1 can release its
// page cache between chunks. Large M1 ranges can otherwise make the UI and
// status endpoint appear offline while a multi-gigabyte database is writing.
const HISTORICAL_CHUNK_DAYS = 7;
const HIGHER_TIMEFRAME_LOOKBACK_DAYS = 42;
const activeFxTaskRuns = new Set<string>();
const sharedDukascopyOfficialClient = new DukascopyOfficialClient();

function nowIso() {
  return new Date().toISOString();
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function dateOnly(value: unknown, fallback: string) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  return value;
}

function daysAgoDate(days: number) {
  const value = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return value.toISOString().slice(0, 10);
}

function addUtcDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function minDate(left: string, right: string) {
  return left <= right ? left : right;
}

function maxDate(left: string, right: string) {
  return left >= right ? left : right;
}

function totalDaysForTask(task: Pick<FxTaskRow, "startDate" | "endDate">) {
  return Math.max(1, Math.floor((Date.parse(`${task.endDate}T00:00:00Z`) - Date.parse(`${task.startDate}T00:00:00Z`)) / 86_400_000) + 1);
}

function getTargetTimeframes(value: unknown, includeMissingDefaults = false) {
  const values = Array.isArray(value) ? value : DEFAULT_TARGET_TIMEFRAMES;
  const result = [...new Set(values.filter((item): item is FxTimeframe => (
    typeof item === "string" && VALID_TARGET_TIMEFRAMES.has(item as FxTimeframe)
  )))];
  if (!result.length || includeMissingDefaults) return [...DEFAULT_TARGET_TIMEFRAMES];
  return result;
}

function rowView(row: FxTaskRow | null): FxTaskView | null {
  if (!row) return null;
  return {
    id: row.id,
    mode: row.mode,
    pairId: row.instrumentId,
    pairLabel: row.pairLabel,
    status: row.status,
    stage: row.stage,
    stageProgress: Number(row.stageProgress ?? 0),
    message: row.message,
    error: row.lastError,
    progress: parseJson(row.progressJson, {}),
    quality: parseJson(row.qualityReportJson, null),
    updatedAt: row.updatedAt,
  };
}

export function getFxTaskView(row: FxTaskRow | null) {
  return rowView(row);
}

export function getFxCatalog(market: "FX" | "GOLD" = "FX") {
  const catalog = market === "GOLD" ? GOLD_INSTRUMENT_CATALOG : FX_INSTRUMENT_CATALOG;
  return catalog.map((instrument) => ({
    id: instrument.id,
    label: instrument.displayName,
    dukascopySymbol: instrument.dukascopySymbol,
    twelveDataSymbol: instrument.twelveDataSymbol,
    pricePrecision: instrument.pricePrecision,
  }));
}

export async function getFxTask(db: D1Database, taskId?: string, pairId?: string) {
  const query = taskId
    ? `SELECT id, mode, instrument_id AS instrumentId, pair_label AS pairLabel,
        vendor_symbol AS vendorSymbol, dukascopy_symbol AS dukascopySymbol,
        twelve_data_symbol AS twelveDataSymbol, start_date AS startDate, end_date AS endDate,
        raw_timeframe AS rawTimeframe, target_timeframes_json AS targetTimeframesJson,
        keep_raw_csv AS keepRawCsv, status, stage, stage_progress AS stageProgress,
        progress_json AS progressJson, cursor_json AS cursorJson,
        quality_report_json AS qualityReportJson, inserted_count AS insertedCount,
        message, last_error AS lastError, created_at AS createdAt, updated_at AS updatedAt,
        started_at AS startedAt, finished_at AS finishedAt
        FROM fx_data_tasks WHERE id = ?`
    : pairId
      ? `SELECT id, mode, instrument_id AS instrumentId, pair_label AS pairLabel,
          vendor_symbol AS vendorSymbol, dukascopy_symbol AS dukascopySymbol,
          twelve_data_symbol AS twelveDataSymbol, start_date AS startDate, end_date AS endDate,
          raw_timeframe AS rawTimeframe, target_timeframes_json AS targetTimeframesJson,
          keep_raw_csv AS keepRawCsv, status, stage, stage_progress AS stageProgress,
          progress_json AS progressJson, cursor_json AS cursorJson,
          quality_report_json AS qualityReportJson, inserted_count AS insertedCount,
          message, last_error AS lastError, created_at AS createdAt, updated_at AS updatedAt,
          started_at AS startedAt, finished_at AS finishedAt
          FROM fx_data_tasks WHERE instrument_id = ? ORDER BY updated_at DESC LIMIT 1`
      : `SELECT id, mode, instrument_id AS instrumentId, pair_label AS pairLabel,
          vendor_symbol AS vendorSymbol, dukascopy_symbol AS dukascopySymbol,
          twelve_data_symbol AS twelveDataSymbol, start_date AS startDate, end_date AS endDate,
          raw_timeframe AS rawTimeframe, target_timeframes_json AS targetTimeframesJson,
          keep_raw_csv AS keepRawCsv, status, stage, stage_progress AS stageProgress,
          progress_json AS progressJson, cursor_json AS cursorJson,
          quality_report_json AS qualityReportJson, inserted_count AS insertedCount,
          message, last_error AS lastError, created_at AS createdAt, updated_at AS updatedAt,
          started_at AS startedAt, finished_at AS finishedAt
          FROM fx_data_tasks ORDER BY updated_at DESC LIMIT 1`;
  const statement = db.prepare(query);
  return taskId || pairId
    ? await statement.bind(taskId ?? pairId).first<FxTaskRow>()
    : await statement.first<FxTaskRow>();
}

export async function createFxTask(db: D1Database, mode: FxTaskMode, input: FxTaskCreateInput) {
  const instrument = getMarketInstrumentDefinition(input.pairId);
  if (!instrument) throw new Error("请选择受支持的外汇或黄金品种");
  const startDate = dateOnly(input.startDate, mode === "update" ? daysAgoDate(7) : DEFAULT_DATE);
  const endDate = dateOnly(input.endDate, new Date().toISOString().slice(0, 10));
  if (mode === "initialize" && (startDate === DEFAULT_DATE || endDate < startDate)) {
    throw new Error("历史初始化需要有效的起止日期");
  }
  if (endDate < startDate) throw new Error("结束日期不能早于开始日期");
  if (input.rawTimeframe !== undefined && input.rawTimeframe !== "1m") throw new Error("历史原始粒度必须为 1m");
  const targetTimeframes = getTargetTimeframes(input.targetTimeframes);
  const id = crypto.randomUUID();
  const now = nowIso();
  await db.prepare(`INSERT INTO fx_data_tasks
    (id, mode, instrument_id, pair_label, vendor_symbol, dukascopy_symbol,
     twelve_data_symbol, start_date, end_date, raw_timeframe,
     target_timeframes_json, keep_raw_csv, status, stage, stage_progress,
     progress_json, cursor_json, quality_report_json, inserted_count,
     message, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '1m', ?, ?, 'queued', 'queued', 0, '{}', '{}', '{}', 0, ?, ?, ?)`)
    .bind(
      id,
      mode,
      instrument.id,
      instrument.displayName,
      instrument.id,
      instrument.dukascopySymbol,
      instrument.twelveDataSymbol,
      startDate,
      endDate,
      JSON.stringify(targetTimeframes),
      input.keepRawCsv === true ? 1 : 0,
      mode === "initialize" ? "等待 Dukascopy CSV 下载" : "等待 Twelve Data 增量更新",
      now,
      now,
    )
    .run();
  return getFxTask(db, id);
}

export async function patchFxTask(db: D1Database, taskId: string, action: "pause" | "resume" | "retry" | "cancel") {
  const task = await getFxTask(db, taskId);
  if (!task) throw new Error("外汇任务不存在");
  if (action === "pause" && !["queued", "running"].includes(task.status)) return task;
  if (action === "cancel" && ["completed", "failed", "cancelled"].includes(task.status)) return task;
  const status: FxTaskStatus = action === "pause"
    ? "paused"
    : action === "cancel"
      ? "cancelled"
      : "queued";
  const now = nowIso();
  await db.prepare(`UPDATE fx_data_tasks SET status = ?,
    stage = CASE WHEN ? = 'retry' THEN 'queued' ELSE stage END,
    stage_progress = CASE WHEN ? = 'retry' THEN 0 ELSE stage_progress END,
    last_error = CASE WHEN ? IN ('retry', 'resume') THEN NULL ELSE last_error END,
    message = ?, updated_at = ? WHERE id = ?`)
    .bind(
      status,
      action,
      action,
      action,
      action === "pause" ? "任务已暂停" : action === "cancel" ? "任务已取消" : "任务已重新排队",
      now,
      taskId,
    )
    .run();
  return getFxTask(db, taskId);
}

async function updateTask(db: D1Database, taskId: string, patch: {
  status?: FxTaskStatus;
  stage?: FxTaskStage;
  stageProgress?: number;
  progress?: Record<string, unknown>;
  cursor?: FxTaskCursor;
  quality?: Record<string, unknown>;
  insertedCount?: number;
  message?: string | null;
  error?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}) {
  const current = await getFxTask(db, taskId);
  if (!current) throw new Error("外汇任务不存在");
  const now = nowIso();
  await db.prepare(`UPDATE fx_data_tasks SET status = ?, stage = ?, stage_progress = ?,
    progress_json = ?, cursor_json = ?, quality_report_json = ?, inserted_count = ?,
    message = ?, last_error = ?, started_at = ?, finished_at = ?, updated_at = ?
    WHERE id = ?`)
    .bind(
      patch.status ?? current.status,
      patch.stage ?? current.stage,
      patch.stageProgress ?? current.stageProgress,
      JSON.stringify(patch.progress ?? parseJson(current.progressJson, {})),
      JSON.stringify(patch.cursor ?? parseJson(current.cursorJson, {})),
      JSON.stringify(patch.quality ?? parseJson(current.qualityReportJson, {})),
      patch.insertedCount ?? current.insertedCount,
      patch.message === undefined ? current.message : patch.message,
      patch.error === undefined ? current.lastError : patch.error,
      patch.startedAt === undefined ? current.startedAt : patch.startedAt,
      patch.finishedAt === undefined ? current.finishedAt : patch.finishedAt,
      now,
      taskId,
    )
    .run();
  return getFxTask(db, taskId);
}

async function isTaskStopped(db: D1Database, taskId: string) {
  const row = await db.prepare("SELECT status FROM fx_data_tasks WHERE id = ?").bind(taskId).first<{ status: FxTaskStatus }>();
  return row?.status === "paused" || row?.status === "cancelled";
}

function makeUrlBuilder(endpoint: string) {
  const tokens = /\{(instrument|start|end|timeframe)\}/g;
  if ([...endpoint.matchAll(tokens)].length) {
    return (request: { instrument: string; start: string; end: string; timeframe?: string }) => endpoint
      .replaceAll("{instrument}", encodeURIComponent(request.instrument))
      .replaceAll("{start}", encodeURIComponent(request.start))
      .replaceAll("{end}", encodeURIComponent(request.end))
      .replaceAll("{timeframe}", encodeURIComponent(request.timeframe ?? "1m"));
  }
  return createDukascopyQueryUrlBuilder({ endpoint });
}

function asCandle(row: Record<string, unknown>): FxCandle {
  return {
    timestamp: Number(row.timestamp),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: row.volume == null ? null : Number(row.volume),
    turnover: null,
  };
}

async function ensureInstrument(db: D1Database, instrument: MarketInstrumentDefinition) {
  await db.prepare(`INSERT INTO instruments (id, symbol, name, market, timezone, price_precision)
    VALUES (?, ?, ?, ?, 'America/New_York', ?)
    ON CONFLICT(id) DO UPDATE SET symbol = excluded.symbol, name = excluded.name,
    market = excluded.market, timezone = excluded.timezone, price_precision = excluded.price_precision`)
    .bind(instrument.id, instrument.id, instrument.displayName, instrument.market, instrument.pricePrecision)
    .run();
}

async function persistCandles(
  db: D1Database,
  task: FxTaskRow,
  timeframe: FxTimeframe,
  source: string,
  candles: readonly FxCandle[],
  onProgress?: (completed: number, total: number) => void | Promise<void>,
) {
  if (!candles.length) return 0;
  const firstTimestamp = candles.reduce((minimum, candle) => Math.min(minimum, candle.timestamp), Number.POSITIVE_INFINITY);
  const lastTimestamp = candles.reduce((maximum, candle) => Math.max(maximum, candle.timestamp), Number.NEGATIVE_INFINITY);
  const uniqueTimestampCount = new Set(candles.map((candle) => candle.timestamp)).size;
  const previousCoverage = await db.prepare(`SELECT bar_count AS barCount, first_timestamp AS firstTimestamp,
    last_timestamp AS lastTimestamp FROM candle_coverage
    WHERE instrument_id = ? AND timeframe = ? AND adjustment_type = 'none' AND source = ?`)
    .bind(task.instrumentId, timeframe, source)
    .first<{ barCount: number; firstTimestamp: number; lastTimestamp: number }>();
  const existingRange = await db.prepare(`SELECT COUNT(*) AS barCount FROM candles
    WHERE instrument_id = ? AND timeframe = ? AND adjustment_type = 'none' AND source = ?
    AND timestamp BETWEEN ? AND ?`)
    .bind(task.instrumentId, timeframe, source, firstTimestamp, lastTimestamp)
    .first<{ barCount: number }>();
  const rowsPerBatch = 1_000;
  let nextHeartbeat = 2_048;
  for (let batchStart = 0; batchStart < candles.length; batchStart += rowsPerBatch) {
    const batchEnd = Math.min(candles.length, batchStart + rowsPerBatch);
    const payload = JSON.stringify(candles.slice(batchStart, batchEnd).map((candle) => [
      candle.timestamp,
      candle.open,
      candle.high,
      candle.low,
      candle.close,
      candle.volume,
      candle.turnover,
    ]));
    await db.prepare(`INSERT OR REPLACE INTO candles
      (instrument_id, timeframe, timestamp, open, high, low, close, volume, turnover,
       adjustment_type, source, quality_flags)
      SELECT ?, ?,
        CAST(json_extract(value, '$[0]') AS INTEGER),
        json_extract(value, '$[1]'),
        json_extract(value, '$[2]'),
        json_extract(value, '$[3]'),
        json_extract(value, '$[4]'),
        json_extract(value, '$[5]'),
        json_extract(value, '$[6]'),
        'none', ?, '[]'
      FROM json_each(?)`)
      .bind(task.instrumentId, timeframe, source, payload)
      .run();
    if (onProgress && (batchEnd >= nextHeartbeat || batchEnd === candles.length)) {
      await onProgress(batchEnd, candles.length);
      nextHeartbeat = batchEnd + 2_048;
    }
    // Give the local worker a chance to answer status and page requests between
    // database batches instead of monopolising the only request isolate.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  // A full COUNT/MIN/MAX scan becomes extremely expensive once M1 history is
  // several gigabytes. Count only the incoming timestamp window and merge it
  // with the persisted coverage row. This also keeps retries idempotent.
  const addedBars = Math.max(0, uniqueTimestampCount - Number(existingRange?.barCount ?? 0));
  let coverage = previousCoverage
    ? {
        barCount: Number(previousCoverage.barCount) + addedBars,
        firstTimestamp: Math.min(Number(previousCoverage.firstTimestamp), firstTimestamp),
        lastTimestamp: Math.max(Number(previousCoverage.lastTimestamp), lastTimestamp),
      }
    : null;
  if (!coverage) {
    coverage = await db.prepare(`SELECT COUNT(*) AS barCount, MIN(timestamp) AS firstTimestamp,
      MAX(timestamp) AS lastTimestamp FROM candles
      WHERE instrument_id = ? AND timeframe = ? AND adjustment_type = 'none' AND source = ?`)
      .bind(task.instrumentId, timeframe, source)
      .first<{ barCount: number; firstTimestamp: number; lastTimestamp: number }>();
  }
  await db.prepare(`INSERT OR REPLACE INTO candle_coverage
    (instrument_id, timeframe, adjustment_type, source, bar_count, first_timestamp, last_timestamp, updated_at)
    VALUES (?, ?, 'none', ?, ?, ?, ?, ?)`)
    .bind(
      task.instrumentId,
      timeframe,
      source,
      Number(coverage?.barCount ?? uniqueTimestampCount),
      Number(coverage?.firstTimestamp ?? firstTimestamp),
      Number(coverage?.lastTimestamp ?? lastTimestamp),
      nowIso(),
    )
    .run();
  return candles.length;
}

async function isCandleRangeCovered(
  db: D1Database,
  task: FxTaskRow,
  timeframe: string,
  source: string,
  candles: readonly FxCandle[],
) {
  if (!candles.length) return true;
  const firstTimestamp = candles.reduce((minimum, candle) => Math.min(minimum, candle.timestamp), Number.POSITIVE_INFINITY);
  const lastTimestamp = candles.reduce((maximum, candle) => Math.max(maximum, candle.timestamp), Number.NEGATIVE_INFINITY);
  const coverage = await db.prepare(`SELECT first_timestamp AS firstTimestamp, last_timestamp AS lastTimestamp
    FROM candle_coverage
    WHERE instrument_id = ? AND timeframe = ? AND adjustment_type = 'none' AND source = ?`)
    .bind(task.instrumentId, timeframe, source)
    .first<{ firstTimestamp: number; lastTimestamp: number }>();
  return Boolean(
    coverage
    && Number(coverage.firstTimestamp) <= firstTimestamp
    && Number(coverage.lastTimestamp) >= lastTimestamp,
  );
}

function isoTimestamp(timestamp: number | null | undefined) {
  return Number.isFinite(timestamp) ? new Date(Number(timestamp)).toISOString() : null;
}

function qualityFromDukascopy(report: DukascopyQualityReport, base: FxCandle[], insertedBars: number, historyBoundary: number | null): QualitySummary {
  const gaps = findFxCandleGaps(base, "5m").filter((gap) => !gap.ignored).length;
  return {
    acceptedRows: report.accepted,
    insertedBars,
    correctedBars: 0,
    invalidRows: report.invalid + report.abnormalOhlc,
    duplicateRows: report.duplicates,
    missingIntervals: gaps,
    abnormalJumps: 0,
    earliestTimestamp: isoTimestamp(base[0]?.timestamp),
    latestTimestamp: isoTimestamp(base.at(-1)?.timestamp),
    historyBoundary: isoTimestamp(historyBoundary),
    source: FX_SOURCE_DUKASCOPY,
    checkedAt: nowIso(),
  };
}

function qualityFromTwelveData(report: { received: number; accepted: number; invalid: number; duplicates: number; firstTimestamp?: number; lastTimestamp?: number }, candles: FxCandle[], insertedBars: number, historyBoundary: number | null): QualitySummary {
  const gaps = findFxCandleGaps(candles, "1m").filter((gap) => !gap.ignored).length;
  return {
    acceptedRows: report.accepted,
    insertedBars,
    correctedBars: 0,
    invalidRows: report.invalid,
    duplicateRows: report.duplicates,
    missingIntervals: gaps,
    abnormalJumps: 0,
    earliestTimestamp: isoTimestamp(report.firstTimestamp ?? candles[0]?.timestamp),
    latestTimestamp: isoTimestamp(report.lastTimestamp ?? candles.at(-1)?.timestamp),
    historyBoundary: isoTimestamp(historyBoundary),
    source: FX_SOURCE_TWELVE_DATA,
    checkedAt: nowIso(),
  };
}

function mergeQuality(previous: Partial<QualitySummary>, current: QualitySummary, insertedBars: number, historyBoundary: number | null): QualitySummary {
  const first = [previous.earliestTimestamp, current.earliestTimestamp]
    .filter((value): value is string => Boolean(value))
    .sort()[0] ?? null;
  const last = [previous.latestTimestamp, current.latestTimestamp]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
  return {
    acceptedRows: Number(previous.acceptedRows ?? 0) + current.acceptedRows,
    insertedBars,
    correctedBars: Number(previous.correctedBars ?? 0) + current.correctedBars,
    invalidRows: Number(previous.invalidRows ?? 0) + current.invalidRows,
    duplicateRows: Number(previous.duplicateRows ?? 0) + current.duplicateRows,
    missingIntervals: Number(previous.missingIntervals ?? 0) + current.missingIntervals,
    abnormalJumps: Number(previous.abnormalJumps ?? 0) + current.abnormalJumps,
    earliestTimestamp: first,
    latestTimestamp: last,
    historyBoundary: isoTimestamp(historyBoundary) ?? previous.historyBoundary ?? current.historyBoundary,
    source: current.source,
    checkedAt: current.checkedAt,
  };
}

async function runHistoricalTask(db: D1Database, task: FxTaskRow, instrument: MarketInstrumentDefinition) {
  const { secrets } = await loadProviderSecrets();
  const cursor = parseJson<FxTaskCursor>(task.cursorJson, {});
  const officialClient = secrets.dukascopyEndpoint ? null : sharedDukascopyOfficialClient;
  const officialMinuteFrom = officialClient
    ? cursor.officialMinuteFrom === undefined
      ? await officialClient.getMinuteAvailability(task.dukascopySymbol)
      : cursor.officialMinuteFrom
    : null;
  const availableDate = officialMinuteFrom == null
    ? null
    : new Date(officialMinuteFrom).toISOString().slice(0, 10);
  const chunkStart = maxDate(
    cursor.historyNextStartDate ?? task.startDate,
    availableDate ?? task.startDate,
  );
  if (chunkStart > task.endDate) {
    const previousQuality = parseJson<Partial<QualitySummary>>(task.qualityReportJson, {});
    const quality = {
      acceptedRows: Number(previousQuality.acceptedRows ?? 0),
      insertedBars: Number(task.insertedCount ?? 0),
      correctedBars: Number(previousQuality.correctedBars ?? 0),
      invalidRows: Number(previousQuality.invalidRows ?? 0),
      duplicateRows: Number(previousQuality.duplicateRows ?? 0),
      missingIntervals: Number(previousQuality.missingIntervals ?? 0),
      abnormalJumps: Number(previousQuality.abnormalJumps ?? 0),
      earliestTimestamp: previousQuality.earliestTimestamp ?? null,
      latestTimestamp: previousQuality.latestTimestamp ?? null,
      historyBoundary: previousQuality.historyBoundary ?? null,
      source: FX_SOURCE_DUKASCOPY,
      checkedAt: nowIso(),
    } satisfies QualitySummary;
    const totalDays = totalDaysForTask(task);
    return updateTask(db, task.id, {
      status: "completed",
      stage: "completed",
      stageProgress: 100,
      progress: { completed: totalDays, total: totalDays, unit: "days", percent: 100 },
      cursor: { ...cursor, officialMinuteFrom, historyNextStartDate: undefined },
      quality,
      insertedCount: Number(task.insertedCount ?? 0),
      message: "指定日期范围早于 Dukascopy 官方可用的分钟数据，未写入新 K 线",
      error: null,
      finishedAt: nowIso(),
    });
  }
  const chunkEnd = minDate(addUtcDays(chunkStart, HISTORICAL_CHUNK_DAYS - 1), task.endDate);
  const chunkStartedAt = Date.now();
  const totalDays = totalDaysForTask(task);
  const completedDays = Math.max(0, Math.floor((Date.parse(`${chunkStart}T00:00:00Z`) - Date.parse(`${task.startDate}T00:00:00Z`)) / 86_400_000));
  const progressPercent = Math.min(95, Math.max(5, (completedDays / totalDays) * 100));
  await updateTask(db, task.id, { stage: "download", stageProgress: progressPercent, message: `正在下载 Dukascopy CSV：${chunkStart} 至 ${chunkEnd}` });
  let parsed: DukascopyOfficialParseResult | Awaited<ReturnType<DukascopyHistoricalClient["downloadAndParseCsv"]>>;
  if (officialClient) {
    parsed = await officialClient.downloadAndParseCsv({
      instrument: task.dukascopySymbol,
      start: chunkStart,
      end: chunkEnd,
      timeframe: "1m",
    });
  } else {
    const client = new DukascopyHistoricalClient({ urlBuilder: makeUrlBuilder(secrets.dukascopyEndpoint as string) });
    parsed = await client.downloadAndParseCsv({
      instrument: task.dukascopySymbol,
      start: chunkStart,
      end: chunkEnd,
      timeframe: "1m",
    }, { timestampTimeZone: "UTC" });
    if (!parsed.candles.length) {
      throw new Error("Dukascopy 服务没有返回可解析的 CSV K 线，请检查适配地址、品种和日期范围");
    }
  }
  if (await isTaskStopped(db, task.id)) return getFxTask(db, task.id);
  await updateTask(db, task.id, {
    stage: "parse",
    stageProgress: Math.min(98, progressPercent + 8),
    progress: { completed: completedDays, total: totalDays, unit: "days", percent: progressPercent },
    message: `CSV 已解析 ${parsed.report.accepted.toLocaleString()} 行`,
  });
  await updateTask(db, task.id, { stage: "aggregate", stageProgress: Math.min(98, progressPercent + 15), message: `正在保存 M1、M5，并聚合 ${FX_DERIVED_TIMEFRAME_LABELS}` });
  const base = aggregateM1To5m(parsed.candles);
  await ensureInstrument(db, instrument);
  await updateTask(db, task.id, { stage: "persist", stageProgress: Math.min(99, progressPercent + 20), message: "正在写入本次分片的 1m / 5m 基准" });
  let inserted = await persistCandles(
    db,
    task,
    "1m",
    FX_SOURCE_DUKASCOPY,
    parsed.candles,
    async (completed, total) => {
      await updateTask(db, task.id, {
        stage: "persist",
        message: `正在写入本次分片的 M1：${completed.toLocaleString()} / ${total.toLocaleString()}`,
      });
    },
  );
  if (await isTaskStopped(db, task.id)) return getFxTask(db, task.id);
  if (!(await isCandleRangeCovered(db, task, "5m", FX_SOURCE_DUKASCOPY, base))) {
    inserted += await persistCandles(db, task, "5m", FX_SOURCE_DUKASCOPY, base);
  }
  if (await isTaskStopped(db, task.id)) return getFxTask(db, task.id);

  const targetTimeframes = getTargetTimeframes(parseJson<unknown>(task.targetTimeframesJson, [...DEFAULT_TARGET_TIMEFRAMES]), true);
  const currentChunkLastTimestamp = base.at(-1)?.timestamp ?? Date.parse(`${chunkEnd}T23:59:59Z`);
  const recent = await readRecentBaseCandles(db, task, currentChunkLastTimestamp, currentChunkLastTimestamp);
  const higher: Array<[FxTimeframe, FxCandle[]]> = [];
  for (const timeframe of targetTimeframes) {
    if (timeframe === "1m" || timeframe === "5m") continue;
    higher.push([timeframe, aggregate5mToTimeframe(recent, timeframe)]);
  }
  for (const [timeframe, candles] of higher) {
    // Re-write every affected higher-period bucket. A monthly bucket can be
    // persisted partially by an earlier chunk while keeping the same first and
    // last timestamps, so range coverage alone cannot detect an OHLCV change.
    inserted += await persistCandles(db, task, timeframe, FX_SOURCE_DUKASCOPY, candles);
  }
  const currentQuality = qualityFromDukascopy(parsed.report, base, inserted, null);
  const previousQuality = parseJson<Partial<QualitySummary>>(task.qualityReportJson, {});
  const nextStartDate = addUtcDays(chunkEnd, 1);
  const complete = nextStartDate > task.endDate;
  const chunkElapsedSeconds = Math.max(0.1, (Date.now() - chunkStartedAt) / 1_000);
  const chunkDayCount = Math.round((Date.parse(`${chunkEnd}T00:00:00Z`) - Date.parse(`${chunkStart}T00:00:00Z`)) / 86_400_000) + 1;
  const lastCompleteRow = await db.prepare(`SELECT MAX(timestamp) AS lastTimestamp FROM candles
    WHERE instrument_id = ? AND timeframe = '5m' AND adjustment_type = 'none' AND source = ?`)
    .bind(task.instrumentId, FX_SOURCE_DUKASCOPY)
    .first<{ lastTimestamp: number | null }>();
  const lastCompleteTimestamp = Number.isFinite(Number(lastCompleteRow?.lastTimestamp)) ? Number(lastCompleteRow?.lastTimestamp) : null;
  const cumulative = Number(task.insertedCount ?? 0) + inserted;
  const quality = mergeQuality(previousQuality, currentQuality, cumulative, complete ? lastCompleteTimestamp : null);
  await updateTask(db, task.id, {
    stage: "validate",
    stageProgress: Math.min(99, progressPercent + 25),
    quality,
    progress: { completed: Math.min(totalDays, completedDays + (Date.parse(`${chunkEnd}T00:00:00Z`) - Date.parse(`${chunkStart}T00:00:00Z`)) / 86_400_000 + 1), total: totalDays, unit: "days", percent: Math.min(99, ((Math.min(totalDays, completedDays + (Date.parse(`${chunkEnd}T00:00:00Z`) - Date.parse(`${chunkStart}T00:00:00Z`)) / 86_400_000 + 1)) / totalDays) * 100) },
    message: `分片质量检查完成，发现 ${quality.missingIntervals} 个非周末缺口`,
  });
  const nextCursor: FxTaskCursor = {
    ...cursor,
    officialMinuteFrom,
    historyNextStartDate: complete ? undefined : nextStartDate,
    historyBoundary: complete ? lastCompleteTimestamp : cursor.historyBoundary ?? null,
    lastCompleteTimestamp: complete ? lastCompleteTimestamp : cursor.lastCompleteTimestamp ?? null,
    nextStartTimestamp: complete && lastCompleteTimestamp != null ? lastCompleteTimestamp + FX_TIMEFRAME_MS["5m"] : cursor.nextStartTimestamp ?? null,
  };
  return updateTask(db, task.id, {
    status: complete ? "completed" : "queued",
    stage: complete ? "completed" : "persist",
    stageProgress: complete ? 100 : Math.min(99, progressPercent + 25),
    progress: { completed: complete ? totalDays : Math.min(totalDays, completedDays + (Date.parse(`${chunkEnd}T00:00:00Z`) - Date.parse(`${chunkStart}T00:00:00Z`)) / 86_400_000 + 1), total: totalDays, unit: "days", percent: complete ? 100 : Math.min(99, ((Math.min(totalDays, completedDays + (Date.parse(`${chunkEnd}T00:00:00Z`) - Date.parse(`${chunkStart}T00:00:00Z`)) / 86_400_000 + 1)) / totalDays) * 100) },
    cursor: nextCursor,
    quality,
    insertedCount: cumulative,
    message: complete
      ? (task.keepRawCsv ? "历史数据已完成；当前运行时只保留解析后的 K 线与质量报告" : "Dukascopy 历史基准已完成")
      : `本次 ${chunkDayCount} 天分片已完成（${chunkElapsedSeconds.toFixed(1)} 秒），下一片从 ${nextStartDate} 继续`,
    error: null,
    finishedAt: complete ? nowIso() : null,
  });
}

async function readRecentBaseCandles(
  db: D1Database,
  task: FxTaskRow,
  fromTimestamp: number,
  throughTimestamp: number,
) {
  const rows = await db.prepare(`SELECT timestamp, open, high, low, close, volume, turnover
    FROM candles WHERE instrument_id = ? AND timeframe = '5m' AND adjustment_type = 'none'
    AND timestamp BETWEEN ? AND ? ORDER BY timestamp ASC`)
    .bind(
      task.instrumentId,
      Math.max(0, fromTimestamp - HIGHER_TIMEFRAME_LOOKBACK_DAYS * 24 * 60 * 60 * 1000),
      throughTimestamp,
    )
    .all<Record<string, unknown>>();
  return rows.results.map(asCandle);
}

async function readRecentMinuteCandles(
  db: D1Database,
  task: FxTaskRow,
  fromTimestamp: number,
  throughTimestamp: number,
) {
  const rows = await db.prepare(`SELECT timestamp, open, high, low, close, volume, turnover
    FROM candles WHERE instrument_id = ? AND timeframe = '1m' AND adjustment_type = 'none'
    AND timestamp BETWEEN ? AND ? ORDER BY timestamp ASC`)
    .bind(
      task.instrumentId,
      Math.max(0, fromTimestamp - 10 * FX_TIMEFRAME_MS["1m"]),
      throughTimestamp,
    )
    .all<Record<string, unknown>>();
  return rows.results.map(asCandle);
}

function rowTimestamp(row: { lastTimestamp: number | null } | null) {
  return Number.isFinite(Number(row?.lastTimestamp)) ? Number(row?.lastTimestamp) : null;
}

async function runIncrementalTask(db: D1Database, task: FxTaskRow, instrument: MarketInstrumentDefinition) {
  const { secrets } = await loadProviderSecrets();
  if (!secrets.twelveDataApiKey) throw new Error("尚未配置 Twelve Data API Key，请在“设置 → 数据源设置”中保存凭证");
  const [historyMinuteRow, historyFiveMinuteRow, latestIncrementalRow] = await Promise.all([
    db.prepare(`SELECT MAX(timestamp) AS lastTimestamp FROM candles
      WHERE instrument_id = ? AND timeframe = '1m' AND adjustment_type = 'none' AND source = ?`)
      .bind(task.instrumentId, FX_SOURCE_DUKASCOPY)
      .first<{ lastTimestamp: number | null }>(),
    db.prepare(`SELECT MAX(timestamp) AS lastTimestamp FROM candles
      WHERE instrument_id = ? AND timeframe = '5m' AND adjustment_type = 'none' AND source = ?`)
      .bind(task.instrumentId, FX_SOURCE_DUKASCOPY)
      .first<{ lastTimestamp: number | null }>(),
    db.prepare(`SELECT MAX(timestamp) AS lastTimestamp FROM candles
      WHERE instrument_id = ? AND timeframe = '1m' AND adjustment_type = 'none' AND source = ?`)
      .bind(task.instrumentId, FX_SOURCE_TWELVE_DATA)
      .first<{ lastTimestamp: number | null }>(),
  ]);
  const historyMinuteTimestamp = rowTimestamp(historyMinuteRow);
  const historyFiveMinuteTimestamp = rowTimestamp(historyFiveMinuteRow);
  // Old databases may only have the historical 5m baseline. In that case the
  // first safe M1 timestamp is the minute immediately after that 5m bucket.
  const historyBoundary = historyMinuteTimestamp
    ?? (historyFiveMinuteTimestamp == null ? null : historyFiveMinuteTimestamp + 4 * FX_TIMEFRAME_MS["1m"]);
  const lastTimestamp = rowTimestamp(latestIncrementalRow);
  const cursor = parseJson<FxTaskCursor>(task.cursorJson, {});
  await updateTask(db, task.id, { stage: "download", stageProgress: 10, message: "正在从 Twelve Data 请求 1m 增量" });
  const chunk = await fetchTwelveDataOneMinuteChunk({
    apiKey: secrets.twelveDataApiKey,
    symbol: task.twelveDataSymbol,
    startDate: lastTimestamp == null && historyBoundary == null ? task.startDate : undefined,
    endDate: task.endDate === DEFAULT_DATE ? undefined : task.endDate,
    cursor: cursor.twelveDataInterval === "1min" ? cursor.twelveData : undefined,
    lastCompletedTimestamp: lastTimestamp,
    historyBoundary,
    overlapBars: 3,
  });
  if (await isTaskStopped(db, task.id)) return getFxTask(db, task.id);
  await updateTask(db, task.id, {
    stage: "parse",
    stageProgress: 35,
    progress: { completed: chunk.quality.accepted, total: chunk.quality.received, unit: "rows", percent: 35 },
    message: `Twelve Data 返回 ${chunk.quality.accepted.toLocaleString()} 根已收盘 M1 K 线`,
  });
  await ensureInstrument(db, instrument);
  await updateTask(db, task.id, { stage: "validate", stageProgress: 60, message: "正在校验历史边界与未收盘过滤结果" });
  const writeCandles = chunk.candles.map((candle) => ({ ...candle, turnover: null }));
  let inserted = 0;
  if (writeCandles.length) inserted += await persistCandles(db, task, "1m", FX_SOURCE_TWELVE_DATA, writeCandles);
  if (await isTaskStopped(db, task.id)) return getFxTask(db, task.id);
  if (writeCandles.length) {
    await updateTask(db, task.id, { stage: "aggregate", stageProgress: 75, message: `正在由 M1 刷新 M5，并重算 ${FX_DERIVED_TIMEFRAME_LABELS}` });
    const incrementalStart = historyBoundary == null
      ? Date.parse(`${task.startDate}T00:00:00Z`)
      : historyBoundary + FX_TIMEFRAME_MS["1m"];
    const fiveMinuteWriteStart = Math.ceil(incrementalStart / FX_TIMEFRAME_MS["5m"]) * FX_TIMEFRAME_MS["5m"];
    const fiveMinuteRefreshStart = Math.max(
      fiveMinuteWriteStart,
      bucketStartTimestamp(writeCandles[0].timestamp, "5m"),
    );
    const completeThroughExclusive = (chunk.latestCompletedTimestamp ?? writeCandles.at(-1)?.timestamp ?? 0)
      + FX_TIMEFRAME_MS["1m"];
    const recentMinutes = await readRecentMinuteCandles(
      db,
      task,
      writeCandles[0].timestamp,
      writeCandles.at(-1)?.timestamp ?? writeCandles[0].timestamp,
    );
    const fiveMinuteCandles = aggregateM1To5m(recentMinutes).filter((candle) => (
      candle.timestamp >= fiveMinuteRefreshStart
      && candle.timestamp + FX_TIMEFRAME_MS["5m"] <= completeThroughExclusive
    ));
    if (fiveMinuteCandles.length) {
      inserted += await persistCandles(db, task, "5m", FX_SOURCE_TWELVE_DATA, fiveMinuteCandles);
    }
    const recent = fiveMinuteCandles.length
      ? await readRecentBaseCandles(
          db,
          task,
          fiveMinuteCandles[0].timestamp,
          fiveMinuteCandles.at(-1)?.timestamp ?? fiveMinuteCandles[0].timestamp,
        )
      : [];
    const targetTimeframes = getTargetTimeframes(parseJson<unknown>(task.targetTimeframesJson, [...DEFAULT_TARGET_TIMEFRAMES]), true);
    const higher: Array<[FxTimeframe, FxCandle[]]> = [];
    for (const timeframe of targetTimeframes) {
      if (timeframe === "1m" || timeframe === "5m") continue;
      higher.push([timeframe, aggregate5mToTimeframe(recent, timeframe)]);
    }
    for (const [timeframe, candles] of higher) {
      const refreshStart = Math.max(
        fiveMinuteWriteStart,
        bucketStartTimestamp(writeCandles[0].timestamp, timeframe),
      );
      const completed = candles.filter((candle) => (
        candle.timestamp >= refreshStart
        && getFxCandleEndTimestamp(candle.timestamp, timeframe) <= completeThroughExclusive
      ));
      inserted += await persistCandles(db, task, timeframe, FX_SOURCE_TWELVE_DATA, completed);
    }
  }
  const nextLastTimestamp = writeCandles.at(-1)?.timestamp ?? lastTimestamp;
  const quality = qualityFromTwelveData(chunk.writeQuality, writeCandles, inserted, historyBoundary);
  const nextCursor: FxTaskCursor = {
    ...cursor,
    twelveData: chunk.complete ? undefined : chunk.cursor,
    twelveDataInterval: "1min",
    historyBoundary,
    lastCompleteTimestamp: nextLastTimestamp,
    nextStartTimestamp: nextLastTimestamp == null ? null : nextLastTimestamp + FX_TIMEFRAME_MS["1m"],
  };
  const complete = chunk.complete;
  const cumulative = Number(task.insertedCount ?? 0) + inserted;
  return updateTask(db, task.id, {
    status: complete ? "completed" : "queued",
    stage: complete ? "completed" : "persist",
    stageProgress: complete ? 100 : 90,
    progress: { completed: cumulative, total: cumulative, unit: "candles", percent: complete ? 100 : 90 },
    cursor: nextCursor,
    quality: { ...quality, insertedBars: cumulative },
    insertedCount: cumulative,
    message: complete ? (inserted ? `增量更新完成，写入 ${inserted.toLocaleString()} 根 K 线` : "当前没有新的完整 1m K 线") : "本次达到分页上限，等待继续处理",
    error: null,
    finishedAt: complete ? nowIso() : null,
  });
}

export async function runFxTask(db: D1Database, taskId: string) {
  const task = await getFxTask(db, taskId);
  if (!task) throw new Error("行情任务不存在");
  if (["paused", "cancelled", "completed"].includes(task.status)) return task;
  if (activeFxTaskRuns.has(taskId)) return task;
  activeFxTaskRuns.add(taskId);
  try {
    const instrument = getMarketInstrumentDefinition(task.instrumentId);
    if (!instrument) throw new Error("任务中的品种已不再受支持");
    const startedAt = task.startedAt ?? nowIso();
    await updateTask(db, task.id, {
      status: "running",
      stage: task.stage === "queued" ? "download" : task.stage,
      message: task.mode === "initialize" ? "历史行情任务正在处理" : "增量行情任务正在处理",
      startedAt,
      error: null,
    });
    if (task.mode === "initialize") return runHistoricalTask(db, task, instrument);
    return runIncrementalTask(db, task, instrument);
  } finally {
    activeFxTaskRuns.delete(taskId);
  }
}

export async function failFxTask(db: D1Database, taskId: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return updateTask(db, taskId, {
    status: "failed",
    stage: "validate",
    stageProgress: 0,
    message: "行情任务失败",
    error: message,
    finishedAt: nowIso(),
  });
}

export function isFxPairId(value: unknown): value is FxInstrumentId {
  return Boolean(getMarketInstrumentDefinition(value)?.market === "FX");
}
