-- ============================================================
-- Deadline Defenders - Clean Production Database Schema
-- Compatible with Local MySQL (XAMPP), Aiven, TiDB Cloud, Railway
-- ============================================================

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET time_zone = "+00:00";

-- ------------------------------------------------------------
-- 1. Users Table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `username` VARCHAR(50) NOT NULL,
  `email` VARCHAR(100) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `reset_token` VARCHAR(255) DEFAULT NULL,
  `reset_token_expires` DATETIME DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_users_username` (`username`),
  UNIQUE KEY `idx_users_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 2. Sessions Table (express-mysql-session)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `sessions` (
  `session_id` VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `expires` INT(11) UNSIGNED NOT NULL,
  `data` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  PRIMARY KEY (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 3. User Interests Table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `user_interests` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `user_id` INT(11) NOT NULL,
  `interest` VARCHAR(100) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_user_interest_unique` (`user_id`, `interest`),
  KEY `idx_user_interests_user` (`user_id`),
  CONSTRAINT `fk_ui_user_id` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 4. Interests Reminders (Global Search Cache)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `interests_reminders` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `interest` VARCHAR(100) NOT NULL,
  `type` VARCHAR(50) NOT NULL DEFAULT 'Exam',
  `application_start` DATE DEFAULT NULL,
  `application_end` DATE DEFAULT NULL,
  `event_date` DATE DEFAULT NULL,
  `location` VARCHAR(255) DEFAULT 'India',
  `short_note` VARCHAR(255) NOT NULL,
  `source` VARCHAR(500) DEFAULT NULL,
  `confidence` ENUM('high','medium','low') DEFAULT 'medium',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_unique_cache_reminder` (`interest`, `type`, `short_note`),
  KEY `idx_cache_interest` (`interest`),
  KEY `idx_cache_event_date` (`event_date`),
  KEY `idx_cache_app_end` (`application_end`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 5. Interests Cache Metadata
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `interests_cache_meta` (
  `interest` VARCHAR(100) NOT NULL,
  `last_fetched` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `reminder_count` INT(11) DEFAULT 0,
  `fetch_status` ENUM('success','failed','pending') DEFAULT 'pending',
  `error_message` TEXT DEFAULT NULL,
  PRIMARY KEY (`interest`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 6. User Reminders (User's Personalized List)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `user_reminders` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `user_id` INT(11) NOT NULL,
  `interest` VARCHAR(100) NOT NULL,
  `type` VARCHAR(50) NOT NULL DEFAULT 'Exam',
  `application_start` DATE DEFAULT NULL,
  `application_end` DATE DEFAULT NULL,
  `event_date` DATE DEFAULT NULL,
  `location` VARCHAR(255) DEFAULT 'India',
  `short_note` VARCHAR(255) NOT NULL,
  `source` VARCHAR(500) DEFAULT NULL,
  `confidence` ENUM('high','medium','low') DEFAULT 'medium',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_unique_user_reminder` (`user_id`, `interest`, `type`, `short_note`),
  KEY `idx_ur_user_dates` (`user_id`, `application_end`, `event_date`),
  CONSTRAINT `fk_ur_user_id` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 7. Push Subscriptions Table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `push_subscriptions` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `user_id` INT(11) NOT NULL,
  `endpoint` TEXT NOT NULL,
  `p256dh` VARCHAR(255) NOT NULL,
  `auth` VARCHAR(255) NOT NULL,
  `subscription_json` TEXT NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_unique_user_push` (`user_id`),
  CONSTRAINT `fk_ps_user_id` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 8. Notification Logs Table (Audit Trail)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `notification_logs` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `user_id` INT(11) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `body` TEXT NOT NULL,
  `sent_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_nl_user_sent` (`user_id`, `sent_at`),
  KEY `idx_nl_sent_at` (`sent_at`),
  CONSTRAINT `fk_nl_user_id` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
