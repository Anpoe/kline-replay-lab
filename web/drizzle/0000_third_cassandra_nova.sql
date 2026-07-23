CREATE TABLE `candles` (
	`instrument_id` text NOT NULL,
	`timeframe` text NOT NULL,
	`timestamp` integer NOT NULL,
	`open` real NOT NULL,
	`high` real NOT NULL,
	`low` real NOT NULL,
	`close` real NOT NULL,
	`volume` real,
	`turnover` real,
	`adjustment_type` text DEFAULT 'none' NOT NULL,
	`source` text DEFAULT 'import' NOT NULL,
	`quality_flags` text DEFAULT '[]' NOT NULL,
	PRIMARY KEY(`instrument_id`, `timeframe`, `timestamp`, `adjustment_type`)
);
--> statement-breakpoint
CREATE TABLE `instruments` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`name` text NOT NULL,
	`market` text NOT NULL,
	`timezone` text NOT NULL,
	`price_precision` integer DEFAULT 2 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `training_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`instrument_id` text NOT NULL,
	`timeframe` text NOT NULL,
	`state_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
