import { ensureSchema, getRawDb } from "../../../db/runtime";
import { marketDataWriteResponse, withMarketDataWrite } from "../../lib/marketDataWriteGuard";
import {
  aggregateBars,
  generateDaily,
  generateIntraday,
  SAMPLE_INSTRUMENTS,
  type SeedCandle,
} from "../../../db/sample-data";
import { fetchLocalData, readLocalDataJson } from "../../lib/localDataService";
import {
  defaultAdjustmentTypeForMarket,
  defaultAdjustmentTypeForInstrument,
  normalizeStockAdjustmentType,
} from "../../lib/marketAdjustments";
import { normalizeTimeframeCoverage } from "../../lib/timeframeAvailability";
import { isSupportedTimeframe } from "../../lib/timeframeCatalog";

function isLocalCnSource(source: string) {
  const normalized = source.toLowerCase();
  return normalized.startsWith("baostock")
    || normalized.startsWith("tdx-official")
    || normalized.startsWith("local-zip");
}

type ImportedBar = Partial<SeedCandle> & { timestamp?: number | string };

async function seedIfNeeded() {
  const db = getRawDb();
  const seeded = await db.prepare("SELECT value FROM app_metadata WHERE key = 'sample_data_seeded'").first();
  if (seeded) {
    for (const instrument of SAMPLE_INSTRUMENTS) {
      const adjustmentType = defaultAdjustmentTypeForMarket(instrument.market);
      await db.prepare(`UPDATE candles SET adjustment_type = ?
        WHERE instrument_id = ? AND source = 'sample' AND adjustment_type = 'none'`)
        .bind(adjustmentType, instrument.id)
        .run();
      await db.prepare(`UPDATE candle_coverage SET adjustment_type = ?
        WHERE instrument_id = ? AND source = 'sample' AND adjustment_type = 'none'`)
        .bind(adjustmentType, instrument.id)
        .run();
    }
    return;
  }
  const count = await db.prepare("SELECT COUNT(*) AS count FROM instruments").first<{ count: number }>();
  if ((count?.count ?? 0) > 0) {
    await db.prepare("INSERT OR REPLACE INTO app_metadata (key, value) VALUES ('sample_data_seeded', '1')").run();
    return;
  }

  await withMarketDataWrite("*", async () => {
  if (await db.prepare("SELECT value FROM app_metadata WHERE key = 'sample_data_seeded'").first()) return;
  for (const instrument of SAMPLE_INSTRUMENTS) {
    const adjustmentType = defaultAdjustmentTypeForMarket(instrument.market);
    await db
      .prepare(`INSERT OR IGNORE INTO instruments
        (id, symbol, name, market, timezone, price_precision)
        VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(
        instrument.id,
        instrument.symbol,
        instrument.name,
        instrument.market,
        instrument.timezone,
        instrument.precision,
      )
      .run();

    const daily = generateDaily(instrument);
    const intraday = generateIntraday(instrument);
    const sets: Array<[string, SeedCandle[]]> = [
      ["5m", intraday],
      ["1h", aggregateBars(intraday, 12)],
      ["1d", daily],
      ["1w", aggregateBars(daily, 5)],
    ];

    for (const [timeframe, bars] of sets) {
      const statements = bars.map((bar) =>
        db
          .prepare(`INSERT OR IGNORE INTO candles
            (instrument_id, timeframe, timestamp, open, high, low, close, volume, turnover, adjustment_type, source, quality_flags)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sample', '[]')`)
          .bind(
            instrument.id,
            timeframe,
            bar.timestamp,
            bar.open,
            bar.high,
            bar.low,
            bar.close,
            bar.volume,
            bar.turnover,
            adjustmentType,
          ),
      );
      for (let index = 0; index < statements.length; index += 80) {
        await db.batch(statements.slice(index, index + 80));
      }
      await db.prepare(`INSERT OR REPLACE INTO candle_coverage
        (instrument_id, timeframe, adjustment_type, source, bar_count,
         first_timestamp, last_timestamp, updated_at)
        VALUES (?, ?, ?, 'sample', ?, ?, ?, ?)`)
        .bind(
          instrument.id,
          timeframe,
          adjustmentType,
          bars.length,
          bars[0]?.timestamp ?? 0,
          bars.at(-1)?.timestamp ?? 0,
          new Date().toISOString(),
        )
        .run();
    }
  }
  await db.prepare("INSERT OR REPLACE INTO app_metadata (key, value) VALUES ('sample_data_seeded', '1')").run();
  });
}

