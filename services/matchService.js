// services/matchService.js
require('dotenv').config();
const { execute } = require('../utils/db'); // ⬅️ use pooled helpers
const { EmbedBuilder } = require('discord.js');
const dayjs = require('dayjs');
const { notifyLadderAdminsNewGame } = require('../utils/notifyAdmins');

function calculateEloAdvanced({
  playerRating,
  opponentRating,
  result, // 1 = win, 0.5 = draw, 0 = loss
  goalDiff = 0,
  winStreak = 0,
  isWinner = false,
}) {
  const winBonus = result === 1 ? 5 : 0;
  const goalBonusFactor = isWinner ? Math.min(goalDiff * 0.05, 0.75) : 0;

  function getBaseK(elo, isWinnerFlag) {
    if (isWinnerFlag) {
      if (elo < 900) return 30;
      if (elo < 950) return 28;
      if (elo < 1000) return 25;
      if (elo < 1050) return 22;
      if (elo < 1100) return 20;
      if (elo < 1150) return 18;
      if (elo < 1200) return 16;
      if (elo < 1250) return 17;
      if (elo < 1300) return 15;
      return 14;
    } else {
      if (elo < 900) return 22;
      if (elo < 950) return 23;
      if (elo < 1000) return 24;
      if (elo < 1050) return 25;
      if (elo < 1100) return 27;
      if (elo < 1150) return 30;
      if (elo < 1200) return 33;
      if (elo < 1250) return 36;
      if (elo < 1300) return 40;
      return 44;
    }
  }

  let expected;
  if (Math.abs(playerRating - opponentRating) <= 15) {
    expected = 0.5;
  } else {
    expected = 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 700));
  }

  const baseK = getBaseK(playerRating, isWinner);
  const k = baseK * (1 + (isWinner ? goalBonusFactor : 0));
  let delta = k * (result - expected);

  if (isWinner) {
    delta += winBonus;
    if (playerRating - opponentRating >= 300) {
      delta = Math.min(delta, 5);
    }
  }

// 🔒 CHECKPOINT (Rivals-like)
if (result === 0 && winStreak >= 3 && playerRating < 1000) {
  return playerRating;
}

  return Math.round(playerRating + delta);
}

/**
 * Confirm a match (auto or manual).
 * @param {Client} client
 * @param {number} matchId
 * @param {number} ladderId
 * @param {ThreadChannel} thread
 * @param {Object} options
 * @param {'auto'|'manual'} [options.source='auto']
 * @param {string} [options.confirmer]
 */
