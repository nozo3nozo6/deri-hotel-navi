-- ============================================================
-- ylka.jp スキーマ（yobuho_db から派生、ラブホ系除外）
-- 生成: 2026-05-24T17:13:03.337Z
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;
SET NAMES utf8mb4;

-- --- hotels ---
DROP TABLE IF EXISTS `hotels`;
CREATE TABLE `hotels` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `address` varchar(500) DEFAULT NULL,
  `prefecture` varchar(10) DEFAULT NULL,
  `city` varchar(50) DEFAULT NULL,
  `major_area` varchar(50) DEFAULT NULL,
  `detail_area` varchar(100) DEFAULT NULL,
  `hotel_type` varchar(30) DEFAULT 'other',
  `source` varchar(20) DEFAULT 'manual',
  `review_average` float DEFAULT NULL,
  `min_charge` int(11) DEFAULT NULL,
  `nearest_station` varchar(100) DEFAULT NULL,
  `postal_code` varchar(20) DEFAULT NULL,
  `tel` varchar(30) DEFAULT NULL,
  `latitude` double DEFAULT NULL,
  `longitude` double DEFAULT NULL,
  `is_published` tinyint(1) DEFAULT 1,
  `is_edited` tinyint(1) DEFAULT 0,
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_pref_published` (`prefecture`,`is_published`),
  KEY `idx_pref_area` (`prefecture`,`major_area`,`detail_area`),
  KEY `idx_pref_city` (`prefecture`,`city`),
  KEY `idx_type` (`hotel_type`),
  KEY `idx_name` (`name`(100)),
  KEY `idx_station` (`nearest_station`(50))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --- reports ---
DROP TABLE IF EXISTS `reports`;
CREATE TABLE `reports` (
  `id` char(36) NOT NULL,
  `hotel_id` int(11) NOT NULL,
  `can_call` tinyint(1) DEFAULT NULL,
  `poster_type` varchar(10) DEFAULT 'user',
  `poster_name` varchar(100) DEFAULT NULL,
  `shop_id` char(36) DEFAULT NULL,
  `can_call_reasons` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`can_call_reasons`)),
  `cannot_call_reasons` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`cannot_call_reasons`)),
  `time_slot` varchar(255) DEFAULT NULL,
  `room_type` varchar(50) DEFAULT NULL,
  `comment` text DEFAULT NULL,
  `multi_person` tinyint(1) DEFAULT 0,
  `guest_male` int(11) DEFAULT 0,
  `guest_female` int(11) DEFAULT 0,
  `multi_fee` tinyint(1) DEFAULT NULL,
  `gender_mode` varchar(15) DEFAULT NULL,
  `fingerprint` varchar(64) DEFAULT NULL,
  `ip_hash` varchar(64) DEFAULT NULL,
  `is_hidden` tinyint(1) DEFAULT 0,
  `flagged_at` datetime DEFAULT NULL,
  `flag_reason` varchar(100) DEFAULT NULL,
  `flag_comment` text DEFAULT NULL,
  `flag_resolved` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `refreshed_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_hotel` (`hotel_id`,`created_at`),
  KEY `idx_ip` (`ip_hash`,`created_at`),
  KEY `idx_fp_hotel` (`fingerprint`,`hotel_id`),
  KEY `idx_shop` (`shop_id`,`hotel_id`),
  KEY `idx_hidden` (`is_hidden`),
  CONSTRAINT `reports_ibfk_1` FOREIGN KEY (`hotel_id`) REFERENCES `hotels` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --- report_votes ---
DROP TABLE IF EXISTS `report_votes`;
CREATE TABLE `report_votes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `report_id` char(36) NOT NULL,
  `voter_fingerprint` varchar(64) DEFAULT NULL,
  `vote_type` varchar(10) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_vote` (`report_id`,`voter_fingerprint`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --- shops ---
DROP TABLE IF EXISTS `shops`;
CREATE TABLE `shops` (
  `id` char(36) NOT NULL,
  `email` varchar(255) NOT NULL,
  `shop_name` varchar(100) DEFAULT NULL,
  `gender_mode` varchar(15) DEFAULT NULL,
  `shop_url` varchar(500) DEFAULT NULL,
  `shop_tel` varchar(30) DEFAULT NULL,
  `phone` varchar(30) DEFAULT NULL,
  `website_url` varchar(500) DEFAULT NULL,
  `document_url` longtext DEFAULT NULL,
  `thumbnail_url` mediumtext DEFAULT NULL,
  `chat_avatar_url` mediumtext DEFAULT NULL,
  `banner_type` varchar(10) DEFAULT NULL,
  `catchphrase` varchar(40) DEFAULT NULL,
  `description` varchar(60) DEFAULT NULL,
  `business_hours` varchar(50) DEFAULT NULL,
  `pr_text` varchar(200) DEFAULT NULL,
  `min_price` varchar(30) DEFAULT NULL,
  `display_tel` varchar(20) DEFAULT NULL,
  `area` varchar(100) DEFAULT NULL,
  `prefecture` varchar(10) DEFAULT NULL,
  `status` varchar(30) DEFAULT 'email_pending',
  `plan_id` int(11) DEFAULT NULL,
  `password_hash` varchar(255) DEFAULT NULL,
  `slug` varchar(100) DEFAULT NULL,
  `show_announcement` tinyint(1) NOT NULL DEFAULT 0,
  `denial_reason` text DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `deleted_at` datetime DEFAULT NULL,
  `last_login_ip_hash` varchar(64) DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `registered_by` varchar(100) DEFAULT NULL,
  `fav_areas` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT 'お気に入りエリア' CHECK (json_valid(`fav_areas`)),
  `cast_enabled` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_email` (`email`),
  KEY `idx_status` (`status`),
  KEY `idx_slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --- shop_hotel_info ---
DROP TABLE IF EXISTS `shop_hotel_info`;
CREATE TABLE `shop_hotel_info` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `shop_id` char(36) NOT NULL,
  `hotel_id` int(11) NOT NULL,
  `can_call` tinyint(1) DEFAULT NULL,
  `transport_fee` varchar(50) DEFAULT NULL,
  `memo` text DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_shop_hotel` (`shop_id`,`hotel_id`),
  KEY `idx_shop_hotel_info_hotel_can_call` (`hotel_id`,`can_call`),
  CONSTRAINT `shop_hotel_info_ibfk_1` FOREIGN KEY (`shop_id`) REFERENCES `shops` (`id`) ON DELETE CASCADE,
  CONSTRAINT `shop_hotel_info_ibfk_2` FOREIGN KEY (`hotel_id`) REFERENCES `hotels` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --- shop_hotel_services ---
