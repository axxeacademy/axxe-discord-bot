-- Step 4: Set ladder_id columns to NOT NULL

ALTER TABLE ladder_matches MODIFY ladder_id BIGINT NOT NULL;
ALTER TABLE ladder_player_stats MODIFY ladder_id BIGINT NOT NULL;
ALTER TABLE ladder_elo_history MODIFY ladder_id BIGINT NOT NULL;
ALTER TABLE ladder_match_queue MODIFY ladder_id BIGINT NOT NULL;