async function confirmMatch(client, matchId, ladderId, thread, options = {}) {
  const { source = 'auto', confirmer } = options;

  try {
    // Try to find a pending match first
    let [matchRows] = await execute(
      'SELECT * FROM ladder_matches WHERE id = ? AND status = ? AND ladder_id = ?',
      [matchId, 'pending', ladderId]
    );
    if (matchRows.length === 0) {
      // If not found, check if it's disputed
      [matchRows] = await execute(
        'SELECT * FROM ladder_matches WHERE id = ? AND status = ? AND ladder_id = ?',
        [matchId, 'disputed', ladderId]
      );
      if (matchRows.length > 0) {
        return { ok: false, code: 'disputed' };
      }
      // Check if already confirmed
      [matchRows] = await execute(
        'SELECT * FROM ladder_matches WHERE id = ? AND status = ? AND ladder_id = ?',
        [matchId, 'confirmed', ladderId]
      );
      if (matchRows.length > 0) {
        return { ok: false, code: 'confirmed' };
      }
      return { ok: false, code: 'not_found' }; // No pending, disputed, or confirmed match found
    }

    const match = matchRows[0];

    // Must be reported to be confirmed
    if (!match.reported_by) {
      return { ok: false, code: 'pending' };
    }

    // Fetch player stats
    const [playerStats] = await execute(
      'SELECT * FROM ladder_player_stats WHERE player_id IN (?, ?) AND ladder_id = ?',
      [match.player1_id, match.player2_id, ladderId]
    );
    const statsMap = {};
    playerStats.forEach(ps => { statsMap[ps.player_id] = ps; });

    // Determine draw/winner (penalties decisive)
    const hasPenalty = (match.penalty_score1 !== null && match.penalty_score2 !== null);
    const penaltyScoresValid = hasPenalty && (match.penalty_score1 !== 0 || match.penalty_score2 !== 0);
    const isDraw = match.player1_score === match.player2_score && !penaltyScoresValid;

    let winnerId = null;
    if (!isDraw) {
      if (penaltyScoresValid) {
        winnerId = match.penalty_score1 > match.penalty_score2 ? match.player1_id : match.player2_id;
      } else {
        winnerId = match.player1_score > match.player2_score ? match.player1_id : match.player2_id;
      }
    }

    const result1 = isDraw ? 0.5 : (match.player1_id === winnerId ? 1 : 0);
    const result2 = isDraw ? 0.5 : (match.player2_id === winnerId ? 1 : 0);
    const goalDiff = Math.abs(match.player1_score - match.player2_score);

    const preElo1 = statsMap[match.player1_id].elo_rating;
    const preElo2 = statsMap[match.player2_id].elo_rating;
    const preWS1  = statsMap[match.player1_id].win_streak || 0;
    const preWS2  = statsMap[match.player2_id].win_streak || 0;

    const newElo1 = calculateEloAdvanced({
      playerRating: preElo1,
      opponentRating: preElo2,
      result: result1,
      goalDiff,
      winStreak: preWS1,
      isWinner: result1 === 1
    });
    const newElo2 = calculateEloAdvanced({
      playerRating: preElo2,
      opponentRating: preElo1,
      result: result2,
      goalDiff,
      winStreak: preWS2,
      isWinner: result2 === 1
    });

    const delta1 = newElo1 - preElo1;
    const delta2 = newElo2 - preElo2;

    const checkpoint1 = (result1 === 0 && preWS1 > 0 && preElo1 < 1000);
    const checkpoint2 = (result2 === 0 && preWS2 > 0 && preElo2 < 1000);

    // Update stats P1
    const gamesPlayed1   = statsMap[match.player1_id].games_played + 1;
    const isPenaltyDecided = (match.penalty_score1 !== null && match.penalty_score2 !== null);

    const wins1          = statsMap[match.player1_id].wins + (result1 === 1 ? 1 : 0);
    const draws1         = statsMap[match.player1_id].draws + ((result1 === 0.5 && !isPenaltyDecided) ? 1 : 0);
    const losses1        = statsMap[match.player1_id].losses + (result1 === 0 ? 1 : 0);
    const goalsScored1   = statsMap[match.player1_id].goals_scored + match.player1_score;
    const goalsConceded1 = statsMap[match.player1_id].goals_conceded + match.player2_score;
    const points1        = statsMap[match.player1_id].points + (result1 === 1 ? 3 : (result1 === 0.5 && !isPenaltyDecided) ? 1 : 0);
    const goalDiff1      = goalsScored1 - goalsConceded1;
    const winStreak1     = result1 === 1 ? preWS1 + 1 : 0;

    // Update stats P2
    const gamesPlayed2   = statsMap[match.player2_id].games_played + 1;
    const wins2          = statsMap[match.player2_id].wins + (result2 === 1 ? 1 : 0);
    const draws2         = statsMap[match.player2_id].draws + ((result2 === 0.5 && !isPenaltyDecided) ? 1 : 0);
    const losses2        = statsMap[match.player2_id].losses + (result2 === 0 ? 1 : 0);
    const goalsScored2   = statsMap[match.player2_id].goals_scored + match.player2_score;
    const goalsConceded2 = statsMap[match.player2_id].goals_conceded + match.player1_score;
    const points2        = statsMap[match.player2_id].points + (result2 === 1 ? 3 : (result2 === 0.5 && !isPenaltyDecided) ? 1 : 0);
    const goalDiff2      = goalsScored2 - goalsConceded2;
    const winStreak2     = result2 === 1 ? preWS2 + 1 : 0;

    await execute(
      'UPDATE ladder_player_stats SET elo_rating = ?, last_played = NOW(), win_streak = ?, games_played = ?, wins = ?, draws = ?, losses = ?, goals_scored = ?, goals_conceded = ?, points = ?, goal_diff = ? WHERE player_id = ? AND ladder_id = ?',
      [newElo1, winStreak1, gamesPlayed1, wins1, draws1, losses1, goalsScored1, goalsConceded1, points1, goalDiff1, match.player1_id, ladderId]
    );

    await execute(
      'UPDATE ladder_player_stats SET elo_rating = ?, last_played = NOW(), win_streak = ?, games_played = ?, wins = ?, draws = ?, losses = ?, goals_scored = ?, goals_conceded = ?, points = ?, goal_diff = ? WHERE player_id = ? AND ladder_id = ?',
      [newElo2, winStreak2, gamesPlayed2, wins2, draws2, losses2, goalsScored2, goalsConceded2, points2, goalDiff2, match.player2_id, ladderId]
    );

    await execute(
      'INSERT INTO ladder_elo_history (match_id, player_id, old_elo, new_elo, delta, changed_at, ladder_id) VALUES (?, ?, ?, ?, ?, NOW(), ?)',
      [match.id, match.player1_id, preElo1, newElo1, delta1, ladderId]
    );
    await execute(
      'INSERT INTO ladder_elo_history (match_id, player_id, old_elo, new_elo, delta, changed_at, ladder_id) VALUES (?, ?, ?, ?, ?, NOW(), ?)',
      [match.id, match.player2_id, preElo2, newElo2, delta2, ladderId]
    );

    await execute('UPDATE ladder_matches SET status = ? WHERE id = ?', ['confirmed', match.id]);

    // Get Discord IDs and gamertags
    const [player1DiscordRows] = await execute('SELECT discord_id, gamertag FROM users WHERE id = ?', [match.player1_id]);
    const [player2DiscordRows] = await execute('SELECT discord_id, gamertag FROM users WHERE id = ?', [match.player2_id]);
    const player1Id = player1DiscordRows[0]?.discord_id;
    const player2Id = player2DiscordRows[0]?.discord_id;
    const player1Gamertag = player1DiscordRows[0]?.gamertag || 'Unknown';
    const player2Gamertag = player2DiscordRows[0]?.gamertag || 'Unknown';

    // Resolve proper guild members for mentions
    const guild = thread.guild;
    async function getMemberPack(id) {
      if (!id) return { member: null, name: 'Unknown', tag: 'unknown', mention: '`unknown`', id: null };
      try {
        const m = await guild.members.fetch(id);
        const name = m.user.globalName || m.displayName || m.user.username;
        const tag  = m.user.tag || m.user.username;
        const mention = m.toString();
        return { member: m, name, tag, mention, id };
      } catch {
        return { member: null, name: 'Unknown', tag: String(id), mention: `<@${id}>`, id };
      }
    }
    const p1 = await getMemberPack(player1Id);
    const p2 = await getMemberPack(player2Id);

    // Score line (include penalties if present)
    const scoreLine = (match.penalty_score1 !== null && match.penalty_score2 !== null)
      ? `**${player1Gamertag}** **${match.player1_score}** (${match.penalty_score1}) – (${match.penalty_score2}) **${match.player2_score}** **${player2Gamertag}**`
      : `**${player1Gamertag}** **${match.player1_score}** – **${match.player2_score}** **${player2Gamertag}**`;

    const p1Icon = (newElo1 - preElo1) >= 0 ? '🟢' : '🔴';
    const p2Icon = (newElo2 - preElo2) >= 0 ? '🟢' : '🔴';
    const formatDelta = (d, checkpoint) => `${d >= 0 ? `+${d}` : `${d}`}${checkpoint ? ' 🛡️ *Checkpoint*' : ''}`;

    const embed = new EmbedBuilder()
      .setTitle(`🆚 Jogo #${matchId} Confirmado`)
      .setDescription(scoreLine)
      .addFields(
        {
          name: player1Gamertag,
          value:
            `${p1Icon} ${p1.mention}\n` +
            `Elo: **${formatDelta(newElo1 - preElo1, checkpoint1)}**\n` +
            `Elo: ${preElo1} → **${newElo1}**`,
          inline: true
        },
        {
          name: player2Gamertag,
          value:
            `${p2Icon} ${p2.mention}\n` +
            `Elo: **${formatDelta(newElo2 - preElo2, checkpoint2)}**\n` +
            `Elo: ${preElo2} → **${newElo2}**`,
          inline: true
        }
      )
      .setTimestamp()
      .setColor(isDraw ? 0x99AAB5 : 0x57F287);

    const footerText = (source === 'manual' && confirmer)
      ? `Confirmed by ${confirmer}`
      : (source === 'auto')
        ? 'Confirmado automaticamente pelo sistema'
        : null;
    if (footerText) embed.setFooter({ text: footerText });

    // Ensure thread is open for sending
    if (thread.archived) {
      try { await thread.setArchived(false); } catch (err) { console.error('❌ Failed to unarchive thread:', err); }
    }
    await thread.send({ embeds: [embed] });
    await thread.setArchived(true).catch(console.error);

    return { ok: true };
  } catch (error) {
    console.error('❌ Error in match confirmation:', error);
    return { ok: false, code: 'exception' };
  }
}

