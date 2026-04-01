-- MaNGOSWebV5 Full Install SQL
-- CMS Database Schema for AzerothCore

SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;

-- ===== DB Version =====
CREATE TABLE IF NOT EXISTS `mw_db_version` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `db_version` varchar(50) NOT NULL DEFAULT '5.0.0',
  `db_update_date` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `mw_db_version` (`db_version`, `db_update_date`) VALUES ('5.0.0', NOW());

-- ===== Site Configuration =====
CREATE TABLE IF NOT EXISTS `mw_config` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `key` varchar(100) NOT NULL,
  `value` text,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_key` (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `mw_config` (`key`, `value`) VALUES
('site_title', 'MaNGOSWebV5'),
('site_desc', 'World of Warcraft Private Server'),
('site_email', 'admin@example.com'),
('emulator', 'azerothcore'),
('templates', 'default'),
('default_lang', 'en'),
('available_lang', 'en'),
('site_armory', ''),
('site_forums', ''),
('default_realm_id', '1'),
('site_notice_enable', '0'),
('site_notice_message', ''),
('fp_news_enable', '1'),
('fp_quicklinks', '1'),
('fp_serverinfo', '1'),
('fp_rssfeed', '0'),
('fp_whoisonline', '1'),
('module_online_list', '1'),
('module_shop', '1'),
('module_voting', '1'),
('module_donate', '1'),
('module_armory', '0'),
('module_statistics', '1'),
('reg_enabled', '1'),
('reg_activation', '0'),
('reg_key_enable', '0'),
('reg_default_expansion', '2'),
('reg_acc_per_ip', '5'),
('rename_cost', '0'),
('customize_cost', '0'),
('racechange_cost', '0'),
('factionchange_cost', '0'),
('paypal_email', ''),
('realmlist', '127.0.0.1'),
('progression_phase', '0')
ON DUPLICATE KEY UPDATE `id` = `id`;

-- ===== Account Extensions =====
CREATE TABLE IF NOT EXISTS `mw_account_extend` (
  `account_id` int(11) NOT NULL,
  `account_level` tinyint(4) NOT NULL DEFAULT 1,
  `web_points` int(11) NOT NULL DEFAULT 0,
  `points_earned` int(11) NOT NULL DEFAULT 0,
  `points_spent` int(11) NOT NULL DEFAULT 0,
  `total_donations` decimal(10,2) NOT NULL DEFAULT 0.00,
  `total_votes` int(11) NOT NULL DEFAULT 0,
  `theme` varchar(50) DEFAULT '',
  `avatar` varchar(255) DEFAULT '',
  `activation_code` varchar(64) DEFAULT '',
  `registration_ip` varchar(45) DEFAULT '',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`account_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===== News =====
CREATE TABLE IF NOT EXISTS `mw_news` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `title` varchar(255) NOT NULL,
  `message` text NOT NULL,
  `posted_by` int(11) NOT NULL DEFAULT 0,
  `post_time` int(11) NOT NULL DEFAULT 0,
  `updated_at` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `mw_news` (`title`, `message`, `posted_by`) VALUES
('Welcome to MaNGOSWebV5!', '<p>Welcome to our World of Warcraft server! We are running AzerothCore 3.3.5a.</p><p>Create an account and start playing today!</p>', 0);

-- ===== Realm Configuration =====
CREATE TABLE IF NOT EXISTS `mw_realm` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `realm_id` int(11) NOT NULL,
  `site_enabled` tinyint(1) NOT NULL DEFAULT 1,
  `db_char_host` varchar(255) DEFAULT '127.0.0.1',
  `db_char_port` varchar(10) DEFAULT '3306',
  `db_char_name` varchar(100) DEFAULT 'acore_characters',
  `db_char_user` varchar(100) DEFAULT 'acore',
  `db_char_pass` varchar(255) DEFAULT '',
  `db_world_host` varchar(255) DEFAULT '127.0.0.1',
  `db_world_port` varchar(10) DEFAULT '3306',
  `db_world_name` varchar(100) DEFAULT 'acore_world',
  `db_world_user` varchar(100) DEFAULT 'acore',
  `db_world_pass` varchar(255) DEFAULT '',
  `ra_type` tinyint(1) DEFAULT 1,
  `ra_port` int(11) DEFAULT 7878,
  `ra_user` varchar(100) DEFAULT '',
  `ra_pass` varchar(255) DEFAULT '',
  `info_refresh_interval` int(11) DEFAULT 5,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_realm` (`realm_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===== Shop Items =====
CREATE TABLE IF NOT EXISTS `mw_shop_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `item_number` varchar(100) NOT NULL,
  `itemset` int(11) DEFAULT 0,
  `gold` int(11) DEFAULT 0,
  `quantity` int(11) DEFAULT 1,
  `desc` varchar(255) DEFAULT '',
  `wp_cost` int(11) NOT NULL DEFAULT 0,
  `realms` int(11) DEFAULT 0,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===== Shop Transactions =====
CREATE TABLE IF NOT EXISTS `mw_shop_transactions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `account_id` int(11) NOT NULL,
  `shop_item_id` int(11) NOT NULL,
  `item_desc` varchar(255) DEFAULT '',
  `item_number` varchar(100) DEFAULT '',
  `quantity` int(11) DEFAULT 1,
  `wp_cost` int(11) NOT NULL DEFAULT 0,
  `character_name` varchar(50) DEFAULT '',
  `status` enum('completed','failed') DEFAULT 'completed',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_account` (`account_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===== Donate Packages =====
