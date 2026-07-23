import { ensureSchema, getRawDb } from "../../../db/runtime";
import {
  aggregateBars,
  generateDaily,
  generateIntraday,
  SAMPLE_INSTRUMENTS,
  type SeedCandle,
} from "../../../db/sample-data";

type ImportedBar = Partial<SeedCandle> & { timestamp?: number | string };

async function seedIfNeeded() {
  const db = getRawDb();
  const count = await db.prepare("SELECT COUNT(*) AS count FROM instruments").first<{ count: number }>();
  if ((count?.count ?? 0) > 0) return;

  for (const instrument of SAMPLE_INSTRUMENTS) {
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
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'none', 'sample', '[]')`)
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
          ),
      );
      for (let index = 0; index < statements.length; index += 80) {
        await db.batch(statements.slice(index, index + 80));
      }
    }
  }
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
  const db = getRawDb();

  if (coverage === "1") {
    const rows = await db
      .prepare(`SELECT i.id, i.symbol, i.name, i.market, i.timezone, i.price_precision AS pricePrecision,
        c.timeframe, COUNT(*) AS barCount, MIN(c.timestamp) AS firstTimestamp, MAX(c.timestamp) AS lastTimestamp,
        c.adjustment_type AS adjustmentType, c.source
        FROM instruments i
        JOIN candles c ON c.instrument_id = i.id
        GROUP BY i.id, c.timeframe, c.adjustment_type, c.source
        ORDER BY i.market, i.symbol, c.timeframe`)
      .all();
    return Response.json({ coverage: rows.results });
  }

  const instrumentId = url.searchParams.get("instrument") ?? "600519.SH";
  const timeframe = url.searchParams.get("timeframe") ?? "1d";
  const instrument = await db
    .prepare(`SELECT id, symbol, name, market, timezone, price_precision AS pricePrecision
      FROM instruments WHERE id = ?`)
    .bind(instrumentId)
    .first();
  const rows = await db
    .prepare(`SELECT timestamp, open, high, low, close, volume, turnover
      FROM candles
      WHERE instrument_id = ? AND timeframe = ? AND adjustment_type = 'none'
      ORDER BY timestamp ASC`)
    .bind(instrumentId, timeframe)
    .all();

  return Response.json({ instrument, timeframe, candles: rows.results });
}

export async function POST(request: Request) {
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
  if (bars.length > 5000 || bars.some((bar) => !isValidBar(bar))) {
    return Response.json({ error: "单次最多 5000 根，且 OHLC 必须有效" }, { status: 400 });
  }

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
        payload.adjustmentType ?? "none",
      );
  });
  for (let index = 0; index < statements.length; index += 80) {
    await db.batch(statements.slice(index, index + 80));
  }
  return Response.json({ imported: bars.length }, { status: 201 });
}