function isValidBar(bar: ImportedBar) {
  const timestamp = typeof bar.timestamp === "string" ? Date.parse(bar.timestamp) : Number(bar.timestamp);
  const open = Number(bar.open);
  const high = Number(bar.high);
  const low = Number(bar.low);
  const close = Number(bar.close);
  return (
    Number.isFinite(timestamp) &&
    Number.isFinite(open) &&
    Number.isFinite(high) &&
    Number.isFinite(low) &&
    Number.isFinite(close) &&
    low <= Math.min(open, close) &&
    high >= Math.max(open, close)
  );
}

export async function GET(request: Request) {
  await ensureSchema();
  await seedIfNeeded();
  const url = new URL(request.url);
  const coverage = url.searchParams.get("coverage");
  const instruments = url.searchParams.get("instruments");
  const db = getRawDb();

  if (instruments === "1") {
    const rows = await db
      .prepare(`SELECT i.id, i.symbol, i.name, i.market, i.timezone,
        i.price_precision AS pricePrecision,
        GROUP_CONCAT(DISTINCT c.timeframe) AS timeframeList,
        GROUP_CONCAT(DISTINCT c.adjustment_type) AS adjustmentTypeList
        FROM instruments i
        JOIN candle_coverage c ON c.instrument_id = i.id AND c.bar_count > 0
        GROUP BY i.id, i.symbol, i.name, i.market, i.timezone, i.price_precision
        ORDER BY i.market, i.symbol`)
      .all();
    const local = await readLocalDataJson<{ instruments: Array<Record<string, unknown>> }>("/instruments");
    const merged = new Map<string, Record<string, unknown>>();
    const visibleRows = (rows.results as Array<Record<string, unknown>>).filter((item) => {
      if (["CN", "A股"].includes(String(item.market ?? "").toUpperCase())) return false;
      const expected = defaultAdjustmentTypeForMarket(String(item.market ?? ""));
      return expected === "none" || String(item.adjustmentTypeList ?? "").split(",").includes(expected);
    });
    for (const item of visibleRows) {
      merged.set(String(item.id), {
        ...item,
        timeframes: normalizeTimeframeCoverage(item.timeframeList),
      });
    }
    for (const item of local?.instruments ?? []) {
      if (Number(item.barCount ?? 0) <= 0) continue;
      const instrumentId = String(item.id);
      const localTimeframes = normalizeTimeframeCoverage(item.timeframes ?? item.timeframeList);
      const existing = merged.get(instrumentId);
      merged.set(String(item.id), {
        ...existing,
        ...item,
        timeframes: normalizeTimeframeCoverage([
          ...normalizeTimeframeCoverage(existing?.timeframes),
          ...localTimeframes,
        ]),
      });
    }
    const cleared = await db.prepare("SELECT key FROM app_metadata WHERE key LIKE 'market_data_cleared:%'").all<{ key: string }>();
    return Response.json({ instruments: [...merged.values()], clearedMarkets: cleared.results.map((row) => row.key.slice("market_data_cleared:".length)) });
  }

  if (coverage === "1") {
    const rows = await db
      .prepare(`SELECT i.id, i.symbol, i.name, i.market, i.timezone, i.price_precision AS pricePrecision,
        c.timeframe, c.bar_count AS barCount, c.first_timestamp AS firstTimestamp,
        c.last_timestamp AS lastTimestamp, c.adjustment_type AS adjustmentType, c.source
        FROM instruments i
        JOIN candle_coverage c ON c.instrument_id = i.id
        ORDER BY i.market, i.symbol, c.timeframe`)
      .all();
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const pageSize = Math.min(200, Math.max(20, Number(url.searchParams.get("pageSize") ?? 100)));
    const query = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const requestedMarket = (url.searchParams.get("market") ?? "").trim().toUpperCase();
    const matchesMarket = (market: unknown) => {
      const normalized = String(market ?? "").toUpperCase();
      if (!requestedMarket) return true;
      if (requestedMarket === "FX") return normalized === "FX" || normalized === "FOREX";
      if (requestedMarket === "GOLD") return normalized === "GOLD" || normalized === "METAL";
      return normalized === requestedMarket;
    };
    const allDatabaseRows = (rows.results as Array<Record<string, unknown>>).filter((item) => {
      if (["CN", "A股"].includes(String(item.market ?? "").toUpperCase())) return false;
      const expected = defaultAdjustmentTypeForMarket(String(item.market ?? ""));
      return expected === "none" || String(item.adjustmentType ?? "") === expected;
    });
    const marketDatabaseRows = allDatabaseRows.filter((item) => matchesMarket(item.market));
    const databaseRows = marketDatabaseRows.filter((item) =>
      !query ||
      String(item.id ?? "").toLowerCase().includes(query) ||
      String(item.name ?? "").toLowerCase().includes(query) ||
      String(item.source ?? "").toLowerCase().includes(query) ||
      String(item.market ?? "").toLowerCase().includes(query) ||
      String(item.timeframe ?? "").toLowerCase().includes(query));
    const offset = (page - 1) * pageSize;
    const databasePage = databaseRows.slice(offset, offset + pageSize);
    const localOffset = Math.max(0, offset - databaseRows.length);
    const localLimit = Math.max(0, pageSize - databasePage.length);
    const includeLocalTdx = !requestedMarket || requestedMarket === "CN";
    const local = localLimit && includeLocalTdx
      ? await readLocalDataJson<{
          coverage: Array<Record<string, unknown>>;
          total: number;
          summary: { instrumentCount: number; barCount: number; timeframes: string[] };
        }>(`/coverage?offset=${localOffset}&limit=${localLimit}&q=${encodeURIComponent(query)}`)
      : null;
    const databaseBarCount = marketDatabaseRows.reduce((sum, item) => sum + Number(item.barCount ?? 0), 0);
    const databaseHasNonSampleData = marketDatabaseRows.some((item) => (
      Number(item.barCount ?? 0) > 0 && String(item.source ?? "") !== "sample"
    ));
    const databaseTimeframes = new Set<string>(
      marketDatabaseRows
        .map((item) => String(item.timeframe))
        .filter((timeframe) => isSupportedTimeframe(timeframe)),
    );
    for (const timeframe of normalizeTimeframeCoverage(local?.summary.timeframes)) databaseTimeframes.add(timeframe);
    return Response.json({
      coverage: [...databasePage, ...(local?.coverage ?? [])],
      total: databaseRows.length + Number(local?.total ?? 0),
      summary: {
        barCount: databaseBarCount + Number(local?.summary.barCount ?? 0),
        timeframeCount: databaseTimeframes.size,
        hasNonSampleData: databaseHasNonSampleData || Number(local?.summary.barCount ?? 0) > 0,
      },
    });
  }

  const instrumentId = url.searchParams.get("instrument") ?? "600519.SH";
  const timeframe = url.searchParams.get("timeframe") ?? "1d";
  if (!isSupportedTimeframe(timeframe)) {
    return Response.json({ error: `不支持的周期：${timeframe}` }, { status: 400 });
  }
  const instrument = await db
    .prepare(`SELECT id, symbol, name, market, timezone, price_precision AS pricePrecision
      FROM instruments WHERE id = ?`)
    .bind(instrumentId)
    .first();
  const adjustmentType = instrument
    ? normalizeStockAdjustmentType(String((instrument as { market?: unknown }).market ?? ""), url.searchParams.get("adjustmentType") ?? undefined)
    : defaultAdjustmentTypeForInstrument(instrumentId);
  const preferLocal = String((instrument as { market?: unknown } | null)?.market ?? "").toUpperCase() === "CN"
    || /\.(SH|SZ|BJ)$/.test(instrumentId.toUpperCase());
  const local = preferLocal
    ? await readLocalDataJson<{
        instrument: Record<string, unknown>;
        timeframe: string;
        adjustmentType?: string;
        candles: Array<Record<string, unknown>>;
        source: string;
        datasetVersion: string;
      }>(`/candles?instrument=${encodeURIComponent(instrumentId)}&timeframe=${encodeURIComponent(timeframe)}&adjustmentType=${encodeURIComponent(adjustmentType)}`, 15000)
    : null;
  const rows = await db
    .prepare(`SELECT timestamp, open, high, low, close, volume, turnover
      FROM candles
      WHERE instrument_id = ? AND timeframe = ? AND adjustment_type = ?
      ORDER BY timestamp ASC`)
    .bind(instrumentId, timeframe, adjustmentType)
    .all();

  // A fresh install keeps a small CN sample in D1 while the optional local
  // market-data service has no imported files yet. Keep that sample usable
  // until local data actually contains bars; otherwise the default 600519
  // screen opens successfully but every new training attempt is rejected.
  if (local?.candles?.length || rows.results.length === 0) {
    if (local) return Response.json(local);
  }

  if (instrument && rows.results.length) {
    return Response.json({ instrument, timeframe, adjustmentType, candles: rows.results });
  }
  if (preferLocal) {
    return Response.json({ instrument, timeframe, adjustmentType, candles: [] });
  }
  const fallbackLocal = await readLocalDataJson<{
    instrument: Record<string, unknown>;
    timeframe: string;
    adjustmentType?: string;
    candles: Array<Record<string, unknown>>;
    source: string;
    datasetVersion: string;
  }>(`/candles?instrument=${encodeURIComponent(instrumentId)}&timeframe=${encodeURIComponent(timeframe)}&adjustmentType=${encodeURIComponent(adjustmentType)}`, 15000);
  if (fallbackLocal) return Response.json(fallbackLocal);
  return Response.json({ instrument, timeframe, adjustmentType, candles: rows.results });
}

