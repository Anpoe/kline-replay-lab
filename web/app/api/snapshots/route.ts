import { ensureSchema, getRawDb } from "../../../db/runtime";
import type { SnapshotCandle } from "../../lib/dataSnapshots";
import { readLocalDataJson } from "../../lib/localDataService";
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

function d1SourceMetadata(candles: SourceCoverageRow[]) {
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
  const candlesResult = await db
    .prepare(`SELECT timestamp, open, high, low, close, volume, turnover, source
      FROM candles WHERE instrument_id = ? AND timeframe = ? AND adjustment_type = ?
      ORDER BY timestamp ASC`)
    .bind(payload.instrumentId, payload.timeframe, adjustmentType)
    .all<SourceCoverageRow>();
  const d1Candles = candlesResult.results;
  let candles: SnapshotCandle[] = d1Candles;
  let sourceMetadata: unknown = null;

  if (instrument && d1Candles.length) {
    sourceMetadata = d1SourceMetadata(d1Candles);
  } else {
    const local = await readLocalDataJson<LocalCandleResponse>(
      `/candles?instrument=${encodeURIComponent(payload.instrumentId)}&timeframe=${encodeURIComponent(payload.timeframe)}`,
      15000,
    );
    if (local?.instrument && local.candles?.length) {
      instrument = local.instrument;
      candles = local.candles;
      sourceMetadata = {
        kind: "local",
        source: local.source ?? "local-data-service",
        datasetVersion: local.datasetVersion ?? null,
      };
    }
  }
  if (!instrument || candles.length === 0) {
    return Response.json({ error: "没有可创建快照的 K 线数据" }, { status: 404 });
  }

  let id: string | null = null;
  try {
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
    if (ready) return Response.json(await snapshotResponse(db, ready));

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
    if (existing.status === "ready") return Response.json(await snapshotResponse(db, existing));
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
    return Response.json(await snapshotResponse(db, created), { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "数据快照创建失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
