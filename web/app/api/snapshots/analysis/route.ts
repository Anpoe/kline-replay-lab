import { ensureSchema, getRawDb } from "../../../../db/runtime";
import type { SnapshotCandle } from "../../../lib/dataSnapshots";
import { tradingDate } from "../../../lib/marketRules";
import {
  getSnapshotRow,
  materializeSnapshotCandleWindow,
  type SnapshotRow,
} from "../../../lib/snapshotStorage";

type AnalysisCandle = Pick<SnapshotCandle, "timestamp" | "close" | "volume">;

function finitePositive(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function averageDailyActivity(
  candles: AnalysisCandle[],
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

async function readAnalysisCandles(
  db: ReturnType<typeof getRawDb>,
  row: SnapshotRow,
  entryTimestamps: number[],
  timezone: string,
) {
  const earliestEntry = Math.min(...entryTimestamps);
  const latestEntry = Math.max(...entryTimestamps);
  let lookbackMilliseconds = 40 * 86_400_000;
  let candles: SnapshotCandle[] = [];

  for (let attempt = 0; attempt < 32; attempt += 1) {
    const window = await materializeSnapshotCandleWindow(db, row, {
      startTimestamp: Math.max(Number(row.firstTimestamp), earliestEntry - lookbackMilliseconds),
      endTimestamp: latestEntry,
    });
    candles = window.candles;
    const priorSessions = new Set(
      candles
        .filter((candle) => candle.timestamp < earliestEntry)
        .map((candle) => tradingDate(candle.timestamp, timezone)),
    );
    if (priorSessions.size >= 20 || window.startIndex === 0) return candles;
    lookbackMilliseconds *= 2;
  }
  return candles;
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
      const entryTimestamps = [...new Set(item.entryTimestamps ?? [])];
      const candles = await readAnalysisCandles(db, row, entryTimestamps, timezone);
      contexts[snapshotId] = {};
      entryTimestamps.forEach((entryTimestamp) => {
        contexts[snapshotId][String(entryTimestamp)] = {
          ...averageDailyActivity(candles, entryTimestamp, timezone, row.timeframe),
          ...(marketCap ? { marketCap } : {}),
        };
      });
    } catch {
      // A damaged or incomplete legacy snapshot should not block the rest of the performance page.
    }
  }
  return Response.json({ contexts });
}
