CREATE TABLE `market_sync_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`batch_no` integer NOT NULL,
	`symbols_json` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`session_count` integer NOT NULL,
	`estimated_points` integer NOT NULL,
	`url_length` integer NOT NULL,
	`page_token` text,
	`feed` text DEFAULT 'sip' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`inserted_count` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `market_sync_batches_run_status_idx` ON `market_sync_batches` (`run_id`,`status`,`batch_no`);--> statement-breakpoint
CREATE TABLE `market_sync_locks` (
	`market` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`lease_token` text NOT NULL,
	`expires_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `market_sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`market` text NOT NULL,
	`mode` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`feed` text DEFAULT 'sip' NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`latest_session` text NOT NULL,
	`total_symbols` integer DEFAULT 0 NOT NULL,
	`completed_symbols` integer DEFAULT 0 NOT NULL,
	`failed_symbols` integer DEFAULT 0 NOT NULL,
	`total_batches` integer DEFAULT 0 NOT NULL,
	`completed_batches` integer DEFAULT 0 NOT NULL,
	`inserted_count` integer DEFAULT 0 NOT NULL,
	`skipped_symbols` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `market_sync_runs_status_idx` ON `market_sync_runs` (`market`,`status`,`updated_at`);--> statement-breakpoint
ALTER TABLE `data_download_jobs` ADD `sync_run_id` text;--> statement-breakpoint
ALTER TABLE `data_download_jobs` ADD `sync_batch_id` text;--> statement-breakpoint
ALTER TABLE `data_download_jobs` ADD `sync_mode` text;--> statement-breakpoint
ALTER TABLE `data_download_jobs` ADD `attempt_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `data_download_jobs` ADD `feed` text;--> statement-breakpoint
ALTER TABLE `data_download_jobs` ADD `terminal_reason` text;--> statement-breakpoint
CREATE INDEX `data_download_jobs_sync_batch_idx` ON `data_download_jobs` (`sync_run_id`,`sync_batch_id`,`status`);
