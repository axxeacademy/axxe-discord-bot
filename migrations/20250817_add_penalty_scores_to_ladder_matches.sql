-- Migration to add penalty score columns to ladder_matches table

ALTER TABLE ladder_matches
ADD COLUMN penalty_score1 INT NULL,
ADD COLUMN penalty_score2 INT NULL;
