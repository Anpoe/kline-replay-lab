import { ensureSchema, getRawDb } from "../../../../db/runtime";
import { loadProviderSecrets } from "../../../lib/providerCredentials";
import {
  filterTradableUsAssets,
  type AlpacaAsset,
} from "../../../lib/marketDataProviders";
import {
  latestClosedUsSession,
  newYorkDate,
  type AlpacaCalendarDay,
} from "../../../lib/usMarketSessions";

type MarketInstrumentRow = {
  id: string;
  symbol: string;
  name: string;
  lastAlpacaTimestamp: number | null;
};

type ActiveJobRow = {
  id: string;
  instrumentId: string;
  hasAlpacaCoverage: number;
};

function dateAfter(timestamp: number) {
  const date = new Date(timestamp);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function dateOffset(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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
      // Fall back to the previous weekday if Alpaca's calendar is temporarily unavailable.
    }
  }
  return latestClosedUsSession([]);
}

async function loadAlpacaAssets(keyId: string, secretKey: string) {
  const headers = {
    "APCA-API-KEY-ID": keyId,
    "APCA-API-SECRET-KEY": secretKey,
  };
  let lastMessage = "Alpaca 品种目录请求失败";
  for (const origin of ["https://paper-api.alpaca.markets", "https://api.alpaca.markets"]) {
    const response = await fetch(`${origin}/v2/assets?status=active&asset_class=us_equity`, { headers });
    if (response.ok) return await response.json() as AlpacaAsset[];
    const payload = await response.json().catch(() => ({})) as { message?: string };
    lastMessage = payload.message || `${lastMessage}：HTTP ${response.status}`;
  }
  throw new Error(lastMessage);
}

