ALTER TABLE `workspace` ADD `creation_key` text;
ALTER TABLE `workspace` ADD `branch_name` text;
CREATE UNIQUE INDEX `workspace_project_creation_key_unique` ON `workspace` (`project_id`,`creation_key`);
CREATE UNIQUE INDEX `workspace_project_branch_name_unique` ON `workspace` (`project_id`,`branch_name`);
