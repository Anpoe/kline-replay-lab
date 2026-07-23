CREATE INDEX `data_snapshots_lookup_idx` ON `data_snapshots` (`instrument_id`,`timeframe`,`adjustment_type`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_events_session_sequence_unique` ON `session_events` (`session_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `session_events_lookup_idx` ON `session_events` (`session_id`,`sequence`);