-- migrations/20260207_competition_winner.sql

ALTER TABLE competitions ADD COLUMN winner_id INT DEFAULT NULL AFTER status;
