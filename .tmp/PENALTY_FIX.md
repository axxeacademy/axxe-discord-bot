# Tournament Penalty Scores Fix

## Problem
The `/reportmatch` command was not accepting penalty scores for tournament matches because the `tournament_matches` table was missing the penalty columns that exist in `ladder_matches`.

## Root Cause
**Table Comparison:**

### `ladder_matches` (Working ✅)
```sql
`player1_score` int DEFAULT NULL,
`player2_score` int DEFAULT NULL,
`penalty_score1` int DEFAULT NULL,  -- ✅ Has penalties
`penalty_score2` int DEFAULT NULL   -- ✅ Has penalties
```

### `tournament_matches` (Broken ❌)
```sql
`player1_score` int DEFAULT NULL,
`player2_score` int DEFAULT NULL,
-- ❌ Missing penalty columns!
```

## Solution

### 1. Database Migration
**File**: `migrations/20260207_add_penalties_to_tournament_matches.sql`

```sql
ALTER TABLE tournament_matches 
ADD COLUMN penalty_score1 INT DEFAULT NULL AFTER player2_score,
ADD COLUMN penalty_score2 INT DEFAULT NULL AFTER penalty_score1;
```

### 2. Code Update
**File**: `commands/user/reportmatch.js` (Line 159-165)

**Before:**
```javascript
await execute(
  `UPDATE tournament_matches
     SET player1_score = ?, player2_score = ?, reported_by = ?, status = 'pending_confirmation', reported_at = NOW()
     WHERE id = ?`,
  [realP1Score, realP2Score, reporterPlayerId || null, finalMatchId]
);
```

**After:**
```javascript
await execute(
  `UPDATE tournament_matches
     SET player1_score = ?, player2_score = ?, penalty_score1 = ?, penalty_score2 = ?, reported_by = ?, status = 'pending_confirmation', reported_at = NOW()
     WHERE id = ?`,
  [realP1Score, realP2Score, realP1Pen, realP2Pen, reporterPlayerId || null, finalMatchId]
);
```

## How to Apply

1. **Run the migration** on your Railway database:
   ```bash
   # Connect to your database and run:
   # migrations/20260207_add_penalties_to_tournament_matches.sql
   ```

2. **Deploy the code** (already updated in `reportmatch.js`)

3. **Test** with a tournament match that ends in a draw:
   ```
   /reportmatch yourscore:1 opponentscore:1 penaltyscore1:5 penaltyscore2:3
   ```

## Verification
After applying the fix, penalty scores will be:
- ✅ Saved to the database
- ✅ Displayed in match embeds
- ✅ Used to determine the winner
- ✅ Consistent with ladder match behavior
