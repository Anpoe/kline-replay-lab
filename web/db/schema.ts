import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const instruments = sqliteTable("instruments", {
  id: text("id").primaryKey(),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  market: text("market").notNull(),
  timezone: text("timezone").notNull(),
  pricePrecision: integer("price_precision").notNull().default(2),
});

export const candles = sqliteTable(
  "candles",
  {
    instrumentId: text("instrument_id").notNull(),
    timeframe: text("timeframe").notNull(),
    timestamp: integer("timestamp").notNull(),
    open: real("open").notNull(),
    high: real("high").notNull(),
    low: real("low").notNull(),
    close: real("close").notNull(),
    volume: real("volume"),
    turnover: real("turnover"),
    adjustmentType: text("adjustment_type").notNull().default("none"),
    source: text("source").notNull().default("import"),
    qualityFlags: text("quality_flags").notNull().default("[]"),
  },
  (table) => [
    primaryKey({
      columns: [
        table.instrumentId,
        table.timeframe,
        table.timestamp,
        table.adjustmentType,
      ],
    }),
  ],
);

export const candleCoverage = sqliteTable(
  "candle_coverage",
  {
    instrumentId: text("instrument_id").notNull(),
    timeframe: text("timeframe").notNull(),
    adjustmentType: text("adjustment_type").notNull(),
    source: text("source").notNull(),
    barCount: integer("bar_count").notNull(),
    firstTimestamp: integer("first_timestamp").notNull(),
    lastTimestamp: integer("last_timestamp").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.instrumentId, table.timeframe, table.adjustmentType, table.source],
    }),
    index("candle_coverage_lookup_idx").on(
      table.instrumentId,
      table.timeframe,
      table.adjustmentType,
      table.source,
    ),
  ],
);

export const trainingSessions = sqliteTable(
  "training_sessions",
  {
    id: text("id").primaryKey(),
    instrumentId: text("instrument_id").notNull(),
    timeframe: text("timeframe").notNull(),
    dataSnapshotId: text("data_snapshot_id"),
    stateJson: text("state_json").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [index("training_sessions_deleted_idx").on(table.deletedAt, table.updatedAt)],
);

export const dataSnapshots = sqliteTable(
  "data_snapshots",
  {
    id: text("id").primaryKey(),
    contentHash: text("content_hash").notNull().unique(),
    instrumentId: text("instrument_id").notNull(),
    timeframe: text("timeframe").notNull(),
    adjustmentType: text("adjustment_type").notNull(),
    instrumentJson: text("instrument_json").notNull(),
    candlesJson: text("candles_json").notNull(),
    barCount: integer("bar_count").notNull(),
    firstTimestamp: integer("first_timestamp").notNull(),
    lastTimestamp: integer("last_timestamp").notNull(),
    createdAt: text("created_at").notNull(),
    baseSnapshotId: text("base_snapshot_id"),
    storageMode: text("storage_mode").notNull().default("full"),
    removedTimestampsJson: text("removed_timestamps_json").notNull().default("[]"),
    chainDepth: integer("chain_depth").notNull().default(0),
    storedBarCount: integer("stored_bar_count").notNull().default(0),
    formatVersion: integer("format_version").notNull().default(1),
    status: text("status").notNull().default("ready"),
    sourceJson: text("source_json").notNull().default("{}"),
    normalizationVersion: integer("normalization_version").notNull().default(1),
    chunkCount: integer("chunk_count").notNull().default(0),
  },
  (table) => [
    index("data_snapshots_lookup_idx").on(
      table.instrumentId,
      table.timeframe,
      table.adjustmentType,
      table.createdAt,
    ),
  ],
);

export const candleChunks = sqliteTable("candle_chunks", {
  chunkHash: text("chunk_hash").primaryKey(),
  encoding: text("encoding").notNull(),
  payloadJson: text("payload_json").notNull(),
  barCount: integer("bar_count").notNull(),
  firstTimestamp: integer("first_timestamp").notNull(),
  lastTimestamp: integer("last_timestamp").notNull(),
  byteSize: integer("byte_size").notNull(),
  createdAt: text("created_at").notNull(),
});

export const dataSnapshotChunks = sqliteTable(
  "data_snapshot_chunks",
  {
    snapshotId: text("snapshot_id").notNull(),
    sequence: integer("sequence").notNull(),
    bucketKey: text("bucket_key").notNull(),
    chunkHash: text("chunk_hash").notNull(),
    firstTimestamp: integer("first_timestamp").notNull(),
    lastTimestamp: integer("last_timestamp").notNull(),
    barCount: integer("bar_count").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.snapshotId, table.sequence] }),
    index("data_snapshot_chunks_snapshot_time_idx").on(
      table.snapshotId,
      table.firstTimestamp,
      table.lastTimestamp,
    ),
    index("data_snapshot_chunks_chunk_hash_idx").on(table.chunkHash),
  ],
);

