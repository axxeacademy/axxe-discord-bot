 // services/queueService.js
const { execute } = require('../utils/db');

/**
 * Fetch the per-opponent daily match limit for a given ladder.
 * @param {number} ladderId
 * @returns {Promise<number|null>} The max matches per opponent, or null if not set.
 */
async function getMaxMatchesPerOpponent(ladderId) {
  let [rows] = await execute(
    'SELECT max_matches_per_opponent FROM ladders WHERE id = ?',
    [ladderId]
  );
  if (rows.length > 0 && rows[0].max_matches_per_opponent !== null) {
    return Number(rows[0].max_matches_per_opponent);
  }
  return null;
}

async function addToQueue(playerId, discordId, ladderId) {
  if (ladderId === undefined) throw new Error('ladderId is required');
  await execute(
    'INSERT INTO ladder_match_queue (player_id, discord_id, ladder_id, looking_since) VALUES (?, ?, ?, UTC_TIMESTAMP())',
    [playerId, discordId, ladderId]
  );
}

async function removeFromQueue(discordId, ladderId, competitionId, leftReason) {
  if (ladderId === undefined) throw new Error('ladderId is required');
  // Update ladder_queue_history for the latest open session
  if (competitionId && leftReason) {
    await execute(
      `UPDATE ladder_queue_history
       SET left_at = UTC_TIMESTAMP(), left_reason = ?
       WHERE discord_id = ? AND ladder_id = ? AND competition_id = ? AND left_at IS NULL
       ORDER BY queued_at DESC
       LIMIT 1`,
      [leftReason, discordId, ladderId, competitionId]
    );
  }
  await execute(
    'DELETE FROM ladder_match_queue WHERE discord_id = ? AND ladder_id = ?',
    [discordId, ladderId]
  );
}

async function clearQueue(ladderId) {
  if (ladderId === undefined) throw new Error('ladderId is required');
  await execute('DELETE FROM ladder_match_queue WHERE ladder_id = ?', [ladderId]);
}

async function getNextOpponent(discordId, playerElo, ladderId) {
  if (ladderId === undefined) throw new Error('ladderId is required');

  // Get the current player's looking_since
  let [myRows] = await execute(
    `SELECT looking_since 
     FROM ladder_match_queue 
     WHERE discord_id = ? AND ladder_id = ? 
     LIMIT 1`,
    [discordId, ladderId]
  );
  let myLookingSince = myRows.length > 0 ? myRows[0].looking_since : null;

  const now = new Date();
  const mySince = myLookingSince ? new Date(myLookingSince) : null;
  const myWaitMinutes = mySince ? (now - mySince) / 60000 : 0;

  // Fetch per-opponent daily match limit for this ladder
  const maxMatchesPerOpponent = await getMaxMatchesPerOpponent(ladderId);

  // Define Elo thresholds based on waiting time
  let eloThreshold = 50; // initial ±50
  if (myWaitMinutes >= 5) {
    eloThreshold = 300;
  } else if (myWaitMinutes >= 2) {
    eloThreshold = 150;
  }

  // Try to find all possible opponents within the Elo threshold, ordered by waiting time
  let [rows] = await execute(
    `SELECT q.*, ps.elo_rating
     FROM ladder_match_queue q
     JOIN ladder_player_stats ps 
       ON q.player_id = ps.player_id AND q.ladder_id = ps.ladder_id
     WHERE q.discord_id != ? 
       AND q.ladder_id = ? 
       AND ABS(ps.elo_rating - ?) <= ?
     ORDER BY q.looking_since ASC`,
    [discordId, ladderId, playerElo, eloThreshold]
  );

  // If no opponent found and waiting less than 2 minutes, return no match
  if (rows.length === 0 && myWaitMinutes < 2) {
    return null;
  }

  // If no opponent found and waiting more than 5 minutes, try to find any opponent who has also been waiting >5 minutes regardless of Elo difference
  if (rows.length === 0 && myWaitMinutes >= 5) {
    [rows] = await execute(
      `SELECT q.*, ps.elo_rating
       FROM ladder_match_queue q
       JOIN ladder_player_stats ps 
         ON q.player_id = ps.player_id AND q.ladder_id = ps.ladder_id
       WHERE q.discord_id != ? 
         AND q.ladder_id = ? 
         AND TIMESTAMPDIFF(MINUTE, q.looking_since, UTC_TIMESTAMP()) >= 5
       ORDER BY q.looking_since ASC`,
      [discordId, ladderId]
    );
  }

  // For each candidate, check per-opponent daily match limit
  for (const candidate of rows) {
    if (!maxMatchesPerOpponent || isNaN(maxMatchesPerOpponent) || maxMatchesPerOpponent <= 0) {
      // No limit set, allow match
      return candidate;
    }

    // Get player IDs for both users
    let [userRows1] = await execute(
      'SELECT id FROM users WHERE discord_id = ?',
      [discordId]
    );
    let [userRows2] = await execute(
      'SELECT id FROM users WHERE discord_id = ?',
      [candidate.discord_id]
    );
    if (userRows1.length === 0 || userRows2.length === 0) continue;
    const player1Id = userRows1[0].id;
    const player2Id = userRows2[0].id;

    // Count today's confirmed matches between these two players in this ladder
    let [matchCountRows] = await execute(
      `SELECT COUNT(*) AS match_count
       FROM ladder_matches
       WHERE ladder_id = ?
         AND status = 'confirmed'
         AND (
           (player1_id = ? AND player2_id = ?)
           OR (player1_id = ? AND player2_id = ?)
         )
         AND DATE(match_date) = CURDATE()`,
      [ladderId, player1Id, player2Id, player2Id, player1Id]
    );
    const matchCount = matchCountRows[0]?.match_count ?? 0;

    if (matchCount < maxMatchesPerOpponent) {
      // Under the limit, allow match
      return candidate;
    }
    // Otherwise, skip this candidate and try the next
  }

  // No suitable opponent found
  return null;
}

module.exports = {
  addToQueue,
  removeFromQueue,
  clearQueue,
  getNextOpponent,
  getMaxMatchesPerOpponent,
};