export async function POST(request: Request) {
  await ensureSchema();
  const payload = await request.json() as {
    market?: string;
    mode?: "initialize" | "update";
    instrumentIds?: string[];
  };
  if (payload.market !== "US") {
    return Response.json({ error: "当前批量目录初始化仅支持美股" }, { status: 400 });
  }

  const { secrets } = await loadProviderSecrets();
  if (!secrets.alpacaKeyId || !secrets.alpacaSecretKey) {
    return Response.json({ error: "请先在“设置 → 数据源设置”配置 Alpaca 免费账户密钥" }, { status: 400 });
  }

  const db = getRawDb();
  const requestedInstrumentIds = Array.isArray(payload.instrumentIds)
    ? [...new Set(payload.instrumentIds.map((value) => String(value).trim()).filter(Boolean))].slice(0, 500)
    : null;
  if (requestedInstrumentIds && !requestedInstrumentIds.length) {
    return Response.json({
      market: "US",
      mode: payload.mode ?? "update",
      catalogCount: 0,
      instrumentCount: 0,
      resumedJobs: 0,
      createdJobs: 0,
      jobIds: [],
    }, { status: 201 });
  }
  let catalogCount = 0;
  if (payload.mode === "initialize") {
    try {
      const assets = filterTradableUsAssets(
        await loadAlpacaAssets(secrets.alpacaKeyId, secrets.alpacaSecretKey),
      );
      const now = new Date().toISOString();
      for (let index = 0; index < assets.length; index += 80) {
        const statements = assets.slice(index, index + 80).map((asset) => {
          const symbol = String(asset.symbol).trim().toUpperCase();
          return db.prepare(`INSERT INTO instruments
            (id, symbol, name, market, timezone, price_precision)
            VALUES (?, ?, ?, 'US', 'America/New_York', 4)
            ON CONFLICT(id) DO UPDATE SET symbol = excluded.symbol, name = excluded.name,
            market = excluded.market, timezone = excluded.timezone`)
            .bind(symbol, symbol, String(asset.name || symbol).trim());
        });
        await db.batch(statements);
      }
      catalogCount = assets.length;
      await db.prepare("INSERT OR REPLACE INTO app_metadata (key, value) VALUES ('us_catalog_updated_at', ?)")
        .bind(now)
        .run();
    } catch (error) {
      return Response.json({
        error: error instanceof Error ? error.message : "美股目录初始化失败",
      }, { status: 502 });
    }
  }

  const instrumentScope = requestedInstrumentIds
    ? ` AND i.id IN (${requestedInstrumentIds.map(() => "?").join(",")})`
    : "";
  const instrumentQuery = db.prepare(`SELECT i.id, i.symbol, i.name,
    MAX(CASE WHEN c.timeframe = '1d' AND c.source IN ('alpaca-sip', 'alpaca-iex') THEN c.last_timestamp END) AS lastAlpacaTimestamp
    FROM instruments i
    LEFT JOIN candle_coverage c ON c.instrument_id = i.id
    WHERE i.market = 'US'${instrumentScope}
    GROUP BY i.id, i.symbol, i.name
    ORDER BY i.symbol`);
  const instruments = requestedInstrumentIds
    ? await instrumentQuery.bind(...requestedInstrumentIds).all<MarketInstrumentRow>()
    : await instrumentQuery.all<MarketInstrumentRow>();
  if (!instruments.results.length) {
    return Response.json({ error: "美股品种目录为空，请先执行市场初始化" }, { status: 400 });
  }

  const jobScope = requestedInstrumentIds
    ? ` AND j.instrument_id IN (${requestedInstrumentIds.map(() => "?").join(",")})`
    : "";
  const jobUpdateScope = requestedInstrumentIds
    ? ` AND instrument_id IN (${requestedInstrumentIds.map(() => "?").join(",")})`
    : "";
  const activeJobQuery = db.prepare(`SELECT j.id, j.instrument_id AS instrumentId,
      EXISTS(SELECT 1 FROM candle_coverage c
        WHERE c.instrument_id = j.instrument_id AND c.timeframe = j.timeframe
          AND c.adjustment_type = j.adjustment_type AND c.source IN ('alpaca-sip', 'alpaca-iex')) AS hasAlpacaCoverage
    FROM data_download_jobs j
    WHERE j.market = 'US' AND j.timeframe = '1d'
      AND status IN ('queued', 'running', 'paused', 'failed')${jobScope}
    ORDER BY j.created_at ASC, j.instrument_id ASC`)
  const activeJobs = requestedInstrumentIds
    ? await activeJobQuery.bind(...requestedInstrumentIds).all<{ id: string; instrumentId: string; hasAlpacaCoverage: number }>()
    : await activeJobQuery.all<{ id: string; instrumentId: string; hasAlpacaCoverage: number }>();
  const activeJobRows = activeJobs.results as ActiveJobRow[];
  const legacyActiveJobs = activeJobRows.filter((job) => !job.hasAlpacaCoverage);
  for (let index = 0; index < legacyActiveJobs.length; index += 80) {
    const statements = legacyActiveJobs.slice(index, index + 80).map((job) => db.prepare(`UPDATE data_download_jobs
      SET start_date = '2016-01-01', cursor_json = '{}', inserted_count = 0,
        quality_report_json = '{}', status = 'queued', last_error = NULL, updated_at = ?
      WHERE id = ?`).bind(new Date().toISOString(), job.id));
    if (statements.length) await db.batch(statements);
  }
  const activeByInstrument = new Map(activeJobRows.map((job) => [job.instrumentId, job.id]));
  const resumeOnly = activeJobRows.length > 0;
  const endDate = await loadLatestClosedUsSession(
    secrets.alpacaKeyId,
    secrets.alpacaSecretKey,
  );
  const now = new Date().toISOString();
  // Extend unfinished jobs when a new session becomes available. This also
  // repairs jobs created before the calendar cutoff was corrected.
  const extendJobsQuery = db.prepare(`UPDATE data_download_jobs SET
      end_date = CASE WHEN end_date < ? THEN ? ELSE end_date END,
      status = CASE WHEN status IN ('paused', 'failed') THEN 'queued' ELSE status END,
      last_error = CASE WHEN status IN ('paused', 'failed') THEN NULL ELSE last_error END,
      updated_at = ?
    WHERE market = 'US' AND timeframe = '1d'
      AND status IN ('queued', 'running', 'paused', 'failed')${jobUpdateScope}`);
  if (requestedInstrumentIds) {
    await extendJobsQuery.bind(endDate, endDate, now, ...requestedInstrumentIds).run();
  } else {
    await extendJobsQuery.bind(endDate, endDate, now).run();
  }
  // Resume unfinished initialization jobs before checking already-downloaded symbols.
  const jobIds: string[] = activeJobRows.map((job) => job.id);
  let createdJobs = 0;
  for (let index = 0; index < instruments.results.length; index += 80) {
    const statements = [];
    for (const instrument of instruments.results.slice(index, index + 80)) {
      const existingId = activeByInstrument.get(instrument.id);
      if (existingId) continue;
      // Continue from whichever Alpaca feed last supplied coverage. When SIP
      // is unavailable for recent data, the provider falls back to IEX;
      // immutable training snapshots remain untouched.
      const startDate = instrument.lastAlpacaTimestamp
        ? dateAfter(Number(instrument.lastAlpacaTimestamp))
        : "2016-01-01";
      if (startDate > endDate) continue;
      const id = crypto.randomUUID();
      jobIds.push(id);
      statements.push(db.prepare(`INSERT INTO data_download_jobs
        (id, provider, instrument_id, vendor_symbol, instrument_name, market, timeframe,
         start_date, end_date, adjustment_type, status, cursor_json, inserted_count,
         quality_report_json, created_at, updated_at)
        VALUES (?, 'alpaca', ?, ?, ?, 'US', '1d', ?, ?, 'none', 'queued', '{}', 0, '{}', ?, ?)`)
        .bind(
          id,
          instrument.id,
          instrument.symbol,
          instrument.name,
          startDate,
          endDate,
          now,
          now,
        ));
    }
    if (statements.length) {
      await db.batch(statements);
      createdJobs += statements.length;
    }
  }

  return Response.json({
    market: "US",
    mode: payload.mode ?? "update",
    catalogCount,
    instrumentCount: instruments.results.length,
    resumedJobs: resumeOnly ? activeJobRows.length : 0,
    createdJobs,
    jobIds,
  }, { status: 201 });
}
