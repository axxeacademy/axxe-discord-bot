-- Step 6: Update primary key on ladder_player_stats to composite (player_id, ladder_id)

ALTER TABLE ladder_player_stats
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (player_id, ladder_id);
