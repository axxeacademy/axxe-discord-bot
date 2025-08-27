// commands/admin/adddummy.js
const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const config = require('../../config');
const db = require('../../utils/db'); // <- use shared pool/wrappers
const { logCommand } = require('../../utils/logger');
const { createMatch, createMatchThread } = require('../../services/matchService');
const { removeFromQueue } = require('../../services/queueService');
const { getLadderIdByChannel } = require('../../utils/ladderChannelMapping');



module.exports = {
  data: new SlashCommandBuilder()
    .setName('adddummy')
    .setDescription('Criar um oponente fictício e iniciar um jogo de teste')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }

    const ladderId = await getLadderIdByChannel(interaction.channelId);
    if (!ladderId) {
      return interaction.editReply({
        content: '❌ Este comando não pode ser usado neste canal.'
      });
    }

    try {
      const discordId = interaction.user.id;
      const username = interaction.user.tag;

      // Lookup player
      const [playerRows] = await db.execute(
        'SELECT id FROM users WHERE discord_id = ?',
        [discordId]
      );
      if (playerRows.length === 0) {
        return interaction.editReply({
          content: '❌ Não está registado na ladder.',
          flags: MessageFlags.Ephemeral
        });
      }
      const playerId = playerRows[0].id;

      // Create dummy user
      const dummyDiscordId = `dummy_${Math.floor(Math.random() * 100000)}`;
      const dummyTag = `DummyUser#${Math.floor(1000 + Math.random() * 8999)}`;

      await db.execute(
        `INSERT INTO users (discord_id, username, is_in_server)
         VALUES (?, ?, 0)
         ON DUPLICATE KEY UPDATE username = VALUES(username)`,
        [dummyDiscordId, dummyTag]
      );

      const [dummyRows] = await db.execute(
        'SELECT id FROM users WHERE discord_id = ?',
        [dummyDiscordId]
      );
      const dummyId = dummyRows[0].id;

      // Ensure default stats for dummy on this ladder
      await db.execute(
        `INSERT IGNORE INTO ladder_player_stats 
         (player_id, elo_rating, games_played, wins, draws, losses, goals_scored, goals_conceded, points, last_played, goal_diff, win_streak, competition_id, ladder_id)
         VALUES (?, 1000, 0, 0, 0, 0, 0, 0, 0, NULL, 0, 0, 1, ?)`,
        [dummyId, ladderId]
      );

      // Create match via your service (make sure it also uses the shared pool)
      const matchId = await createMatch(playerId, dummyId, { ladderId });

      // Remove from queue (both)
      await removeFromQueue(discordId, ladderId);
      await removeFromQueue(dummyDiscordId, ladderId);

      // Fetch gamertag for the real user
      const [userRows] = await db.execute(
        'SELECT gamertag FROM users WHERE discord_id = ?',
        [discordId]
      );
      const userGamertag = userRows[0]?.gamertag || null;

      const thread = await createMatchThread(
        interaction,
        discordId,
        dummyDiscordId,
        matchId,
        userGamertag,
        dummyTag,
        { private: true }
      );

      // Dummy player info for logging
      const [dummyPlayerRows] = await db.execute(
        'SELECT gamertag, username as discordUsername, discord_id as discordUserId FROM users WHERE discord_id = ?',
        [dummyDiscordId]
      );
      const dummyPlayer = dummyPlayerRows[0] || { gamertag: dummyTag, discordUsername: dummyTag, discordUserId: null };

      await interaction.editReply({
        content: `Jogo de teste criado: ${thread}`,
        flags: MessageFlags.Ephemeral
      });

      await logCommand(
        interaction,
        `${username} criou jogo de teste #${matchId} contra ${dummyTag}`,
        {
          gamertag: userGamertag,
          threadId: thread.id,
          threadName: thread.name,
          matchInfo: {
            player1: { gamertag: userGamertag, discordUsername: username, discordUserId: interaction.user.id },
            player2: dummyPlayer,
            threadId: thread.id
          }
        }
      );

    } catch (err) {
      console.error('Erro em adddummy:', err);
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: 'Falha ao criar jogo de teste.' });
      } else {
        await interaction.editReply({ content: 'Falha ao criar jogo de teste.' });
      }
    }
  }
};
