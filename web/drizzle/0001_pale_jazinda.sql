CREATE TABLE `data_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`content_hash` text NOT NULL,
	`instrument_id` text NOT NULL,
	`timeframe` text NOT NULL,
	`adjustment_type` text NOT NULL,
	`instrument_json` text NOT NULL,
	`candles_json` text NOT NULL,
	`bar_count` integer NOT NULL,
	`first_timestamp` integer NOT NULL,
	`last_timestamp` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `data_snapshots_content_hash_unique` ON `data_snapshots` (`content_hash`);--> statement-breakpoint
CREATE TABLE `session_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`event_type` text NOT NULL,
	`bar_timestamp` integer,
	`payload_json` text NOT NULL,
	`occurred_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `training_sessions` ADD `data_snapshot_id` text;