export async function POST(request: Request) {
  return marketDataWriteResponse("*", () => importCandles(request));
}

async function importCandles(request: Request) {
  await ensureSchema();
  const payload = (await request.json()) as {
    instrument?: {
      id?: string;
      symbol?: string;
      name?: string;
      market?: string;
      timezone?: string;
      pricePrecision?: number;
    };
    timeframe?: string;
    adjustmentType?: string;
    bars?: ImportedBar[];
  };
  const instrument = payload.instrument;
  const bars = payload.bars ?? [];
  if (!instrument?.id || !instrument.symbol || !payload.timeframe || bars.length === 0) {
    return Response.json({ error: "缺少品种、周期或 K 线数据" }, { status: 400 });
  }
  if (!isSupportedTimeframe(payload.timeframe)) {
    return Response.json({ error: `不支持的周期：${payload.timeframe}` }, { status: 400 });
  }
  if (bars.length > 5000 || bars.some((bar) => !isValidBar(bar))) {
    return Response.json({ error: "单次最多 5000 根，且 OHLC 必须有效" }, { status: 400 });
  }

  const market = instrument.market ?? "CUSTOM";
  const adjustmentType = normalizeStockAdjustmentType(market, payload.adjustmentType);

  const db = getRawDb();
  await db
    .prepare(`INSERT INTO instruments (id, symbol, name, market, timezone, price_precision)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET symbol = excluded.symbol, name = excluded.name,
      market = excluded.market, timezone = excluded.timezone, price_precision = excluded.price_precision`)
    .bind(
      instrument.id,
      instrument.symbol,
      instrument.name ?? instrument.symbol,
      instrument.market ?? "CUSTOM",
      instrument.timezone ?? "UTC",
      instrument.pricePrecision ?? 2,
    )
    .run();

  const statements = bars.map((bar) => {
    const timestamp = typeof bar.timestamp === "string" ? Date.parse(bar.timestamp) : Number(bar.timestamp);
    return db
      .prepare(`INSERT OR REPLACE INTO candles
        (instrument_id, timeframe, timestamp, open, high, low, close, volume, turnover, adjustment_type, source, quality_flags)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'csv-import', '[]')`)
      .bind(
        instrument.id,
        payload.timeframe,
        timestamp,
        Number(bar.open),
        Number(bar.high),
        Number(bar.low),
        Number(bar.close),
        bar.volume == null ? null : Number(bar.volume),
        bar.turnover == null ? null : Number(bar.turnover),
        adjustmentType,
      );
  });
  for (let index = 0; index < statements.length; index += 80) {
    await db.batch(statements.slice(index, index + 80));
  }
  const importedCoverage = await db.prepare(`SELECT COUNT(*) AS barCount,
    MIN(timestamp) AS firstTimestamp, MAX(timestamp) AS lastTimestamp
    FROM candles
    WHERE instrument_id = ? AND timeframe = ? AND adjustment_type = ? AND source = 'csv-import'`)
    .bind(instrument.id, payload.timeframe, adjustmentType)
    .first<{ barCount: number; firstTimestamp: number; lastTimestamp: number }>();
  await db.prepare(`INSERT OR REPLACE INTO candle_coverage
    (instrument_id, timeframe, adjustment_type, source, bar_count,
     first_timestamp, last_timestamp, updated_at)
    VALUES (?, ?, ?, 'csv-import', ?, ?, ?, ?)`)
    .bind(
      instrument.id,
      payload.timeframe,
      adjustmentType,
      Number(importedCoverage?.barCount ?? 0),
      Number(importedCoverage?.firstTimestamp ?? 0),
      Number(importedCoverage?.lastTimestamp ?? 0),
      new Date().toISOString(),
    )
    .run();
  return Response.json({ imported: bars.length }, { status: 201 });
}

