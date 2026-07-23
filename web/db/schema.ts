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

export const trainingSessions = sqliteTable("training_sessions", {
  id: text("id").primaryKey(),
  instrumentId: text("instrument_id").notNull(),
  timeframe: text("timeframe").notNull(),
  dataSnapshotId: text("data_snapshot_id"),
  stateJson: text("state_json").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

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
