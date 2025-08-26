-- Step 5: Add foreign keys and indexes on ladder_id columns

ALTER TABLE ladder_matches
  ADD CONSTRAINT fk_ladder_matches_ladder FOREIGN KEY (ladder_id) REFERENCES ladders(id) ON DELETE RESTRICT,
  ADD INDEX idx_ladder_matches_ladder_id (ladder_id);

ALTER TABLE ladder_player_stats
  ADD CONSTRAINT fk_ladder_player_stats_ladder FOREIGN KEY (ladder_id) REFERENCES ladders(id) ON DELETE RESTRICT,
  ADD INDEX idx_ladder_player_stats_ladder_id (ladder_id);

ALTER TABLE ladder_elo_history
  ADD CONSTRAINT fk_ladder_elo_history_ladder FOREIGN KEY (ladder_id) REFERENCES ladders(id) ON DELETE RESTRICT,
  ADD INDEX idx_ladder_elo_history_ladder_id (ladder_id);

ALTER TABLE ladder_match_queue
  ADD CONSTRAINT fk_ladder_match_queue_ladder FOREIGN KEY (ladder_id) REFERENCES ladders(id) ON DELETE RESTRICT,
  ADD INDEX idx_ladder_match_queue_ladder_id (ladder_id);
