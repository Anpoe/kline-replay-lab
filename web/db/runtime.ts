import { env } from "cloudflare:workers";
import { migrateLegacyLiveData } from "./live-ledger";

let schemaReady = false;
let schemaInitialization: Promise<void> | null = null;

export function getRawDb(): D1Database {
  if (!env.DB) {
    throw new Error("K 线数据库暂不可用");
  }
  return env.DB;
}

export async function ensureSchema() {
  if (schemaReady) return;
  if (!schemaInitialization) schemaInitialization = initializeSchema();
  const pending = schemaInitialization;
  try {
    await pending;
    schemaReady = true;
  } catch (error) {
    if (schemaInitialization === pending) schemaInitialization = null;
    throw error;
  }
}

async function initializeSchema() {
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
      updated_at TEXT NOT NULL,
      deleted_at TEXT
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
      stored_bar_count INTEGER NOT NULL DEFAULT 0,
      format_version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'ready',
      source_json TEXT NOT NULL DEFAULT '{}',
      normalization_version INTEGER NOT NULL DEFAULT 1,
      chunk_count INTEGER NOT NULL DEFAULT 0
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS data_snapshots_lookup_idx
      ON data_snapshots (instrument_id, timeframe, adjustment_type, created_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS candle_chunks (
      chunk_hash TEXT PRIMARY KEY,
      encoding TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      bar_count INTEGER NOT NULL,
      first_timestamp INTEGER NOT NULL,
      last_timestamp INTEGER NOT NULL,
      byte_size INTEGER NOT NULL,
      created_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS data_snapshot_chunks (
      snapshot_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      bucket_key TEXT NOT NULL,
      chunk_hash TEXT NOT NULL,
      first_timestamp INTEGER NOT NULL,
      last_timestamp INTEGER NOT NULL,
      bar_count INTEGER NOT NULL,
      PRIMARY KEY (snapshot_id, sequence)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS data_snapshot_chunks_snapshot_time_idx
      ON data_snapshot_chunks (snapshot_id, first_timestamp, last_timestamp)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS data_snapshot_chunks_chunk_hash_idx
      ON data_snapshot_chunks (chunk_hash)`),
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
      sync_run_id TEXT,
      sync_batch_id TEXT,
      sync_mode TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      feed TEXT,
      terminal_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS data_download_jobs_status_idx
      ON data_download_jobs (status, updated_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS fx_data_tasks (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL,
      instrument_id TEXT NOT NULL,
      pair_label TEXT NOT NULL,
      vendor_symbol TEXT NOT NULL,
      dukascopy_symbol TEXT NOT NULL,
      twelve_data_symbol TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      raw_timeframe TEXT NOT NULL DEFAULT '1m',
      target_timeframes_json TEXT NOT NULL DEFAULT '["5m","1h","1d","1w"]',
      keep_raw_csv INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'queued',
      stage TEXT NOT NULL DEFAULT 'queued',
      stage_progress REAL NOT NULL DEFAULT 0,
      progress_json TEXT NOT NULL DEFAULT '{}',
      cursor_json TEXT NOT NULL DEFAULT '{}',
      quality_report_json TEXT NOT NULL DEFAULT '{}',
      inserted_count INTEGER NOT NULL DEFAULT 0,
      message TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS fx_data_tasks_status_idx
      ON fx_data_tasks (status, updated_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS local_provider_credentials (
      provider TEXT PRIMARY KEY,
      credentials_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS app_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS live_accounts (
      account_id TEXT PRIMARY KEY,
      market TEXT NOT NULL,
      currency TEXT NOT NULL,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      trading_mode TEXT NOT NULL DEFAULT 'return',
      initial_capital REAL NOT NULL DEFAULT 0,
      risk_capital REAL NOT NULL DEFAULT 0,
      cash_balance REAL NOT NULL DEFAULT 0,
      reserved_cash REAL NOT NULL DEFAULT 0,
      reserved_margin REAL NOT NULL DEFAULT 0,
      equity REAL NOT NULL DEFAULT 0,
      available_cash REAL NOT NULL DEFAULT 0,
      account_version INTEGER NOT NULL DEFAULT 1,
      payload_version INTEGER NOT NULL DEFAULT 1,
      payload_json TEXT NOT NULL DEFAULT '{}',
      settings_json TEXT NOT NULL DEFAULT '{}',
      execution_profile_json TEXT NOT NULL DEFAULT '{}',
      execution_profile_version TEXT,
      execution_engine_version TEXT NOT NULL DEFAULT 'legacy-next-open-v0',
      execution_switch_state TEXT NOT NULL DEFAULT 'legacy',
      switched_at TEXT,
      previous_account_version INTEGER,
      market_rule_version TEXT,
      data_contract_version TEXT,
      legacy_pending_order_count INTEGER NOT NULL DEFAULT 0,
      carried_position_count INTEGER NOT NULL DEFAULT 0,
      needs_user_action INTEGER NOT NULL DEFAULT 0,
      last_processed_timestamp INTEGER,
      last_processed_revision TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS live_accounts_market_status_idx ON live_accounts (market, status, updated_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS live_portfolios (
      instrument_id TEXT PRIMARY KEY,
      account_id TEXT,
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      market TEXT NOT NULL,
      latest_timestamp INTEGER NOT NULL,
      latest_close REAL NOT NULL,
      scan_timestamp INTEGER NOT NULL,
      preset_ids_json TEXT NOT NULL DEFAULT '[]',
      preset_names_json TEXT NOT NULL DEFAULT '[]',
      decision_json TEXT,
      decision_submissions_json TEXT NOT NULL DEFAULT '[]',
      trading_mode TEXT NOT NULL DEFAULT 'return',
      initial_capital REAL NOT NULL DEFAULT 0,
      cash_balance REAL NOT NULL DEFAULT 0,
      account_version INTEGER NOT NULL DEFAULT 1,
      payload_version INTEGER NOT NULL DEFAULT 1,
      payload_json TEXT NOT NULL DEFAULT '{}',
      last_processed_timestamp INTEGER,
      last_processed_revision TEXT,
      corporate_action_events_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS live_portfolios_updated_idx ON live_portfolios (updated_at, sort_order)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS live_positions (
      id TEXT PRIMARY KEY,
      account_id TEXT,
      portfolio_instrument_id TEXT NOT NULL,
      side TEXT NOT NULL,
      qty REAL NOT NULL,
      entry_price REAL NOT NULL,
      entry_timestamp INTEGER NOT NULL,
      entry_order_id TEXT NOT NULL,
      entry_order_type TEXT,
      entry_intrabar INTEGER,
      status TEXT NOT NULL,
      exit_price REAL,
      exit_timestamp INTEGER,
      exit_order_id TEXT,
      realized_pnl REAL,
      gross_realized_pnl REAL,
      entry_fee REAL,
      exit_fee REAL,
      total_fees REAL,
      stop_loss REAL,
      take_profit REAL,
      initial_risk REAL,
      exit_reason TEXT,
      intrabar_ambiguous INTEGER,
      engine_version TEXT,
      sizing_mode TEXT,
      risk_percent REAL,
      risk_budget REAL,
      margin_used REAL,
      payload_version INTEGER NOT NULL DEFAULT 1,
      payload_json TEXT NOT NULL DEFAULT '{}'
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS live_positions_portfolio_idx ON live_positions (portfolio_instrument_id)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS live_pending_orders (
      id TEXT PRIMARY KEY,
      account_id TEXT,
      portfolio_instrument_id TEXT NOT NULL,
      action TEXT NOT NULL,
      side TEXT NOT NULL,
      qty REAL NOT NULL,
      created_at INTEGER NOT NULL,
      position_id TEXT NOT NULL,
      rule_id TEXT,
      rule_version TEXT,
      price_band_json TEXT,
      reserved_cash REAL,
      status TEXT NOT NULL DEFAULT 'pending',
      execute_at_timestamp INTEGER,
      order_type TEXT,
      trigger_price REAL,
      original_qty REAL,
      filled_qty REAL,
      remaining_qty REAL,
      stop_loss REAL,
      take_profit REAL,
      sizing_mode TEXT,
      risk_percent REAL,
      risk_budget REAL,
      reserved_margin REAL,
      engine_version TEXT,
      payload_version INTEGER NOT NULL DEFAULT 1,
      payload_json TEXT NOT NULL DEFAULT '{}'
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS live_pending_orders_portfolio_idx ON live_pending_orders (portfolio_instrument_id)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS live_executions (
      id TEXT PRIMARY KEY,
      account_id TEXT,
      portfolio_instrument_id TEXT NOT NULL,
      order_id TEXT NOT NULL,
      position_id TEXT NOT NULL,
      action TEXT NOT NULL,
      side TEXT NOT NULL,
      qty REAL NOT NULL,
      price REAL NOT NULL,
      timestamp INTEGER NOT NULL,
      realized_pnl REAL NOT NULL,
      rule_id TEXT,
      rule_version TEXT,
      raw_price REAL,
      quote_price REAL,
      quote_side TEXT,
      fee REAL,
      price_impact_cost REAL,
      order_type TEXT,
      trigger_price REAL,
      reason TEXT,
      intrabar_ambiguous INTEGER,
      partial INTEGER,
      remaining_qty REAL,
      notional_value REAL,
      margin_impact REAL,
      account_currency TEXT,
      engine_version TEXT,
      payload_version INTEGER NOT NULL DEFAULT 1,
      payload_json TEXT NOT NULL DEFAULT '{}'
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS live_executions_portfolio_idx ON live_executions (portfolio_instrument_id, timestamp)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS live_order_rejections (
      id TEXT PRIMARY KEY,
      account_id TEXT,
      portfolio_instrument_id TEXT NOT NULL,
      order_id TEXT,
      code TEXT NOT NULL,
      message TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      rule_id TEXT NOT NULL,
      rule_version TEXT NOT NULL,
      payload_version INTEGER NOT NULL DEFAULT 1,
      payload_json TEXT NOT NULL DEFAULT '{}'
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS live_order_rejections_portfolio_idx ON live_order_rejections (portfolio_instrument_id, timestamp)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS live_command_receipts (
      command_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      command_type TEXT NOT NULL,
      command_json TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS live_command_receipts_account_idx ON live_command_receipts (account_id, created_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS live_watchlist (
      instrument_id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      market TEXT NOT NULL,
      latest_timestamp INTEGER NOT NULL,
      latest_close REAL NOT NULL,
      observation_timestamp INTEGER,
      observation_close REAL,
      entry_timestamp INTEGER,
      entry_price REAL,
      scan_timestamp INTEGER NOT NULL,
      preset_ids_json TEXT NOT NULL DEFAULT '[]',
      preset_names_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS live_watchlist_updated_idx ON live_watchlist (updated_at, sort_order)"),
    db.prepare("CREATE TABLE IF NOT EXISTS market_sync_runs (id TEXT PRIMARY KEY, market TEXT NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', feed TEXT NOT NULL DEFAULT 'sip', start_date TEXT NOT NULL, end_date TEXT NOT NULL, latest_session TEXT NOT NULL, total_symbols INTEGER NOT NULL DEFAULT 0, completed_symbols INTEGER NOT NULL DEFAULT 0, failed_symbols INTEGER NOT NULL DEFAULT 0, total_batches INTEGER NOT NULL DEFAULT 0, completed_batches INTEGER NOT NULL DEFAULT 0, inserted_count INTEGER NOT NULL DEFAULT 0, skipped_symbols INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, updated_at TEXT NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS market_sync_runs_status_idx ON market_sync_runs (market, status, updated_at)"),
    db.prepare("CREATE TABLE IF NOT EXISTS market_sync_batches (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, batch_no INTEGER NOT NULL, symbols_json TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL, session_count INTEGER NOT NULL, estimated_points INTEGER NOT NULL, url_length INTEGER NOT NULL, page_token TEXT, feed TEXT NOT NULL DEFAULT 'sip', status TEXT NOT NULL DEFAULT 'queued', attempt_count INTEGER NOT NULL DEFAULT 0, inserted_count INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, updated_at TEXT NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS market_sync_batches_run_status_idx ON market_sync_batches (run_id, status, batch_no)"),
    db.prepare("CREATE TABLE IF NOT EXISTS market_sync_locks (market TEXT PRIMARY KEY, run_id TEXT NOT NULL, lease_token TEXT NOT NULL, expires_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
  ]);

  const liveLedgerColumnMigrations: Record<string, Array<[string, string]>> = {
    live_accounts: [
      ["payload_json", "TEXT NOT NULL DEFAULT '{}'"],
      ["execution_engine_version", "TEXT NOT NULL DEFAULT 'legacy-next-open-v0'"],
      ["execution_switch_state", "TEXT NOT NULL DEFAULT 'legacy'"],
      ["switched_at", "TEXT"],
      ["previous_account_version", "INTEGER"],
      ["market_rule_version", "TEXT"],
      ["data_contract_version", "TEXT"],
      ["legacy_pending_order_count", "INTEGER NOT NULL DEFAULT 0"],
      ["carried_position_count", "INTEGER NOT NULL DEFAULT 0"],
      ["needs_user_action", "INTEGER NOT NULL DEFAULT 0"],
    ],
    live_portfolios: [
      ["account_id", "TEXT"],
      ["account_version", "INTEGER NOT NULL DEFAULT 1"],
      ["payload_version", "INTEGER NOT NULL DEFAULT 1"],
      ["payload_json", "TEXT NOT NULL DEFAULT '{}'"],
      ["last_processed_timestamp", "INTEGER"],
      ["last_processed_revision", "TEXT"],
      ["corporate_action_events_json", "TEXT NOT NULL DEFAULT '[]'"],
    ],
    live_positions: [
      ["account_id", "TEXT"],
      ["entry_order_type", "TEXT"],
      ["entry_intrabar", "INTEGER"],
      ["gross_realized_pnl", "REAL"],
      ["entry_fee", "REAL"],
      ["exit_fee", "REAL"],
      ["total_fees", "REAL"],
      ["stop_loss", "REAL"],
      ["take_profit", "REAL"],
      ["initial_risk", "REAL"],
      ["exit_reason", "TEXT"],
      ["intrabar_ambiguous", "INTEGER"],
      ["engine_version", "TEXT"],
      ["sizing_mode", "TEXT"],
      ["risk_percent", "REAL"],
      ["risk_budget", "REAL"],
      ["margin_used", "REAL"],
      ["payload_version", "INTEGER NOT NULL DEFAULT 1"],
      ["payload_json", "TEXT NOT NULL DEFAULT '{}'"],
    ],
    live_pending_orders: [
      ["account_id", "TEXT"],
      ["status", "TEXT NOT NULL DEFAULT 'pending'"],
      ["order_type", "TEXT"],
      ["trigger_price", "REAL"],
      ["original_qty", "REAL"],
      ["filled_qty", "REAL"],
      ["remaining_qty", "REAL"],
      ["stop_loss", "REAL"],
      ["take_profit", "REAL"],
      ["sizing_mode", "TEXT"],
      ["risk_percent", "REAL"],
      ["risk_budget", "REAL"],
      ["reserved_margin", "REAL"],
      ["engine_version", "TEXT"],
      ["payload_version", "INTEGER NOT NULL DEFAULT 1"],
      ["payload_json", "TEXT NOT NULL DEFAULT '{}'"],
    ],
    live_executions: [
      ["account_id", "TEXT"],
      ["raw_price", "REAL"],
      ["quote_price", "REAL"],
      ["quote_side", "TEXT"],
      ["fee", "REAL"],
      ["price_impact_cost", "REAL"],
      ["order_type", "TEXT"],
      ["trigger_price", "REAL"],
      ["reason", "TEXT"],
      ["intrabar_ambiguous", "INTEGER"],
      ["partial", "INTEGER"],
      ["remaining_qty", "REAL"],
      ["notional_value", "REAL"],
      ["margin_impact", "REAL"],
      ["account_currency", "TEXT"],
      ["engine_version", "TEXT"],
      ["payload_version", "INTEGER NOT NULL DEFAULT 1"],
      ["payload_json", "TEXT NOT NULL DEFAULT '{}'"],
    ],
    live_order_rejections: [
      ["account_id", "TEXT"],
      ["payload_version", "INTEGER NOT NULL DEFAULT 1"],
      ["payload_json", "TEXT NOT NULL DEFAULT '{}'"],
    ],
  };
  for (const [table, columns] of Object.entries(liveLedgerColumnMigrations)) {
    const tableInfo = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
    const existingColumns = new Set(tableInfo.results.map((column) => column.name));
    for (const [name, definition] of columns) {
      if (!existingColumns.has(name)) {
        await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`).run();
      }
    }
  }
  await db.prepare("CREATE INDEX IF NOT EXISTS live_portfolios_account_idx ON live_portfolios (account_id, updated_at)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS live_positions_account_idx ON live_positions (account_id, id)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS live_pending_orders_account_idx ON live_pending_orders (account_id, created_at, id)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS live_executions_account_idx ON live_executions (account_id, timestamp, id)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS live_order_rejections_account_idx ON live_order_rejections (account_id, timestamp, id)").run();

  const jobColumns = await db.prepare("PRAGMA table_info(data_download_jobs)").all<{ name: string }>();
  const existingJobColumns = new Set(jobColumns.results.map((column) => column.name));
  const jobColumnMigrations = [
    ["sync_run_id", "TEXT"],
    ["sync_batch_id", "TEXT"],
    ["sync_mode", "TEXT"],
    ["attempt_count", "INTEGER NOT NULL DEFAULT 0"],
    ["feed", "TEXT"],
    ["terminal_reason", "TEXT"],
  ] as const;
  for (const [name, definition] of jobColumnMigrations) {
    if (!existingJobColumns.has(name)) {
      await db.prepare(`ALTER TABLE data_download_jobs ADD COLUMN ${name} ${definition}`).run();
    }
  }
  await db.prepare("CREATE INDEX IF NOT EXISTS data_download_jobs_sync_batch_idx ON data_download_jobs (sync_run_id, sync_batch_id, status)").run();
  const runColumns = await db.prepare("PRAGMA table_info(market_sync_runs)").all<{ name: string }>();
  if (!runColumns.results.some((column) => column.name === "skipped_symbols")) {
    await db.prepare("ALTER TABLE market_sync_runs ADD COLUMN skipped_symbols INTEGER NOT NULL DEFAULT 0").run();
  }

  const sessionColumns = await db.prepare("PRAGMA table_info(training_sessions)").all<{ name: string }>();
  if (!sessionColumns.results.some((column) => column.name === "data_snapshot_id")) {
    await db.prepare("ALTER TABLE training_sessions ADD COLUMN data_snapshot_id TEXT").run();
  }
  if (!sessionColumns.results.some((column) => column.name === "deleted_at")) {
    await db.prepare("ALTER TABLE training_sessions ADD COLUMN deleted_at TEXT").run();
  }
  await db.prepare("CREATE INDEX IF NOT EXISTS training_sessions_deleted_idx ON training_sessions (deleted_at, updated_at)").run();
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
  const existingSnapshotColumns = new Set(snapshotColumns.results.map((column) => column.name));
  const snapshotVersionColumnMigrations = [
    ["format_version", "INTEGER NOT NULL DEFAULT 1"],
    ["status", "TEXT NOT NULL DEFAULT 'ready'"],
    ["source_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["normalization_version", "INTEGER NOT NULL DEFAULT 1"],
    ["chunk_count", "INTEGER NOT NULL DEFAULT 0"],
  ] as const;
  for (const [name, definition] of snapshotVersionColumnMigrations) {
    if (!existingSnapshotColumns.has(name)) {
      await db.prepare(`ALTER TABLE data_snapshots ADD COLUMN ${name} ${definition}`).run();
    }
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
  const sourceCoverageBackfill = await db.prepare(
    "SELECT value FROM app_metadata WHERE key = 'candle_coverage_backfilled_v2'",
  ).first();
  if (!sourceCoverageBackfill) {
    await db.prepare("INSERT OR REPLACE INTO candle_coverage " +
      "(instrument_id, timeframe, adjustment_type, source, bar_count, " +
      "first_timestamp, last_timestamp, updated_at) " +
      "SELECT instrument_id, timeframe, adjustment_type, source, COUNT(*), " +
      "MIN(timestamp), MAX(timestamp), ? FROM candles " +
      "WHERE source IN ('alpaca-sip', 'alpaca-iex') " +
      "GROUP BY instrument_id, timeframe, adjustment_type, source").bind(new Date().toISOString()).run();
    await db.prepare(
      "INSERT OR REPLACE INTO app_metadata (key, value) VALUES ('candle_coverage_backfilled_v2', '1')",
    ).run();
  }
  const legacyIexCleanup = await db.prepare(
    "SELECT value FROM app_metadata WHERE key = 'alpaca_iex_removed_v1'",
  ).first();
  if (!legacyIexCleanup) {
    // Alpaca US history is now SIP-only.  Remove only the legacy IEX market
    // library and its coverage index; immutable training snapshots live in a
    // separate table and must remain reproducible.
    await db.batch([
      db.prepare("DELETE FROM candles WHERE source = 'alpaca-iex'"),
      db.prepare("DELETE FROM candle_coverage WHERE source = 'alpaca-iex'"),
      db.prepare(
        "INSERT OR REPLACE INTO app_metadata (key, value) VALUES ('alpaca_iex_removed_v1', '1')",
      ),
    ]);
  }
  await migrateLegacyLiveData(db);
}
