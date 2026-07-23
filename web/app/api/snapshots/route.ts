import { ensureSchema, getRawDb } from "../../../db/runtime";

type SnapshotRow = {
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
};

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function snapshotResponse(row: SnapshotRow) {
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
    },
    instrument: JSON.parse(row.instrumentJson),
    candles: JSON.parse(row.candlesJson),
  };
}

export async function GET(request: Request) {
  await ensureSchema();
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "缺少数据快照 ID" }, { status: 400 });
  const row = await getRawDb()
    .prepare(`SELECT id, content_hash AS contentHash, instrument_id AS instrumentId,
      timeframe, adjustment_type AS adjustmentType, instrument_json AS instrumentJson,
      candles_json AS candlesJson, bar_count AS barCount,
      first_timestamp AS firstTimestamp, last_timestamp AS lastTimestamp,
      created_at AS createdAt
      FROM data_snapshots WHERE id = ?`)
    .bind(id)
    .first<SnapshotRow>();
  if (!row) return Response.json({ error: "数据快照不存在" }, { status: 404 });
  return Response.json(snapshotResponse(row));
}

export async function POST(request: Request) {
  await ensureSchema();
  const payload = (await request.json()) as {
    instrumentId?: string;
    timeframe?: string;
    adjustmentType?: string;
  };
  if (!payload.instrumentId || !payload.timeframe) {
    return Response.json({ error: "缺少品种或周期" }, { status: 400 });
  }

  const adjustmentType = payload.adjustmentType ?? "none";
  const db = getRawDb();
  const instrument = await db
    .prepare(`SELECT id, symbol, name, market, timezone, price_precision AS pricePrecision
      FROM instruments WHERE id = ?`)
    .bind(payload.instrumentId)
    .first();
  const candles = await db
    .prepare(`SELECT timestamp, open, high, low, close, volume, turnover
      FROM candles WHERE instrument_id = ? AND timeframe = ? AND adjustment_type = ?
      ORDER BY timestamp ASC`)
    .bind(payload.instrumentId, payload.timeframe, adjustmentType)
    .all();
  if (!instrument || candles.results.length === 0) {
    return Response.json({ error: "没有可创建快照的 K 线数据" }, { status: 404 });
  }

  const instrumentJson = JSON.stringify(instrument);
  const candlesJson = JSON.stringify(candles.results);
  const canonical = JSON.stringify({
    instrument,
    timeframe: payload.timeframe,
    adjustmentType,
    candles: candles.results,
  });
  const contentHash = await sha256(canonical);
  const id = `snapshot_${contentHash}`;
  const existing = await db
    .prepare(`SELECT id, content_hash AS contentHash, instrument_id AS instrumentId,
      timeframe, adjustment_type AS adjustmentType, instrument_json AS instrumentJson,
      candles_json AS candlesJson, bar_count AS barCount,
      first_timestamp AS firstTimestamp, last_timestamp AS lastTimestamp,
      created_at AS createdAt FROM data_snapshots WHERE content_hash = ?`)
    .bind(contentHash)
    .first<SnapshotRow>();
  if (existing) return Response.json(snapshotResponse(existing));

  const firstTimestamp = Number((candles.results[0] as { timestamp: number }).timestamp);
  const lastTimestamp = Number((candles.results[candles.results.length - 1] as { timestamp: number }).timestamp);
  const createdAt = new Date().toISOString();
  await db.prepare(`INSERT INTO data_snapshots
    (id, content_hash, instrument_id, timeframe, adjustment_type, instrument_json,
      candles_json, bar_count, first_timestamp, last_timestamp, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      id,
      contentHash,
      payload.instrumentId,
      payload.timeframe,
      adjustmentType,
      instrumentJson,
      candlesJson,
      candles.results.length,
      firstTimestamp,
      lastTimestamp,
      createdAt,
    )
    .run();

  return Response.json({
    snapshot: {
      id,
      contentHash,
      instrumentId: payload.instrumentId,
      timeframe: payload.timeframe,
      adjustmentType,
      barCount: candles.results.length,
      firstTimestamp,
      lastTimestamp,
      createdAt,
    },
    instrument,
    candles: candles.results,
  }, { status: 201 });
}
