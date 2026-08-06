CREATE TABLE `live_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_instrument_id` text NOT NULL,
	`order_id` text NOT NULL,
	`position_id` text NOT NULL,
	`action` text NOT NULL,
	`side` text NOT NULL,
	`qty` real NOT NULL,
	`price` real NOT NULL,
	`timestamp` integer NOT NULL,
	`realized_pnl` real NOT NULL,
	`rule_id` text,
	`rule_version` text
);
--> statement-breakpoint
CREATE INDEX `live_executions_portfolio_idx` ON `live_executions` (`portfolio_instrument_id`,`timestamp`);--> statement-breakpoint
CREATE TABLE `live_order_rejections` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_instrument_id` text NOT NULL,
	`order_id` text,
	`code` text NOT NULL,
	`message` text NOT NULL,
	`timestamp` integer NOT NULL,
	`rule_id` text NOT NULL,
	`rule_version` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `live_order_rejections_portfolio_idx` ON `live_order_rejections` (`portfolio_instrument_id`,`timestamp`);--> statement-breakpoint
CREATE TABLE `live_pending_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_instrument_id` text NOT NULL,
	`action` text NOT NULL,
	`side` text NOT NULL,
	`qty` real NOT NULL,
	`created_at` integer NOT NULL,
	`position_id` text NOT NULL,
	`rule_id` text,
	`rule_version` text,
	`price_band_json` text,
	`reserved_cash` real,
	`execute_at_timestamp` integer
);
--> statement-breakpoint
CREATE INDEX `live_pending_orders_portfolio_idx` ON `live_pending_orders` (`portfolio_instrument_id`);--> statement-breakpoint
CREATE TABLE `live_portfolios` (
	`instrument_id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`name` text NOT NULL,
	`market` text NOT NULL,
	`latest_timestamp` integer NOT NULL,
	`latest_close` real NOT NULL,
	`scan_timestamp` integer NOT NULL,
	`preset_ids_json` text DEFAULT '[]' NOT NULL,
	`preset_names_json` text DEFAULT '[]' NOT NULL,
	`decision_json` text,
	`decision_submissions_json` text DEFAULT '[]' NOT NULL,
	`trading_mode` text DEFAULT 'return' NOT NULL,
	`initial_capital` real DEFAULT 0 NOT NULL,
	`cash_balance` real DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `live_portfolios_updated_idx` ON `live_portfolios` (`updated_at`,`sort_order`);--> statement-breakpoint
CREATE TABLE `live_positions` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_instrument_id` text NOT NULL,
	`side` text NOT NULL,
	`qty` real NOT NULL,
	`entry_price` real NOT NULL,
	`entry_timestamp` integer NOT NULL,
	`entry_order_id` text NOT NULL,
	`status` text NOT NULL,
	`exit_price` real,
	`exit_timestamp` integer,
	`exit_order_id` text,
	`realized_pnl` real
);
--> statement-breakpoint
CREATE INDEX `live_positions_portfolio_idx` ON `live_positions` (`portfolio_instrument_id`);--> statement-breakpoint
CREATE TABLE `live_watchlist` (
	`instrument_id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`name` text NOT NULL,
	`market` text NOT NULL,
	`latest_timestamp` integer NOT NULL,
	`latest_close` real NOT NULL,
	`observation_timestamp` integer,
	`observation_close` real,
	`entry_timestamp` integer,
	`entry_price` real,
	`scan_timestamp` integer NOT NULL,
	`preset_ids_json` text DEFAULT '[]' NOT NULL,
	`preset_names_json` text DEFAULT '[]' NOT NULL,
	`updated_at` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `live_watchlist_updated_idx` ON `live_watchlist` (`updated_at`,`sort_order`);