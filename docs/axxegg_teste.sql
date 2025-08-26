-- phpMyAdmin SQL Dump
-- version 5.2.2
-- https://www.phpmyadmin.net/
--
-- Host: localhost:3306
-- Generation Time: Aug 15, 2025 at 03:05 AM
-- Server version: 8.0.37
-- PHP Version: 8.4.10

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `axxegg_teste`
--

-- --------------------------------------------------------

--
-- Table structure for table `activity_logs`
--

CREATE TABLE `activity_logs` (
  `id` int NOT NULL,
  `user_id` int NOT NULL,
  `action` varchar(255) NOT NULL,
  `details` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------

--
-- Table structure for table `admin_actions`
--

CREATE TABLE `admin_actions` (
  `id` int NOT NULL,
  `player_id` int DEFAULT NULL,
  `match_id` int DEFAULT NULL,
  `action_type` enum('ban','unban','edit_match','resolve_dispute') DEFAULT NULL,
  `reason` text,
  `performed_by` varchar(100) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------

--
-- Table structure for table `admin_audit_log`
--

CREATE TABLE `admin_audit_log` (
  `id` bigint NOT NULL,
  `actor_discord_id` bigint NOT NULL,
  `module` varchar(32) NOT NULL,
  `action` varchar(48) NOT NULL,
  `entity_type` varchar(32) DEFAULT NULL,
  `entity_id` varchar(64) DEFAULT NULL,
  `details` json DEFAULT NULL,
  `ip` varchar(45) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------

--
-- Table structure for table `admin_roles`
--

CREATE TABLE `admin_roles` (
  `id` int NOT NULL,
  `name` varchar(32) NOT NULL,
  `perms` json NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Dumping data for table `admin_roles`
--

INSERT INTO `admin_roles` (`id`, `name`, `perms`) VALUES
(1, 'Owner', '{\"*\": true}'),
(2, 'Ops', '{\"audit.view\": true, \"points.edit\": true, \"points.view\": true, \"ladder.manage\": true}'),
(3, 'Coach', '{\"ladder.view\": true, \"players.view\": true}'),
(4, 'Mod', '{\"ladder.view\": true, \"moderation.kick\": true}'),
(5, 'Finance', '{\"audit.view\": true, \"billing.view\": true, \"invoices.view\": true}');

-- --------------------------------------------------------

--
-- Table structure for table `admin_users`
--

CREATE TABLE `admin_users` (
  `discord_id` bigint NOT NULL,
  `role_id` int NOT NULL,
  `display_name` varchar(64) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Dumping data for table `admin_users`
--

INSERT INTO `admin_users` (`discord_id`, `role_id`, `display_name`, `created_at`) VALUES
(281087422056497163, 1, 'João Carvalho', '2025-08-14 02:15:22');

-- --------------------------------------------------------

--
-- Table structure for table `competitions`
--

CREATE TABLE `competitions` (
  `id` int NOT NULL,
  `name` varchar(100) NOT NULL,
  `type` enum('ladder','cup') NOT NULL,
  `start_date` date DEFAULT NULL,
  `end_date` date DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT '1'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Dumping data for table `competitions`
--

INSERT INTO `competitions` (`id`, `name`, `type`, `start_date`, `end_date`, `is_active`) VALUES
(1, 'AXXE Ladder Default', 'ladder', '2025-08-02', NULL, 1);

-- --------------------------------------------------------

--
-- Table structure for table `ladders`
--

CREATE TABLE `ladders` (
  `id` bigint NOT NULL,
  `name` varchar(100) NOT NULL,
  `slug` varchar(120) NOT NULL,
  `status` enum('draft','active','archived') DEFAULT 'draft',
  `starts_at` datetime DEFAULT NULL,
  `ends_at` datetime DEFAULT NULL,
  `timezone` varchar(64) NOT NULL DEFAULT 'Europe/Lisbon',
  `allowed_days_mask` tinyint UNSIGNED NOT NULL DEFAULT '127',
  `allowed_start_time` time DEFAULT NULL,
  `allowed_end_time` time DEFAULT NULL,
  `max_matches_per_day` int DEFAULT NULL,
  `config` json DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Dumping data for table `ladders`
--

INSERT INTO `ladders` (`id`, `name`, `slug`, `status`, `starts_at`, `ends_at`, `timezone`, `allowed_days_mask`, `allowed_start_time`, `allowed_end_time`, `max_matches_per_day`, `config`, `created_at`, `updated_at`) VALUES
(1, 'Default Ladder', 'default', 'active', NULL, NULL, 'Europe/Lisbon', 127, NULL, NULL, NULL, NULL, '2025-08-15 02:42:15', '2025-08-15 02:42:15');

-- --------------------------------------------------------

--
-- Table structure for table `ladder_elo_history`
--

CREATE TABLE `ladder_elo_history` (
  `id` int NOT NULL,
  `match_id` int DEFAULT NULL,
  `player_id` int NOT NULL,
  `old_elo` int NOT NULL,
  `new_elo` int NOT NULL,
  `delta` int NOT NULL,
  `changed_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `competition_id` int NOT NULL DEFAULT '1',
  `ladder_id` bigint NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Dumping data for table `ladder_elo_history`
--

INSERT INTO `ladder_elo_history` (`id`, `match_id`, `player_id`, `old_elo`, `new_elo`, `delta`, `changed_at`, `competition_id`, `ladder_id`) VALUES
(1, 16, 1, 1000, 1009, 9, '2025-07-27 15:08:58', 1, 1),
(2, 16, 37, 1000, 0, 0, '2025-07-27 15:08:58', 1, 1),
(3, 17, 1, 1009, 992, -17, '2025-07-27 15:29:38', 1, 1),
(4, 17, 38, 1000, 0, 0, '2025-07-27 15:29:38', 1, 1),
(5, 18, 1, 992, 1009, 17, '2025-07-27 15:34:40', 1, 1),
(6, 18, 39, 1000, 0, 0, '2025-07-27 15:34:40', 1, 1),
(7, 19, 1, 1009, 1025, 16, '2025-07-27 15:36:20', 1, 1),
(8, 19, 40, 1000, 0, 0, '2025-07-27 15:36:20', 1, 1),
(9, 20, 1, 1025, 1040, 15, '2025-07-27 15:40:54', 1, 1),
(10, 20, 41, 1000, 985, -15, '2025-07-27 15:40:54', 1, 1),
(11, 21, 1, 1040, 1055, 15, '2025-07-27 15:46:37', 1, 1),
(12, 21, 42, 1000, 985, -15, '2025-07-27 15:46:37', 1, 1),
(13, 22, 1, 1055, 1078, 23, '2025-07-27 15:50:23', 1, 1),
(14, 22, 43, 1210, 1187, -23, '2025-07-27 15:50:23', 1, 1),
(15, NULL, 5, 1000, 925, -75, '2025-07-28 16:39:08', 1, 1),
(16, NULL, 6, 1000, 925, -75, '2025-07-28 16:39:08', 1, 1),
(17, NULL, 5, 925, 910, -15, '2025-07-28 16:48:19', 1, 1),
(18, NULL, 6, 925, 910, -15, '2025-07-28 16:48:19', 1, 1),
(19, 23, 1, 1078, 1091, 13, '2025-07-28 19:08:21', 1, 1),
(20, 23, 44, 1000, 987, -13, '2025-07-28 19:08:21', 1, 1),
(21, 24, 1, 1091, 1103, 12, '2025-07-28 19:14:31', 1, 1),
(22, 24, 45, 1000, 988, -12, '2025-07-28 19:14:31', 1, 1),
(25, 26, 1, 1103, 1118, 15, '2025-07-28 21:46:20', 1, 1),
(26, 26, 47, 1000, 990, -10, '2025-07-28 21:46:20', 1, 1),
(27, 27, 1, 1118, 1131, 13, '2025-07-28 21:59:09', 1, 1),
(28, 27, 48, 1000, 990, -10, '2025-07-28 21:59:09', 1, 1),
(29, 28, 1, 1131, 1113, -18, '2025-07-28 21:59:40', 1, 1),
(30, 28, 49, 1000, 1020, 20, '2025-07-28 21:59:40', 1, 1),
(31, 29, 1, 1113, 1127, 14, '2025-07-28 22:02:44', 1, 1),
(32, 29, 50, 1000, 990, -10, '2025-07-28 22:02:44', 1, 1),
(33, 31, 1, 1127, 1141, 14, '2025-07-28 23:00:09', 1, 1),
(34, 31, 55, 1000, 990, -10, '2025-07-28 23:00:09', 1, 1),
(35, 32, 1, 1141, 1123, -18, '2025-07-28 23:09:53', 1, 1),
(36, 32, 54, 1000, 1022, 22, '2025-07-28 23:09:53', 1, 1),
(37, 33, 54, 1022, 1040, 18, '2025-07-28 23:31:33', 1, 1),
(38, 33, 1, 1123, 1106, -17, '2025-07-28 23:31:33', 1, 1),
(39, NULL, 5, 910, 895, -15, '2025-07-29 02:00:04', 1, 1),
(40, NULL, 6, 910, 895, -15, '2025-07-29 02:00:05', 1, 1),
(41, 34, 1, 1106, 1120, 14, '2025-07-29 09:27:30', 1, 1),
(42, 34, 64, 1000, 990, -10, '2025-07-29 09:27:30', 1, 1),
(43, 35, 1, 1120, 1102, -18, '2025-07-29 10:22:10', 1, 1),
(44, 35, 27, 1000, 1019, 19, '2025-07-29 10:22:10', 1, 1),
(45, NULL, 5, 895, 880, -15, '2025-07-30 02:00:03', 1, 1),
(46, NULL, 6, 895, 880, -15, '2025-07-30 02:00:03', 1, 1),
(47, NULL, 5, 880, 865, -15, '2025-07-31 02:00:03', 1, 1),
(48, NULL, 6, 880, 865, -15, '2025-07-31 02:00:04', 1, 1),
(49, NULL, 5, 865, 850, -15, '2025-08-01 02:00:03', 1, 1),
(50, NULL, 6, 865, 850, -15, '2025-08-01 02:00:03', 1, 1),
(51, NULL, 5, 850, 835, -15, '2025-08-02 02:00:04', 1, 1),
(52, NULL, 6, 850, 835, -15, '2025-08-02 02:00:04', 1, 1);

-- --------------------------------------------------------

--
-- Table structure for table `ladder_matches`
--

CREATE TABLE `ladder_matches` (
  `id` int NOT NULL,
  `player1_id` int NOT NULL,
  `player2_id` int NOT NULL,
  `player1_score` int DEFAULT '0',
  `player2_score` int DEFAULT '0',
  `status` enum('pending','confirmed','disputed') DEFAULT 'pending',
  `reported_by` int DEFAULT NULL,
  `screenshot_url` varchar(255) DEFAULT NULL,
  `match_date` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `competition_id` int NOT NULL DEFAULT '1',
  `ladder_id` bigint NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Dumping data for table `ladder_matches`
--

INSERT INTO `ladder_matches` (`id`, `player1_id`, `player2_id`, `player1_score`, `player2_score`, `status`, `reported_by`, `screenshot_url`, `match_date`, `competition_id`, `ladder_id`) VALUES
(2, 1, 6, 3, 1, 'confirmed', 1, NULL, '2025-07-18 12:34:09', 1, 1),
(3, 1, 6, 3, 1, 'confirmed', 1, NULL, '2025-07-18 12:45:00', 1, 1),
(4, 6, 1, 3, 1, 'confirmed', 6, NULL, '2025-07-18 12:52:52', 1, 1),
(5, 6, 1, 3, 2, 'confirmed', 6, NULL, '2025-07-18 13:01:10', 1, 1),
(6, 6, 1, 0, 2, 'confirmed', 6, NULL, '2025-07-18 13:02:53', 1, 1),
(7, 5, 1, 1, 1, 'confirmed', 5, NULL, '2025-07-18 14:24:57', 1, 1),
(8, 5, 1, 1, 1, 'confirmed', 5, NULL, '2025-07-18 14:33:02', 1, 1),
(9, 1, 5, 6, 2, 'confirmed', 1, NULL, '2025-07-18 14:47:55', 1, 1),
(10, 1, 29, 0, 0, 'pending', 1, NULL, '2025-07-27 00:13:03', 1, 1),
(11, 1, 31, 0, 0, 'pending', 1, NULL, '2025-07-27 00:23:00', 1, 1),
(12, 1, 33, 4, 2, 'confirmed', 1, NULL, '2025-07-27 00:59:31', 1, 1),
(13, 1, 34, 6, 5, 'pending', 1, NULL, '2025-07-27 10:54:58', 1, 1),
(14, 1, 35, 4, 1, 'pending', 1, NULL, '2025-07-27 14:28:45', 1, 1),
(15, 1, 36, 5, 2, 'pending', 1, NULL, '2025-07-27 14:58:10', 1, 1),
(16, 1, 37, 5, 1, 'confirmed', 1, NULL, '2025-07-27 15:08:28', 1, 1),
(17, 1, 38, 1, 4, 'confirmed', 1, NULL, '2025-07-27 15:29:17', 1, 1),
(18, 1, 39, 2, 1, 'confirmed', 1, NULL, '2025-07-27 15:34:18', 1, 1),
(19, 1, 40, 6, 3, 'confirmed', 1, NULL, '2025-07-27 15:35:49', 1, 1),
(20, 1, 41, 7, 3, 'confirmed', 1, NULL, '2025-07-27 15:40:42', 1, 1),
(21, 1, 42, 5, 2, 'confirmed', 1, NULL, '2025-07-27 15:45:32', 1, 1),
(22, 1, 43, 3, 1, 'confirmed', 1, NULL, '2025-07-27 15:49:59', 1, 1),
(23, 1, 44, 6, 2, 'confirmed', 1, NULL, '2025-07-28 19:08:00', 1, 1),
(24, 1, 45, 5, 2, 'confirmed', 1, NULL, '2025-07-28 19:14:16', 1, 1),
(25, 1, 46, 6, 0, 'confirmed', 1, NULL, '2025-07-28 21:39:17', 1, 1),
(26, 1, 47, 7, 1, 'confirmed', 1, NULL, '2025-07-28 21:46:05', 1, 1),
(27, 1, 48, 2, 1, 'confirmed', 1, NULL, '2025-07-28 21:58:48', 1, 1),
(28, 1, 49, 1, 3, 'confirmed', 1, NULL, '2025-07-28 21:59:26', 1, 1),
(29, 1, 50, 5, 1, 'confirmed', 1, NULL, '2025-07-28 22:01:59', 1, 1),
(30, 1, 51, 0, 0, 'pending', NULL, NULL, '2025-07-28 22:02:19', 1, 1),
(31, 1, 55, 5, 1, 'confirmed', 1, NULL, '2025-07-28 22:59:47', 1, 1),
(32, 1, 54, 1, 6, 'confirmed', 54, NULL, '2025-07-28 23:09:04', 1, 1),
(33, 54, 1, 2, 1, 'confirmed', 54, NULL, '2025-07-28 23:30:43', 1, 1),
(34, 1, 64, 5, 1, 'confirmed', 1, NULL, '2025-07-29 09:27:03', 1, 1),
(35, 1, 27, 6, 7, 'confirmed', 27, NULL, '2025-07-29 10:21:37', 1, 1);

-- --------------------------------------------------------

--
-- Table structure for table `ladder_match_confirmations`
--

CREATE TABLE `ladder_match_confirmations` (
  `match_id` int NOT NULL,
  `player1_confirmed` tinyint(1) DEFAULT '0',
  `player2_confirmed` tinyint(1) DEFAULT '0'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------

--
-- Table structure for table `ladder_match_queue`
--

CREATE TABLE `ladder_match_queue` (
  `id` int NOT NULL,
  `player_id` int NOT NULL,
  `discord_id` varchar(50) NOT NULL,
  `looking_since` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `competition_id` int NOT NULL DEFAULT '1',
  `ladder_id` bigint NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------

--
-- Table structure for table `ladder_player_stats`
--

CREATE TABLE `ladder_player_stats` (
  `player_id` int NOT NULL,
  `elo_rating` int NOT NULL DEFAULT '1000',
  `games_played` int DEFAULT '0',
  `wins` int DEFAULT '0',
  `draws` int DEFAULT '0',
  `losses` int DEFAULT '0',
  `goals_scored` int DEFAULT '0',
  `goals_conceded` int DEFAULT '0',
  `points` int DEFAULT '0',
  `last_played` timestamp NULL DEFAULT NULL,
  `goal_diff` int DEFAULT '0',
  `win_streak` int DEFAULT '0',
  `competition_id` int NOT NULL DEFAULT '1',
  `ladder_id` bigint NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Dumping data for table `ladder_player_stats`
--

INSERT INTO `ladder_player_stats` (`player_id`, `elo_rating`, `games_played`, `wins`, `draws`, `losses`, `goals_scored`, `goals_conceded`, `points`, `last_played`, `goal_diff`, `win_streak`, `competition_id`, `ladder_id`) VALUES
(1, 1102, 10, 6, 2, 2, 36, 19, 20, '2025-07-29 10:22:10', 17, 0, 1, 1),
(5, 835, 3, 0, 2, 1, 4, 8, 2, '2025-07-18 14:48:14', -4, 0, 1, 1),
(6, 835, 1, 0, 0, 1, 0, 2, 0, '2025-07-18 13:02:59', -2, 0, 1, 1),
(27, 1019, 1, 1, 0, 0, 7, 6, 3, '2025-07-29 10:22:10', 1, 1, 1, 1),
(36, 1000, 0, 0, 0, 0, 0, 0, 0, NULL, 0, 0, 1, 1),
(37, 1000, 0, 0, 0, 0, 0, 0, 0, '2025-07-27 15:08:58', 0, 0, 1, 1),
(38, 1000, 0, 0, 0, 0, 0, 0, 0, '2025-07-27 15:29:38', 0, 0, 1, 1),
(39, 1000, 0, 0, 0, 0, 0, 0, 0, '2025-07-27 15:34:40', 0, 0, 1, 1),
(40, 1000, 0, 0, 0, 0, 0, 0, 0, '2025-07-27 15:36:20', 0, 0, 1, 1),
(41, 985, 0, 0, 0, 0, 0, 0, 0, '2025-07-27 15:40:54', 0, 0, 1, 1),
(42, 985, 1, 0, 0, 1, 2, 5, 0, '2025-07-27 15:46:37', -3, 0, 1, 1),
(43, 1187, 1, 0, 0, 1, 1, 3, 0, '2025-07-27 15:50:23', -2, 0, 1, 1),
(44, 987, 1, 0, 0, 1, 2, 6, 0, '2025-07-28 19:08:21', -4, 0, 1, 1),
(45, 988, 0, 0, 0, 0, 0, 0, 0, '2025-07-28 19:14:31', 0, 0, 1, 1),
(46, 0, 0, 0, 0, 0, 0, 0, 0, '2025-07-28 21:40:19', 0, 0, 1, 1),
(47, 990, 0, 0, 0, 0, 0, 0, 0, '2025-07-28 21:46:20', 0, 0, 1, 1),
(48, 990, 0, 0, 0, 0, 0, 0, 0, '2025-07-28 21:59:09', 0, 0, 1, 1),
(49, 1020, 0, 0, 0, 0, 0, 0, 0, '2025-07-28 21:59:40', 0, 1, 1, 1),
(50, 990, 0, 0, 0, 0, 0, 0, 0, '2025-07-28 22:02:44', 0, 0, 1, 1),
(51, 1000, 0, 0, 0, 0, 0, 0, 0, NULL, 0, 0, 1, 1),
(54, 1040, 1, 1, 0, 0, 2, 1, 3, '2025-07-28 23:31:33', 1, 2, 1, 1),
(55, 990, 0, 0, 0, 0, 0, 0, 0, '2025-07-28 23:00:09', 0, 0, 1, 1),
(64, 990, 1, 0, 0, 1, 1, 5, 0, '2025-07-29 09:27:30', -4, 0, 1, 1);

-- --------------------------------------------------------

--
-- Table structure for table `lessons`
--

CREATE TABLE `lessons` (
  `id` int NOT NULL,
  `title` varchar(255) NOT NULL,
  `description` text,
  `professor_id` int NOT NULL,
  `discord_channel_id` varchar(50) DEFAULT NULL,
  `discord_message_id` varchar(50) DEFAULT NULL,
  `date_time` datetime NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------

--
-- Table structure for table `lesson_materials`
--

CREATE TABLE `lesson_materials` (
  `id` int NOT NULL,
  `lesson_id` int NOT NULL,
  `type` enum('pdf','link','video','image') NOT NULL,
  `url` varchar(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------

--
-- Table structure for table `subscriptions`
--

CREATE TABLE `subscriptions` (
  `id` int NOT NULL,
  `user_id` int NOT NULL,
  `tier` enum('Free','Silver','Gold','Icon') NOT NULL,
  `start_date` date NOT NULL,
  `end_date` date NOT NULL,
  `status` enum('active','expired','cancelled') DEFAULT 'active'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

CREATE TABLE `users` (
  `id` int NOT NULL,
  `discord_id` varchar(50) NOT NULL,
  `username` varchar(100) DEFAULT NULL,
  `avatar_url` varchar(255) DEFAULT NULL,
  `is_in_server` tinyint(1) DEFAULT '1',
  `platform` enum('PlayStation','Xbox','PC') DEFAULT 'PlayStation',
  `gamertag` varchar(50) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `last_elo_change` timestamp NULL DEFAULT NULL,
  `email` varchar(100) DEFAULT NULL,
  `role` enum('player','professor','admin') DEFAULT 'player',
  `subscription_tier` enum('Free','Silver','Gold','Icon') DEFAULT 'Free'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Dumping data for table `users`
--

INSERT INTO `users` (`id`, `discord_id`, `username`, `avatar_url`, `is_in_server`, `platform`, `gamertag`, `created_at`, `last_elo_change`, `email`, `role`, `subscription_tier`) VALUES
(1, '281087422056497163', 'jocaccarvalho#0', 'https://cdn.discordapp.com/avatars/281087422056497163/a155bf5e9b57c856f08e59c3ca010dd8.png', 1, 'PlayStation', NULL, '2025-07-18 09:38:41', NULL, NULL, 'player', 'Free'),
(3, '1123387377881186475', 'AXXE BOT#5879', NULL, 1, 'PlayStation', NULL, '2025-07-18 10:57:48', NULL, NULL, 'player', 'Free'),
(5, '627539879345258527', 'b_twenty1', 'https://cdn.discordapp.com/avatars/627539879345258527/02022a75c7b98d6f6dfd1fd1f7f2f9e3.png', 1, 'PlayStation', NULL, '2025-07-18 12:02:18', NULL, NULL, 'player', 'Free'),
(6, '132912003143434240', 'luismgloureiro', 'https://cdn.discordapp.com/avatars/132912003143434240/ecd87aaa4d980b4713df72ea638df523.png', 1, 'PlayStation', NULL, '2025-07-18 12:28:30', NULL, NULL, 'player', 'Free'),
(27, '400074566451331072', 'insert0868#0', 'https://cdn.discordapp.com/avatars/400074566451331072/ebb9ca7edb00128e566211fbcf625e99.png', 1, 'PlayStation', NULL, '2025-07-24 14:11:21', NULL, NULL, 'player', 'Free'),
(29, 'dummy_68574', 'DummyUser#6537', NULL, 0, 'PlayStation', NULL, '2025-07-27 00:13:03', NULL, NULL, 'player', 'Free'),
(31, 'dummy_18372', 'DummyUser#5069', NULL, 0, 'PlayStation', NULL, '2025-07-27 00:23:00', NULL, NULL, 'player', 'Free'),
(32, 'dummy_67984', 'DummyUser#4662', NULL, 0, 'PlayStation', NULL, '2025-07-27 00:51:40', NULL, NULL, 'player', 'Free'),
(33, 'dummy_76421', 'DummyUser#6552', NULL, 0, 'PlayStation', NULL, '2025-07-27 00:59:31', NULL, NULL, 'player', 'Free'),
(34, 'dummy_35693', 'DummyUser#2901', NULL, 0, 'PlayStation', NULL, '2025-07-27 10:54:58', NULL, NULL, 'player', 'Free'),
(35, 'dummy_17596', 'DummyUser#8818', NULL, 0, 'PlayStation', NULL, '2025-07-27 14:28:45', NULL, NULL, 'player', 'Free'),
(36, 'dummy_17722', 'DummyUser#9157', NULL, 0, 'PlayStation', NULL, '2025-07-27 14:58:10', NULL, NULL, 'player', 'Free'),
(37, 'dummy_69665', 'DummyUser#7167', NULL, 0, 'PlayStation', NULL, '2025-07-27 15:08:28', NULL, NULL, 'player', 'Free'),
(38, 'dummy_8649', 'DummyUser#3854', NULL, 0, 'PlayStation', NULL, '2025-07-27 15:29:17', NULL, NULL, 'player', 'Free'),
(39, 'dummy_42373', 'DummyUser#1973', NULL, 0, 'PlayStation', NULL, '2025-07-27 15:34:18', NULL, NULL, 'player', 'Free'),
(40, 'dummy_15109', 'DummyUser#1292', NULL, 0, 'PlayStation', NULL, '2025-07-27 15:35:49', NULL, NULL, 'player', 'Free'),
(41, 'dummy_27401', 'DummyUser#9435', NULL, 0, 'PlayStation', NULL, '2025-07-27 15:40:42', NULL, NULL, 'player', 'Free'),
(42, 'dummy_45996', 'DummyUser#3566', NULL, 0, 'PlayStation', NULL, '2025-07-27 15:45:31', NULL, NULL, 'player', 'Free'),
(43, 'dummy_45777', 'DummyUser#7130', NULL, 0, 'PlayStation', NULL, '2025-07-27 15:49:59', NULL, NULL, 'player', 'Free'),
(44, 'dummy_82397', 'DummyUser#1627', NULL, 0, 'PlayStation', NULL, '2025-07-28 19:07:59', NULL, NULL, 'player', 'Free'),
(45, 'dummy_25173', 'DummyUser#8397', NULL, 0, 'PlayStation', NULL, '2025-07-28 19:14:16', NULL, NULL, 'player', 'Free'),
(46, 'dummy_12448', 'DummyUser#2682', NULL, 0, 'PlayStation', NULL, '2025-07-28 21:39:17', NULL, NULL, 'player', 'Free'),
(47, 'dummy_49715', 'DummyUser#8951', NULL, 0, 'PlayStation', NULL, '2025-07-28 21:46:05', NULL, NULL, 'player', 'Free'),
(48, 'dummy_67568', 'DummyUser#1402', NULL, 0, 'PlayStation', NULL, '2025-07-28 21:58:48', NULL, NULL, 'player', 'Free'),
(49, 'dummy_27355', 'DummyUser#1015', NULL, 0, 'PlayStation', NULL, '2025-07-28 21:59:26', NULL, NULL, 'player', 'Free'),
(50, 'dummy_21099', 'DummyUser#9654', NULL, 0, 'PlayStation', NULL, '2025-07-28 22:01:59', NULL, NULL, 'player', 'Free'),
(51, 'dummy_69310', 'DummyUser#5300', NULL, 0, 'PlayStation', NULL, '2025-07-28 22:02:19', NULL, NULL, 'player', 'Free'),
(54, '296029182268538881', 'roquedybala#0', 'https://cdn.discordapp.com/avatars/296029182268538881/66a594937fe8dd764cba3c2e07e79e31.png', 1, 'PlayStation', NULL, '2025-07-28 22:57:15', NULL, NULL, 'player', 'Free'),
(55, 'dummy_31291', 'DummyUser#1092', NULL, 0, 'PlayStation', NULL, '2025-07-28 22:59:47', NULL, NULL, 'player', 'Free'),
(64, 'dummy_95236', 'DummyUser#7854', NULL, 0, 'PlayStation', NULL, '2025-07-29 09:27:03', NULL, NULL, 'player', 'Free');

--
-- Indexes for dumped tables
--

--
-- Indexes for table `activity_logs`
--
ALTER TABLE `activity_logs`
  ADD PRIMARY KEY (`id`),
  ADD KEY `user_id` (`user_id`);

--
-- Indexes for table `admin_actions`
--
ALTER TABLE `admin_actions`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `admin_audit_log`
--
ALTER TABLE `admin_audit_log`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `admin_roles`
--
ALTER TABLE `admin_roles`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `name` (`name`);

--
-- Indexes for table `admin_users`
--
ALTER TABLE `admin_users`
  ADD PRIMARY KEY (`discord_id`),
  ADD KEY `role_id` (`role_id`);

--
-- Indexes for table `competitions`
--
ALTER TABLE `competitions`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `ladders`
--
ALTER TABLE `ladders`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `slug` (`slug`);

--
-- Indexes for table `ladder_elo_history`
--
ALTER TABLE `ladder_elo_history`
  ADD PRIMARY KEY (`id`),
  ADD KEY `player_id` (`player_id`),
  ADD KEY `match_id` (`match_id`),
  ADD KEY `competition_id` (`competition_id`),
  ADD KEY `idx_ladder_elo_history_ladder_id` (`ladder_id`);

--
-- Indexes for table `ladder_matches`
--
ALTER TABLE `ladder_matches`
  ADD PRIMARY KEY (`id`),
  ADD KEY `player1_id` (`player1_id`),
  ADD KEY `player2_id` (`player2_id`),
  ADD KEY `reported_by` (`reported_by`),
  ADD KEY `competition_id` (`competition_id`),
  ADD KEY `idx_ladder_matches_ladder_id` (`ladder_id`);

--
-- Indexes for table `ladder_match_confirmations`
--
ALTER TABLE `ladder_match_confirmations`
  ADD PRIMARY KEY (`match_id`);

--
-- Indexes for table `ladder_match_queue`
--
ALTER TABLE `ladder_match_queue`
  ADD PRIMARY KEY (`id`),
  ADD KEY `player_id` (`player_id`),
  ADD KEY `competition_id` (`competition_id`),
  ADD KEY `idx_ladder_match_queue_ladder_id` (`ladder_id`);

--
-- Indexes for table `ladder_player_stats`
--
ALTER TABLE `ladder_player_stats`
  ADD PRIMARY KEY (`player_id`,`ladder_id`),
  ADD KEY `competition_id` (`competition_id`),
  ADD KEY `idx_ladder_player_stats_ladder_id` (`ladder_id`);

--
-- Indexes for table `lessons`
--
ALTER TABLE `lessons`
  ADD PRIMARY KEY (`id`),
  ADD KEY `professor_id` (`professor_id`);

--
-- Indexes for table `lesson_materials`
--
ALTER TABLE `lesson_materials`
  ADD PRIMARY KEY (`id`),
  ADD KEY `lesson_id` (`lesson_id`);

--
-- Indexes for table `subscriptions`
--
ALTER TABLE `subscriptions`
  ADD PRIMARY KEY (`id`),
  ADD KEY `user_id` (`user_id`);

--
-- Indexes for table `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `discord_id` (`discord_id`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `activity_logs`
--
ALTER TABLE `activity_logs`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `admin_actions`
--
ALTER TABLE `admin_actions`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `admin_audit_log`
--
ALTER TABLE `admin_audit_log`
  MODIFY `id` bigint NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `admin_roles`
--
ALTER TABLE `admin_roles`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=6;

--
-- AUTO_INCREMENT for table `competitions`
--
ALTER TABLE `competitions`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `ladders`
--
ALTER TABLE `ladders`
  MODIFY `id` bigint NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `ladder_elo_history`
--
ALTER TABLE `ladder_elo_history`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=53;

--
-- AUTO_INCREMENT for table `ladder_matches`
--
ALTER TABLE `ladder_matches`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=36;

--
-- AUTO_INCREMENT for table `ladder_match_queue`
--
ALTER TABLE `ladder_match_queue`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=66;

--
-- AUTO_INCREMENT for table `lessons`
--
ALTER TABLE `lessons`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `lesson_materials`
--
ALTER TABLE `lesson_materials`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `subscriptions`
--
ALTER TABLE `subscriptions`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `users`
--
ALTER TABLE `users`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=75;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `activity_logs`
--
ALTER TABLE `activity_logs`
  ADD CONSTRAINT `activity_logs_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);

--
-- Constraints for table `admin_users`
--
ALTER TABLE `admin_users`
  ADD CONSTRAINT `admin_users_ibfk_1` FOREIGN KEY (`role_id`) REFERENCES `admin_roles` (`id`);

--
-- Constraints for table `ladder_elo_history`
--
ALTER TABLE `ladder_elo_history`
  ADD CONSTRAINT `fk_ladder_elo_history_ladder` FOREIGN KEY (`ladder_id`) REFERENCES `ladders` (`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `ladder_elo_history_ibfk_1` FOREIGN KEY (`player_id`) REFERENCES `users` (`id`),
  ADD CONSTRAINT `ladder_elo_history_ibfk_2` FOREIGN KEY (`match_id`) REFERENCES `ladder_matches` (`id`),
  ADD CONSTRAINT `ladder_elo_history_ibfk_3` FOREIGN KEY (`competition_id`) REFERENCES `competitions` (`id`);

--
-- Constraints for table `ladder_matches`
--
ALTER TABLE `ladder_matches`
  ADD CONSTRAINT `fk_ladder_matches_ladder` FOREIGN KEY (`ladder_id`) REFERENCES `ladders` (`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `ladder_matches_ibfk_1` FOREIGN KEY (`player1_id`) REFERENCES `users` (`id`),
  ADD CONSTRAINT `ladder_matches_ibfk_2` FOREIGN KEY (`player2_id`) REFERENCES `users` (`id`),
  ADD CONSTRAINT `ladder_matches_ibfk_3` FOREIGN KEY (`reported_by`) REFERENCES `users` (`id`),
  ADD CONSTRAINT `ladder_matches_ibfk_4` FOREIGN KEY (`competition_id`) REFERENCES `competitions` (`id`);

--
-- Constraints for table `ladder_match_confirmations`
--
ALTER TABLE `ladder_match_confirmations`
  ADD CONSTRAINT `ladder_match_confirmations_ibfk_1` FOREIGN KEY (`match_id`) REFERENCES `ladder_matches` (`id`);

--
-- Constraints for table `ladder_match_queue`
--
ALTER TABLE `ladder_match_queue`
  ADD CONSTRAINT `fk_ladder_match_queue_ladder` FOREIGN KEY (`ladder_id`) REFERENCES `ladders` (`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `ladder_match_queue_ibfk_1` FOREIGN KEY (`player_id`) REFERENCES `users` (`id`),
  ADD CONSTRAINT `ladder_match_queue_ibfk_2` FOREIGN KEY (`competition_id`) REFERENCES `competitions` (`id`);

--
-- Constraints for table `ladder_player_stats`
--
ALTER TABLE `ladder_player_stats`
  ADD CONSTRAINT `fk_ladder_player_stats_ladder` FOREIGN KEY (`ladder_id`) REFERENCES `ladders` (`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `ladder_player_stats_ibfk_1` FOREIGN KEY (`player_id`) REFERENCES `users` (`id`),
  ADD CONSTRAINT `ladder_player_stats_ibfk_2` FOREIGN KEY (`competition_id`) REFERENCES `competitions` (`id`);

--
-- Constraints for table `lessons`
--
ALTER TABLE `lessons`
  ADD CONSTRAINT `lessons_ibfk_1` FOREIGN KEY (`professor_id`) REFERENCES `users` (`id`);

--
-- Constraints for table `lesson_materials`
--
ALTER TABLE `lesson_materials`
  ADD CONSTRAINT `lesson_materials_ibfk_1` FOREIGN KEY (`lesson_id`) REFERENCES `lessons` (`id`);

--
-- Constraints for table `subscriptions`
--
ALTER TABLE `subscriptions`
  ADD CONSTRAINT `subscriptions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
