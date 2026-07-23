CREATE TABLE `local_provider_credentials` (
	`provider` text PRIMARY KEY NOT NULL,
	`credentials_json` text NOT NULL,
	`updated_at` text NOT NULL
);
