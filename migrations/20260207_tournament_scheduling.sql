-- migrations/20260207_tournament_scheduling.sql

-- Add edition to tournament_scripts
ALTER TABLE tournament_scripts ADD COLUMN edition VARCHAR(50) DEFAULT NULL;

-- Add start_date and start_time to competitions
ALTER TABLE competitions 
ADD COLUMN start_date DATE DEFAULT NULL,
ADD COLUMN start_time TIME DEFAULT NULL;
