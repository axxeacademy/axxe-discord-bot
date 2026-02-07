-- migrations/20260207_add_penalties_to_tournament_matches.sql

ALTER TABLE tournament_matches 
ADD COLUMN penalty_score1 INT DEFAULT NULL AFTER player2_score,
ADD COLUMN penalty_score2 INT DEFAULT NULL AFTER penalty_score1;