DROP TABLE IF EXISTS `shop_hotel_services`;
CREATE TABLE `shop_hotel_services` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `shop_hotel_info_id` int(11) NOT NULL,
  `service_option_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `shop_hotel_info_id` (`shop_hotel_info_id`),
  CONSTRAINT `shop_hotel_services_ibfk_1` FOREIGN KEY (`shop_hotel_info_id`) REFERENCES `shop_hotel_info` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --- shop_contracts ---
DROP TABLE IF EXISTS `shop_contracts`;
CREATE TABLE `shop_contracts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `shop_id` char(36) NOT NULL,
  `plan_id` int(11) NOT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `expires_at` date DEFAULT NULL,
  `is_campaign` tinyint(1) DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `shop_id` (`shop_id`),
  CONSTRAINT `shop_contracts_ibfk_1` FOREIGN KEY (`shop_id`) REFERENCES `shops` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --- shop_placements ---
DROP TABLE IF EXISTS `shop_placements`;
CREATE TABLE `shop_placements` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `shop_id` char(36) NOT NULL,
  `level` varchar(30) DEFAULT NULL,
  `target_name` varchar(100) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_shop_area` (`level`,`target_name`),
  KEY `shop_id` (`shop_id`),
  CONSTRAINT `shop_placements_ibfk_1` FOREIGN KEY (`shop_id`) REFERENCES `shops` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --- shop_service_areas ---
DROP TABLE IF EXISTS `shop_service_areas`;
CREATE TABLE `shop_service_areas` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `shop_id` char(36) NOT NULL,
  `pref` varchar(20) DEFAULT NULL COMMENT '都道府県名 (例: 東京都). クリック時のナビ用',
  `area` varchar(80) DEFAULT NULL COMMENT '主要エリア or 詳細エリア (例: 西東京・三多摩)',
  `detail` varchar(80) DEFAULT NULL COMMENT '詳細エリア (例: 上野・浅草・錦糸町)',
  `city` varchar(80) DEFAULT NULL COMMENT '市区町村 (例: 練馬区)',
  `label` varchar(80) NOT NULL COMMENT '表示用テキスト. pref/area/city のいずれかから自動生成',
  `is_primary` tinyint(1) NOT NULL DEFAULT 0 COMMENT '1=メインエリア (店舗 URL 着地点). 1 店舗 1 行のみ',
  `sort_order` int(11) NOT NULL DEFAULT 0 COMMENT '表示順 (小さい順)',
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_shop_sort` (`shop_id`,`sort_order`),
  KEY `idx_shop_primary` (`shop_id`,`is_primary`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='店舗専用ページ表示用の対応エリア (契約プランとは独立)';

-- --- shop_images ---
DROP TABLE IF EXISTS `shop_images`;
CREATE TABLE `shop_images` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `shop_id` varchar(36) NOT NULL,
  `image_url` mediumtext NOT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `usage` varchar(10) DEFAULT 'rich',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_shop_images_shop` (`shop_id`),
  KEY `idx_shop_images_shop_id` (`shop_id`,`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --- shop_plan_requests ---
DROP TABLE IF EXISTS `shop_plan_requests`;
CREATE TABLE `shop_plan_requests` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `shop_id` char(36) NOT NULL,
  `plan_id` int(11) NOT NULL,
  `requested_areas` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`requested_areas`)),
  `message` text DEFAULT NULL,
  `status` varchar(20) DEFAULT 'pending',
  `admin_note` text DEFAULT NULL,
  `contract_id` int(11) DEFAULT NULL,
  `agreed_at` datetime NOT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_shop` (`shop_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --- shop_email_tokens ---
