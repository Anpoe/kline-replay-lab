ALTER TABLE `training_sessions` ADD `deleted_at` text;--> statement-breakpoint
CREATE INDEX `training_sessions_deleted_idx` ON `training_sessions` (`deleted_at`,`updated_at`);