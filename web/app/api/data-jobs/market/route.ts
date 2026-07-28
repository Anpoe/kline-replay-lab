import { ensureSchema, getRawDb } from "../../../../db/runtime";
import { loadProviderSecrets } from "../../../lib/providerCredentials";
import {
  filterTradableUsAssets,
  type AlpacaAsset,
} from "../../../lib/marketDataProviders";

type MarketInstrumentRow = {
  id: string;
  symbol: string;
  name: string;
  lastRealTimestamp: number | null;
  lastAttemptedDate: string | null;
};

type AlpacaCalendarDay = {
  date?: string;
};

function dateAfter(timestamp: number) {
  const date = new Date(timestamp);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function newYorkDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dateOffset(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function previousWeekday(value: string) {
  let date = dateOffset(value, -1);
  while ([0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay())) {
    date = dateOffset(date, -1);
  }
  return date;
}

async function loadLatestClosedUsSession(keyId: string, secretKey: string) {
  const today = newYorkDate();
  const fallback = previousWeekday(today);
  const headers = {
    "APCA-API-KEY-ID": keyId,
    "APCA-API-SECRET-KEY": secretKey,
  };
  for (const origin of ["https://paper-api.alpaca.markets", "https://api.alpaca.markets"]) {
    try {
      const response = await fetch(
        `${origin}/v2/calendar?start=${dateOffset(today, -16)}&end=${fallback}`,
        { headers },
      );
      if (!response.ok) continue;
      const calendar = await response.json() as AlpacaCalendarDay[];
      const dates = calendar
        .map((item) => String(item.date ?? ""))
        .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= fallback)
        .sort();
      if (dates.length) return dates.at(-1) as string;
    } catch {
      // Fall back to the previous weekday if Alpaca's calendar is temporarily unavailable.
    }
  }
  return fallback;
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
  };
  if (payload.market !== "US") {
    return Response.json({ error: "当前批量目录初始化仅支持美股" }, { status: 400 });
  }

  const { secrets } = await loadProviderSecrets();
  if (!secrets.alpacaKeyId || !secrets.alpacaSecretKey) {
    return Response.json({ error: "请先在“设置 → 数据源设置”配置 Alpaca 免费账户密钥" }, { status: 400 });
  }

  const db = getRawDb();
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

  const instruments = await db.prepare(`SELECT i.id, i.symbol, i.name,
    MAX(CASE WHEN c.timeframe = '1d' AND c.source <> 'sample' THEN c.last_timestamp END) AS lastRealTimestamp,
    (SELECT MAX(j.end_date) FROM data_download_jobs j
      WHERE j.instrument_id = i.id AND j.market = 'US' AND j.timeframe = '1d'
        AND j.status = 'completed') AS lastAttemptedDate
    FROM instruments i
    LEFT JOIN candle_coverage c ON c.instrument_id = i.id
    WHERE i.market = 'US'
    GROUP BY i.id, i.symbol, i.name
    ORDER BY i.symbol`)
    .all<MarketInstrumentRow>();
  if (!instruments.results.length) {
    return Response.json({ error: "美股品种目录为空，请先执行市场初始化" }, { status: 400 });
  }

  const activeJobs = await db.prepare(`SELECT id, instrument_id AS instrumentId
    FROM data_download_jobs
    WHERE market = 'US' AND timeframe = '1d'
      AND status IN ('queued', 'running', 'paused', 'failed')
    ORDER BY created_at ASC, instrument_id ASC`)
    .all<{ id: string; instrumentId: string }>();
  await db.prepare(`UPDATE data_download_jobs SET status = 'queued', updated_at = ?
    , last_error = NULL
    WHERE market = 'US' AND timeframe = '1d' AND status IN ('paused', 'failed')`)
    .bind(new Date().toISOString())
    .run();
  const activeByInstrument = new Map(activeJobs.results.map((job) => [job.instrumentId, job.id]));
  const resumeOnly = activeJobs.results.length > 0;
  const endDate = await loadLatestClosedUsSession(
    secrets.alpacaKeyId,
    secrets.alpacaSecretKey,
  );
  const now = new Date().toISOString();
  // Resume unfinished initialization jobs before checking already-downloaded symbols.
  const jobIds: string[] = activeJobs.results.map((job) => job.id);
  let createdJobs = 0;
  for (let index = 0; index < instruments.results.length; index += 80) {
    const statements = [];
    for (const instrument of instruments.results.slice(index, index + 80)) {
      const existingId = activeByInstrument.get(instrument.id);
      if (existingId || resumeOnly) continue;
      const startDate = instrument.lastRealTimestamp
        ? dateAfter(Number(instrument.lastRealTimestamp))
        : instrument.lastAttemptedDate
          ? dateOffset(instrument.lastAttemptedDate, 1)
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
    createdJobs,
    jobIds,
  }, { status: 201 });
}