DROP TABLE IF EXISTS `shop_email_tokens`;
CREATE TABLE `shop_email_tokens` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `email` varchar(255) NOT NULL,
  `token` char(64) NOT NULL,
  `genre` varchar(15) DEFAULT NULL,
  `expires_at` datetime NOT NULL,
  `used` tinyint(1) DEFAULT 0,
  `created_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_token` (`token`),
  KEY `idx_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --- room_types ---
DROP TABLE IF EXISTS `room_types`;
CREATE TABLE `room_types` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `label` varchar(100) NOT NULL,
  `sort_order` int(11) DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --- can_call_reasons ---
DROP TABLE IF EXISTS `can_call_reasons`;
CREATE TABLE `can_call_reasons` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `label` varchar(100) NOT NULL,
  `sort_order` int(11) DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --- cannot_call_reasons ---
DROP TABLE IF EXISTS `cannot_call_reasons`;
CREATE TABLE `cannot_call_reasons` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `label` varchar(100) NOT NULL,
  `sort_order` int(11) DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --- shop_service_options ---
DROP TABLE IF EXISTS `shop_service_options`;
CREATE TABLE `shop_service_options` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `sort_order` int(11) DEFAULT 0,
  `is_active` tinyint(1) DEFAULT 1,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --- contract_plans ---
DROP TABLE IF EXISTS `contract_plans`;
CREATE TABLE `contract_plans` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `price` int(11) DEFAULT 0,
  `description` text DEFAULT NULL,
  `slots_city` int(11) NOT NULL DEFAULT 0,
  `slots_detail_area` int(11) NOT NULL DEFAULT 0,
  `slots_spot` int(11) NOT NULL DEFAULT 0,
  `slots_prefecture` int(11) NOT NULL DEFAULT 0,
  `slots_region` int(11) NOT NULL DEFAULT 0,
  `slots_national` int(11) NOT NULL DEFAULT 0,
  `sort_order` int(11) DEFAULT 0,
  `cast_limit` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --- hotel_requests ---
DROP TABLE IF EXISTS `hotel_requests`;
CREATE TABLE `hotel_requests` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `hotel_name` varchar(200) DEFAULT NULL,
  `address` varchar(500) DEFAULT NULL,
  `tel` varchar(30) DEFAULT NULL,
  `hotel_type` varchar(30) DEFAULT 'business',
  `comment` text DEFAULT NULL,
  `status` varchar(20) DEFAULT 'pending',
  `created_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --- hotel_corrections ---
