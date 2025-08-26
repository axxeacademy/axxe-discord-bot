-- Step 3: Backfill ladder_id for all existing rows with the "Default" ladder id

UPDATE ladder_matches
  SET ladder_id = (SELECT id FROM ladders WHERE slug = 'default')
  WHERE ladder_id IS NULL;

UPDATE ladder_player_stats
  SET ladder_id = (SELECT id FROM ladders WHERE slug = 'default')
  WHERE ladder_id IS NULL;

UPDATE ladder_elo_history
  SET ladder_id = (SELECT id FROM ladders WHERE slug = 'default')
  WHERE ladder_id IS NULL;

UPDATE ladder_match_queue
  SET ladder_id = (SELECT id FROM ladders WHERE slug = 'default')
  WHERE ladder_id IS NULL;
