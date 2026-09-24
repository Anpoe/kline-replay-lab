import { ensureSchema, getRawDb } from "../../../db/runtime";
import { fetchLocalData } from "../../lib/localDataService";
import { matchesPattern, normalizePatternPresets, type PatternCandle, type PatternPreset } from "../../lib/patternFilters";
import { stableLiveBarRevision } from "../../lib/liveExecutionAdapter";

type ScanFilters = {
  minPrice?: number;
  maxPrice?: number;
  minAverageVolume?: number;
  minAverageTurnover?: number;
  minChangePct?: number;
  maxChangePct?: number;
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

function parseQualityFlags(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string").slice(0, 32);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string").slice(0, 32)
      : [];
  } catch {
    return [];
  }
}

function normalizeScanLimit(value: unknown) {
  const parsed = Number(value);
  if (parsed === 0 && (typeof value === "number" || (typeof value === "string" && value.trim() === "0"))) return 0;
  return Number.isFinite(parsed) ? Math.min(500, Math.max(1, Math.round(parsed))) : 100;
}

function withBarRevision<T extends {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
  turnover?: number | null;
  source?: string;
  qualityFlags?: string[];
  revision?: string | null;
  priceBasis?: "raw" | "adjusted" | "unknown";
}>(bar: T, priceBasis: "raw" | "adjusted" | "unknown") {
  return {
    ...bar,
    priceBasis,
    revision: bar.revision ?? stableLiveBarRevision({ ...bar, priceBasis }),
  };
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
        const response = await fetchLocalData("/quotes/realtime", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            instrumentIds,
            ...(Object.keys(entryAfter).length ? { entryAfter } : {}),
          }),
        }, 30_000);
        const result = await response.json() as Record<string, unknown>;
        const priceBasis: "raw" | "adjusted" = result.activeSource === "baostock" ? "adjusted" : "raw";
        const prices = Array.isArray(result.prices)
          ? result.prices.map((value) => {
              if (!value || typeof value !== "object" || Array.isArray(value)) return value;
              const price = value as Record<string, unknown>;
              const previousClose = Number(price.previousClose ?? price.lastClose);
              const entryBars = Array.isArray(price.entryBars)
                ? price.entryBars.flatMap((bar) => {
                  if (!bar || typeof bar !== "object" || Array.isArray(bar)) return [];
                  const candidate = bar as Record<string, unknown>;
                  const timestamp = Number(candidate.timestamp);
                  const open = Number(candidate.open);
                  const high = Number(candidate.high);
                  const low = Number(candidate.low);
                  const close = Number(candidate.close);
                  if (![timestamp, open, high, low, close].every(Number.isFinite)) return [];
                  return [withBarRevision({
                    ...candidate,
                    timestamp,
                    open,
                    high,
                    low,
                    close,
                    volume: candidate.volume == null ? null : Number(candidate.volume),
                    turnover: candidate.turnover == null ? null : Number(candidate.turnover),
                    source: typeof candidate.source === "string" ? candidate.source : undefined,
                    qualityFlags: Array.isArray(candidate.qualityFlags)
                      ? candidate.qualityFlags.filter((flag): flag is string => typeof flag === "string")
                      : undefined,
                  }, priceBasis as "raw" | "adjusted" | "unknown")];
                })
                : undefined;
              const normalized = {
                ...price,
                priceBasis,
                ...(entryBars?.length ? { entryBars } : {}),
              };
              const timestamp = Number(price.timestamp);
              const open = Number(price.open);
              const high = Number(price.high ?? price.open);
              const low = Number(price.low ?? price.close);
              const close = Number(price.close);
              const withRevision = [timestamp, open, high, low, close].every(Number.isFinite)
                ? withBarRevision({
                  ...normalized,
                  timestamp,
                  open,
                  high,
                  low,
                  close,
                  volume: price.volume == null ? null : Number(price.volume),
                  turnover: price.turnover == null ? null : Number(price.turnover),
                  source: typeof price.source === "string" ? price.source : undefined,
                  qualityFlags: Array.isArray(price.qualityFlags)
                    ? price.qualityFlags.filter((flag): flag is string => typeof flag === "string")
                    : undefined,
                }, priceBasis as "raw" | "adjusted" | "unknown")
                : normalized;
              return Number.isFinite(previousClose) && previousClose > 0
                ? { ...withRevision, previousClose }
                : withRevision;
            })
          : result.prices;
        return Response.json({ ...result, prices }, { status: response.status });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "A 股实时价格同步失败" }, { status: 502 });
      }
    }
    await ensureSchema();
    const db = getRawDb();
    const prices: Array<{
      instrumentId: string;
      timestamp: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number | null;
      turnover: number | null;
      closed: boolean;
      source?: string;
      qualityFlags?: string[];
      previousClose?: number;
      entryTimestamp?: number;
      entryOpen?: number;
      entryBars?: Array<{
        timestamp: number;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number | null;
        turnover: number | null;
        closed: boolean;
        source?: string;
        qualityFlags?: string[];
        revision?: string | null;
        priceBasis?: "raw" | "adjusted" | "unknown";
      }>;
      hasMoreEntryBars?: boolean;
    }> = [];
    for (let offset = 0; offset < instrumentIds.length; offset += 80) {
      const batch = instrumentIds.slice(offset, offset + 80);
      const placeholders = batch.map(() => "?").join(",");
      const rows = await db.prepare(`
        SELECT c.instrument_id AS instrumentId, c.timestamp, c.open, c.high, c.low, c.close,
          c.volume, c.turnover, c.source, c.quality_flags AS qualityFlags,
          (SELECT previous.close FROM candles previous
            WHERE previous.instrument_id = c.instrument_id
              AND previous.timeframe = '1d'
              AND previous.adjustment_type = 'all'
              AND previous.timestamp < c.timestamp
            ORDER BY previous.timestamp DESC LIMIT 1) AS previousClose
        FROM candles c
        JOIN (
          SELECT instrument_id, MAX(timestamp) AS timestamp
          FROM candles
          WHERE timeframe = '1d' AND adjustment_type = 'all' AND instrument_id IN (${placeholders})
          GROUP BY instrument_id
        ) latest ON latest.instrument_id = c.instrument_id AND latest.timestamp = c.timestamp
        WHERE c.timeframe = '1d' AND c.adjustment_type = 'all'
      `).bind(...batch).all<{
        instrumentId: string;
        timestamp: number;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number | null;
        turnover: number | null;
        source: string;
        qualityFlags: string;
        previousClose: number | null;
      }>();
      const entryByInstrument = new Map<string, { entryTimestamp: number; entryOpen: number }>();
      const entryBarsByInstrument = new Map<string, Array<{
        timestamp: number;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number | null;
        turnover: number | null;
        closed: boolean;
        source?: string;
        qualityFlags?: string[];
        revision?: string | null;
        priceBasis?: "raw" | "adjusted" | "unknown";
      }>>();
      const entryHasMoreByInstrument = new Map<string, boolean>();
      for (const instrumentId of batch) {
        const after = entryAfter[instrumentId];
        if (!Number.isFinite(after)) continue;
        const entries = await db.prepare(`
          SELECT timestamp, open, high, low, close, volume, turnover, source,
            quality_flags AS qualityFlags
          FROM candles
          WHERE instrument_id = ? AND timeframe = '1d' AND adjustment_type = 'all' AND timestamp > ?
          ORDER BY timestamp ASC
          LIMIT 65
        `).bind(instrumentId, after).all<{
          timestamp: number;
          open: number;
          high: number;
          low: number;
          close: number;
          volume: number | null;
          turnover: number | null;
          source: string;
          qualityFlags: string;
        }>();
        entryHasMoreByInstrument.set(instrumentId, (entries.results ?? []).length > 64);
        const entryBars = (entries.results ?? [])
          .filter((entry) => Number.isFinite(Number(entry.timestamp))
            && Number.isFinite(Number(entry.open))
            && Number.isFinite(Number(entry.high))
            && Number.isFinite(Number(entry.low))
            && Number.isFinite(Number(entry.close)))
          .slice(0, 64)
          .map((entry) => ({
            timestamp: Number(entry.timestamp),
            open: Number(entry.open),
            high: Number(entry.high),
            low: Number(entry.low),
            close: Number(entry.close),
            volume: entry.volume == null ? null : Number(entry.volume),
            turnover: entry.turnover == null ? null : Number(entry.turnover),
            closed: true,
            ...(entry.source ? { source: entry.source } : {}),
            ...(entry.qualityFlags ? { qualityFlags: parseQualityFlags(entry.qualityFlags) } : {}),
            priceBasis: "adjusted" as const,
          }));
        if (entryBars.length) {
          entryBarsByInstrument.set(instrumentId, entryBars);
          entryByInstrument.set(instrumentId, {
            entryTimestamp: entryBars[0].timestamp,
            entryOpen: entryBars[0].open,
          });
        }
      }
      prices.push(...(rows.results as Array<{
        instrumentId: string;
        timestamp: number;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number | null;
        turnover: number | null;
        source: string;
        qualityFlags: string;
        previousClose: number | null;
      }>).map((row) => {
        const entry = entryByInstrument.get(row.instrumentId);
        const entryBars = entryBarsByInstrument.get(row.instrumentId);
        return {
          instrumentId: row.instrumentId,
          timestamp: Number(row.timestamp),
          open: Number(row.open),
          high: Number(row.high),
          low: Number(row.low),
          close: Number(row.close),
          volume: row.volume == null ? null : Number(row.volume),
          turnover: row.turnover == null ? null : Number(row.turnover),
          closed: true,
          ...(row.source ? { source: row.source } : {}),
          ...(row.qualityFlags ? { qualityFlags: parseQualityFlags(row.qualityFlags) } : {}),
          priceBasis: "adjusted" as const,
          ...(Number.isFinite(Number(row.previousClose)) && Number(row.previousClose) > 0
            ? { previousClose: Number(row.previousClose) }
            : {}),
          ...(entry ?? {}),
          ...(entryBars?.length ? { entryBars: entryBars.map((bar) => withBarRevision(bar, "adjusted")) } : {}),
          revision: withBarRevision({
            timestamp: Number(row.timestamp),
            open: Number(row.open),
            high: Number(row.high),
            low: Number(row.low),
            close: Number(row.close),
            volume: row.volume == null ? null : Number(row.volume),
            turnover: row.turnover == null ? null : Number(row.turnover),
            source: row.source,
            qualityFlags: parseQualityFlags(row.qualityFlags),
            priceBasis: "adjusted",
          }, "adjusted").revision,
          ...(entryHasMoreByInstrument.get(row.instrumentId) ? { hasMoreEntryBars: true } : {}),
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
    limit: normalizeScanLimit(payload.limit),
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
      AND c.source IN ('alpaca-sip', 'alpaca-iex') AND c.adjustment_type = 'all'
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
      FROM candles WHERE timeframe = '1d' AND adjustment_type = 'all'
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
      const changePct = previous?.close ? (latest.close / previous.close - 1) * 100 : 0;
      const filters = body.filters;
      if (filters.minPrice != null && latest.close < filters.minPrice) continue;
      if (filters.maxPrice != null && latest.close > filters.maxPrice) continue;
      if (filters.minAverageVolume != null && averageVolume < filters.minAverageVolume) continue;
      if (filters.minAverageTurnover != null && averageTurnover < filters.minAverageTurnover) continue;
      if (filters.minChangePct != null && changePct < filters.minChangePct) continue;
      if (filters.maxChangePct != null && changePct > filters.maxChangePct) continue;
      const hits = presets.filter((preset) => matchesPattern(candles, candles.length - 1, preset));
      if (presets.length && !hits.length) continue;
      results.push({
        instrumentId: item.id, symbol: item.symbol, name: item.name, market: "US",
        timestamp: latest.timestamp, close: latest.close,
        changePct,
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
    matchedCount: results.length, results: body.limit > 0 ? results.slice(0, body.limit) : results,
  });
}
