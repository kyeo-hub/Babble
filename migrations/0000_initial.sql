-- Migration number: 0000 	DO NOT MODIFY THIS FILE
-- D1 Migration

CREATE TABLE `users` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `uid` text NOT NULL UNIQUE,
  `username` text NOT NULL UNIQUE,
  `password_hash` text NOT NULL,
  `role` text NOT NULL DEFAULT 'user',
  `created_ts` integer NOT NULL,
  `updated_ts` integer NOT NULL
);

CREATE TABLE `api_tokens` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL,
  `token_hash` text NOT NULL UNIQUE,
  `name` text NOT NULL,
  `created_ts` integer NOT NULL,
  `last_used_ts` integer,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
);

CREATE TABLE `memos` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `uid` text NOT NULL UNIQUE,
  `creator_id` integer NOT NULL,
  `content` text NOT NULL,
  `visibility` text NOT NULL DEFAULT 'private',
  `pinned` integer NOT NULL DEFAULT 0,
  `row_status` text NOT NULL DEFAULT 'normal',
  `created_ts` integer NOT NULL,
  `updated_ts` integer NOT NULL,
  FOREIGN KEY (`creator_id`) REFERENCES `users`(`id`)
);

CREATE TABLE `tags` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `creator_id` integer NOT NULL,
  `created_ts` integer NOT NULL,
  FOREIGN KEY (`creator_id`) REFERENCES `users`(`id`)
);

CREATE TABLE `resources` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `uid` text NOT NULL UNIQUE,
  `memo_id` integer,
  `creator_id` integer NOT NULL,
  `name` text NOT NULL,
  `type` text NOT NULL,
  `size` integer NOT NULL DEFAULT 0,
  `storage_key` text NOT NULL UNIQUE,
  `created_ts` integer NOT NULL,
  FOREIGN KEY (`memo_id`) REFERENCES `memos`(`id`),
  FOREIGN KEY (`creator_id`) REFERENCES `users`(`id`)
);

CREATE INDEX `users_username_idx` ON `users` (`username`);
CREATE INDEX `api_tokens_user_idx` ON `api_tokens` (`user_id`);
CREATE INDEX `memos_created_idx` ON `memos` (`created_ts`);
CREATE INDEX `memos_pinned_idx` ON `memos` (`pinned`);
CREATE INDEX `memos_creator_idx` ON `memos` (`creator_id`);
CREATE UNIQUE INDEX `tags_name_creator_idx` ON `tags` (`name`, `creator_id`);
CREATE INDEX `resources_memo_idx` ON `resources` (`memo_id`);
