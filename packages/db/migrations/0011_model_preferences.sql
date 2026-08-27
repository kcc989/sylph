ALTER TABLE `open_code_connection` RENAME TO `open_code_connection_legacy`;
DROP INDEX `open_code_connection_organization_id_idx`;
CREATE TABLE `open_code_connection` (
  `organization_id` text NOT NULL,
  `configured_by_user_id` text NOT NULL,
  `provider_id` text NOT NULL,
  `auth_method` text NOT NULL,
  `encrypted_credential` text NOT NULL,
  `encryption_iv` text NOT NULL,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch()) NOT NULL,
  PRIMARY KEY (`organization_id`, `provider_id`),
  FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`configured_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict
);
CREATE INDEX `open_code_connection_organization_id_idx` ON `open_code_connection` (`organization_id`);
INSERT INTO `open_code_connection` SELECT `organization_id`, `configured_by_user_id`, `provider_id`, `auth_method`, `encrypted_credential`, `encryption_iv`, `created_at`, `updated_at` FROM `open_code_connection_legacy`;

ALTER TABLE `user_open_code_connection` RENAME TO `user_open_code_connection_legacy`;
DROP INDEX `user_open_code_connection_user_id_idx`;
CREATE TABLE `user_open_code_connection` (
  `user_id` text NOT NULL,
  `provider_id` text NOT NULL,
  `auth_method` text NOT NULL,
  `encrypted_credential` text NOT NULL,
  `encryption_iv` text NOT NULL,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch()) NOT NULL,
  PRIMARY KEY (`user_id`, `provider_id`),
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `user_open_code_connection_user_id_idx` ON `user_open_code_connection` (`user_id`);
INSERT INTO `user_open_code_connection` SELECT `user_id`, `provider_id`, `auth_method`, `encrypted_credential`, `encryption_iv`, `created_at`, `updated_at` FROM `user_open_code_connection_legacy`;

CREATE TABLE `organization_provider_model` (
  `organization_id` text NOT NULL,
  `provider_id` text NOT NULL,
  `model_id` text NOT NULL,
  `name` text NOT NULL,
  `discovered_at` integer DEFAULT (unixepoch()) NOT NULL,
  PRIMARY KEY (`organization_id`, `provider_id`, `model_id`),
  FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `organization_provider_model_organization_id_idx` ON `organization_provider_model` (`organization_id`);
INSERT INTO `organization_provider_model` (`organization_id`, `provider_id`, `model_id`, `name`, `discovered_at`) SELECT `organization_id`, `provider_id`, `model_id`, `model_id`, `updated_at` FROM `open_code_connection_legacy`;

CREATE TABLE `user_provider_model` (
  `user_id` text NOT NULL,
  `provider_id` text NOT NULL,
  `model_id` text NOT NULL,
  `name` text NOT NULL,
  `discovered_at` integer DEFAULT (unixepoch()) NOT NULL,
  PRIMARY KEY (`user_id`, `provider_id`, `model_id`),
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `user_provider_model_user_id_idx` ON `user_provider_model` (`user_id`);
INSERT INTO `user_provider_model` (`user_id`, `provider_id`, `model_id`, `name`, `discovered_at`) SELECT `user_id`, `provider_id`, `model_id`, `model_id`, `updated_at` FROM `user_open_code_connection_legacy`;

CREATE TABLE `organization_model_preference` (
  `organization_id` text PRIMARY KEY NOT NULL,
  `provider_id` text NOT NULL,
  `model_id` text NOT NULL,
  `configured_by_user_id` text NOT NULL,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch()) NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`configured_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict
);
INSERT INTO `organization_model_preference` (`organization_id`, `provider_id`, `model_id`, `configured_by_user_id`, `created_at`, `updated_at`) SELECT `organization_id`, `provider_id`, `model_id`, `configured_by_user_id`, `created_at`, `updated_at` FROM `open_code_connection_legacy` WHERE `is_default` = 1;

CREATE TABLE `user_model_preference` (
  `user_id` text PRIMARY KEY NOT NULL,
  `provider_id` text NOT NULL,
  `model_id` text NOT NULL,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch()) NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
INSERT INTO `user_model_preference` (`user_id`, `provider_id`, `model_id`, `created_at`, `updated_at`) SELECT `user_id`, `provider_id`, `model_id`, `created_at`, `updated_at` FROM `user_open_code_connection_legacy` WHERE `is_default` = 1;

DROP TABLE `open_code_connection_legacy`;
DROP TABLE `user_open_code_connection_legacy`;
