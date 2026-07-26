import { ensureSchema, getRawDb } from "../../../db/runtime";
import { computeSnapshotDelta, type SnapshotCandle } from "../../lib/dataSnapshots";
import { readLocalDataJson } from "../../lib/localDataService";

type CandleRow = SnapshotCandle;

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
  baseSnapshotId: string | null;
  storageMode: "full" | "delta";
  removedTimestampsJson: string;
  chainDepth: number;
  storedBarCount: number;
};

const snapshotColumns = `id, content_hash AS contentHash, instrument_id AS instrumentId,
  timeframe, adjustment_type AS adjustmentType, instrument_json AS instrumentJson,
  candles_json AS candlesJson, bar_count AS barCount,
  first_timestamp AS firstTimestamp, last_timestamp AS lastTimestamp,
  created_at AS createdAt, base_snapshot_id AS baseSnapshotId,
  storage_mode AS storageMode, removed_timestamps_json AS removedTimestampsJson,
  chain_depth AS chainDepth, stored_bar_count AS storedBarCount`;

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function getSnapshotRow(db: D1Database, id: string) {
  return db.prepare(`SELECT ${snapshotColumns} FROM data_snapshots WHERE id = ?`)
    .bind(id)
    .first<SnapshotRow>();
}

async function materializeCandles(db: D1Database, row: SnapshotRow, visited = new Set<string>()): Promise<CandleRow[]> {
  if (visited.has(row.id)) throw new Error("数据快照链出现循环引用");
  visited.add(row.id);
  const stored = JSON.parse(row.candlesJson) as CandleRow[];
  if (row.storageMode !== "delta" || !row.baseSnapshotId) {
    return stored.sort((left, right) => left.timestamp - right.timestamp);
  }
  const base = await getSnapshotRow(db, row.baseSnapshotId);
  if (!base) throw new Error(`数据快照缺少基础版本 ${row.baseSnapshotId}`);
  const merged = new Map((await materializeCandles(db, base, visited)).map((candle) => [candle.timestamp, candle]));
  const removed = JSON.parse(row.removedTimestampsJson || "[]") as number[];
  removed.forEach((timestamp) => merged.delete(timestamp));
  stored.forEach((candle) => merged.set(candle.timestamp, candle));
  return [...merged.values()].sort((left, right) => left.timestamp - right.timestamp);
}

async function snapshotResponse(db: D1Database, row: SnapshotRow) {
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
    },
    instrument: JSON.parse(row.instrumentJson),
    candles: await materializeCandles(db, row),
  };
}

export async function GET(request: Request) {
  await ensureSchema();
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "缺少数据快照 ID" }, { status: 400 });
  const db = getRawDb();
  const row = await getSnapshotRow(db, id);
  if (!row) return Response.json({ error: "数据快照不存在" }, { status: 404 });
  try {
    return Response.json(await snapshotResponse(db, row));
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
    .first();
  const candlesResult = await db
    .prepare(`SELECT timestamp, open, high, low, close, volume, turnover
      FROM candles WHERE instrument_id = ? AND timeframe = ? AND adjustment_type = ?
      ORDER BY timestamp ASC`)
    .bind(payload.instrumentId, payload.timeframe, adjustmentType)
    .all<CandleRow>();
  let candles = candlesResult.results;
  if (!instrument || candles.length === 0) {
    const local = await readLocalDataJson<{
      instrument: Record<string, unknown>;
      candles: CandleRow[];
    }>(`/candles?instrument=${encodeURIComponent(payload.instrumentId)}&timeframe=${encodeURIComponent(payload.timeframe)}`, 15000);
    if (local) {
      instrument = local.instrument;
      candles = local.candles;
    }
  }
  if (!instrument || candles.length === 0) {
    return Response.json({ error: "没有可创建快照的 K 线数据" }, { status: 404 });
  }

  const instrumentJson = JSON.stringify(instrument);
  const canonical = JSON.stringify({
    instrument,
    timeframe: payload.timeframe,
    adjustmentType,
    candles,
  });
  const contentHash = await sha256(canonical);
  const id = `snapshot_${contentHash}`;
  const existing = await db
    .prepare(`SELECT ${snapshotColumns} FROM data_snapshots WHERE content_hash = ?`)
    .bind(contentHash)
    .first<SnapshotRow>();
  if (existing) return Response.json(await snapshotResponse(db, existing));

  const latest = await db
    .prepare(`SELECT ${snapshotColumns} FROM data_snapshots
      WHERE instrument_id = ? AND timeframe = ? AND adjustment_type = ?
      ORDER BY created_at DESC LIMIT 1`)
    .bind(payload.instrumentId, payload.timeframe, adjustmentType)
    .first<SnapshotRow>();

  let storageMode: SnapshotRow["storageMode"] = "full";
  let baseSnapshotId: string | null = null;
  let storedCandles = candles;
  let removedTimestamps: number[] = [];
  let chainDepth = 0;

  if (latest && latest.chainDepth < 19) {
    const previousCandles = await materializeCandles(db, latest);
    const delta = computeSnapshotDelta(previousCandles, candles);
    removedTimestamps = delta.removedTimestamps;
    if (delta.changedCandles.length + removedTimestamps.length < candles.length * 0.7) {
      storageMode = "delta";
      baseSnapshotId = latest.id;
      storedCandles = delta.changedCandles;
      chainDepth = latest.chainDepth + 1;
    }
  }

  const firstTimestamp = Number(candles[0].timestamp);
  const lastTimestamp = Number(candles[candles.length - 1].timestamp);
  const createdAt = new Date().toISOString();
  await db.prepare(`INSERT INTO data_snapshots
    (id, content_hash, instrument_id, timeframe, adjustment_type, instrument_json,
      candles_json, bar_count, first_timestamp, last_timestamp, created_at,
      base_snapshot_id, storage_mode, removed_timestamps_json, chain_depth, stored_bar_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      id,
      contentHash,
      payload.instrumentId,
      payload.timeframe,
      adjustmentType,
      instrumentJson,
      JSON.stringify(storedCandles),
      candles.length,
      firstTimestamp,
      lastTimestamp,
      createdAt,
      baseSnapshotId,
      storageMode,
      JSON.stringify(removedTimestamps),
      chainDepth,
      storedCandles.length,
    )
    .run();

  const created = await getSnapshotRow(db, id);
  if (!created) return Response.json({ error: "数据快照创建失败" }, { status: 500 });
  return Response.json(await snapshotResponse(db, created), { status: 201 });
}
