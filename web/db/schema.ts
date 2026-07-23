import { integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
  stateJson: text("state_json").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
