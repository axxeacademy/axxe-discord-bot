// commands/user/findmatch.js
const { SlashCommandBuilder } = require('discord.js');
const db = require('../../utils/db'); // pooled mysql2/promise
const { logCommand } = require('../../utils/logger');
const { addToQueue, getNextOpponent, removeFromQueue } = require('../../services/queueService');
const { createMatch, createMatchThread } = require('../../services/matchService');
const { getLadderIdByChannel } = require('../../utils/ladderChannelMapping');
const languageService = require('../../services/languageService');

async function logPlayerPairing(interaction, player1, player2, thread) {
  await logCommand(interaction, `Players paired:`, {
    matchInfo: {
      player1: {
        gamertag: player1.gamertag,
        discordUsername: player1.username
      },
      player2: {
        gamertag: player2.gamertag,
        discordUsername: player2.username
      },
      threadId: thread.id
    }
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('findmatch')
    .setDescription('Entrar na fila de matchmaking para encontrar um adversário.'),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const discordId = interaction.user.id;
    const username = interaction.user.tag;
    const channelId = interaction.channel.id;

    const ladderId = await getLadderIdByChannel(channelId);
    if (!ladderId) {
      return interaction.editReply({
        content: languageService.getMessage('pt-PT', 'command_not_in_channel') || '❌ Este comando não pode ser usado neste canal.',
      });
    }

    try {
      // Check if user is in ANY queue (across all ladders)
      const [anyQueueRows] = await db.execute(
        'SELECT * FROM ladder_match_queue WHERE discord_id = ?',
        [discordId]
      );
      if (anyQueueRows.length > 0) {
        return interaction.editReply({
          content: '❌ Já está numa fila de matchmaking noutra ladder ou competição. Saia da fila antes de entrar noutra.',
        });
      }

      // Check if user is in ANY active match (pending/disputed, across all ladders)
      const [activeMatchRows] = await db.execute(
        `SELECT * FROM ladder_matches WHERE 
          (player1_id = (SELECT id FROM users WHERE discord_id = ?) 
          OR player2_id = (SELECT id FROM users WHERE discord_id = ?))
          AND status IN ('pending', 'disputed')`,
        [discordId, discordId]
      );
      if (activeMatchRows.length > 0) {
        return interaction.editReply({
          content: '❌ Já está num jogo ativo ou pendente. Termine ou reporte o resultado antes de entrar noutra fila.',
        });
      }

      // Already in queue for this ladder?
      const [queueRows] = await db.execute(
        'SELECT * FROM ladder_match_queue WHERE discord_id = ? AND competition_id = ? AND ladder_id = ?',
        [discordId, ladderId, ladderId]
      );
      if (queueRows.length > 0) {
        return interaction.editReply({
          content: '❌ Já está na fila de matchmaking.',
        });
      }

      // Fetch player record
      const [playerRows] = await db.execute(
        'SELECT id, gamertag FROM users WHERE discord_id = ?',
        [discordId]
      );
      if (playerRows.length === 0) {
        return interaction.editReply({
          content: '❌ Não está registado na ladder.',
        });
      }

      const playerId = playerRows[0].id;
      const playerGamertag = playerRows[0].gamertag;

      if (!playerGamertag || playerGamertag.trim() === '') {
        return interaction.editReply({
          content: '❌ Precisa definir o seu gamertag antes de entrar na fila.\nPara definir o seu gamertag, use o comando `/ladder-setGamerTag`.',
        });
      }

      // Ensure ladder_player_stats exists for this player+ladder
      const [statsRows] = await db.execute(
        'SELECT player_id FROM ladder_player_stats WHERE player_id = ? AND competition_id = ? AND ladder_id = ?',
        [playerId, ladderId, ladderId]
      );
      if (statsRows.length === 0) {
        await db.execute(
          `INSERT INTO ladder_player_stats 
            (player_id, competition_id, ladder_id, elo_rating, games_played, wins, draws, losses, points, goals_scored, goals_conceded, goal_diff, win_streak, last_played)
           VALUES (?, ?, ?, 1000, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL)`,
          [playerId, ladderId, ladderId]
        );
      }

      // Fetch player's Elo and rank
      const [eloRowsInitial] = await db.execute(
        `SELECT 
            ps.elo_rating AS elo,
            (SELECT COUNT(*) + 1 FROM ladder_player_stats 
               WHERE elo_rating > ps.elo_rating AND competition_id = ? AND ladder_id = ?) AS 'rank'
         FROM ladder_player_stats ps
         WHERE ps.player_id = ? AND ps.competition_id = ? AND ps.ladder_id = ?`,
        [ladderId, ladderId, playerId, ladderId, ladderId]
      );
      const playerElo = eloRowsInitial[0]?.elo ?? null;

      // Try to get a suitable opponent from the queue service
      const opponent = await getNextOpponent(discordId, playerElo, ladderId);

      if (opponent) {
        // Resolve opponent's user id and gamertag
        const [opponentRows] = await db.execute(
          'SELECT id, gamertag FROM users WHERE discord_id = ?',
          [opponent.discord_id]
        );
        const opponentPlayerId = opponentRows[0]?.id;
        const opponentGamertag = opponentRows[0]?.gamertag;

        if (!opponentPlayerId) {
          return interaction.editReply({
            content: '❌ Falha ao encontrar adversário.',
          });
        }
        if (!opponentGamertag || opponentGamertag.trim() === '') {
          return interaction.editReply({
            content: '❌ O adversário não tem gamertag definido.',
          });
        }

        // Double-check: Are either player already in an active match? (prevents race condition)
        const [activeMatchRowsSelf] = await db.execute(
          `SELECT * FROM ladder_matches WHERE 
            (player1_id = ? OR player2_id = ?)
            AND status IN ('pending', 'disputed')`,
          [playerId, playerId]
        );
        const [activeMatchRowsOpponent] = await db.execute(
          `SELECT * FROM ladder_matches WHERE 
            (player1_id = ? OR player2_id = ?)
            AND status IN ('pending', 'disputed')`,
          [opponentPlayerId, opponentPlayerId]
        );
        if (activeMatchRowsSelf.length > 0 || activeMatchRowsOpponent.length > 0) {
          // One or both players are already in a match, do not create a new match.
          // Remove only the player who is not in a match from the queue, so they can be matched again.
          if (activeMatchRowsSelf.length === 0) {
            await removeFromQueue(discordId, ladderId);
          }
          if (activeMatchRowsOpponent.length === 0) {
            await removeFromQueue(opponent.discord_id, ladderId);
          }
          return interaction.editReply({
            content: '❌ Não foi possível criar o jogo porque um dos jogadores já está num jogo ativo. Aguarde para ser emparelhado novamente.',
          });
        }

        // Remove both from queue
        await removeFromQueue(discordId, ladderId);
        await removeFromQueue(opponent.discord_id, ladderId);

        // Create match + thread
        const matchId = await createMatch(playerId, opponentPlayerId, ladderId);

        // Fetch both gamertags (fallback to existing)
        const [[user1Row]] = await db.execute(
          'SELECT gamertag FROM users WHERE discord_id = ?',
          [discordId]
        );
        const [[user2Row]] = await db.execute(
          'SELECT gamertag FROM users WHERE discord_id = ?',
          [opponent.discord_id]
        );
        const user1Gamertag = user1Row?.gamertag || playerGamertag;
        const user2Gamertag = user2Row?.gamertag || opponentGamertag;

        const thread = await createMatchThread(
          interaction,
          discordId,
          opponent.discord_id,
          matchId,
          user1Gamertag,
          user2Gamertag,
          { private: true }
        );

        // Try to delete the system "thread created" message from the parent channel
        try {
          const fetched = await interaction.channel.messages.fetch({ limit: 5 });
          const systemMessage = fetched.find(
            (msg) =>
              msg.type === 11 && // MessageType.ThreadCreated
              msg.content.includes(`Match #${matchId} -`)
          );
          if (systemMessage) {
            await systemMessage.delete();
          }
        } catch (deleteError) {
          console.error('Failed to delete thread creation system message:', deleteError);
        }

        // Log the pairing
        await logPlayerPairing(
          interaction,
          { gamertag: user1Gamertag, username },
          { gamertag: user2Gamertag, username: opponent.discord_id },
          thread
        );

        return interaction.editReply({
          content: `✅ Entrou na fila da ladder ${ladderId} — Elo: ${playerElo}, Classificação: #${eloRowsInitial[0]?.rank ?? 'N/A'}`,
        });
      }

      // No opponent found → add to queue
      await addToQueue(playerId, discordId, ladderId);

      // Re-read Elo and rank for the confirmation message
      const [eloRowsAfter] = await db.execute(
        `SELECT 
            ps.elo_rating AS elo,
            (SELECT COUNT(*) + 1 FROM ladder_player_stats 
               WHERE elo_rating > ps.elo_rating AND competition_id = ? AND ladder_id = ?) AS 'rank'
         FROM ladder_player_stats ps
         WHERE ps.player_id = ? AND ps.competition_id = ? AND ps.ladder_id = ?`,
        [ladderId, ladderId, playerId, ladderId, ladderId]
      );

      const elo = eloRowsAfter[0]?.elo ?? 'N/A';
      const rank = eloRowsAfter[0]?.rank ?? 'N/A';

      await interaction.editReply({
        content: `✅ Entrou na fila da ladder ${ladderId} — Elo: ${elo}, Classificação: #${rank}\n\nPara sair da fila, use o comando /cancelqueue.\nPara ver quantos jogadores estão na fila, use o comando /status.`,
      });

      await logCommand(
        interaction,
        `${playerGamertag} entrou na fila de matchmaking da ladder ${ladderId} — Elo: ${elo}, Classificação: #${rank}`
      );
    } catch (error) {
      console.error('❌ DB Error in /findmatch:', error);
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({
            content: '❌ Ocorreu um erro ao tentar encontrar um adversário.',
          });
        } else {
          await interaction.reply({
            content: '❌ Ocorreu um erro ao tentar encontrar um adversário.',
            flags: MessageFlags.Ephemeral,
          });
        }
      } catch (err) {
        console.error('❌ Secondary reply error:', err);
      }
    }
  },
};
