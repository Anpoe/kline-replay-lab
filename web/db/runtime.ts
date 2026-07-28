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
    db.prepare(`CREATE TABLE IF NOT EXISTS candle_coverage (
      instrument_id TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      adjustment_type TEXT NOT NULL,
      source TEXT NOT NULL,
      bar_count INTEGER NOT NULL,
      first_timestamp INTEGER NOT NULL,
      last_timestamp INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (instrument_id, timeframe, adjustment_type, source)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS candle_coverage_lookup_idx
      ON candle_coverage (instrument_id, timeframe, adjustment_type, source)`),
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
      created_at TEXT NOT NULL,
      base_snapshot_id TEXT,
      storage_mode TEXT NOT NULL DEFAULT 'full',
      removed_timestamps_json TEXT NOT NULL DEFAULT '[]',
      chain_depth INTEGER NOT NULL DEFAULT 0,
      stored_bar_count INTEGER NOT NULL DEFAULT 0
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
    db.prepare(`CREATE TABLE IF NOT EXISTS app_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`),
  ]);

  const sessionColumns = await db.prepare("PRAGMA table_info(training_sessions)").all<{ name: string }>();
  if (!sessionColumns.results.some((column) => column.name === "data_snapshot_id")) {
    await db.prepare("ALTER TABLE training_sessions ADD COLUMN data_snapshot_id TEXT").run();
  }
  const snapshotColumns = await db.prepare("PRAGMA table_info(data_snapshots)").all<{ name: string }>();
  if (!snapshotColumns.results.some((column) => column.name === "base_snapshot_id")) {
    await db.prepare("ALTER TABLE data_snapshots ADD COLUMN base_snapshot_id TEXT").run();
  }
  if (!snapshotColumns.results.some((column) => column.name === "storage_mode")) {
    await db.prepare("ALTER TABLE data_snapshots ADD COLUMN storage_mode TEXT NOT NULL DEFAULT 'full'").run();
  }
  if (!snapshotColumns.results.some((column) => column.name === "removed_timestamps_json")) {
    await db.prepare("ALTER TABLE data_snapshots ADD COLUMN removed_timestamps_json TEXT NOT NULL DEFAULT '[]'").run();
  }
  if (!snapshotColumns.results.some((column) => column.name === "chain_depth")) {
    await db.prepare("ALTER TABLE data_snapshots ADD COLUMN chain_depth INTEGER NOT NULL DEFAULT 0").run();
  }
  if (!snapshotColumns.results.some((column) => column.name === "stored_bar_count")) {
    await db.prepare("ALTER TABLE data_snapshots ADD COLUMN stored_bar_count INTEGER NOT NULL DEFAULT 0").run();
    await db.prepare("UPDATE data_snapshots SET stored_bar_count = bar_count WHERE stored_bar_count = 0").run();
  }
  const coverageBackfill = await db.prepare(
    "SELECT value FROM app_metadata WHERE key = 'candle_coverage_backfilled_v1'",
  ).first();
  if (!coverageBackfill) {
    // Existing provider jobs already contain accepted counts and first/last
    // timestamps, so the initial index can be built without scanning millions
    // of candle rows during application startup.
    await db.prepare(`INSERT OR REPLACE INTO candle_coverage
      (instrument_id, timeframe, adjustment_type, source, bar_count,
       first_timestamp, last_timestamp, updated_at)
      SELECT instrument_id, timeframe, adjustment_type,
        CASE provider WHEN 'alpaca' THEN 'alpaca-iex' ELSE provider END,
        SUM(inserted_count),
        COALESCE(MIN(CAST(json_extract(quality_report_json, '$.firstTimestamp') AS INTEGER)), 0),
        COALESCE(MAX(CAST(json_extract(quality_report_json, '$.lastTimestamp') AS INTEGER)), 0),
        MAX(updated_at)
      FROM data_download_jobs
      WHERE status = 'completed' AND inserted_count > 0
      GROUP BY instrument_id, timeframe, adjustment_type, provider`).run();
    await db.prepare(
      "INSERT OR REPLACE INTO app_metadata (key, value) VALUES ('candle_coverage_backfilled_v1', '1')",
    ).run();
  }
  schemaReady = true;
}
