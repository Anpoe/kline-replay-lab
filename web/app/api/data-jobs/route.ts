import { ensureSchema, getRawDb } from "../../../db/runtime";
import type { MarketDataProviderId, SupportedTimeframe } from "../../lib/marketDataProviders";

type DownloadJobInput = {
  provider?: MarketDataProviderId;
  instrumentId?: string;
  vendorSymbol?: string;
  instrumentName?: string;
  market?: string;
  timeframe?: SupportedTimeframe;
  startDate?: string;
  endDate?: string;
};

const providers = new Set(["tushare", "alpaca"]);
const timeframes = new Set(["5m", "1h", "1d", "1w"]);

export async function GET(request: Request) {
  await ensureSchema();
  const market = new URL(request.url).searchParams.get("market");
  const db = getRawDb();
  const statement = db
    .prepare(`SELECT id, provider, instrument_id AS instrumentId, vendor_symbol AS vendorSymbol,
      instrument_name AS instrumentName, market, timeframe, start_date AS startDate,
      end_date AS endDate, adjustment_type AS adjustmentType, status,
      cursor_json AS cursorJson, inserted_count AS insertedCount,
      quality_report_json AS qualityReportJson, last_error AS lastError,
      created_at AS createdAt, updated_at AS updatedAt
      FROM data_download_jobs ${market ? "WHERE market = ?" : ""}
      ORDER BY updated_at DESC LIMIT 100`);
  const rows = market ? await statement.bind(market).all() : await statement.all();
  const summaryStatement = db.prepare(`WITH instrument_status AS (
      SELECT instrument_id,
        MAX(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS has_completed,
        MAX(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS has_queued,
        MAX(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS has_running,
        MAX(CASE WHEN status = 'paused' THEN 1 ELSE 0 END) AS has_paused,
        MAX(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS has_failed,
        SUM(inserted_count) AS inserted_count
      FROM data_download_jobs ${market ? "WHERE market = ?" : ""}
      GROUP BY instrument_id
    )
    SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN has_completed = 0 AND has_queued = 1 THEN 1 ELSE 0 END), 0) AS queued,
      COALESCE(SUM(CASE WHEN has_completed = 0 AND has_running = 1 THEN 1 ELSE 0 END), 0) AS running,
      COALESCE(SUM(CASE WHEN has_completed = 0 AND has_paused = 1 THEN 1 ELSE 0 END), 0) AS paused,
      COALESCE(SUM(has_completed), 0) AS completed,
      COALESCE(SUM(CASE WHEN has_completed = 0 AND has_failed = 1 THEN 1 ELSE 0 END), 0) AS failed,
      COALESCE(SUM(inserted_count), 0) AS insertedCount
    FROM instrument_status`);
  const summary = market
    ? await summaryStatement.bind(market).first()
    : await summaryStatement.first();
  return Response.json({ jobs: rows.results, summary });
}

export async function POST(request: Request) {
  await ensureSchema();
  const payload = await request.json() as DownloadJobInput;
  if (
    !payload.provider
    || !providers.has(payload.provider)
    || !payload.instrumentId
    || !payload.vendorSymbol
    || !payload.instrumentName
    || !payload.market
    || !payload.timeframe
    || !timeframes.has(payload.timeframe)
    || !payload.startDate
    || !payload.endDate
  ) {
    return Response.json({ error: "下载任务参数不完整" }, { status: 400 });
  }
  if (payload.endDate < payload.startDate) {
    return Response.json({ error: "结束日期不能早于开始日期" }, { status: 400 });
  }
  if (payload.provider === "tushare" && payload.market !== "CN") {
    return Response.json({ error: "Tushare 下载任务当前只用于 A 股" }, { status: 400 });
  }
  if (payload.provider === "alpaca" && payload.market !== "US") {
    return Response.json({ error: "Alpaca 下载任务当前只用于美股" }, { status: 400 });
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await getRawDb()
    .prepare(`INSERT INTO data_download_jobs
      (id, provider, instrument_id, vendor_symbol, instrument_name, market, timeframe,
       start_date, end_date, adjustment_type, status, cursor_json, inserted_count,
       quality_report_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'none', 'queued', '{}', 0, '{}', ?, ?)`)
    .bind(
      id,
      payload.provider,
      payload.instrumentId,
      payload.vendorSymbol,
      payload.instrumentName,
      payload.market,
      payload.timeframe,
      payload.startDate,
      payload.endDate,
      now,
      now,
    )
    .run();
  return Response.json({ id, status: "queued" }, { status: 201 });
}

export async function PATCH(request: Request) {
  await ensureSchema();
  const payload = await request.json() as { id?: string; action?: "pause" | "resume" | "retry" };
  if (!payload.id || !payload.action) {
    return Response.json({ error: "缺少任务 ID 或操作" }, { status: 400 });
  }
  const status = payload.action === "pause" ? "paused" : "queued";
  const resetError = payload.action === "retry";
  const result = await getRawDb()
    .prepare(`UPDATE data_download_jobs SET status = ?, last_error = ${resetError ? "NULL" : "last_error"},
      updated_at = ? WHERE id = ?`)
    .bind(status, new Date().toISOString(), payload.id)
    .run();
  if (!result.meta.changes) return Response.json({ error: "下载任务不存在" }, { status: 404 });
  return Response.json({ id: payload.id, status });
}

export async function DELETE(request: Request) {
  await ensureSchema();
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "缺少下载任务 ID" }, { status: 400 });
  await getRawDb().prepare("DELETE FROM data_download_jobs WHERE id = ?").bind(id).run();
  return Response.json({ id, deleted: true });
}
