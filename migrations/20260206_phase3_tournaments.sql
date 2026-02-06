-- migrations/20260206_phase3_tournaments.sql

ALTER TABLE tournament_matches 
ADD COLUMN p1_ready TINYINT(1) DEFAULT 0,
ADD COLUMN p2_ready TINYINT(1) DEFAULT 0,
ADD COLUMN next_match_win_slot TINYINT(1) DEFAULT 1,
ADD COLUMN next_match_loss_slot TINYINT(1) DEFAULT 1;

-- Set Round 1 as ready by default
UPDATE tournament_matches SET p1_ready = 1, p2_ready = 1 WHERE round = 1;
