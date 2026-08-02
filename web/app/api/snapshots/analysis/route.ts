import { ensureSchema, getRawDb } from "../../../../db/runtime";
import { tradingDate } from "../../../lib/marketRules";

type CandleRow = {
  timestamp: number;
  close: number;
  volume?: number | null;
};

type SnapshotRow = {
  id: string;
  timeframe: string;
  instrumentJson: string;
  candlesJson: string;
  baseSnapshotId: string | null;
  storageMode: "full" | "delta";
  removedTimestampsJson: string;
};

const snapshotColumns = `id, timeframe, instrument_json AS instrumentJson,
  candles_json AS candlesJson, base_snapshot_id AS baseSnapshotId,
  storage_mode AS storageMode, removed_timestamps_json AS removedTimestampsJson`;

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

function finitePositive(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function averageDailyActivity(
  candles: CandleRow[],
  entryTimestamp: number,
  timezone: string,
  timeframe: string,
) {
  let entryIndex = candles.findIndex((candle) => candle.timestamp >= entryTimestamp);
  if (entryIndex < 0) entryIndex = candles.length;
  const sessions = new Map<string, { volume: number; turnover: number }>();
  for (let index = entryIndex - 1; index >= 0; index -= 1) {
    const candle = candles[index];
    const session = tradingDate(candle.timestamp, timezone);
    if (!sessions.has(session) && sessions.size >= 20) break;
    const volume = Math.max(0, Number(candle.volume) || 0);
    const current = sessions.get(session) ?? { volume: 0, turnover: 0 };
    current.volume += volume;
    current.turnover += volume * Math.max(0, Number(candle.close) || 0);
    sessions.set(session, current);
  }
  if (sessions.size < 5) return {};
  const weeklyDivisor = timeframe === "1w" ? 5 : 1;
  const totals = [...sessions.values()].reduce((sum, session) => ({
    volume: sum.volume + session.volume,
    turnover: sum.turnover + session.turnover,
  }), { volume: 0, turnover: 0 });
  return {
    averageDailyVolume: totals.volume / sessions.size / weeklyDivisor,
    averageDailyTurnover: totals.turnover / sessions.size / weeklyDivisor,
  };
}

export async function POST(request: Request) {
  await ensureSchema();
  const payload = await request.json() as {
    items?: Array<{ snapshotId?: string; entryTimestamps?: number[] }>;
  };
  const items = (payload.items ?? [])
    .filter((item) => item.snapshotId && item.entryTimestamps?.length)
    .slice(0, 250);
  const db = getRawDb();
  const contexts: Record<string, Record<string, {
    averageDailyVolume?: number;
    averageDailyTurnover?: number;
    marketCap?: number;
  }>> = {};

  for (const item of items) {
    const snapshotId = item.snapshotId!;
    const row = await getSnapshotRow(db, snapshotId);
    if (!row) continue;
    try {
      const instrument = JSON.parse(row.instrumentJson) as Record<string, unknown>;
      const timezone = typeof instrument.timezone === "string" ? instrument.timezone : "America/New_York";
      const marketCap = finitePositive(
        instrument.marketCap ?? instrument.market_cap ?? instrument.marketCapitalization ?? instrument.floatMarketCap,
      );
      const candles = await materializeCandles(db, row);
      contexts[snapshotId] = {};
      [...new Set(item.entryTimestamps ?? [])].forEach((entryTimestamp) => {
        contexts[snapshotId][String(entryTimestamp)] = {
          ...averageDailyActivity(candles, entryTimestamp, timezone, row.timeframe),
          ...(marketCap ? { marketCap } : {}),
        };
      });
    } catch {
      // A damaged legacy snapshot should not block the rest of the performance page.
    }
  }
  return Response.json({ contexts });
}
