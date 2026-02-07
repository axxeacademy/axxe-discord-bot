# Tournament to Competition Refactoring - Summary

## Changes Made

### 1. Command Renamed
- **Old**: `/tournament` (deleted)
- **New**: `/competition` (created at `commands/admin/competition.js`)

### 2. Enhanced `/competition create` Subcommand
Now includes the following parameters:
- `name` (required) - Nome da competição
- `slug` (required) - Slug único
- `type` (required, autocomplete) - Tipo: ladder, tournament, league
- `format` (required, autocomplete) - Formato: double_elimination, single_elimination, swiss, round_robin
- `edition` (optional) - Edição (ex: #03)
- `season` (optional, autocomplete) - Temporada (busca da base de dados)
- `start_date` (optional) - Data de início (YYYY-MM-DD)
- `start_time` (optional) - Hora de início (HH:MM)

### 3. Autocomplete Implementation
The command now provides dynamic autocomplete for:
- **Type**: Ladder, Tournament, League
- **Format**: Double Elimination, Single Elimination, Swiss, Round Robin
- **Season**: Fetches from database (shows most recent 10 seasons)

### 4. Database Changes
Migration file created: `migrations/20260207_tournament_scheduling.sql`
- Added `edition` column to `tournament_scripts`
- Added `start_date` and `start_time` columns to `competitions`

### 5. Service Updates
`tournamentService.js`:
- Updated `createCompetition()` to accept `startDate` and `startTime` parameters
- Moved status update to 'active' to the beginning of `startCompetition()` to prevent "draft ghosting"

### 6. Battlefy Replicator Updates
`create_db_script.js`:
- Now accepts optional `edition` parameter: `node create_db_script.js <json> <channel> [edition]`
- Stores edition in database for automatic use during tournament execution

### 7. Other Subcommands
All existing subcommands preserved:
- `/competition register` - Register a player
- `/competition start` - Start the competition (generate bracket)
- `/competition status` - View competition status
- `/competition script` - Execute Battlefy replicator script

## Next Steps
1. Deploy commands to Discord: `node deploy-commands.js`
2. Run migration: Apply `20260207_tournament_scheduling.sql` to database
3. Test the new `/competition create` command with autocomplete
4. Verify season selection works correctly

## Notes
- The old `/tournament` command file has been deleted
- All references to tournament functionality now use the `/competition` command
- The service layer (`tournamentService.js`) remains unchanged in name for backward compatibility
