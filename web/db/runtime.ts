import { env } from "cloudflare:workers";

let schemaReady = false;

export function getRawDb(): D1Database {
  if (!env.DB) {
    throw new Error("K 线数据库暂不可用");
  }
  return env.DB;
}

export async function ensureSchema() {
  if (schemaReady) return;
  const db = getRawDb();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS instruments (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      market TEXT NOT NULL,
      timezone TEXT NOT NULL,
      price_precision INTEGER NOT NULL DEFAULT 2
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS candles (
      instrument_id TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume REAL,
      turnover REAL,
      adjustment_type TEXT NOT NULL DEFAULT 'none',
      source TEXT NOT NULL DEFAULT 'import',
      quality_flags TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY (instrument_id, timeframe, timestamp, adjustment_type)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS candles_lookup_idx
      ON candles (instrument_id, timeframe, adjustment_type, timestamp)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS training_sessions (
      id TEXT PRIMARY KEY,
      instrument_id TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      state_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
  ]);
  schemaReady = true;
}
