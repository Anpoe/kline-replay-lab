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
      data_snapshot_id TEXT,
      state_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS data_snapshots (
      id TEXT PRIMARY KEY,
      content_hash TEXT NOT NULL UNIQUE,
      instrument_id TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      adjustment_type TEXT NOT NULL,
      instrument_json TEXT NOT NULL,
      candles_json TEXT NOT NULL,
      bar_count INTEGER NOT NULL,
      first_timestamp INTEGER NOT NULL,
      last_timestamp INTEGER NOT NULL,
      created_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS data_snapshots_lookup_idx
      ON data_snapshots (instrument_id, timeframe, adjustment_type, created_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS session_events (
      event_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      bar_timestamp INTEGER,
      payload_json TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      UNIQUE (session_id, sequence)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS session_events_lookup_idx
      ON session_events (session_id, sequence)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS data_download_jobs (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      instrument_id TEXT NOT NULL,
      vendor_symbol TEXT NOT NULL,
      instrument_name TEXT NOT NULL,
      market TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      adjustment_type TEXT NOT NULL DEFAULT 'none',
      status TEXT NOT NULL DEFAULT 'queued',
      cursor_json TEXT NOT NULL DEFAULT '{}',
      inserted_count INTEGER NOT NULL DEFAULT 0,
      quality_report_json TEXT NOT NULL DEFAULT '{}',
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS data_download_jobs_status_idx
      ON data_download_jobs (status, updated_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS local_provider_credentials (
      provider TEXT PRIMARY KEY,
      credentials_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
  ]);

  const sessionColumns = await db.prepare("PRAGMA table_info(training_sessions)").all<{ name: string }>();
  if (!sessionColumns.results.some((column) => column.name === "data_snapshot_id")) {
    await db.prepare("ALTER TABLE training_sessions ADD COLUMN data_snapshot_id TEXT").run();
  }
  schemaReady = true;
}
