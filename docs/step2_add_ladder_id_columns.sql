-- Step 2: Add ladder_id columns (nullable for backfill)

ALTER TABLE ladder_matches ADD COLUMN ladder_id BIGINT NULL;
ALTER TABLE ladder_player_stats ADD COLUMN ladder_id BIGINT NULL;
ALTER TABLE ladder_elo_history ADD COLUMN ladder_id BIGINT NULL;
ALTER TABLE ladder_match_queue ADD COLUMN ladder_id BIGINT NULL;
