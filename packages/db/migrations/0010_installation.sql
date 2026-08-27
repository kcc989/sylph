CREATE TABLE `installation` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text,
  `claimed_by_user_id` text,
  `claimed_at` integer,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`claimed_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict
);

INSERT INTO `installation` (`id`) VALUES ('default');

UPDATE `installation`
SET
  `organization_id` = (SELECT `id` FROM `organization` ORDER BY `created_at` LIMIT 1),
  `claimed_by_user_id` = (
    SELECT `user_id`
    FROM `member`
    WHERE `organization_id` = (SELECT `id` FROM `organization` ORDER BY `created_at` LIMIT 1)
      AND `role` IN ('owner', 'admin')
    ORDER BY `created_at`
    LIMIT 1
  ),
  `claimed_at` = CASE WHEN EXISTS (SELECT 1 FROM `organization`) THEN unixepoch() ELSE NULL END
WHERE EXISTS (SELECT 1 FROM `organization`);
