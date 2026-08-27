import { ensureSchema, getRawDb } from "../../db/runtime";
import {
  fetchAlpacaMultiSymbolChunk,
  filterTradableUsAssets,
  type AlpacaAsset,
  type AlpacaFeed,
  type AlpacaMultiSymbolChunk,
  type NormalizedCandle,
} from "./marketDataProviders";
import {
  countWeekdaySessions,
  countTradingSessions,
  errorText,
  isAlpacaUrlTooLongError,
  planAlpacaBatches,
  splitSymbols,
  US_SYNC_MAX_ATTEMPTS,
  US_SYNC_REQUEST_SPACING_MS,
  type AlpacaBatchPlan,
  type MarketSyncMode,
} from "./marketSync";
import { loadProviderSecrets } from "./providerCredentials";
import { createMarketSyncWorkerGate } from "./marketSyncWorkerCoordinator.ts";
import {
  latestClosedUsSession,
  newYorkDate,
  type AlpacaCalendarDay,
} from "./usMarketSessions";

export const US_HISTORY_START_DATE = "2016-01-01";
const US_MARKET = "US";
const RUNNING_LEASE_MS = 10 * 60 * 1000;
const MAX_SELECTED_INSTRUMENTS = 2_000;
const marketSyncWorkerGate = createMarketSyncWorkerGate();

type ProviderSecrets = {
  alpacaKeyId?: string;
  alpacaSecretKey?: string;
};

type InstrumentRow = {
  id: string;
  symbol: string;
  name: string;
  lastTimestamp: number | null;
};

type RunRow = {
  id: string;
  market: string;
  mode: MarketSyncMode;
  status: string;
  feed: AlpacaFeed;
  startDate: string;
  endDate: string;
  latestSession: string;
  totalSymbols: number;
  completedSymbols: number;
  failedSymbols: number;
  totalBatches: number;
  completedBatches: number;
  insertedCount: number;
  skippedSymbols: number;
  lastError: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
};

type BatchRow = {
  id: string;
  runId: string;
  batchNo: number;
  symbolsJson: string;
  startDate: string;
  endDate: string;
  sessionCount: number;
  estimatedPoints: number;
  urlLength: number;
  pageToken: string | null;
  feed: AlpacaFeed;
  status: string;
  attemptCount: number;
  insertedCount: number;
  lastError: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
};

type SyncStatus = {
  run: RunRow;
  currentBatch: BatchRow | null;
  pendingBatches: number;
  runningBatches: number;
  failedBatches: number;
};

export class MarketSyncError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "MarketSyncError";
    this.status = status;
  }
}

let alpacaRequestGate: Promise<void> = Promise.resolve();
let nextAlpacaRequestAt = 0;

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForAlpacaRequestSlot() {
  const previous = alpacaRequestGate;
  let release = () => {};
  alpacaRequestGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  const wait = Math.max(0, nextAlpacaRequestAt - Date.now());
  if (wait) await sleep(wait);
  nextAlpacaRequestAt = Date.now() + US_SYNC_REQUEST_SPACING_MS;
  release();
}

const rateLimitedFetch: typeof fetch = async (input, init) => {
  await waitForAlpacaRequestSlot();
  return fetch(input, init);
};

function nowIso() {
  return new Date().toISOString();
}

