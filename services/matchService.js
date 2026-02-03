// services/matchService.js
require('dotenv').config();
const { execute } = require('../utils/db');
const { EmbedBuilder } = require('discord.js');
const tournamentService = require('./tournamentService'); // NEW: Import tournament service
const { notifyLadderAdminsNewGame } = require('../utils/notifyAdmins');

// [NEW] Helper to register thread association
async function registerMatchThread(threadId, matchId, type) {
  try {
    await execute(
      'INSERT INTO match_threads (thread_id, match_id, match_type) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE match_id = ?, match_type = ?',
      [threadId, matchId, type, matchId, type]
    );
  } catch (err) {
    console.error('Failed to register match thread:', err);
  }
}

// [NEW] Helper to get context from thread
async function getMatchContext(threadId) {
  try {
    const [rows] = await execute('SELECT * FROM match_threads WHERE thread_id = ?', [threadId]);
    if (rows.length > 0) {
      return { matchId: rows[0].match_id, type: rows[0].match_type };
    }
    return null;
  } catch (err) {
    console.error('Failed to get match context:', err);
    return null;
  }
}

// [NEW] Helper to check if a match already has a thread
async function isThreadRegistered(matchId, type) {
  try {
    const [rows] = await execute('SELECT thread_id FROM match_threads WHERE match_id = ? AND match_type = ?', [matchId, type]);
    return rows.length > 0;
  } catch (err) {
    console.error('Failed to check thread registration:', err);
    return false;
  }
}

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
 */
