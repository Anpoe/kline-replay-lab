ALTER TABLE `data_snapshots` ADD `base_snapshot_id` text;--> statement-breakpoint
ALTER TABLE `data_snapshots` ADD `storage_mode` text DEFAULT 'full' NOT NULL;--> statement-breakpoint
ALTER TABLE `data_snapshots` ADD `removed_timestamps_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `data_snapshots` ADD `chain_depth` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `data_snapshots` ADD `stored_bar_count` integer DEFAULT 0 NOT NULL;