function dateOffset(value: string, days: number) {
  const date = new Date(value + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateFromTimestamp(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function dateAfterTimestamp(timestamp: number) {
  return dateOffset(dateFromTimestamp(timestamp), 1);
}

function hasHistory(timestamp: number | null | undefined) {
  return Number.isFinite(Number(timestamp)) && Number(timestamp) > 0;
}

function toNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function parseSymbols(batch: BatchRow) {
  try {
    const symbols = JSON.parse(batch.symbolsJson) as unknown;
    if (!Array.isArray(symbols)) return [];
    return [...new Set(symbols.map((symbol) => String(symbol).trim().toUpperCase()).filter(Boolean))];
  } catch {
    return [];
  }
}

function runSelect() {
  return "SELECT id, market, mode, status, feed, start_date AS startDate, " +
    "end_date AS endDate, latest_session AS latestSession, " +
    "total_symbols AS totalSymbols, completed_symbols AS completedSymbols, " +
    "failed_symbols AS failedSymbols, total_batches AS totalBatches, " +
    "completed_batches AS completedBatches, inserted_count AS insertedCount, " +
    "skipped_symbols AS skippedSymbols, last_error AS lastError, " +
    "created_at AS createdAt, started_at AS startedAt, finished_at AS finishedAt, " +
    "updated_at AS updatedAt FROM market_sync_runs";
}

function batchSelect() {
  return "SELECT id, run_id AS runId, batch_no AS batchNo, " +
    "symbols_json AS symbolsJson, start_date AS startDate, end_date AS endDate, " +
    "session_count AS sessionCount, estimated_points AS estimatedPoints, " +
    "url_length AS urlLength, page_token AS pageToken, feed, status, " +
    "attempt_count AS attemptCount, inserted_count AS insertedCount, " +
    "last_error AS lastError, created_at AS createdAt, started_at AS startedAt, " +
    "finished_at AS finishedAt, updated_at AS updatedAt FROM market_sync_batches";
}

async function loadAlpacaCalendar(
  secrets: ProviderSecrets,
  startDate: string,
  endDate: string,
) {
  const headers = {
    "APCA-API-KEY-ID": secrets.alpacaKeyId ?? "",
    "APCA-API-SECRET-KEY": secrets.alpacaSecretKey ?? "",
  };
  for (const origin of ["https://api.alpaca.markets", "https://paper-api.alpaca.markets"]) {
    try {
      const response = await rateLimitedFetch(
        origin + "/v2/calendar?start=" + startDate + "&end=" + endDate,
        { headers },
      );
      if (!response.ok) continue;
      const calendar = await response.json().catch(() => []) as unknown;
      if (Array.isArray(calendar) && calendar.length) return calendar as AlpacaCalendarDay[];
    } catch {
      // Try the paper endpoint before falling back to a weekday upper bound.
    }
  }
  return null;
}

async function loadUsSyncCalendar(secrets: ProviderSecrets) {
  const today = newYorkDate();
  return await loadAlpacaCalendar(secrets, US_HISTORY_START_DATE, today)
    ?? await loadAlpacaCalendar(secrets, dateOffset(today, -16), today)
    ?? [];
}

async function loadAlpacaAssets(secrets: ProviderSecrets) {
  const headers = {
    "APCA-API-KEY-ID": secrets.alpacaKeyId ?? "",
    "APCA-API-SECRET-KEY": secrets.alpacaSecretKey ?? "",
  };
  let lastError = "Alpaca 品种目录请求失败";
  for (const origin of ["https://api.alpaca.markets", "https://paper-api.alpaca.markets"]) {
    try {
      const response = await rateLimitedFetch(origin + "/v2/assets?status=active&asset_class=us_equity", { headers });
      const payload = await response.json().catch(() => ({})) as unknown;
      if (response.ok && Array.isArray(payload)) return payload as AlpacaAsset[];
      const message = payload && typeof payload === "object" && "message" in payload
        ? String((payload as { message?: unknown }).message ?? "")
        : "";
      lastError = message || lastError + "：HTTP " + response.status;
    } catch (error) {
      lastError = errorText(error);
    }
  }
  throw new MarketSyncError(lastError, 502);
}

async function upsertUsCatalog(db: D1Database, assets: AlpacaAsset[]) {
  const now = nowIso();
  const filtered = filterTradableUsAssets(assets);
  for (const group of chunks(filtered, 80)) {
    await db.batch(group.map((asset) => {
      const symbol = String(asset.symbol ?? "").trim().toUpperCase();
      return db.prepare("INSERT INTO instruments " +
        "(id, symbol, name, market, timezone, price_precision) " +
        "VALUES (?, ?, ?, 'US', 'America/New_York', 4) " +
        "ON CONFLICT(id) DO UPDATE SET symbol = excluded.symbol, " +
        "name = excluded.name, market = excluded.market, " +
        "timezone = excluded.timezone").bind(
        symbol,
        symbol,
        String(asset.name || symbol).trim(),
      );
    }));
  }
  await db.prepare("INSERT OR REPLACE INTO app_metadata (key, value) VALUES ('us_catalog_updated_at', ?)")
    .bind(now)
    .run();
  return filtered.length;
}

async function loadUsInstruments(db: D1Database, requestedIds: string[] | null) {
  const groups = requestedIds?.length ? chunks(requestedIds, 80) : [null];
  const rows: InstrumentRow[] = [];
  for (const group of groups) {
    const scope = group?.length
      ? " AND i.id IN (" + group.map(() => "?").join(",") + ")"
      : "";
    const query = db.prepare("SELECT i.id, i.symbol, i.name, " +
      "MAX(CASE WHEN c.timeframe = '1d' AND c.source IN ('alpaca-sip', 'alpaca-iex') " +
      "THEN c.last_timestamp END) AS lastTimestamp " +
      "FROM instruments i LEFT JOIN candle_coverage c ON c.instrument_id = i.id " +
      "WHERE i.market = 'US'" + scope +
      " GROUP BY i.id, i.symbol, i.name ORDER BY i.symbol");
    const result = group?.length
      ? await query.bind(...group).all<InstrumentRow>()
      : await query.all<InstrumentRow>();
    rows.push(...(result.results as InstrumentRow[]));
  }
  return rows.sort((left, right) => left.symbol.localeCompare(right.symbol)).map((row) => ({
    ...row,
    lastTimestamp: row.lastTimestamp == null ? null : Number(row.lastTimestamp),
  }));
}

async function acquireLock(db: D1Database, runId: string) {
  const now = nowIso();
  const expires = new Date(Date.now() + RUNNING_LEASE_MS).toISOString();
  const token = crypto.randomUUID();
  const result = await db.prepare("INSERT INTO market_sync_locks " +
    "(market, run_id, lease_token, expires_at, updated_at) VALUES (?, ?, ?, ?, ?) " +
    "ON CONFLICT(market) DO UPDATE SET run_id = excluded.run_id, " +
    "lease_token = excluded.lease_token, expires_at = excluded.expires_at, " +
    "updated_at = excluded.updated_at " +
    "WHERE market_sync_locks.expires_at < ? OR market_sync_locks.run_id = ?")
    .bind(US_MARKET, runId, token, expires, now, now, runId)
    .run();
  if (!result.meta.changes) throw new MarketSyncError("已有美股同步任务正在运行", 409);
}

async function renewLock(db: D1Database, runId: string) {
  const result = await db.prepare("UPDATE market_sync_locks SET expires_at = ?, updated_at = ? " +
    "WHERE market = ? AND run_id = ?")
    .bind(new Date(Date.now() + RUNNING_LEASE_MS).toISOString(), nowIso(), US_MARKET, runId)
    .run();
  return Boolean(result.meta.changes);
}

async function releaseLock(db: D1Database, runId: string) {
  await db.prepare("DELETE FROM market_sync_locks WHERE market = ? AND run_id = ?")
    .bind(US_MARKET, runId)
    .run();
}

async function getActiveRun(db: D1Database) {
  return db.prepare(runSelect() +
    " WHERE market = ? AND status IN ('queued', 'running', 'paused') " +
    "ORDER BY created_at DESC LIMIT 1")
    .bind(US_MARKET)
    .first<RunRow>();
}

export async function getActiveMarketSyncStatus() {
  await ensureSchema();
  const active = await getActiveRun(getRawDb());
  if (!active) return null;
  return await getMarketSyncStatus(active.id);
}

/**
 * Check whether an already populated US market has a closed session missing.
 * This is deliberately separate from createMarketSyncRun so the startup
 * updater can decide whether to create a worker run at all.
 */
export async function inspectMarketSyncUpdate(db: D1Database = getRawDb()) {
  const { secrets } = await loadProviderSecrets();
  const instruments = await loadUsInstruments(db, null);
  const populated = instruments.filter((instrument) => hasHistory(instrument.lastTimestamp));
  if (!populated.length) {
    return {
      existing: false,
      configured: Boolean(secrets.alpacaKeyId && secrets.alpacaSecretKey),
      needsUpdate: false,
      totalSymbols: 0,
      eligibleSymbols: 0,
      latestSession: null,
      reason: "美股尚无可更新的历史数据",
    };
  }
  if (!secrets.alpacaKeyId || !secrets.alpacaSecretKey) {
    return {
      existing: true,
      configured: false,
      needsUpdate: false,
      totalSymbols: populated.length,
      eligibleSymbols: 0,
      latestSession: null,
      reason: "美股已有数据，但尚未配置 Alpaca",
    };
  }
  const active = await getActiveRun(db);
  if (active) {
    return {
      existing: true,
      configured: true,
      needsUpdate: true,
      activeRunId: active.id,
      totalSymbols: populated.length,
      eligibleSymbols: populated.length,
      latestSession: active.latestSession,
      reason: "美股已有更新任务，启动后继续处理",
    };
  }
  const calendar = await loadUsSyncCalendar(secrets);
  const latestSession = latestClosedUsSession(calendar);
  const eligibleSymbols = populated.reduce((count, instrument) => (
    dateAfterTimestamp(Number(instrument.lastTimestamp)) <= latestSession ? count + 1 : count
  ), 0);
  return {
    existing: true,
    configured: true,
    needsUpdate: eligibleSymbols > 0,
    totalSymbols: populated.length,
    eligibleSymbols,
    latestSession,
    reason: eligibleSymbols > 0
      ? `美股有 ${eligibleSymbols.toLocaleString()} 个品种缺少最新收盘日`
      : "美股已有数据已经覆盖最近收盘日",
  };
}

function publicRun(run: RunRow) {
  return {
    id: run.id,
    market: run.market,
    mode: run.mode,
    status: run.status,
    feed: run.feed,
    startDate: run.startDate,
    endDate: run.endDate,
    latestSession: run.latestSession,
    totalSymbols: toNumber(run.totalSymbols),
    completedSymbols: toNumber(run.completedSymbols),
    failedSymbols: toNumber(run.failedSymbols),
    totalBatches: toNumber(run.totalBatches),
    completedBatches: toNumber(run.completedBatches),
    insertedCount: toNumber(run.insertedCount),
    skippedSymbols: toNumber(run.skippedSymbols),
    lastError: run.lastError,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    updatedAt: run.updatedAt,
  };
}

export async function getMarketSyncStatus(runId: string): Promise<SyncStatus | null> {
  await ensureSchema();
  const db = getRawDb();
  const run = await db.prepare(runSelect() + " WHERE id = ?").bind(runId).first<RunRow>();
  if (!run) return null;
  const currentBatch = await db.prepare(batchSelect() +
    " WHERE run_id = ? AND status IN ('running', 'queued') ORDER BY batch_no LIMIT 1")
    .bind(runId)
    .first<BatchRow>();
  const counts = await db.prepare("SELECT " +
    "SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS pending, " +
    "SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running, " +
    "SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed " +
    "FROM market_sync_batches WHERE run_id = ?").bind(runId).first<{
      pending: number;
      running: number;
      failed: number;
    }>();
  return {
    run,
    currentBatch: currentBatch ?? null,
    pendingBatches: toNumber(counts?.pending),
    runningBatches: toNumber(counts?.running),
    failedBatches: toNumber(counts?.failed),
  };
}

export async function createMarketSyncRun(input: {
  mode: MarketSyncMode;
  instrumentIds?: string[];
  startDate?: string;
  endDate?: string;
}) {
  await ensureSchema();
  const { secrets } = await loadProviderSecrets();
  if (!secrets.alpacaKeyId || !secrets.alpacaSecretKey) {
    throw new MarketSyncError("请先配置 Alpaca API Key ID 和 Secret Key", 400);
  }
  const db = getRawDb();
  const requestedStartDate = input.startDate?.trim() || null;
  const requestedEndDate = input.endDate?.trim() || null;
  const hasExplicitRange = Boolean(requestedStartDate || requestedEndDate);
  if (hasExplicitRange && (
    !requestedStartDate
    || !requestedEndDate
    || !/^\d{4}-\d{2}-\d{2}$/.test(requestedStartDate)
    || !/^\d{4}-\d{2}-\d{2}$/.test(requestedEndDate)
    || requestedEndDate < requestedStartDate
  )) {
    throw new MarketSyncError("缂哄皯鏈夋晥鐨勭編鑲″洖琛ュ紑濮嬫垨缁撴潫鏃ユ湡", 400);
  }
  const active = await getActiveRun(db);
  if (active) return { run: publicRun(active), reused: true };

  const requestedIds = Array.isArray(input.instrumentIds)
    ? [...new Set(input.instrumentIds.map((value) => String(value).trim()).filter(Boolean))]
      .slice(0, MAX_SELECTED_INSTRUMENTS)
    : null;
  if (hasExplicitRange && !requestedIds?.length) {
    throw new MarketSyncError("鎸囧畾缁勬垚鍥炴潯鏃ユ湡鏃跺繀椤绘寚瀹氬搧绉嶏紝閬垮厤璇存剰鍏ㄥ競鍥炴潯", 400);
  }
  if (input.mode === "initialize") {
    await upsertUsCatalog(db, await loadAlpacaAssets(secrets));
  }
  const instruments = await loadUsInstruments(db, requestedIds);
  if (!instruments.length) throw new MarketSyncError("美股品种目录为空，请先刷新品种目录", 400);

  const calendar = await loadUsSyncCalendar(secrets);
  const latestSession = latestClosedUsSession(calendar);
  const endDate = requestedEndDate ?? latestSession;
  if (endDate > latestSession) {
    throw new MarketSyncError("缁撴潫鏃ユ湡涓嶈兘瓒呰繃鏈€杩戞敹鐩樼殑缇庤偂浜ゆ槗鏃?", 400);
  }
  const calendarDates = calendar
    ?.map((session) => String(session.date ?? ""))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort()
    ?? [];
  const eligible: Array<InstrumentRow & { startDate: string }> = [];
  let skippedSymbols = 0;
  for (const instrument of instruments) {
    if (requestedStartDate) {
      eligible.push({ ...instrument, startDate: requestedStartDate });
      continue;
    }
    if (!hasHistory(instrument.lastTimestamp)) {
      if (input.mode === "initialize") {
        eligible.push({ ...instrument, startDate: US_HISTORY_START_DATE });
      } else {
        skippedSymbols += 1;
      }
      continue;
    }
    const startDate = dateAfterTimestamp(Number(instrument.lastTimestamp));
    if (startDate <= endDate) {
      eligible.push({ ...instrument, startDate });
    } else {
      skippedSymbols += 1;
    }
  }

  const runId = crypto.randomUUID();
  await acquireLock(db, runId);
  try {
    await db.prepare("UPDATE data_download_jobs SET status = 'superseded', " +
      "terminal_reason = 'replaced_by_bulk_sync', updated_at = ? " +
      "WHERE market = 'US' AND timeframe = '1d' AND sync_run_id IS NULL " +
      "AND status IN ('queued', 'running', 'paused', 'failed')").bind(nowIso()).run();

    const grouped = new Map<string, Array<InstrumentRow & { startDate: string }>>();
    for (const instrument of eligible) {
      const group = grouped.get(instrument.startDate) ?? [];
      group.push(instrument);
      grouped.set(instrument.startDate, group);
    }

    const planned: Array<{ plan: AlpacaBatchPlan; instruments: Array<InstrumentRow & { startDate: string }> }> = [];
    for (const [startDate, group] of grouped) {
      const hasCompleteCalendar = calendarDates.length > 0
        && calendarDates[0] <= startDate
        && calendarDates.at(-1)! >= endDate;
      const sessionCount = hasCompleteCalendar
        ? countTradingSessions(startDate, endDate, calendarDates)
        : countWeekdaySessions(startDate, endDate);
      const plans = planAlpacaBatches({
        symbols: group.map((instrument) => instrument.symbol),
        startDate,
        endDate,
        sessionCount,
      });
      const bySymbol = new Map(group.map((instrument) => [instrument.symbol.toUpperCase(), instrument]));
      for (const plan of plans) {
        planned.push({
          plan,
          instruments: plan.symbols.map((symbol) => bySymbol.get(symbol)).filter(Boolean) as Array<InstrumentRow & { startDate: string }>,
        });
      }
    }

    const createdAt = nowIso();
    const runStartDate = eligible.length
      ? eligible.map((instrument) => instrument.startDate).sort()[0]
      : endDate;
    await db.prepare("INSERT INTO market_sync_runs " +
      "(id, market, mode, status, feed, start_date, end_date, latest_session, " +
      "total_symbols, completed_symbols, failed_symbols, total_batches, " +
      "completed_batches, inserted_count, skipped_symbols, created_at, updated_at) " +
      "VALUES (?, 'US', ?, ?, 'sip', ?, ?, ?, ?, 0, 0, ?, 0, 0, ?, ?, ?)")
      .bind(
        runId,
        input.mode,
        planned.length ? "queued" : "completed",
         runStartDate,
        endDate,
        endDate,
        eligible.length,
        planned.length,
        skippedSymbols,
        createdAt,
        createdAt,
      )
      .run();

    let globalBatchNo = 0;
    for (const { plan, instruments: batchInstruments } of planned) {
      globalBatchNo += 1;
      const batchId = crypto.randomUUID();
      await db.prepare("INSERT INTO market_sync_batches " +
        "(id, run_id, batch_no, symbols_json, start_date, end_date, session_count, " +
        "estimated_points, url_length, feed, status, created_at, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'sip', 'queued', ?, ?)")
        .bind(
          batchId,
          runId,
          globalBatchNo,
          JSON.stringify(plan.symbols),
          plan.startDate,
          plan.endDate,
          plan.sessionCount,
          plan.estimatedPoints,
          plan.urlLength,
          createdAt,
          createdAt,
        )
        .run();
      for (const group of chunks(batchInstruments, 80)) {
        await db.batch(group.map((instrument) => db.prepare("INSERT INTO data_download_jobs " +
          "(id, provider, instrument_id, vendor_symbol, instrument_name, market, " +
          "timeframe, start_date, end_date, adjustment_type, status, cursor_json, " +
          "inserted_count, quality_report_json, sync_run_id, sync_batch_id, " +
          "sync_mode, attempt_count, feed, created_at, updated_at) " +
          "VALUES (?, 'alpaca', ?, ?, ?, 'US', '1d', ?, ?, 'none', 'queued', " +
          "'{}', 0, '{}', ?, ?, ?, 0, 'sip', ?, ?)").bind(
          crypto.randomUUID(),
          instrument.id,
          instrument.symbol,
          instrument.name,
          plan.startDate,
          plan.endDate,
          runId,
          batchId,
          input.mode,
          createdAt,
          createdAt,
        )));
      }
    }

    const status = await getMarketSyncStatus(runId);
    if (!status) throw new MarketSyncError("同步任务创建后无法读取状态", 500);
    if (status.run.status === "completed") await releaseLock(db, runId);
    return {
      run: publicRun(status.run),
      reused: false,
      instrumentCount: instruments.length,
      eligibleCount: eligible.length,
      skippedSymbols,
    };
  } catch (error) {
    await releaseLock(db, runId);
    throw error;
  }
}

async function loadBatchInstruments(db: D1Database, symbols: string[]) {
  const result: InstrumentRow[] = [];
  for (const group of chunks(symbols, 80)) {
    if (!group.length) continue;
    const placeholders = group.map(() => "?").join(",");
    const rows = await db.prepare(
      "SELECT id, symbol, name, NULL AS lastTimestamp FROM instruments " +
      "WHERE market = 'US' AND symbol IN (" + placeholders + ")",
    ).bind(...group).all<InstrumentRow>();
    result.push(...(rows.results as InstrumentRow[]));
  }
  return new Map(result.map((instrument) => [instrument.symbol.toUpperCase(), instrument]));
}

async function refreshCoverage(db: D1Database, instrumentIds: string[]) {
  for (const group of chunks([...new Set(instrumentIds)], 80)) {
    if (!group.length) continue;
    const placeholders = group.map(() => "?").join(",");
    const rows = await db.prepare(
      "SELECT instrument_id AS instrumentId, source, COUNT(*) AS barCount, " +
      "MIN(timestamp) AS firstTimestamp, MAX(timestamp) AS lastTimestamp " +
      "FROM candles WHERE instrument_id IN (" + placeholders + ") " +
      "AND timeframe = '1d' AND adjustment_type = 'none' GROUP BY instrument_id, source",
    ).bind(...group).all<{
      instrumentId: string;
      source: string;
      barCount: number;
      firstTimestamp: number;
      lastTimestamp: number;
    }>();
    const statements = (rows.results as Array<{
      instrumentId: string;
      source: string;
      barCount: number;
      firstTimestamp: number;
      lastTimestamp: number;
    }>).map((row) => db.prepare("INSERT OR REPLACE INTO candle_coverage " +
      "(instrument_id, timeframe, adjustment_type, source, bar_count, " +
      "first_timestamp, last_timestamp, updated_at) " +
      "VALUES (?, '1d', 'none', ?, ?, ?, ?, ?)").bind(
      row.instrumentId,
      row.source,
      Number(row.barCount),
      Number(row.firstTimestamp),
      Number(row.lastTimestamp),
      nowIso(),
    ));
    if (statements.length) await db.batch(statements);
  }
}

async function persistCandleRows(
  db: D1Database,
  symbols: string[],
  candlesBySymbol: Map<string, NormalizedCandle[]>,
  source: string,
) {
  const instrumentsBySymbol = await loadBatchInstruments(db, symbols);
  const affected = new Set<string>();
  const insertedBySymbol = new Map<string, number>();
  const statements = [];
  const insertVerb = source === "alpaca-iex" ? "INSERT OR IGNORE" : "INSERT OR REPLACE";
  for (const [symbol, candles] of candlesBySymbol) {
    const instrument = instrumentsBySymbol.get(symbol.toUpperCase());
    if (!instrument) continue;
    affected.add(instrument.id);
    insertedBySymbol.set(symbol.toUpperCase(), candles.length);
    for (const group of chunks(candles, 8)) {
      const placeholders = group.map(() => "(?, '1d', ?, ?, ?, ?, ?, ?, ?, 'none', ?, '[]')").join(",");
      const values = group.flatMap((candle) => [
        instrument.id,
        candle.timestamp,
        candle.open,
        candle.high,
        candle.low,
        candle.close,
        candle.volume,
        candle.turnover,
        source,
      ]);
      statements.push(db.prepare(insertVerb + " INTO candles " +
        "(instrument_id, timeframe, timestamp, open, high, low, close, volume, " +
        "turnover, adjustment_type, source, quality_flags) VALUES " + placeholders).bind(...values));
    }
  }
  for (const group of chunks(statements, 16)) {
    if (group.length) await db.batch(group);
  }
  // Do not purge IEX rows by instrument here.  This function is also used for
  // incremental SIP updates, so a response for one new session cannot prove
  // that older sessions have a SIP replacement.  The candle primary key makes
  // SIP replace IEX automatically when both sources contain the same date.
  await refreshCoverage(db, [...affected]);
  return {
    affected,
    insertedBySymbol,
    inserted: [...candlesBySymbol.values()].reduce((sum, candles) => sum + candles.length, 0),
  };
}

async function updateRunProgress(db: D1Database, runId: string) {
  const items = await db.prepare("SELECT COUNT(*) AS total, " +
    "SUM(CASE WHEN status IN ('completed', 'no_data') THEN 1 ELSE 0 END) AS completed, " +
    "SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed, " +
    "COALESCE(SUM(inserted_count), 0) AS inserted " +
    "FROM data_download_jobs WHERE sync_run_id = ?").bind(runId).first<{
      total: number;
      completed: number;
      failed: number;
      inserted: number;
    }>();
  const batches = await db.prepare("SELECT COUNT(*) AS total, " +
    "SUM(CASE WHEN status IN ('completed', 'split') THEN 1 ELSE 0 END) AS completed, " +
    "SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed, " +
    "SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued, " +
    "SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running, " +
    "COALESCE(SUM(inserted_count), 0) AS inserted " +
    "FROM market_sync_batches WHERE run_id = ?").bind(runId).first<{
      total: number;
      completed: number;
      failed: number;
      queued: number;
      running: number;
      inserted: number;
    }>();
  const current = await db.prepare(runSelect() + " WHERE id = ?").bind(runId).first<RunRow>();
  if (!current) return null;
  const latestError = await db.prepare("SELECT last_error AS lastError FROM market_sync_batches " +
    "WHERE run_id = ? AND last_error IS NOT NULL ORDER BY updated_at DESC LIMIT 1")
    .bind(runId).first<{ lastError: string | null }>();
  const queued = toNumber(batches?.queued);
  const running = toNumber(batches?.running);
  const failedBatches = toNumber(batches?.failed);
  const terminal = queued === 0 && running === 0;
  const status = current.status === "paused" || current.status === "cancelled"
    ? current.status
    : terminal
      ? failedBatches || toNumber(items?.failed) ? "completed_with_errors" : "completed"
      : "running";
  const finishedAt = terminal && !["paused", "cancelled"].includes(status) ? nowIso() : current.finishedAt;
  await db.prepare("UPDATE market_sync_runs SET status = ?, total_symbols = ?, " +
    "completed_symbols = ?, failed_symbols = ?, total_batches = ?, " +
    "completed_batches = ?, inserted_count = ?, last_error = ?, started_at = COALESCE(started_at, ?), " +
    "finished_at = ?, updated_at = ? " +
    "WHERE id = ?").bind(
    status,
    toNumber(items?.total),
    toNumber(items?.completed),
    toNumber(items?.failed),
    toNumber(batches?.total),
    toNumber(batches?.completed),
    toNumber(batches?.inserted),
    latestError?.lastError ?? null,
    current.startedAt ?? nowIso(),
    finishedAt,
    nowIso(),
    runId,
  ).run();
  const next = await db.prepare(runSelect() + " WHERE id = ?").bind(runId).first<RunRow>();
  if (next && ["completed", "completed_with_errors", "cancelled"].includes(next.status)) {
    await releaseLock(db, runId);
  }
  return next ?? null;
}

async function splitBatch(db: D1Database, batch: BatchRow, message: string) {
  const symbols = parseSymbols(batch);
  const halves = splitSymbols(symbols);
  if (halves.length < 2) return false;
  const timestamp = nowIso();
  await db.prepare("UPDATE market_sync_batches SET status = 'split', last_error = ?, " +
    "finished_at = ?, updated_at = ? WHERE id = ?")
    .bind(message, timestamp, timestamp, batch.id).run();
  for (const half of halves) {
    const plan = planAlpacaBatches({
      symbols: half,
      startDate: batch.startDate,
      endDate: batch.endDate,
      sessionCount: batch.sessionCount,
      feed: "sip",
    })[0];
    if (!plan) continue;
    const childId = crypto.randomUUID();
    await db.prepare("INSERT INTO market_sync_batches " +
      "(id, run_id, batch_no, symbols_json, start_date, end_date, session_count, " +
      "estimated_points, url_length, feed, status, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)").bind(
      childId,
      batch.runId,
      batch.batchNo,
      JSON.stringify(plan.symbols),
      plan.startDate,
      plan.endDate,
      plan.sessionCount,
      plan.estimatedPoints,
      plan.urlLength,
      "sip",
      timestamp,
      timestamp,
    ).run();
    for (const group of chunks(half, 80)) {
      const placeholders = group.map(() => "?").join(",");
      await db.prepare("UPDATE data_download_jobs SET sync_batch_id = ?, status = 'queued', " +
        "last_error = NULL, terminal_reason = NULL, updated_at = ? " +
        "WHERE sync_batch_id = ? AND vendor_symbol IN (" + placeholders + ")")
        .bind(childId, timestamp, batch.id, ...group).run();
    }
  }
  await db.prepare("UPDATE market_sync_runs SET total_batches = total_batches + 1, updated_at = ? WHERE id = ?")
    .bind(timestamp, batch.runId).run();
  return true;
}

async function markBatchFailed(db: D1Database, batch: BatchRow, message: string) {
  const timestamp = nowIso();
  await db.prepare("UPDATE market_sync_batches SET status = 'failed', last_error = ?, " +
    "finished_at = ?, updated_at = ? WHERE id = ?")
    .bind(message, timestamp, timestamp, batch.id).run();
  await db.prepare("UPDATE data_download_jobs SET status = 'failed', last_error = ?, " +
    "terminal_reason = 'request_failed', updated_at = ? WHERE sync_batch_id = ? " +
    "AND status NOT IN ('completed', 'no_data')")
    .bind(message, timestamp, batch.id).run();
}

async function processBatch(db: D1Database, run: RunRow, originalBatch: BatchRow, secrets: ProviderSecrets) {
  if (!await renewLock(db, run.id)) return;
  const claimTime = nowIso();
  const claim = await db.prepare("UPDATE market_sync_batches SET status = 'running', " +
    "attempt_count = attempt_count + 1, started_at = COALESCE(started_at, ?), " +
    "updated_at = ? WHERE id = ? AND status = 'queued' " +
    "AND NOT EXISTS (SELECT 1 FROM market_sync_batches AS active " +
    "WHERE active.run_id = ? AND active.status = 'running')")
    .bind(claimTime, claimTime, originalBatch.id, originalBatch.runId).run();
  if (!claim.meta.changes) return;
  const batch = await db.prepare(batchSelect() + " WHERE id = ?").bind(originalBatch.id).first<BatchRow>();
  if (!batch) return;
  if (!await renewLock(db, run.id)) {
    await db.prepare("UPDATE market_sync_batches SET status = 'queued', last_error = ?, updated_at = ? WHERE id = ?")
      .bind("同步锁已失效，等待重新获取", nowIso(), batch.id).run();
    return;
  }
  const symbols = parseSymbols(batch);
  // Bulk US syncs are SIP-only.  A permission or provider error must fail and
  // remain visible instead of silently changing the historical data source.
  const feed: AlpacaFeed = "sip";
  const requestPageToken = batch.feed === "sip" ? batch.pageToken ?? undefined : undefined;
  let chunk: AlpacaMultiSymbolChunk;
  try {
    chunk = await fetchAlpacaMultiSymbolChunk({
      symbols,
      timeframe: "1d",
      startDate: batch.startDate,
      endDate: batch.endDate,
      feed,
      pageToken: requestPageToken,
      limit: 10_000,
    }, secrets, rateLimitedFetch);
  } catch (error) {
    const message = errorText(error);
    const status = Number((error as { status?: unknown })?.status ?? 0);
    const shouldSplit = isAlpacaUrlTooLongError(error) || status === 400;
    if ((shouldSplit || batch.attemptCount >= US_SYNC_MAX_ATTEMPTS) && symbols.length > 1) {
      await splitBatch(db, batch, message);
    } else if (batch.attemptCount >= US_SYNC_MAX_ATTEMPTS || (shouldSplit && symbols.length === 1)) {
      await markBatchFailed(db, batch, message);
    } else {
      await db.prepare("UPDATE market_sync_batches SET status = 'queued', last_error = ?, updated_at = ? WHERE id = ?")
        .bind(message, nowIso(), batch.id).run();
    }
    await updateRunProgress(db, run.id);
    return;
  }

  let persisted: Awaited<ReturnType<typeof persistCandleRows>>;
  try {
    persisted = await persistCandleRows(db, symbols, chunk.candlesBySymbol, chunk.source);
  } catch (error) {
    const message = errorText(error);
    if (batch.attemptCount >= US_SYNC_MAX_ATTEMPTS) {
      await markBatchFailed(db, batch, message);
    } else {
      await db.prepare("UPDATE market_sync_batches SET status = 'queued', last_error = ?, updated_at = ? WHERE id = ?")
        .bind(message, nowIso(), batch.id).run();
    }
    await updateRunProgress(db, run.id);
    return;
  }
  const pageToken = chunk.cursor.pageToken ?? null;
  const timestamp = nowIso();
  await db.prepare("UPDATE market_sync_batches SET status = ?, page_token = ?, feed = ?, " +
    "attempt_count = 0, inserted_count = inserted_count + ?, last_error = NULL, updated_at = ?, " +
    "finished_at = CASE WHEN ? = 'completed' THEN ? ELSE finished_at END WHERE id = ?")
    .bind(
      pageToken ? "queued" : "completed",
      pageToken,
      feed,
      persisted.inserted,
      timestamp,
      pageToken ? "queued" : "completed",
      timestamp,
      batch.id,
    ).run();
  if (!pageToken) {
    const coverageExists = "EXISTS (SELECT 1 FROM candle_coverage c " +
      "JOIN instruments i ON i.id = c.instrument_id " +
      "WHERE i.symbol = data_download_jobs.vendor_symbol " +
      "AND c.timeframe = '1d' AND c.source IN ('alpaca-sip', 'alpaca-iex') " +
      "AND c.bar_count > 0)";
    const updates = symbols.map((symbol) => db.prepare("UPDATE data_download_jobs SET " +
      "status = CASE WHEN " + coverageExists + " THEN 'completed' ELSE 'no_data' END, " +
      "inserted_count = inserted_count + ?, feed = ?, last_error = NULL, " +
      "terminal_reason = CASE WHEN " + coverageExists + " THEN NULL ELSE 'no_bars_returned' END, " +
      "updated_at = ? WHERE sync_batch_id = ? AND vendor_symbol = ?")
      .bind(persisted.insertedBySymbol.get(symbol.toUpperCase()) ?? 0, feed, timestamp, batch.id, symbol));
    for (const group of chunks(updates, 80)) {
      if (group.length) await db.batch(group);
    }
  } else {
    const updates = symbols.map((symbol) => db.prepare("UPDATE data_download_jobs SET status = 'running', feed = ?, " +
      "inserted_count = inserted_count + ?, updated_at = ? WHERE sync_batch_id = ? AND vendor_symbol = ?")
      .bind(feed, persisted.insertedBySymbol.get(symbol.toUpperCase()) ?? 0, timestamp, batch.id, symbol));
    for (const group of chunks(updates, 80)) {
      if (group.length) await db.batch(group);
    }
  }
  await updateRunProgress(db, run.id);
}

async function processNextMarketSyncBatchInternal(runId: string) {
  await ensureSchema();
  const db = getRawDb();
  const status = await getMarketSyncStatus(runId);
  if (!status) throw new MarketSyncError("同步任务不存在", 404);
  if (["completed", "completed_with_errors", "cancelled", "paused"].includes(status.run.status)) {
    return status;
  }
  const staleBefore = new Date(Date.now() - RUNNING_LEASE_MS).toISOString();
  await db.prepare("UPDATE market_sync_batches SET status = 'queued', updated_at = ? " +
    "WHERE run_id = ? AND status = 'running' AND updated_at < ?")
    .bind(nowIso(), runId, staleBefore).run();
  const batch = await db.prepare(batchSelect() +
    " WHERE run_id = ? AND status = 'queued' ORDER BY batch_no LIMIT 1")
    .bind(runId).first<BatchRow>();
  if (!batch) {
    await updateRunProgress(db, runId);
    return await getMarketSyncStatus(runId);
  }
  const run = await db.prepare(runSelect() + " WHERE id = ?").bind(runId).first<RunRow>();
  if (!run) throw new MarketSyncError("同步任务不存在", 404);
  const { secrets } = await loadProviderSecrets();
  if (!secrets.alpacaKeyId || !secrets.alpacaSecretKey) {
    throw new MarketSyncError("Alpaca 凭证不存在", 400);
  }
  const startedAt = nowIso();
  await db.prepare("UPDATE market_sync_runs SET status = 'running', started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ? AND status = 'queued'")
    .bind(startedAt, startedAt, runId).run();
  await processBatch(db, run, batch, secrets);
  return await getMarketSyncStatus(runId);
}

export async function processNextMarketSyncBatch(runId: string) {
  return await marketSyncWorkerGate.run(
    runId,
    () => processNextMarketSyncBatchInternal(runId),
    async () => {
      const status = await getMarketSyncStatus(runId);
      if (!status) throw new MarketSyncError("同步任务不存在", 404);
      return status;
    },
  );
}

export async function controlMarketSync(
  runId: string,
  action: "pause" | "resume" | "cancel" | "retry",
) {
  await ensureSchema();
  const db = getRawDb();
  const run = await db.prepare(runSelect() + " WHERE id = ?").bind(runId).first<RunRow>();
  if (!run) throw new MarketSyncError("同步任务不存在", 404);
  const timestamp = nowIso();
  if (action === "pause") {
    await db.prepare("UPDATE market_sync_runs SET status = 'paused', updated_at = ? WHERE id = ? AND status IN ('queued', 'running')")
      .bind(timestamp, runId).run();
    await db.prepare("UPDATE market_sync_batches SET status = 'paused', updated_at = ? WHERE run_id = ? AND status = 'queued'")
      .bind(timestamp, runId).run();
  } else if (action === "resume") {
    await acquireLock(db, runId);
    await db.prepare("UPDATE market_sync_runs SET status = 'queued', last_error = NULL, updated_at = ? WHERE id = ? AND status = 'paused'")
      .bind(timestamp, runId).run();
    await db.prepare("UPDATE market_sync_batches SET status = 'queued', updated_at = ? WHERE run_id = ? AND status = 'paused'")
      .bind(timestamp, runId).run();
  } else if (action === "cancel") {
    await db.prepare("UPDATE market_sync_runs SET status = 'cancelled', finished_at = ?, updated_at = ? WHERE id = ? AND status NOT IN ('completed', 'completed_with_errors', 'cancelled')")
      .bind(timestamp, timestamp, runId).run();
    await db.prepare("UPDATE market_sync_batches SET status = 'cancelled', finished_at = ?, updated_at = ? WHERE run_id = ? AND status NOT IN ('completed', 'split', 'failed')")
      .bind(timestamp, timestamp, runId).run();
    await db.prepare("UPDATE data_download_jobs SET status = 'cancelled', terminal_reason = 'run_cancelled', updated_at = ? WHERE sync_run_id = ? AND status NOT IN ('completed', 'no_data', 'failed')")
      .bind(timestamp, runId).run();
    await releaseLock(db, runId);
  } else {
    await db.prepare("UPDATE market_sync_runs SET status = 'queued', last_error = NULL, updated_at = ? WHERE id = ? AND status IN ('failed', 'completed_with_errors')")
      .bind(timestamp, runId).run();
    await db.prepare("UPDATE market_sync_batches SET status = 'queued', last_error = NULL, updated_at = ? WHERE run_id = ? AND status = 'failed'")
      .bind(timestamp, runId).run();
    await db.prepare("UPDATE data_download_jobs SET status = 'queued', last_error = NULL, terminal_reason = NULL, updated_at = ? WHERE sync_run_id = ? AND status = 'failed'")
      .bind(timestamp, runId).run();
  }
  return await getMarketSyncStatus(runId);
}

export function serializeMarketSyncStatus(status: SyncStatus | null) {
  if (!status) return null;
  return {
    run: publicRun(status.run),
    currentBatch: status.currentBatch
      ? {
          id: status.currentBatch.id,
          batchNo: status.currentBatch.batchNo,
          symbolCount: parseSymbols(status.currentBatch).length,
          startDate: status.currentBatch.startDate,
          endDate: status.currentBatch.endDate,
          sessionCount: status.currentBatch.sessionCount,
          estimatedPoints: status.currentBatch.estimatedPoints,
          urlLength: status.currentBatch.urlLength,
          status: status.currentBatch.status,
          attemptCount: status.currentBatch.attemptCount,
          insertedCount: status.currentBatch.insertedCount,
          lastError: status.currentBatch.lastError,
        }
      : null,
    pendingBatches: status.pendingBatches,
    runningBatches: status.runningBatches,
    failedBatches: status.failedBatches,
  };
}
