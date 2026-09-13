import { ensureSchema, getRawDb } from "../../../db/runtime";
import { fetchLocalData } from "../../lib/localDataService";
import { matchesPattern, normalizePatternPresets, type PatternCandle, type PatternPreset } from "../../lib/patternFilters";

type ScanFilters = {
  minPrice?: number;
  maxPrice?: number;
  minAverageVolume?: number;
  minAverageTurnover?: number;
  excludeLimitUp?: boolean;
};

type ScanRequest = {
  action?: "scan" | "refresh";
  market?: "CN" | "US";
  instrumentIds?: string[];
  /** Signal-day timestamps used to locate the simulated next-session fill. */
  entryAfter?: Record<string, number>;
  presetIds?: string[];
  presets?: PatternPreset[];
  filters?: ScanFilters;
  limit?: number;
  sort?: "turnover" | "volume" | "change";
};

type UsInstrument = { id: string; symbol: string; name: string; lastTimestamp: number };
type CandleRow = PatternCandle & { instrumentId: string; turnover: number | null };

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function finite(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function POST(request: Request) {
  const payload = await request.json() as ScanRequest;
  const market = payload.market === "US" ? "US" : "CN";

  if (payload.action === "refresh") {
    const instrumentIds = Array.isArray(payload.instrumentIds)
      ? [...new Set(payload.instrumentIds.map((value) => String(value)).filter(Boolean))].slice(0, 500)
      : [];
    if (!instrumentIds.length) return Response.json({ market, prices: [] });
    const entryAfter = Object.fromEntries(
      Object.entries(payload.entryAfter ?? {})
        .filter(([instrumentId, timestamp]) => instrumentIds.includes(instrumentId) && Number.isFinite(Number(timestamp)))
        .map(([instrumentId, timestamp]) => [instrumentId, Number(timestamp)]),
    );
    if (market === "CN") {
      try {
        const response = await fetchLocalData("/prices/latest", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ instrumentIds, entryAfter }),
        }, 30_000);
        const result = await response.json();
        return Response.json(result, { status: response.status });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "A 股实盘价格同步失败" }, { status: 502 });
      }
    }
    await ensureSchema();
    const db = getRawDb();
    const prices: Array<{ instrumentId: string; timestamp: number; open: number; close: number; entryTimestamp?: number; entryOpen?: number }> = [];
    for (let offset = 0; offset < instrumentIds.length; offset += 80) {
      const batch = instrumentIds.slice(offset, offset + 80);
      const placeholders = batch.map(() => "?").join(",");
      const rows = await db.prepare(`
        SELECT c.instrument_id AS instrumentId, c.timestamp, c.open, c.close
        FROM candles c
        JOIN (
          SELECT instrument_id, MAX(timestamp) AS timestamp
          FROM candles
          WHERE timeframe = '1d' AND adjustment_type = 'none' AND instrument_id IN (${placeholders})
          GROUP BY instrument_id
        ) latest ON latest.instrument_id = c.instrument_id AND latest.timestamp = c.timestamp
        WHERE c.timeframe = '1d' AND c.adjustment_type = 'none'
      `).bind(...batch).all<{ instrumentId: string; timestamp: number; open: number; close: number }>();
      const entryByInstrument = new Map<string, { entryTimestamp: number; entryOpen: number }>();
      for (const instrumentId of batch) {
        const after = entryAfter[instrumentId];
        if (!Number.isFinite(after)) continue;
        const entry = await db.prepare(`
          SELECT timestamp AS entryTimestamp, open AS entryOpen
          FROM candles
          WHERE instrument_id = ? AND timeframe = '1d' AND adjustment_type = 'none' AND timestamp > ?
          ORDER BY timestamp ASC
          LIMIT 1
        `).bind(instrumentId, after).first<{ entryTimestamp: number; entryOpen: number }>();
        if (entry && Number.isFinite(Number(entry.entryTimestamp)) && Number.isFinite(Number(entry.entryOpen))) {
          entryByInstrument.set(instrumentId, {
            entryTimestamp: Number(entry.entryTimestamp),
            entryOpen: Number(entry.entryOpen),
          });
        }
      }
      prices.push(...(rows.results as Array<{ instrumentId: string; timestamp: number; open: number; close: number }>).map((row) => {
        const entry = entryByInstrument.get(row.instrumentId);
        return {
          instrumentId: row.instrumentId,
          timestamp: Number(row.timestamp),
          open: Number(row.open),
          close: Number(row.close),
          ...(entry ?? {}),
        };
      }));
    }
    return Response.json({ market, prices });
  }

  const allPresets = normalizePatternPresets(payload.presets);
  const selected = new Set(Array.isArray(payload.presetIds) ? payload.presetIds : []);
  const presets = allPresets.filter((preset) => selected.has(preset.id));
  const body = {
    presets,
    filters: payload.filters ?? {},
    limit: Math.min(500, Math.max(1, Number(payload.limit) || 100)),
    sort: payload.sort ?? "turnover",
  };

  if (market === "CN") {
    try {
      const response = await fetchLocalData("/scan/latest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }, 180_000);
      const result = await response.json();
      return Response.json(result, { status: response.status });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "本机 A 股筛选服务不可用" }, { status: 502 });
    }
  }

  await ensureSchema();
  const db = getRawDb();
  const rows = await db.prepare(`SELECT i.id, i.symbol, i.name,
      MAX(c.last_timestamp) AS lastTimestamp
    FROM instruments i JOIN candle_coverage c ON c.instrument_id = i.id
    WHERE i.market = 'US' AND c.timeframe = '1d' AND c.bar_count > 0
      AND c.source IN ('alpaca-sip', 'alpaca-iex')
    GROUP BY i.id, i.symbol, i.name ORDER BY i.symbol`).all<UsInstrument>();
  const instruments = (rows.results as UsInstrument[]).map((row) => ({ ...row, lastTimestamp: Number(row.lastTimestamp) }));
  const latestTimestamp = instruments.reduce((maximum, item) => Math.max(maximum, item.lastTimestamp), 0);
  if (!latestTimestamp) return Response.json({ error: "美股 Alpaca 日线库为空，请先初始化或更新行情" }, { status: 400 });
  const eligible = instruments.filter((item) => item.lastTimestamp === latestTimestamp);
  const results: Array<Record<string, unknown>> = [];
  const cutoff = latestTimestamp - 420 * 86_400_000;
  for (let offset = 0; offset < eligible.length; offset += 40) {
    const batch = eligible.slice(offset, offset + 40);
    const placeholders = batch.map(() => "?").join(",");
    const candleRows = await db.prepare(`SELECT instrument_id AS instrumentId, timestamp,
        open, high, low, close, volume, turnover
      FROM candles WHERE timeframe = '1d' AND adjustment_type = 'none'
        AND timestamp >= ? AND instrument_id IN (${placeholders})
      ORDER BY instrument_id, timestamp`).bind(cutoff, ...batch.map((item) => item.id)).all<CandleRow>();
    const grouped = new Map<string, CandleRow[]>();
    for (const candle of candleRows.results as CandleRow[]) {
      const list = grouped.get(candle.instrumentId) ?? [];
      list.push(candle);
      grouped.set(candle.instrumentId, list);
    }
    for (const item of batch) {
      const candles = grouped.get(item.id) ?? [];
      const latest = candles.at(-1);
      const previous = candles.at(-2);
      if (!latest || latest.timestamp !== latestTimestamp) continue;
      const recent = candles.slice(-20);
      const averageVolume = average(recent.map((bar) => finite(bar.volume)));
      const averageTurnover = average(recent.map((bar) => finite(bar.turnover)));
      const filters = body.filters;
      if (filters.minPrice != null && latest.close < filters.minPrice) continue;
      if (filters.maxPrice != null && latest.close > filters.maxPrice) continue;
      if (filters.minAverageVolume != null && averageVolume < filters.minAverageVolume) continue;
      if (filters.minAverageTurnover != null && averageTurnover < filters.minAverageTurnover) continue;
      const hits = presets.filter((preset) => matchesPattern(candles, candles.length - 1, preset));
      if (presets.length && !hits.length) continue;
      results.push({
        instrumentId: item.id, symbol: item.symbol, name: item.name, market: "US",
        timestamp: latest.timestamp, close: latest.close,
        changePct: previous?.close ? (latest.close / previous.close - 1) * 100 : 0,
        volume: finite(latest.volume), turnover: finite(latest.turnover),
        averageVolume, averageTurnover,
        presetIds: hits.map((preset) => preset.id), presetNames: hits.map((preset) => preset.name),
      });
    }
  }
  const key = body.sort === "change" ? "changePct" : body.sort === "volume" ? "averageVolume" : "averageTurnover";
  results.sort((left, right) => finite(right[key]) - finite(left[key]));
  return Response.json({
    market: "US", latestTimestamp, scannedCount: eligible.length,
    matchedCount: results.length, results: results.slice(0, body.limit),
  });
}