export const sessionEvents = sqliteTable(
  "session_events",
  {
    eventId: text("event_id").primaryKey(),
    sessionId: text("session_id").notNull(),
    sequence: integer("sequence").notNull(),
    eventType: text("event_type").notNull(),
    barTimestamp: integer("bar_timestamp"),
    payloadJson: text("payload_json").notNull(),
    occurredAt: text("occurred_at").notNull(),
  },
  (table) => [
    uniqueIndex("session_events_session_sequence_unique").on(table.sessionId, table.sequence),
    index("session_events_lookup_idx").on(table.sessionId, table.sequence),
  ],
);

export const dataDownloadJobs = sqliteTable(
  "data_download_jobs",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    instrumentId: text("instrument_id").notNull(),
    vendorSymbol: text("vendor_symbol").notNull(),
    instrumentName: text("instrument_name").notNull(),
    market: text("market").notNull(),
    timeframe: text("timeframe").notNull(),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    adjustmentType: text("adjustment_type").notNull().default("none"),
    status: text("status").notNull().default("queued"),
    cursorJson: text("cursor_json").notNull().default("{}"),
    insertedCount: integer("inserted_count").notNull().default(0),
    qualityReportJson: text("quality_report_json").notNull().default("{}"),
    lastError: text("last_error"),
    syncRunId: text("sync_run_id"),
    syncBatchId: text("sync_batch_id"),
    syncMode: text("sync_mode"),
    attemptCount: integer("attempt_count").notNull().default(0),
    feed: text("feed"),
    terminalReason: text("terminal_reason"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("data_download_jobs_status_idx").on(table.status, table.updatedAt),
    index("data_download_jobs_sync_batch_idx").on(table.syncRunId, table.syncBatchId, table.status),
  ],
);

export const fxDataTasks = sqliteTable(
  "fx_data_tasks",
  {
    id: text("id").primaryKey(),
    mode: text("mode").notNull(),
    instrumentId: text("instrument_id").notNull(),
    pairLabel: text("pair_label").notNull(),
    vendorSymbol: text("vendor_symbol").notNull(),
    dukascopySymbol: text("dukascopy_symbol").notNull(),
    // Kept for compatibility with the original task-table shape. New tasks
    // store the Dukascopy symbol here; no provider-specific API exposes it.
    legacyVendorSymbol: text("twelve_data_symbol").notNull(),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    rawTimeframe: text("raw_timeframe").notNull().default("1m"),
    targetTimeframesJson: text("target_timeframes_json").notNull().default('["5m","1h","1d","1w"]'),
    keepRawCsv: integer("keep_raw_csv").notNull().default(0),
    status: text("status").notNull().default("queued"),
    stage: text("stage").notNull().default("queued"),
    stageProgress: real("stage_progress").notNull().default(0),
    progressJson: text("progress_json").notNull().default("{}"),
    cursorJson: text("cursor_json").notNull().default("{}"),
    qualityReportJson: text("quality_report_json").notNull().default("{}"),
    insertedCount: integer("inserted_count").notNull().default(0),
    message: text("message"),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
  },
  (table) => [index("fx_data_tasks_status_idx").on(table.status, table.updatedAt)],
);

export const marketSyncRuns = sqliteTable(
  "market_sync_runs",
  {
    id: text("id").primaryKey(),
    market: text("market").notNull(),
    mode: text("mode").notNull(),
    status: text("status").notNull().default("queued"),
    feed: text("feed").notNull().default("sip"),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    latestSession: text("latest_session").notNull(),
    totalSymbols: integer("total_symbols").notNull().default(0),
    completedSymbols: integer("completed_symbols").notNull().default(0),
    failedSymbols: integer("failed_symbols").notNull().default(0),
    totalBatches: integer("total_batches").notNull().default(0),
    completedBatches: integer("completed_batches").notNull().default(0),
    insertedCount: integer("inserted_count").notNull().default(0),
    skippedSymbols: integer("skipped_symbols").notNull().default(0),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("market_sync_runs_status_idx").on(table.market, table.status, table.updatedAt),
  ],
);

export const marketSyncBatches = sqliteTable(
  "market_sync_batches",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    batchNo: integer("batch_no").notNull(),
    symbolsJson: text("symbols_json").notNull(),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    sessionCount: integer("session_count").notNull(),
    estimatedPoints: integer("estimated_points").notNull(),
    urlLength: integer("url_length").notNull(),
    pageToken: text("page_token"),
    feed: text("feed").notNull().default("sip"),
    status: text("status").notNull().default("queued"),
    attemptCount: integer("attempt_count").notNull().default(0),
    insertedCount: integer("inserted_count").notNull().default(0),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("market_sync_batches_run_status_idx").on(table.runId, table.status, table.batchNo),
  ],
);

