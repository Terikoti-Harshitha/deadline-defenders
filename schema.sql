-- ============================================================
-- Deadline Defenders — Comprehensive Academic Database Schema
-- Architecture: Shared Intelligence, Incremental Discovery,
-- Provenance Tracking, Idempotent Reminders & Explainable Eligibility
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ------------------------------------------------------------
-- 1. Users Table (Authentication & Accounts)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `username` VARCHAR(50) NOT NULL,
  `email` VARCHAR(100) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `reset_token` VARCHAR(255) DEFAULT NULL,
  `reset_token_expires` DATETIME DEFAULT NULL,
  `onboarding_completed` BOOLEAN NOT NULL DEFAULT FALSE,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_users_username` (`username`),
  UNIQUE KEY `idx_users_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 2. User Academic & Personal Profiles (Progressive & Optional)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `user_profiles` (
  `user_id` INT(11) NOT NULL,
  `education_level` VARCHAR(50) DEFAULT NULL,
  `qualification` VARCHAR(100) DEFAULT NULL,
  `branch` VARCHAR(100) DEFAULT NULL,
  `study_status` VARCHAR(50) DEFAULT NULL,
  `graduation_year` INT(11) DEFAULT NULL,
  `state_location` VARCHAR(100) DEFAULT NULL,
  `city` VARCHAR(100) DEFAULT NULL,
  `age` INT(11) DEFAULT NULL,
  `gender` VARCHAR(50) DEFAULT NULL,
  `skills` TEXT DEFAULT NULL,
  `career_goal` VARCHAR(100) DEFAULT NULL,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_up_user_id` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 3. Topic Registry (Shared Intelligence Clustering)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `topic_registry` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `canonical_topic` VARCHAR(100) NOT NULL,
  `aliases_json` TEXT NOT NULL,
  `keywords_json` TEXT NOT NULL,
  `last_discovered` TIMESTAMP NULL DEFAULT NULL,
  `next_discovery` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_canonical_topic` (`canonical_topic`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 4. Shared Search Cache (Cost-Effective Discovery Layer)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `search_cache` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `query` VARCHAR(255) NOT NULL,
  `normalized_query` VARCHAR(255) NOT NULL,
  `source` VARCHAR(50) NOT NULL DEFAULT 'serpapi',
  `results_json` MEDIUMTEXT NOT NULL,
  `result_hash` VARCHAR(64) NOT NULL,
  `expires_at` TIMESTAMP NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_normalized_query` (`normalized_query`),
  KEY `idx_expires_at` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 5. Sources Registry (Official & Verified Source Catalog)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `sources` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `organization` VARCHAR(100) NOT NULL,
  `source_url` VARCHAR(500) NOT NULL,
  `category` VARCHAR(50) NOT NULL DEFAULT 'Government Exam',
  `source_type` VARCHAR(50) NOT NULL DEFAULT 'Official Government',
  `acquisition_method` VARCHAR(50) NOT NULL DEFAULT 'Search Discovery',
  `trust_level` ENUM('OFFICIAL', 'VERIFIED_SECONDARY', 'UNVERIFIED') NOT NULL DEFAULT 'OFFICIAL',
  `check_frequency` VARCHAR(50) NOT NULL DEFAULT 'DAILY',
  `last_checked` TIMESTAMP NULL DEFAULT NULL,
  `next_check` TIMESTAMP NULL DEFAULT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_source_org_url` (`organization`, `source_url`(200))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 6. Source Documents (Change Detection & Content Hashing)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `source_documents` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `source_id` INT(11) DEFAULT NULL,
  `url` VARCHAR(500) NOT NULL,
  `content_hash` VARCHAR(64) NOT NULL,
  `etag` VARCHAR(100) DEFAULT NULL,
  `last_modified` VARCHAR(100) DEFAULT NULL,
  `raw_text` MEDIUMTEXT DEFAULT NULL,
  `fetched_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_doc_url` (`url`(255)),
  KEY `idx_doc_hash` (`content_hash`),
  CONSTRAINT `fk_sd_source_id` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 7. Opportunities Master Store (Single Canonical Record)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `opportunities` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `source_id` INT(11) DEFAULT NULL,
  `title` VARCHAR(255) NOT NULL,
  `organization` VARCHAR(100) NOT NULL,
  `category` VARCHAR(50) NOT NULL DEFAULT 'Government Exam',
  `application_start` DATE DEFAULT NULL,
  `deadline` DATE DEFAULT NULL,
  `event_date` DATE DEFAULT NULL,
  `deadline_source_text` TEXT DEFAULT NULL,
  `qualification_req` VARCHAR(255) DEFAULT 'Any',
  `branch_req` VARCHAR(255) DEFAULT 'Any',
  `graduation_year_req` VARCHAR(100) DEFAULT 'Any',
  `location` VARCHAR(255) DEFAULT 'India',
  `application_url` VARCHAR(500) DEFAULT NULL,
  `source_url` VARCHAR(500) NOT NULL,
  `trust_level` ENUM('OFFICIAL', 'VERIFIED_SECONDARY', 'UNVERIFIED') NOT NULL DEFAULT 'OFFICIAL',
  `confidence` ENUM('high', 'medium', 'low') NOT NULL DEFAULT 'medium',
  `raw_evidence` TEXT DEFAULT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_canonical_opp` (`organization`, `title`(150), `deadline`),
  KEY `idx_opp_deadline` (`deadline`),
  KEY `idx_opp_category` (`category`),
  KEY `idx_opp_trust` (`trust_level`),
  CONSTRAINT `fk_opp_source_id` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 8. Opportunity Versions (Audit Trail for Date Adjustments)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `opportunity_versions` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `opportunity_id` INT(11) NOT NULL,
  `old_deadline` DATE DEFAULT NULL,
  `new_deadline` DATE DEFAULT NULL,
  `change_reason` VARCHAR(255) DEFAULT NULL,
  `changed_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ov_opp_id` (`opportunity_id`),
  CONSTRAINT `fk_ov_opp_id` FOREIGN KEY (`opportunity_id`) REFERENCES `opportunities`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 9. User Opportunity Tracking (State: Saved / Applied / Dismissed)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `user_opportunity_actions` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `user_id` INT(11) NOT NULL,
  `opportunity_id` INT(11) NOT NULL,
  `status` ENUM('unseen', 'saved', 'applied', 'completed', 'dismissed') NOT NULL DEFAULT 'unseen',
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_user_opp_unique` (`user_id`, `opportunity_id`),
  KEY `idx_uoa_status` (`user_id`, `status`),
  CONSTRAINT `fk_uoa_user_id` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_uoa_opp_id` FOREIGN KEY (`opportunity_id`) REFERENCES `opportunities`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 10. Persistent User Reminders (Idempotent Notification Store)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `user_reminders` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `user_id` INT(11) NOT NULL,
  `opportunity_id` INT(11) DEFAULT NULL,
  `interest` VARCHAR(100) DEFAULT NULL,
  `type` VARCHAR(50) NOT NULL DEFAULT 'Exam',
  `application_start` DATE DEFAULT NULL,
  `application_end` DATE DEFAULT NULL,
  `event_date` DATE DEFAULT NULL,
  `location` VARCHAR(255) DEFAULT 'India',
  `short_note` VARCHAR(255) NOT NULL,
  `source` VARCHAR(500) DEFAULT NULL,
  `confidence` ENUM('high','medium','low') DEFAULT 'medium',
  `reminder_stage` VARCHAR(20) DEFAULT 'STANDARD',
  `status` ENUM('PENDING', 'SENT', 'ACKNOWLEDGED', 'CANCELLED', 'MISSED') NOT NULL DEFAULT 'PENDING',
  `scheduled_at` DATE DEFAULT NULL,
  `sent_at` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_unique_user_reminder` (`user_id`, `interest`, `type`, `short_note`),
  KEY `idx_ur_user_status` (`user_id`, `status`),
  KEY `idx_ur_opp_id` (`opportunity_id`),
  CONSTRAINT `fk_ur_user_id` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ur_opp_id` FOREIGN KEY (`opportunity_id`) REFERENCES `opportunities`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 11. Pipeline Runs (Academic Performance & Metric Logging)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `pipeline_runs` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `run_id` VARCHAR(64) NOT NULL,
  `source_name` VARCHAR(100) NOT NULL,
  `started_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` TIMESTAMP NULL DEFAULT NULL,
  `items_found` INT(11) DEFAULT 0,
  `items_new` INT(11) DEFAULT 0,
  `items_updated` INT(11) DEFAULT 0,
  `items_duplicate` INT(11) DEFAULT 0,
  `api_calls` INT(11) DEFAULT 0,
  `llm_calls` INT(11) DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_pr_run_id` (`run_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 12. Sessions Table (express-mysql-session)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `sessions` (
  `session_id` VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `expires` INT(11) UNSIGNED NOT NULL,
  `data` MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  PRIMARY KEY (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 13. User Interests Table
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
-- 14. Push Subscriptions Table
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
-- 15. Notification Logs Table (Audit Trail)
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

SET FOREIGN_KEY_CHECKS = 1;
