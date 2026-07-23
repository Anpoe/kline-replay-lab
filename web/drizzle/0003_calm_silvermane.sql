CREATE TABLE `data_download_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`instrument_id` text NOT NULL,
	`vendor_symbol` text NOT NULL,
	`instrument_name` text NOT NULL,
	`market` text NOT NULL,
	`timeframe` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`adjustment_type` text DEFAULT 'none' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`cursor_json` text DEFAULT '{}' NOT NULL,
	`inserted_count` integer DEFAULT 0 NOT NULL,
	`quality_report_json` text DEFAULT '{}' NOT NULL,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `data_download_jobs_status_idx` ON `data_download_jobs` (`status`,`updated_at`);