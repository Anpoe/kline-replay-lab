import { ensureSchema, getRawDb } from "../../../../../db/runtime";
import { loadProviderSecrets } from "../../../../lib/providerCredentials";
import {
  fetchAlpacaMultiSymbolChunk,
  isAlpacaSipPermissionError,
  type AlpacaFeed,
  type AlpacaMultiSymbolChunk,
  type NormalizedCandle,
} from "../../../../lib/marketDataProviders";
import {
  latestClosedUsSession,
  newYorkDate,
  type AlpacaCalendarDay,
} from "../../../../lib/usMarketSessions";

type SyncInstrument = {
  id: string;
  symbol: string;
  name: string;
  lastTimestamp: number | null;
};

type CoverageRow = {
  instrumentId: string;
  barCount: number;
  firstTimestamp: number;
  lastTimestamp: number;
};

const symbolsPerRequest = 100;
const requestSpacingMs = 350;
const maxRequestedInstruments = 500;

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
  nextAlpacaRequestAt = Date.now() + requestSpacingMs;
  release();
}

const rateLimitedFetch: typeof fetch = async (input, init) => {
  await waitForAlpacaRequestSlot();
  return fetch(input, init);
};

function dateOffset(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateFromTimestamp(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function dateAfter(timestamp: number) {
  return dateOffset(dateFromTimestamp(timestamp), 1);
}

function hasUsHistory(timestamp: number | null | undefined) {
  const value = Number(timestamp);
  return Number.isFinite(value) && value > 0;
}

async function loadLatestClosedUsSession(keyId: string, secretKey: string) {
  const today = newYorkDate();
  const headers = {
    "APCA-API-KEY-ID": keyId,
    "APCA-API-SECRET-KEY": secretKey,
  };
  for (const origin of ["https://paper-api.alpaca.markets", "https://api.alpaca.markets"]) {
    try {
      const response = await fetch(
        `${origin}/v2/calendar?start=${dateOffset(today, -16)}&end=${today}`,
        { headers },
      );
      if (!response.ok) continue;
      const calendar = await response.json() as AlpacaCalendarDay[];
      return latestClosedUsSession(calendar);
    } catch {
      // The shared calendar helper falls back to the previous weekday below.
    }
  }
  return latestClosedUsSession([]);
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function insertCandleRows(
  db: D1Database,
  instrumentsBySymbol: Map<string, SyncInstrument>,
  candlesBySymbol: Map<string, NormalizedCandle[]>,
  source: string,
) {
  const affected = new Set<string>();
  const statements = [];
  for (const [symbol, candles] of candlesBySymbol) {
    const instrument = instrumentsBySymbol.get(symbol.toUpperCase());
    if (!instrument) continue;
    affected.add(instrument.id);
    for (const candle of candles) {
      statements.push(db.prepare(`INSERT OR REPLACE INTO candles
        (instrument_id, timeframe, timestamp, open, high, low, close, volume, turnover,
         adjustment_type, source, quality_flags)
        VALUES (?, '1d', ?, ?, ?, ?, ?, ?, ?, 'none', ?, '[]')`).bind(
        instrument.id,
        candle.timestamp,
        candle.open,
        candle.high,
        candle.low,
        candle.close,
        candle.volume,
        candle.turnover,
        source,
      ));
    }
  }
  for (const batch of chunks(statements, 16)) {
    if (batch.length) await db.batch(batch);
  }

  // A sample AAPL row can exist before the real market library is initialized.
  // Remove only that disposable source after the first real Alpaca bars arrive.
  for (const batch of chunks([...affected], 80)) {
    if (!batch.length) continue;
    const placeholders = batch.map(() => "?").join(",");
    await db.prepare(`DELETE FROM candles
      WHERE instrument_id IN (${placeholders}) AND timeframe = '1d'
        AND adjustment_type = 'none' AND source = 'sample'`).bind(...batch).run();
    await db.prepare(`DELETE FROM candle_coverage
      WHERE instrument_id IN (${placeholders}) AND timeframe = '1d'
        AND adjustment_type = 'none' AND source = 'sample'`).bind(...batch).run();
  }

  const coverageRows: CoverageRow[] = [];
  for (const batch of chunks([...affected], 80)) {
    if (!batch.length) continue;
    const placeholders = batch.map(() => "?").join(",");
    const rows = await db.prepare(`SELECT instrument_id AS instrumentId,
        COUNT(*) AS barCount, MIN(timestamp) AS firstTimestamp, MAX(timestamp) AS lastTimestamp
      FROM candles
      WHERE instrument_id IN (${placeholders}) AND timeframe = '1d'
        AND adjustment_type = 'none' AND source = ?
      GROUP BY instrument_id`).bind(...batch, source).all<CoverageRow>();
    coverageRows.push(...(rows.results as CoverageRow[]));
  }
  const now = new Date().toISOString();
  for (const row of coverageRows) {
    await db.prepare(`INSERT OR REPLACE INTO candle_coverage
      (instrument_id, timeframe, adjustment_type, source, bar_count,
       first_timestamp, last_timestamp, updated_at)
      VALUES (?, '1d', 'none', ?, ?, ?, ?, ?)`).bind(
      row.instrumentId,
      source,
      Number(row.barCount),
      Number(row.firstTimestamp),
      Number(row.lastTimestamp),
      now,
    ).run();
  }
  return { affected, inserted: statements.length };
}

export async function POST(request: Request) {
  await ensureSchema();
  const payload = await request.json().catch(() => ({})) as { market?: string; instrumentIds?: string[] };
  if (payload.market && payload.market !== "US") {
    return Response.json({ error: "最新日线批量同步当前仅支持美股" }, { status: 400 });
  }
  const { secrets } = await loadProviderSecrets();
  if (!secrets.alpacaKeyId || !secrets.alpacaSecretKey) {
    return Response.json({ error: "请先配置 Alpaca API Key ID 和 Secret Key" }, { status: 400 });
  }

  const requestedInstrumentIds = Array.isArray(payload.instrumentIds)
    ? [...new Set(payload.instrumentIds.map((value) => String(value).trim()).filter(Boolean))].slice(0, maxRequestedInstruments)
    : null;
  const db = getRawDb();
  const scope = requestedInstrumentIds
    ? ` AND i.id IN (${requestedInstrumentIds.map(() => "?").join(",")})`
    : "";
  const query = db.prepare(`SELECT i.id, i.symbol, i.name,
      MAX(CASE WHEN c.timeframe = '1d' AND c.source IN ('alpaca-sip', 'alpaca-iex')
        THEN c.last_timestamp END) AS lastTimestamp
    FROM instruments i LEFT JOIN candle_coverage c ON c.instrument_id = i.id
    WHERE i.market = 'US'${scope}
    GROUP BY i.id, i.symbol, i.name ORDER BY i.symbol`);
  const rows = requestedInstrumentIds
    ? await query.bind(...requestedInstrumentIds).all<SyncInstrument>()
    : await query.all<SyncInstrument>();
  const instruments = (rows.results as SyncInstrument[]).map((row) => ({
    ...row,
    lastTimestamp: row.lastTimestamp == null ? null : Number(row.lastTimestamp),
  }));
  if (!instruments.length) {
    return Response.json({ error: "美股品种目录为空，请先执行市场初始化" }, { status: 400 });
  }

  const endDate = await loadLatestClosedUsSession(secrets.alpacaKeyId, secrets.alpacaSecretKey);
  const missingHistory = instruments.filter((instrument) => !hasUsHistory(instrument.lastTimestamp));
  const pending = instruments.filter((instrument) => {
    if (!hasUsHistory(instrument.lastTimestamp)) return false;
    return dateFromTimestamp(Number(instrument.lastTimestamp)) < endDate;
  });
  if (!pending.length) {
    return Response.json({
      market: "US",
      latestDate: endDate,
      instrumentCount: instruments.length,
      pendingCount: 0,
      updatedCount: 0,
      insertedCount: 0,
      missingHistoryCount: missingHistory.length,
      failedCount: 0,
    });
  }

  const instrumentsBySymbol = new Map(instruments.map((instrument) => [instrument.symbol.toUpperCase(), instrument]));
  const groups = new Map<string, SyncInstrument[]>();
  for (const instrument of pending) {
    const startDate = dateAfter(Number(instrument.lastTimestamp));
    const group = groups.get(startDate) ?? [];
    group.push(instrument);
    groups.set(startDate, group);
  }

  let feed: AlpacaFeed = "sip";
  let insertedCount = 0;
  let updatedCount = 0;
  let failedCount = 0;
  let firstError = "";
  const updatedInstrumentIds = new Set<string>();
  for (const [startDate, group] of groups) {
    for (const symbolBatch of chunks(group, symbolsPerRequest)) {
      let pageToken: string | undefined;
      let batchSucceeded = false;
      try {
        do {
          let chunk: AlpacaMultiSymbolChunk;
          try {
            chunk = await fetchBatchWithSecrets(feed, symbolBatch, startDate, endDate, pageToken, secrets);
          } catch (error) {
            if (feed !== "sip" || !isAlpacaSipPermissionError(error)) throw error;
            feed = "iex";
            pageToken = undefined;
            chunk = await fetchBatchWithSecrets(feed, symbolBatch, startDate, endDate, undefined, secrets);
          }
          const persisted = await insertCandleRows(db, instrumentsBySymbol, chunk.candlesBySymbol, chunk.source);
          insertedCount += persisted.inserted;
          for (const instrumentId of persisted.affected) updatedInstrumentIds.add(instrumentId);
          pageToken = chunk.cursor.pageToken;
          batchSucceeded = true;
        } while (pageToken);
      } catch (error) {
        failedCount += symbolBatch.length;
        if (!firstError) firstError = error instanceof Error ? error.message : String(error);
      }
      if (batchSucceeded) updatedCount += symbolBatch.length;
    }
  }

  // Clear the old per-symbol incremental jobs that this bulk sync has now
  // satisfied. A job with no prior coverage is intentionally left alone so
  // the historical initializer can still resume it later.
  for (const batch of chunks([...updatedInstrumentIds], 80)) {
    if (!batch.length) continue;
    const placeholders = batch.map(() => "?").join(",");
    await db.prepare(`UPDATE data_download_jobs SET status = 'completed', last_error = NULL,
        updated_at = ?
      WHERE market = 'US' AND timeframe = '1d' AND instrument_id IN (${placeholders})
        AND status IN ('queued', 'running', 'failed')
        AND start_date <> '2016-01-01'`).bind(new Date().toISOString(), ...batch).run();
  }

  return Response.json({
    market: "US",
    latestDate: endDate,
    instrumentCount: instruments.length,
    pendingCount: pending.length,
    updatedCount,
    insertedCount,
    missingHistoryCount: missingHistory.length,
    failedCount,
    ...(firstError ? { firstError } : {}),
  });
}

async function fetchBatchWithSecrets(
  feed: AlpacaFeed,
  symbols: SyncInstrument[],
  startDate: string,
  endDate: string,
  pageToken: string | undefined,
  secrets: { alpacaKeyId?: string; alpacaSecretKey?: string },
) {
  return fetchAlpacaMultiSymbolChunk({
    symbols: symbols.map((instrument) => instrument.symbol),
    timeframe: "1d",
    startDate,
    endDate,
    feed,
    pageToken,
    limit: 10_000,
  }, secrets, rateLimitedFetch);
}
