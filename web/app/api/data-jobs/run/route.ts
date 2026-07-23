import { ensureSchema, getRawDb } from "../../../../db/runtime";
import {
  fetchProviderChunk,
  type MarketDataProviderId,
  type ProviderCursor,
  type QualityReport,
  type SupportedTimeframe,
} from "../../../lib/marketDataProviders";
import { loadProviderSecrets } from "../../../lib/providerCredentials";

type DownloadJobRow = {
  id: string;
  provider: MarketDataProviderId;
  instrumentId: string;
  vendorSymbol: string;
  instrumentName: string;
  market: string;
  timeframe: SupportedTimeframe;
  startDate: string;
  endDate: string;
  adjustmentType: string;
  status: string;
  cursorJson: string;
  insertedCount: number;
  qualityReportJson: string;
};

function mergeQuality(previous: Partial<QualityReport>, current: QualityReport): QualityReport {
  const firstTimestamps = [previous.firstTimestamp, current.firstTimestamp]
    .filter((value): value is number => Number.isFinite(value));
  const lastTimestamps = [previous.lastTimestamp, current.lastTimestamp]
    .filter((value): value is number => Number.isFinite(value));
  return {
    received: (previous.received ?? 0) + current.received,
    accepted: (previous.accepted ?? 0) + current.accepted,
    invalid: (previous.invalid ?? 0) + current.invalid,
    duplicates: (previous.duplicates ?? 0) + current.duplicates,
    ...(firstTimestamps.length ? { firstTimestamp: Math.min(...firstTimestamps) } : {}),
    ...(lastTimestamps.length ? { lastTimestamp: Math.max(...lastTimestamps) } : {}),
  };
}

export async function POST(request: Request) {
  await ensureSchema();
  const payload = await request.json() as { id?: string };
  if (!payload.id) return Response.json({ error: "缺少下载任务 ID" }, { status: 400 });
  const db = getRawDb();
  const job = await db
    .prepare(`SELECT id, provider, instrument_id AS instrumentId, vendor_symbol AS vendorSymbol,
      instrument_name AS instrumentName, market, timeframe, start_date AS startDate,
      end_date AS endDate, adjustment_type AS adjustmentType, status,
      cursor_json AS cursorJson, inserted_count AS insertedCount,
      quality_report_json AS qualityReportJson
      FROM data_download_jobs WHERE id = ?`)
    .bind(payload.id)
    .first<DownloadJobRow>();
  if (!job) return Response.json({ error: "下载任务不存在" }, { status: 404 });
  if (job.status === "paused") return Response.json({ id: job.id, status: "paused" });
  if (job.status === "completed") return Response.json({ id: job.id, status: "completed", complete: true });

  await db.prepare("UPDATE data_download_jobs SET status = 'running', updated_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), job.id)
    .run();

  try {
    const { secrets } = await loadProviderSecrets();
    const chunk = await fetchProviderChunk({
      provider: job.provider,
      vendorSymbol: job.vendorSymbol,
      timeframe: job.timeframe,
      startDate: job.startDate,
      endDate: job.endDate,
      cursor: JSON.parse(job.cursorJson || "{}") as ProviderCursor,
    }, secrets);

    await db.prepare(`INSERT INTO instruments
      (id, symbol, name, market, timezone, price_precision)
      VALUES (?, ?, ?, ?, ?, 2)
      ON CONFLICT(id) DO UPDATE SET symbol = excluded.symbol, name = excluded.name,
      market = excluded.market, timezone = excluded.timezone`)
      .bind(
        job.instrumentId,
        job.vendorSymbol,
        job.instrumentName,
        job.market,
        job.market === "CN" ? "Asia/Shanghai" : "America/New_York",
      )
      .run();

    if (Number(job.insertedCount) === 0 && chunk.candles.length > 0) {
      await db.prepare(`DELETE FROM candles
        WHERE instrument_id = ? AND timeframe = ? AND adjustment_type = ? AND source = 'sample'`)
        .bind(job.instrumentId, job.timeframe, job.adjustmentType)
        .run();
    }

    const statements = chunk.candles.map((bar) => db.prepare(`INSERT OR REPLACE INTO candles
      (instrument_id, timeframe, timestamp, open, high, low, close, volume, turnover,
       adjustment_type, source, quality_flags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]')`)
      .bind(
        job.instrumentId,
        job.timeframe,
        bar.timestamp,
        bar.open,
        bar.high,
        bar.low,
        bar.close,
        bar.volume,
        bar.turnover,
        job.adjustmentType,
        chunk.source,
      ));
    for (let index = 0; index < statements.length; index += 80) {
      await db.batch(statements.slice(index, index + 80));
    }

    const priorQuality = JSON.parse(job.qualityReportJson || "{}") as Partial<QualityReport>;
    const quality = mergeQuality(priorQuality, chunk.quality);
    const latest = await db
      .prepare("SELECT status FROM data_download_jobs WHERE id = ?")
      .bind(job.id)
      .first<{ status: string }>();
    const status = latest?.status === "paused" ? "paused" : chunk.complete ? "completed" : "queued";
    const insertedCount = Number(job.insertedCount) + chunk.candles.length;
    await db.prepare(`UPDATE data_download_jobs SET status = ?, cursor_json = ?,
      inserted_count = ?, quality_report_json = ?, last_error = NULL, updated_at = ? WHERE id = ?`)
      .bind(
        status,
        JSON.stringify(chunk.cursor),
        insertedCount,
        JSON.stringify(quality),
        new Date().toISOString(),
        job.id,
      )
      .run();
    return Response.json({
      id: job.id,
      status,
      complete: chunk.complete,
      insertedThisChunk: chunk.candles.length,
      insertedCount,
      quality,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "下载失败";
    await db.prepare(`UPDATE data_download_jobs SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?`)
      .bind(message, new Date().toISOString(), job.id)
      .run();
    return Response.json({ id: job.id, status: "failed", error: message }, { status: 502 });
  }
}
