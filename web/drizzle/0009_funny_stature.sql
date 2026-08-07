CREATE TABLE `fx_data_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`instrument_id` text NOT NULL,
	`pair_label` text NOT NULL,
	`vendor_symbol` text NOT NULL,
	`dukascopy_symbol` text NOT NULL,
	`twelve_data_symbol` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`raw_timeframe` text DEFAULT '1m' NOT NULL,
	`target_timeframes_json` text DEFAULT '["5m","1h","1d","1w"]' NOT NULL,
	`keep_raw_csv` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`stage` text DEFAULT 'queued' NOT NULL,
	`stage_progress` real DEFAULT 0 NOT NULL,
	`progress_json` text DEFAULT '{}' NOT NULL,
	`cursor_json` text DEFAULT '{}' NOT NULL,
	`quality_report_json` text DEFAULT '{}' NOT NULL,
	`inserted_count` integer DEFAULT 0 NOT NULL,
	`message` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`started_at` text,
	`finished_at` text
);
--> statement-breakpoint
CREATE INDEX `fx_data_tasks_status_idx` ON `fx_data_tasks` (`status`,`updated_at`);