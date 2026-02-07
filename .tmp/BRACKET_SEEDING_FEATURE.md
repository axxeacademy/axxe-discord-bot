# Competition Bracket Seeding Feature

## New Command: `/competition bracket`

### Purpose
Generate seeding for tournament participants before starting the competition. This step comes **after** `/competition register` and **before** `/competition start`.

### Parameters
1. **competition_id** (required, autocomplete)
   - Shows last 5 competitions in draft/registration status
   
2. **seeding_type** (required, autocomplete)
   - **Por Data de Registo** (`registration`) - Seeds by registration order (first registered = seed 1)
   - **Por Classificação da Ladder** (`ladder`) - Seeds by ladder standings (highest ELO = seed 1)
   - **Aleatório** (`random`) - Random shuffle of all participants

3. **ladder_id** (optional, required if seeding_type = 'ladder')
   - The ladder ID to use for standings-based seeding

### Workflow Example

```
1. /competition create → Creates competition in "draft" status
2. /competition register → Register all participants
3. /competition bracket → Generate seeding (NEW!)
4. /competition start → Generate bracket and start
```

### Implementation Details

#### Service Layer (`tournamentService.js`)
- Added `generateSeeding(competitionId, seedingType, ladderId)` function
- Validates competition status (must be draft/registration)
- Three seeding algorithms:
  - **Registration**: Uses `joined_at` timestamp
  - **Ladder**: Queries `ladder_standings` table, orders by ELO DESC
  - **Random**: Fisher-Yates shuffle algorithm
- Updates `tournament_participants.seed` for all participants

#### Command Layer (`competition.js`)
- Added `bracket` subcommand with autocomplete
- Displays seeded participant list after generation
- Validates ladder_id requirement for ladder seeding

### Output Example

```
✅ Seeding gerado com sucesso!

**Tipo**: Classificação da Ladder
**Participantes**: 16

**Seeds:**
1. PlayerPro
2. SkillMaster
3. TopGamer
4. ElitePlayer
...
```

### Database Impact
- Updates existing `tournament_participants.seed` column
- No schema changes required
- Seeds are used by existing bracket generation logic in `startCompetition()`

### Error Handling
- Competition not found
- Competition already active/completed
- No participants registered
- Missing ladder_id for ladder seeding
- Invalid seeding type