CREATE TABLE IF NOT EXISTS `mw_donate_packages` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `desc` varchar(255) NOT NULL,
  `cost` decimal(10,2) NOT NULL DEFAULT 0.00,
  `points` int(11) NOT NULL DEFAULT 0,
  `active` tinyint(1) DEFAULT 1,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===== Donate Transactions =====
CREATE TABLE IF NOT EXISTS `mw_donate_transactions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `trans_id` varchar(100) NOT NULL DEFAULT '',
  `account` int(11) NOT NULL,
  `item_number` varchar(100) DEFAULT '',
  `buyer_email` varchar(255) DEFAULT '',
  `payment_type` varchar(50) DEFAULT '',
  `payment_status` varchar(50) DEFAULT '',
  `pending_reason` varchar(100) DEFAULT '',
  `reason_code` varchar(100) DEFAULT '',
  `amount` decimal(10,2) DEFAULT 0.00,
  `item_given` tinyint(1) DEFAULT 0,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_account` (`account`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===== Vote Sites =====
CREATE TABLE IF NOT EXISTS `mw_vote_sites` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `hostname` varchar(255) NOT NULL,
  `vote_type` enum('link','fake') NOT NULL DEFAULT 'link',
  `votelink` varchar(500) DEFAULT '',
  `image_url` varchar(500) DEFAULT '',
  `points` int(11) NOT NULL DEFAULT 1,
  `reset_time` int(11) DEFAULT 12,
  `active` tinyint(1) DEFAULT 1,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===== Vote Log =====
CREATE TABLE IF NOT EXISTS `mw_voting` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_ip` varchar(45) NOT NULL,
  `site` int(11) NOT NULL,
  `time` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_ip_site` (`user_ip`, `site`),
  KEY `idx_time` (`time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===== FAQ =====
CREATE TABLE IF NOT EXISTS `mw_faq` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `question` varchar(500) NOT NULL,
  `answer` text NOT NULL,
  `sort_order` int(11) DEFAULT 0,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===== Menu Links =====
CREATE TABLE IF NOT EXISTS `mw_menu_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `menu_id` int(11) NOT NULL DEFAULT 1,
  `link_title` varchar(255) NOT NULL,
  `link` varchar(500) NOT NULL,
  `order` int(11) DEFAULT 0,
  `account_level` tinyint(4) DEFAULT 1,
  `guest_only` tinyint(1) DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `mw_menu_items` (`menu_id`, `link_title`, `link`, `order`, `account_level`, `guest_only`) VALUES
(1, 'Home', '/', 1, 1, 0),
(1, 'Server Info', '/server', 2, 1, 0),
(1, 'Progression', '/server/progression', 3, 1, 0),
(2, 'Login', '/auth/login', 1, 1, 1),
(2, 'Register', '/auth/register', 2, 1, 1),
(2, 'My Account', '/account', 1, 2, 0),
(2, 'Characters', '/account/characters', 2, 2, 0),
(2, 'Transactions', '/account/transactions', 3, 2, 0),
(2, 'Admin Panel', '/admin', 4, 3, 0),
(4, 'Top Kills', '/server/topkills', 1, 1, 0),
(4, 'Characters', '/server/chars', 2, 1, 0),
(4, 'Players Online', '/server/online', 3, 1, 0),
(4, 'Server Statistics', '/server/stats', 4, 1, 0),
(4, 'Player Map', '/server/playermap', 5, 1, 0),
(7, 'Donate', '/donate', 1, 1, 0),
(7, 'Vote', '/vote', 2, 1, 0),
(7, 'Shop', '/shop', 3, 1, 0),
(8, 'FAQ', '/support/faq', 1, 1, 0)
ON DUPLICATE KEY UPDATE `id` = `id`;

-- ===== Registration Keys =====
CREATE TABLE IF NOT EXISTS `mw_regkeys` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `key` varchar(32) NOT NULL,
  `used` tinyint(1) DEFAULT 0,
  `used_by` int(11) DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_key` (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===== Progression Phases =====
CREATE TABLE IF NOT EXISTS `mw_progression_phases` (
  `phase` int(11) NOT NULL,
  `release_date` varchar(50) DEFAULT '',
  PRIMARY KEY (`phase`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `mw_progression_phases` (`phase`, `release_date`) VALUES
(0, ''), (1, ''), (2, ''), (3, ''), (4, ''), (5, ''),
(6, ''), (7, ''), (8, ''), (9, ''), (10, ''),
(11, ''), (12, ''), (13, ''), (14, ''), (15, '')
ON DUPLICATE KEY UPDATE `phase` = `phase`;

-- ===== Online Visitors =====
CREATE TABLE IF NOT EXISTS `mw_online` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL DEFAULT 0,
  `user_name` varchar(50) NOT NULL DEFAULT 'Guest',
  `user_ip` varchar(45) NOT NULL,
  `logged` int(11) NOT NULL DEFAULT 0,
  `currenturl` varchar(500) DEFAULT '',
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_logged` (`logged`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===== Sessions (for express-mysql-session) =====
CREATE TABLE IF NOT EXISTS `mw_sessions` (
  `session_id` varchar(128) NOT NULL,
  `expires` int(11) unsigned NOT NULL,
  `data` mediumtext,
  PRIMARY KEY (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===== Brute Force Protection =====
CREATE TABLE IF NOT EXISTS `mw_failed_logins` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `ip_address` varchar(45) NOT NULL,
  `username` varchar(50) NOT NULL DEFAULT '',
  `attempts` int(11) NOT NULL DEFAULT 0,
  `last_attempt` int(11) NOT NULL DEFAULT 0,
  `block_until` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_ip_user` (`ip_address`, `username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