export const marketSyncLocks = sqliteTable("market_sync_locks", {
  market: text("market").primaryKey(),
  runId: text("run_id").notNull(),
  leaseToken: text("lease_token").notNull(),
  expiresAt: text("expires_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const localProviderCredentials = sqliteTable("local_provider_credentials", {
  provider: text("provider").primaryKey(),
  credentialsJson: text("credentials_json").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const livePortfolios = sqliteTable(
  "live_portfolios",
  {
    instrumentId: text("instrument_id").primaryKey(),
    symbol: text("symbol").notNull(),
    name: text("name").notNull(),
    market: text("market").notNull(),
    latestTimestamp: integer("latest_timestamp").notNull(),
    latestClose: real("latest_close").notNull(),
    scanTimestamp: integer("scan_timestamp").notNull(),
    presetIdsJson: text("preset_ids_json").notNull().default("[]"),
    presetNamesJson: text("preset_names_json").notNull().default("[]"),
    decisionJson: text("decision_json"),
    decisionSubmissionsJson: text("decision_submissions_json").notNull().default("[]"),
    tradingMode: text("trading_mode").notNull().default("return"),
    initialCapital: real("initial_capital").notNull().default(0),
    cashBalance: real("cash_balance").notNull().default(0),
    updatedAt: text("updated_at").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("live_portfolios_updated_idx").on(table.updatedAt, table.sortOrder)],
);

export const livePositions = sqliteTable(
  "live_positions",
  {
    id: text("id").primaryKey(),
    portfolioInstrumentId: text("portfolio_instrument_id").notNull(),
    side: text("side").notNull(),
    qty: real("qty").notNull(),
    entryPrice: real("entry_price").notNull(),
    entryTimestamp: integer("entry_timestamp").notNull(),
    entryOrderId: text("entry_order_id").notNull(),
    status: text("status").notNull(),
    exitPrice: real("exit_price"),
    exitTimestamp: integer("exit_timestamp"),
    exitOrderId: text("exit_order_id"),
    realizedPnl: real("realized_pnl"),
  },
  (table) => [index("live_positions_portfolio_idx").on(table.portfolioInstrumentId)],
);

export const livePendingOrders = sqliteTable(
  "live_pending_orders",
  {
    id: text("id").primaryKey(),
    portfolioInstrumentId: text("portfolio_instrument_id").notNull(),
    action: text("action").notNull(),
    side: text("side").notNull(),
    qty: real("qty").notNull(),
    createdAt: integer("created_at").notNull(),
    positionId: text("position_id").notNull(),
    ruleId: text("rule_id"),
    ruleVersion: text("rule_version"),
    priceBandJson: text("price_band_json"),
    reservedCash: real("reserved_cash"),
    executeAtTimestamp: integer("execute_at_timestamp"),
  },
  (table) => [index("live_pending_orders_portfolio_idx").on(table.portfolioInstrumentId)],
);

export const liveExecutions = sqliteTable(
  "live_executions",
  {
    id: text("id").primaryKey(),
    portfolioInstrumentId: text("portfolio_instrument_id").notNull(),
    orderId: text("order_id").notNull(),
    positionId: text("position_id").notNull(),
    action: text("action").notNull(),
    side: text("side").notNull(),
    qty: real("qty").notNull(),
    price: real("price").notNull(),
    timestamp: integer("timestamp").notNull(),
    realizedPnl: real("realized_pnl").notNull(),
    ruleId: text("rule_id"),
    ruleVersion: text("rule_version"),
  },
  (table) => [index("live_executions_portfolio_idx").on(table.portfolioInstrumentId, table.timestamp)],
);

export const liveOrderRejections = sqliteTable(
  "live_order_rejections",
  {
    id: text("id").primaryKey(),
    portfolioInstrumentId: text("portfolio_instrument_id").notNull(),
    orderId: text("order_id"),
    code: text("code").notNull(),
    message: text("message").notNull(),
    timestamp: integer("timestamp").notNull(),
    ruleId: text("rule_id").notNull(),
    ruleVersion: text("rule_version").notNull(),
  },
  (table) => [index("live_order_rejections_portfolio_idx").on(table.portfolioInstrumentId, table.timestamp)],
);

export const liveWatchlist = sqliteTable(
  "live_watchlist",
  {
    instrumentId: text("instrument_id").primaryKey(),
    symbol: text("symbol").notNull(),
    name: text("name").notNull(),
    market: text("market").notNull(),
    latestTimestamp: integer("latest_timestamp").notNull(),
    latestClose: real("latest_close").notNull(),
    observationTimestamp: integer("observation_timestamp"),
    observationClose: real("observation_close"),
    entryTimestamp: integer("entry_timestamp"),
    entryPrice: real("entry_price"),
    scanTimestamp: integer("scan_timestamp").notNull(),
    presetIdsJson: text("preset_ids_json").notNull().default("[]"),
    presetNamesJson: text("preset_names_json").notNull().default("[]"),
    updatedAt: text("updated_at").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("live_watchlist_updated_idx").on(table.updatedAt, table.sortOrder)],
);

export const appMetadata = sqliteTable("app_metadata", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
