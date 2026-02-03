-- 20260203_init_tournaments.sql

CREATE TABLE IF NOT EXISTS `competitions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `slug` varchar(100) NOT NULL,
  `type` enum('ladder','tournament','league') NOT NULL DEFAULT 'ladder',
  `format` enum('double_elimination','single_elimination','swiss','round_robin') DEFAULT NULL,
  `status` enum('draft','registration','active','completed','archived') NOT NULL DEFAULT 'draft',
  `settings` json DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `tournament_participants` (
  `id` int NOT NULL AUTO_INCREMENT,
  `competition_id` int NOT NULL,
  `user_id` int NOT NULL,
  `seed` int DEFAULT NULL,
  `status` enum('active','eliminated','disqualified','winner') DEFAULT 'active',
  `joined_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `competition_idx` (`competition_id`),
  KEY `user_idx` (`user_id`),
  UNIQUE KEY `comp_user_unique` (`competition_id`, `user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `tournament_matches` (
  `id` int NOT NULL AUTO_INCREMENT,
  `competition_id` int NOT NULL,
  `round` int NOT NULL DEFAULT '1',
  `bracket_side` enum('winners','losers','grand_final','group_stage') DEFAULT 'winners',
  `match_num` int DEFAULT NULL,
  
  `player1_id` int DEFAULT NULL,
  `player2_id` int DEFAULT NULL,
  
  `player1_score` int DEFAULT NULL,
  `player2_score` int DEFAULT NULL,
  `reported_by` int DEFAULT NULL,
  `reported_at` timestamp NULL DEFAULT NULL,
  
  `winner_id` int DEFAULT NULL,
  `status` enum('scheduled','pending_confirmation','completed','disputed') DEFAULT 'scheduled',
  
  `next_match_win` int DEFAULT NULL,
  `next_match_loss` int DEFAULT NULL,
  
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `comp_round_idx` (`competition_id`, `round`),
  KEY `player1_idx` (`player1_id`),
  KEY `player2_idx` (`player2_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