export async function DELETE(request: Request) {
  await ensureSchema();
  await seedIfNeeded();
  const payload = (await request.json()) as {
    selections?: Array<{
      id?: string;
      timeframe?: string;
      adjustmentType?: string;
      source?: string;
    }>;
  };
  const selections = (payload.selections ?? []).filter((item) =>
    item.id && item.timeframe && isSupportedTimeframe(item.timeframe) && item.adjustmentType && item.source);
  if (!selections.length || selections.length > 200) {
    return Response.json({ error: "请选择 1～200 条数据记录" }, { status: 400 });
  }

  const localInstrumentIds = [...new Set(
    selections.filter((item) => isLocalCnSource(String(item.source ?? ""))).map((item) => item.id as string),
  )];
  let deletedLocalInstruments = 0;
  if (localInstrumentIds.length) {
    try {
      const response = await fetchLocalData("/data", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instrumentIds: localInstrumentIds }),
      }, 15000);
      const result = await response.json() as { deletedInstruments?: number; error?: string };
      if (!response.ok) throw new Error(result.error ?? "本机行情删除失败");
      deletedLocalInstruments = Number(result.deletedInstruments ?? 0);
    } catch (error) {
      return Response.json({
        error: error instanceof Error ? error.message : "本机行情删除失败",
      }, { status: 503 });
    }
  }

  const databaseSelections = selections.filter((item) => !isLocalCnSource(String(item.source ?? "")));
  const db = getRawDb();
  let deletedRows = 0;
  for (const item of databaseSelections) {
    const result = await db.prepare(`DELETE FROM candles
      WHERE instrument_id = ? AND timeframe = ? AND adjustment_type = ? AND source = ?`)
      .bind(item.id, item.timeframe, item.adjustmentType, item.source)
      .run();
    deletedRows += Number(result.meta?.changes ?? 0);
    await db.prepare(`DELETE FROM candle_coverage
      WHERE instrument_id = ? AND timeframe = ? AND adjustment_type = ? AND source = ?`)
      .bind(item.id, item.timeframe, item.adjustmentType, item.source)
      .run();
  }
  const touchedIds = [...new Set(databaseSelections.map((item) => item.id as string))];
  for (const instrumentId of touchedIds) {
    const remaining = await db.prepare("SELECT COUNT(*) AS count FROM candles WHERE instrument_id = ?")
      .bind(instrumentId)
      .first<{ count: number }>();
    if ((remaining?.count ?? 0) === 0) {
      await db.prepare("DELETE FROM instruments WHERE id = ?").bind(instrumentId).run();
    }
  }
  return Response.json({
    deletedRows,
    deletedLocalInstruments,
    note: deletedLocalInstruments
      ? "本机 A 股周线/月线由日线生成，因此删除任一周期会同时删除该品种在当前本机数据源中的日线和聚合周期。"
      : undefined,
  });
}