DROP TABLE IF EXISTS `hotel_corrections`;
CREATE TABLE `hotel_corrections` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `hotel_id` int(11) NOT NULL,
  `hotel_name` varchar(255) DEFAULT NULL,
  `category` enum('address','area','tel','hotel_name','closed','other') NOT NULL,
  `detail` text NOT NULL,
  `ip_hash` varchar(64) DEFAULT NULL,
  `status` enum('pending','resolved','rejected') DEFAULT 'pending',
  `admin_note` text DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --- ad_placements ---
DROP TABLE IF EXISTS `ad_placements`;
CREATE TABLE `ad_placements` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `placement_type` varchar(50) DEFAULT NULL,
  `placement_target` varchar(100) DEFAULT NULL,
  `status` varchar(20) DEFAULT 'active',
  `mode` varchar(15) DEFAULT NULL,
  `shop_id` char(36) DEFAULT NULL,
  `banner_image_url` text DEFAULT NULL,
  `banner_link_url` text DEFAULT NULL,
  `banner_size` varchar(20) DEFAULT NULL,
  `banner_alt` varchar(200) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `shop_id` (`shop_id`),
  KEY `idx_ad_placements_type_status_mode` (`placement_type`,`status`,`mode`),
  CONSTRAINT `ad_placements_ibfk_1` FOREIGN KEY (`shop_id`) REFERENCES `shops` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --- admin_users ---
DROP TABLE IF EXISTS `admin_users`;
CREATE TABLE `admin_users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `username` varchar(50) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --- agent_users ---
DROP TABLE IF EXISTS `agent_users`;
CREATE TABLE `agent_users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `username` varchar(50) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `name` varchar(100) NOT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --- outreach_emails ---
DROP TABLE IF EXISTS `outreach_emails`;
CREATE TABLE `outreach_emails` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `shop_name` varchar(200) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `genre` varchar(15) DEFAULT NULL,
  `area` varchar(100) DEFAULT NULL,
  `sent_at` datetime DEFAULT current_timestamp(),
  `status` varchar(20) DEFAULT 'sent',
  `notes` text DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --- hotel_report_summary (view) ---
DROP VIEW IF EXISTS `hotel_report_summary`;
CREATE VIEW `hotel_report_summary` AS
SELECT
    h.id AS hotel_id,
    COUNT(r.id) AS total_reports,
    SUM(CASE WHEN r.can_call = 1 AND (r.poster_type IS NULL OR r.poster_type = 'user') THEN 1 ELSE 0 END) AS user_can_call,
    SUM(CASE WHEN r.can_call = 0 AND (r.poster_type IS NULL OR r.poster_type = 'user') THEN 1 ELSE 0 END) AS user_cannot_call,
    SUM(CASE WHEN r.can_call = 1 AND r.poster_type = 'shop' THEN 1 ELSE 0 END) AS shop_can_call,
    SUM(CASE WHEN r.can_call = 0 AND r.poster_type = 'shop' THEN 1 ELSE 0 END) AS shop_cannot_call
FROM hotels h
LEFT JOIN reports r ON r.hotel_id = h.id AND (r.is_hidden = 0 OR r.is_hidden IS NULL)
GROUP BY h.id;

SET FOREIGN_KEY_CHECKS = 1;