async function confirmMatch(client, inputMatchId, ladderId, thread, options = {}) {
  const { source = 'auto', confirmer } = options;

  try {
    // 1. RESOLVE CONTEXT
    let matchId = inputMatchId;
    let type = null;

    // Try lookup from thread first (MOST RELIABLE)
    if (thread) {
      const context = await getMatchContext(thread.id);
      if (context) {
        matchId = context.matchId; // Override/Ensure ID matches thread
        type = context.type;
      }
    }

    // Fallbacks
    if (!type) {
      if (ladderId) type = 'ladder';
      else {
        console.warn(`[confirmMatch] No context found for match ${matchId} in thread ${thread?.id}. Defaulting to ladder check.`);
        type = 'ladder';
      }
    }

    // 2. LOAD MATCH DATA BASED ON TYPE
    let match = null;
    let isTournament = (type === 'tournament');

    if (isTournament) {
      const [rows] = await execute('SELECT * FROM tournament_matches WHERE id = ?', [matchId]);
      if (rows.length > 0) match = rows[0];
    } else {
      const [rows] = await execute('SELECT * FROM ladder_matches WHERE id = ?', [matchId]);
      if (rows.length > 0) match = rows[0];
    }

    if (!match) return { ok: false, code: 'not_found' };

    // 3. COMMON STATUS CHECKS
    const status = match.status;
    if (status === 'disputed') return { ok: false, code: 'disputed' };

    // Check confirmed status
    const isCompleted = isTournament ? (status === 'completed') : (status === 'confirmed');
    // Tournament 'pending_confirmation' is the ready state. 'scheduled' is not ready.
    const isPending = isTournament ? (status === 'pending_confirmation') : (status === 'pending');

    if (isCompleted) return { ok: false, code: 'confirmed' };
    if (!isPending) return { ok: false, code: 'pending' };

    // 4. EXECUTE CONFIRMATION LOGIC
    if (isTournament) {
      // --- TOURNAMENT LOGIC ---
      let winnerId = null;
      if (match.player1_score > match.player2_score) winnerId = match.player1_id;
      else if (match.player2_score > match.player1_score) winnerId = match.player2_id;
      else return { ok: false, code: 'draw_not_allowed' };

      // [FIX] Pass thread.parent so next match thread can be created
      const contextChannel = thread ? thread.parent : null;
      await tournamentService.processTournamentMatchResult(matchId, winnerId, contextChannel);

      const embed = new EmbedBuilder()
        .setTitle(`🏆 Jogo de Torneio #${matchId} Confirmado`)
        .setDescription(`Vencedor: <@${winnerId}>`)
        .setColor(0xF1C40F);

      if (thread) {
        if (thread.archived) await thread.setArchived(false).catch(() => { });
        await thread.send({ embeds: [embed] });
        await thread.setArchived(true).catch(() => { });
      }
      return { ok: true };
    } else {
      // --- LADDER LOGIC ---
      if (!match.reported_by) {
        return { ok: false, code: 'pending' };
      }

      const [playerStats] = await execute(
        'SELECT * FROM ladder_player_stats WHERE player_id IN (?, ?) AND ladder_id = ?',
        [match.player1_id, match.player2_id, match.ladder_id || ladderId]
      );
      const statsMap = {};
      playerStats.forEach(ps => { statsMap[ps.player_id] = ps; });

      if (!statsMap[match.player1_id] || !statsMap[match.player2_id]) {
        console.error(`Missing stats for players in match ${matchId}`);
      }

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
      const preWS1 = statsMap[match.player1_id].win_streak || 0;
      const preWS2 = statsMap[match.player2_id].win_streak || 0;

      const newElo1 = calculateEloAdvanced({
        playerRating: preElo1, opponentRating: preElo2, result: result1, goalDiff, winStreak: preWS1, isWinner: result1 === 1
      });
      const newElo2 = calculateEloAdvanced({
        playerRating: preElo2, opponentRating: preElo1, result: result2, goalDiff, winStreak: preWS2, isWinner: result2 === 1
      });

      const delta1 = newElo1 - preElo1;
      const delta2 = newElo2 - preElo2;

      const checkpoint1 = (result1 === 0 && preWS1 > 0 && preElo1 < 1000);
      const checkpoint2 = (result2 === 0 && preWS2 > 0 && preElo2 < 1000);

      // Update stats P1
      const gamesPlayed1 = statsMap[match.player1_id].games_played + 1;
      const isPenaltyDecided = (match.penalty_score1 !== null && match.penalty_score2 !== null);

      const wins1 = statsMap[match.player1_id].wins + (result1 === 1 ? 1 : 0);
      const draws1 = statsMap[match.player1_id].draws + ((result1 === 0.5 && !isPenaltyDecided) ? 1 : 0);
      const losses1 = statsMap[match.player1_id].losses + (result1 === 0 ? 1 : 0);
      const goalsScored1 = statsMap[match.player1_id].goals_scored + match.player1_score;
      const goalsConceded1 = statsMap[match.player1_id].goals_conceded + match.player2_score;
      const points1 = statsMap[match.player1_id].points + (result1 === 1 ? 3 : (result1 === 0.5 && !isPenaltyDecided) ? 1 : 0);
      const goalDiff1 = goalsScored1 - goalsConceded1;
      const winStreak1 = result1 === 1 ? preWS1 + 1 : 0;

      // Update stats P2
      const gamesPlayed2 = statsMap[match.player2_id].games_played + 1;
      const wins2 = statsMap[match.player2_id].wins + (result2 === 1 ? 1 : 0);
      const draws2 = statsMap[match.player2_id].draws + ((result2 === 0.5 && !isPenaltyDecided) ? 1 : 0);
      const losses2 = statsMap[match.player2_id].losses + (result2 === 0 ? 1 : 0);
      const goalsScored2 = statsMap[match.player2_id].goals_scored + match.player2_score;
      const goalsConceded2 = statsMap[match.player2_id].goals_conceded + match.player1_score;
      const points2 = statsMap[match.player2_id].points + (result2 === 1 ? 3 : (result2 === 0.5 && !isPenaltyDecided) ? 1 : 0);
      const goalDiff2 = goalsScored2 - goalsConceded2;
      const winStreak2 = result2 === 1 ? preWS2 + 1 : 0;

      const currentLadderId = match.ladder_id || ladderId;

      await execute(
        'UPDATE ladder_player_stats SET elo_rating = ?, last_played = NOW(), win_streak = ?, games_played = ?, wins = ?, draws = ?, losses = ?, goals_scored = ?, goals_conceded = ?, points = ?, goal_diff = ? WHERE player_id = ? AND ladder_id = ?',
        [newElo1, winStreak1, gamesPlayed1, wins1, draws1, losses1, goalsScored1, goalsConceded1, points1, goalDiff1, match.player1_id, currentLadderId]
      );

      await execute(
        'UPDATE ladder_player_stats SET elo_rating = ?, last_played = NOW(), win_streak = ?, games_played = ?, wins = ?, draws = ?, losses = ?, goals_scored = ?, goals_conceded = ?, points = ?, goal_diff = ? WHERE player_id = ? AND ladder_id = ?',
        [newElo2, winStreak2, gamesPlayed2, wins2, draws2, losses2, goalsScored2, goalsConceded2, points2, goalDiff2, match.player2_id, currentLadderId]
      );

      await execute(
        'INSERT INTO ladder_elo_history (match_id, player_id, old_elo, new_elo, delta, changed_at, ladder_id) VALUES (?, ?, ?, ?, ?, NOW(), ?)',
        [match.id, match.player1_id, preElo1, newElo1, delta1, currentLadderId]
      );
      await execute(
        'INSERT INTO ladder_elo_history (match_id, player_id, old_elo, new_elo, delta, changed_at, ladder_id) VALUES (?, ?, ?, ?, ?, NOW(), ?)',
        [match.id, match.player2_id, preElo2, newElo2, delta2, currentLadderId]
      );

      await execute('UPDATE ladder_matches SET status = ? WHERE id = ?', ['confirmed', match.id]);

      // Get Discord IDs and gamertags
      const [player1DiscordRows] = await execute('SELECT discord_id, gamertag FROM users WHERE id = ?', [match.player1_id]);
      const [player2DiscordRows] = await execute('SELECT discord_id, gamertag FROM users WHERE id = ?', [match.player1_id]);
      const player1Id = player1DiscordRows[0]?.discord_id;
      const player2Id = player2DiscordRows[0]?.discord_id;
      const player1Gamertag = player1DiscordRows[0]?.gamertag || 'Unknown';
      const player2Gamertag = player2DiscordRows[0]?.gamertag || 'Unknown';

      // Utils
      const guild = thread.guild;
      async function getMemberPack(id) {
        if (!id) return { member: null, name: 'Unknown', tag: 'unknown', mention: '`unknown`', id: null };
        try {
          const m = await guild.members.fetch(id);
          const name = m.user.globalName || m.displayName || m.user.username;
          const tag = m.user.tag || m.user.username;
          const mention = m.toString();
          return { member: m, name, tag, mention, id };
        } catch {
          return { member: null, name: 'Unknown', tag: String(id), mention: `<@${id}>`, id };
        }
      }
      const p1 = await getMemberPack(player1Id);
      const p2 = await getMemberPack(player2Id);

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
          { name: player1Gamertag, value: `${p1Icon} ${p1.mention}\nElo: **${formatDelta(newElo1 - preElo1, checkpoint1)}**\nElo: ${preElo1} → **${newElo1}**`, inline: true },
          { name: player2Gamertag, value: `${p2Icon} ${p2.mention}\nElo: **${formatDelta(newElo2 - preElo2, checkpoint2)}**\nElo: ${preElo2} → **${newElo2}**`, inline: true }
        )
        .setTimestamp()
        .setColor(isDraw ? 0x99AAB5 : 0x57F287);

      const footerText = (source === 'manual' && confirmer) ? `Confirmed by ${confirmer}` : (source === 'auto') ? 'Confirmado automaticamente pelo sistema' : null;
      if (footerText) embed.setFooter({ text: footerText });

      if (thread) {
        if (thread.archived) await thread.setArchived(false).catch(() => { });
        await thread.send({ embeds: [embed] });
        await thread.setArchived(true).catch(() => { });
      }
      return { ok: true };
    }
  } catch (error) {
    console.error('❌ Error in match confirmation:', error);
    return { ok: false, code: 'exception' };
  }
}

