// services/queueService.js
const { execute } = require('../utils/db');

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

  // Define Elo thresholds based on waiting time
  let eloThreshold = 50; // initial ±50
  if (myWaitMinutes >= 5) {
    eloThreshold = 300;
  } else if (myWaitMinutes >= 2) {
    eloThreshold = 150;
  }

  // Try to find an opponent within the Elo threshold
  let [rows] = await execute(
    `SELECT q.*, ps.elo_rating
     FROM ladder_match_queue q
     JOIN ladder_player_stats ps 
       ON q.player_id = ps.player_id AND q.ladder_id = ps.ladder_id
     WHERE q.discord_id != ? 
       AND q.ladder_id = ? 
       AND ABS(ps.elo_rating - ?) <= ?
     ORDER BY q.looking_since ASC
     LIMIT 1`,
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
       ORDER BY q.looking_since ASC
       LIMIT 1`,
      [discordId, ladderId]
    );
    if (rows.length > 0) {
      const oppSince = new Date(rows[0].looking_since);
      const oppWaitMinutes = (now - oppSince) / 60000;
      if (oppWaitMinutes >= 5) {
        return rows[0];
      }
    }
  }

  return rows[0] || null;
}

module.exports = {
  addToQueue,
  removeFromQueue,
  clearQueue,
  getNextOpponent,
};
