-- Migration: Add max_matches_per_opponent to ladders table
-- Adds a per-opponent daily match limit for each ladder

ALTER TABLE ladders
  ADD COLUMN max_matches_per_opponent INT DEFAULT NULL AFTER max_matches_per_day;