async function createMatch(player1Id, player2Id, ladderId) {
  try {
    const [result] = await execute(
      `INSERT INTO ladder_matches (player1_id, player2_id, status, player1_score, player2_score, ladder_id)
       VALUES (?, ?, 'pending', 0, 0, ?)`,
      [player1Id, player2Id, ladderId]
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
    // 1. Try LADDER
    const [rows] = await execute('SELECT * FROM ladder_matches WHERE id = ?', [matchId]);
    if (rows.length > 0) return rows[0];

    // 2. Try TOURNAMENT
    const [tRows] = await execute('SELECT * FROM tournament_matches WHERE id = ?', [matchId]);
    if (tRows.length > 0) return { ...tRows[0], isTournament: true };

    return null;
  } catch (error) {
    throw error;
  }
}

async function createMatchThread(
  interactionOrChannel,
  player1DiscordId,
  player2DiscordId,
  matchId,
  player1Gamertag,
  player2Gamertag,
  type = 'ladder',
  edition = null,
  roundSlug = null
) {
  const channel = interactionOrChannel.threads ? interactionOrChannel : interactionOrChannel.channel;

  let threadTitle;
  // [NEW] Enforce stricter logic and format edition
  const isTournament = (type === 'tournament');

  if (isTournament && roundSlug) {
    // Format edition to ensure it starts with #
    let editionPart = '';
    if (edition) {
      editionPart = String(edition);
      if (!editionPart.startsWith('#')) {
        // Prepend # and pad if it's a short string like "3" -> "#03"?
        // Simplest is to just prepend # if missing.
        if (/^\d+$/.test(editionPart) && editionPart.length < 2) {
          editionPart = `#0${editionPart}`;
        } else if (/^\d+$/.test(editionPart)) {
          editionPart = `#${editionPart}`;
        } else if (!editionPart.startsWith('#')) {
          editionPart = `${editionPart}`; // maybe it's "Cup 1"
        }
      }
      threadTitle = `${editionPart} | ${roundSlug} - ${player1Gamertag} vs ${player2Gamertag}`;
    } else {
      threadTitle = `${roundSlug} - ${player1Gamertag} vs ${player2Gamertag}`;
    }
  } else {
    threadTitle = `Match #${matchId} - ${player1Gamertag} vs ${player2Gamertag}`;
  }

  const thread = await channel.threads.create({
    name: threadTitle,
    autoArchiveDuration: 60,
    reason: 'Match thread created',
    type: 12,
  });

  if (thread.joinable) {
    try { await thread.join(); } catch { }
  }

  await registerMatchThread(thread.id, matchId, type);
  await notifyLadderAdminsNewGame(thread, threadTitle);

  await thread.send(`Jogo #${matchId} iniciado entre ${player1DiscordId ? `<@${player1DiscordId}>` : player1Gamertag} e ${player2DiscordId ? `<@${player2DiscordId}>` : player2Gamertag}.`);
  await thread.send('Use `/reportmatch` para reportar o resultado do jogo quando terminar.');

  return thread;
}

/**
 * Get the rank of a user in a ladder, using multi-level sorting logic.
 */
async function getRankByUserID(userId, ladderId, competitionId) {
  const [allStatsRows] = await execute(
    `SELECT 
        ps.player_id,
        ps.elo_rating,
        ps.games_played,
        ps.wins,
        ps.draws,
        ps.losses,
        ps.points,
        ps.goals_scored,
        ps.goals_conceded,
        ps.goal_diff,
        ps.win_streak,
        u.username
     FROM ladder_player_stats ps
     JOIN users u ON ps.player_id = u.id
     WHERE ps.competition_id = ? AND ps.ladder_id = ?`,
    [competitionId, ladderId]
  );

  const sortedStats = allStatsRows.slice().sort((a, b) => {
    if (a.elo_rating !== b.elo_rating) return b.elo_rating - a.elo_rating;
    if (a.goal_diff !== b.goal_diff) return b.goal_diff - a.goal_diff;
    if (a.goals_scored !== b.goals_scored) return b.goals_scored - a.goals_scored;
    if (a.goals_conceded !== b.goals_conceded) return a.goals_conceded - b.goals_conceded;
    let nameA = (a.username || "").toLowerCase();
    let nameB = (b.username || "").toLowerCase();
    if (nameA < nameB) return -1;
    if (nameA > nameB) return 1;
    return 0;
  });

  const idx = sortedStats.findIndex(row => row.player_id === userId);
  return idx >= 0 ? idx + 1 : null;
}

/**
 * Get global stats for a ladder.
 */
async function getLadderStats(ladderId) {
  // Number of matches played
  const [[{ matchesPlayed }]] = await execute('SELECT COUNT(*) AS matchesPlayed FROM ladder_matches WHERE ladder_id = ?', [ladderId]);
  // Number of unique players
  const [[{ players }]] = await execute('SELECT COUNT(DISTINCT player_id) AS players FROM ladder_player_stats WHERE ladder_id = ?', [ladderId]);
  // Number of active queues (if available)
  let activeQueues = 0;
  try {
    const [[{ count }]] = await execute('SELECT COUNT(*) AS count FROM ladder_match_queue WHERE ladder_id = ?', [ladderId]);
    activeQueues = count;
  } catch { }
  // Number of disputes (matches with status 'disputed')
  const [[{ disputes }]] = await execute('SELECT COUNT(*) AS disputes FROM ladder_matches WHERE ladder_id = ? AND status = ?', [ladderId, 'disputed']);
  // Unconfirmed matches (status 'pending')
  const [[{ unconfirmed }]] = await execute('SELECT COUNT(*) AS unconfirmed FROM ladder_matches WHERE ladder_id = ? AND status = ?', [ladderId, 'pending']);
  // Penalty shootouts (matches with non-null penalty_score1/2)
  const [[{ penaltyShootouts }]] = await execute('SELECT COUNT(*) AS penaltyShootouts FROM ladder_matches WHERE ladder_id = ? AND penalty_score1 IS NOT NULL AND penalty_score2 IS NOT NULL', [ladderId]);
  // Draw rate (matches with equal scores and not cancelled)
  const [[{ draws }]] = await execute('SELECT COUNT(*) AS draws FROM ladder_matches WHERE ladder_id = ? AND player1_score = player2_score AND status != "cancelled"', [ladderId]);
  // Average goals per match
  const [[{ avgGoals }]] = await execute('SELECT AVG(player1_score + player2_score) AS avgGoals FROM ladder_matches WHERE ladder_id = ? AND status != "cancelled"', [ladderId]);
  // Biggest win margin
  const [[{ maxWinMargin }]] = await execute('SELECT MAX(ABS(player1_score - player2_score)) AS maxWinMargin FROM ladder_matches WHERE ladder_id = ? AND status != "cancelled"', [ladderId]);
  // Recent activity (matches in last 7 days)
  const [[{ recentMatches }]] = await execute('SELECT COUNT(*) AS recentMatches FROM ladder_matches WHERE ladder_id = ? AND match_date >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND status != "cancelled"', [ladderId]);
  // Most active player (by games_played)
  const [[mostActivePlayer]] = await execute(
    'SELECT player_id, games_played FROM ladder_player_stats WHERE ladder_id = ? ORDER BY games_played DESC LIMIT 1',
    [ladderId]
  );
  // Top 3 players by wins
  const topPlayers = await execute(
    'SELECT player_id, wins FROM ladder_player_stats WHERE ladder_id = ? ORDER BY wins DESC LIMIT 3',
    [ladderId]
  );
  // Average matches per player
  const [[{ avgMatchesPerPlayer }]] = await execute(
    'SELECT AVG(games_played) AS avgMatchesPerPlayer FROM ladder_player_stats WHERE ladder_id = ?',
    [ladderId]
  );

  return {
    matchesPlayed,
    players,
    activeQueues,
    disputes,
    unconfirmed,
    penaltyShootouts,
    draws,
    avgGoals: avgGoals ? Number(avgGoals).toFixed(2) : "0.00",
    maxWinMargin,
    recentMatches,
    mostActivePlayer,
    topPlayers,
    avgMatchesPerPlayer: avgMatchesPerPlayer ? Number(avgMatchesPerPlayer).toFixed(2) : "0.00"
  };
}

module.exports = {
  createMatch,
  deleteMatch,
  updateMatchResult,
  getMatchById,
  createMatchThread,
  confirmMatch,
  getRankByUserID,
  getLadderStats,
  registerMatchThread,
  getMatchContext,
  isThreadRegistered
};