async function createMatch(player1Id, player2Id) {
  try {
    const [result] = await execute(
      `INSERT INTO ladder_matches (player1_id, player2_id, status, player1_score, player2_score, ladder_id)
       VALUES (?, ?, 'pending', 0, 0, 1)`,
      [player1Id, player2Id]
    );
    return result.insertId;
  } catch (error) {
    throw error;
  }
}

async function deleteMatch(matchId) {
  try {
    await execute('DELETE FROM ladder_matches WHERE id = ?', [matchId]);
  } catch (error) {
    throw error;
  }
}

async function updateMatchResult(matchId, player1Score, player2Score) {
  try {
    await execute(
      'UPDATE ladder_matches SET player1_score = ?, player2_score = ?, status = ? WHERE id = ?',
      [player1Score, player2Score, 'completed', matchId]
    );
  } catch (error) {
    throw error;
  }
}

async function getMatchById(matchId) {
  try {
    const [rows] = await execute('SELECT * FROM ladder_matches WHERE id = ?', [matchId]);
    return rows[0] || null;
  } catch (error) {
    throw error;
  }
}

async function createMatchThread(
  interaction,
  player1DiscordId,
  player2DiscordId,
  matchId,
  player1Gamertag,
  player2Gamertag
) {
  const channel = interaction.channel;
  const threadTitle = `Match #${matchId} - ${player1Gamertag} vs ${player2Gamertag}`;

  const thread = await channel.threads.create({
    name: threadTitle,
    autoArchiveDuration: 60,
    reason: 'Match thread created',
    type: 12, // ChannelType.PrivateThread
  });

  if (thread.joinable) {
    try { await thread.join(); } catch {}
  }

  await notifyLadderAdminsNewGame(thread, threadTitle);

  await thread.send(`Jogo #${matchId} iniciado entre <@${player1DiscordId}> e <@${player2DiscordId}>.`);
  await thread.send('Use `/reportmatch` para reportar o resultado do jogo quando terminar.');

  return thread;
}

module.exports = {
  createMatch,
  deleteMatch,
  updateMatchResult,
  getMatchById,
  createMatchThread,
  confirmMatch
};
