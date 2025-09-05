/**
 * Periodic Queue Review Service
 * Scans the match queue every 30 seconds and matches players according to ELO/timing rules.
 * Notifies both players when a match is made.
 */

const { getNextOpponent, removeFromQueue } = require('./queueService');
const { createMatch, getRankByUserID, createMatchThread } = require('./matchService');
const db = require('../utils/db');
const { getChannelIdByLadder } = require('../utils/ladderChannelMapping');

// Interval in milliseconds
const INTERVAL = 30 * 1000;

let running = false;

async function reviewQueue(discordClient) {
  if (running) return; // Prevent overlapping runs
  running = true;
  try {
    // Get all players in the queue
    const [queueRows] = await db.execute('SELECT * FROM ladder_match_queue ORDER BY looking_since ASC');
    const matchedDiscordIds = new Set();

    for (const player of queueRows) {
      const { discord_id, player_id, ladder_id } = player;
      if (matchedDiscordIds.has(discord_id)) continue;

      // Fetch player's ELO
      const [statsRows] = await db.execute(
        'SELECT elo_rating FROM ladder_player_stats WHERE player_id = ? AND ladder_id = ?',
        [player_id, ladder_id]
      );
      const playerElo = statsRows[0]?.elo_rating ?? 1000;

      // Try to find an opponent
      const opponent = await getNextOpponent(discord_id, playerElo, ladder_id);

      if (
        opponent &&
        !matchedDiscordIds.has(opponent.discord_id) &&
        opponent.discord_id !== discord_id
      ) {
        // Double-check: Are either player already in an active match?
        const [activeMatchRowsSelf] = await db.execute(
          `SELECT * FROM ladder_matches WHERE 
            (player1_id = ? OR player2_id = ?)
            AND status IN ('pending', 'disputed')`,
          [player_id, player_id]
        );
        const [activeMatchRowsOpponent] = await db.execute(
          `SELECT * FROM ladder_matches WHERE 
            (player1_id = ? OR player2_id = ?)
            AND status IN ('pending', 'disputed')`,
          [opponent.player_id, opponent.player_id]
        );
        if (activeMatchRowsSelf.length > 0 || activeMatchRowsOpponent.length > 0) {
          continue;
        }

        // Remove both from queue
        await removeFromQueue(discord_id, ladder_id);
        await removeFromQueue(opponent.discord_id, ladder_id);

        // Create match
        const matchId = await createMatch(player_id, opponent.player_id, ladder_id);

        // Fetch player gamertags
        const [player1Rows] = await db.execute('SELECT discord_id, gamertag FROM users WHERE id = ?', [player_id]);
        const [player2Rows] = await db.execute('SELECT discord_id, gamertag FROM users WHERE id = ?', [opponent.player_id]);
        const player1Gamertag = player1Rows[0]?.gamertag || 'Jogador 1';
        const player2Gamertag = player2Rows[0]?.gamertag || 'Jogador 2';

        // Fetch the correct channel for the ladder
        let channelId = null;
        try {
          channelId = await getChannelIdByLadder(ladder_id);
        } catch (e) {
          console.error('Erro ao obter o canal do ladder:', e);
        }

        if (discordClient && channelId) {
          try {
            const channel = await discordClient.channels.fetch(channelId);
            // Create the match thread
            const thread = await channel.threads.create({
              name: `Match #${matchId} - ${player1Gamertag} vs ${player2Gamertag}`,
              autoArchiveDuration: 60,
              reason: 'Match thread created',
              type: 12, // ChannelType.PrivateThread
            });

            // Notify both players in Portuguese with only the thread link
            const user1 = await discordClient.users.fetch(discord_id);
            const user2 = await discordClient.users.fetch(opponent.discord_id);
            const threadUrl = thread.url;
            await user1.send(`Tens jogo na Ladder! Acede à Thread para jogar: ${threadUrl}`);
            await user2.send(`Tens Jogo na Ladder! Acede à Thread para jogar: ${threadUrl}`);
          } catch (err) {
            console.error('Falha ao criar o tópico ou enviar DM aos jogadores:', err);
          }
        }

        // Mark both as matched for this run
        matchedDiscordIds.add(discord_id);
        matchedDiscordIds.add(opponent.discord_id);
      }
    }
  } catch (err) {
    console.error('Error in periodic queue review:', err);
  } finally {
    running = false;
  }
}

// Start the periodic review
function startQueueReview(discordClient) {
  setInterval(() => reviewQueue(discordClient), INTERVAL);
}

module.exports = {
  startQueueReview,
  reviewQueue,
};
