# Multi-Ladder Migration Technical Note

## Altered Tables and Added Columns

- Created new table `ladders` with columns:
  - `id` BIGINT PRIMARY KEY AUTO_INCREMENT
  - `name`, `slug` (unique), `status`, `starts_at`, `ends_at`, `timezone`
  - `allowed_days_mask`, `allowed_start_time`, `allowed_end_time`, `max_matches_per_day`
  - `config` JSON for ladder-specific rules
  - `created_at`, `updated_at`

- Added `ladder_id` BIGINT column to:
  - `ladder_matches`
  - `ladder_player_stats`
  - `ladder_elo_history`
  - `ladder_match_queue`

## Indexes and Foreign Keys Created

- Added indexes on `ladder_id` in all four tables.
- Added foreign key constraints referencing `ladders(id)` with `ON DELETE RESTRICT`.
- Updated primary key on `ladder_player_stats` to composite `(player_id, ladder_id)` to enforce uniqueness per ladder.

## Backfill Plan Executed

- After adding nullable `ladder_id` columns, all existing rows in the four tables were updated to reference the "Default" ladder (slug = 'default').
- Then, `ladder_id` columns were altered to be NOT NULL to enforce data integrity.

## Compatibility Considerations

- Existing data is preserved and linked to the "Default" ladder, ensuring backward compatibility.
- Queries and commands must be updated to filter by `ladder_id` to support multiple ladders.
- The new `ladders` table supports multiple simultaneous ladders with independent calendars, rules, and limits.
- Indexes on `ladder_id` ensure no noticeable performance degradation on joins and filters.
- The composite primary key on `ladder_player_stats` prevents duplicate stats per player per ladder.

## Next Steps

- Update application queries and commands to include `ladder_id` filtering.
- Implement ladder selection logic in commands and APIs.
- Optionally seed additional ladders with custom configurations.

---

This migration enables multi-ladder support while maintaining full compatibility with existing data and workflows.
