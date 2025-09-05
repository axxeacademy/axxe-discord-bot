// commands/admin/purgequeue.js
const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { clearQueue } = require('../../services/queueService');
const { logCommand } = require('../../utils/logger');
const { getLadderIdByChannel } = require('../../utils/ladderChannelMapping');
const db = require('../../utils/db');


module.exports = {
  data: new SlashCommandBuilder()
    .setName('purgequeue')
    .setDescription('Remove all players from the matchmaking queue')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const ladderId = await getLadderIdByChannel(interaction.channelId);
    if (!ladderId) {
      return await interaction.reply({
        content: '❌ Este comando não pode ser usado neste canal.',
        flags: MessageFlags.Ephemeral
      });
    }

    try {
      // Fetch all users in the queue for this ladder, with their discord_id and competition_id
      const [queueRows] = await db.execute(
        'SELECT discord_id, competition_id FROM ladder_match_queue WHERE ladder_id = ?',
        [ladderId]
      );

      // For each user, update ladder_queue_history to set left_at and left_reason='purged'
      for (const row of queueRows) {
        await db.execute(
          `UPDATE ladder_queue_history
           SET left_at = UTC_TIMESTAMP(), left_reason = 'purged'
           WHERE discord_id = ? AND ladder_id = ? AND competition_id = ? AND left_at IS NULL
           ORDER BY queued_at DESC
           LIMIT 1`,
          [row.discord_id, ladderId, row.competition_id]
        );
      }

      await clearQueue(ladderId);

      if (interaction.replied) {
        await interaction.followUp({
          content: '🧹 A fila de matchmaking foi limpa. Todos os jogadores removidos.',
          flags: MessageFlags.Ephemeral
        });
      } else if (interaction.deferred) {
        await interaction.editReply({
          content: '🧹 A fila de matchmaking foi limpa. Todos os jogadores removidos.',
          flags: MessageFlags.Ephemeral
        });
      } else {
        await interaction.reply({
          content: '🧹 A fila de matchmaking foi limpa. Todos os jogadores removidos.',
          flags: MessageFlags.Ephemeral
        });
      }

      await logCommand(interaction, `${interaction.user.tag} limpou a fila de matchmaking.`);

    } catch (err) {
      console.error('❌ Error in /purgequeue:', err);
      if (interaction.replied) {
        await interaction.followUp({
          content: '❌ Falha ao limpar a fila.',
          flags: MessageFlags.Ephemeral
        });
      } else if (interaction.deferred) {
        await interaction.editReply({
          content: '❌ Falha ao limpar a fila.',
          flags: MessageFlags.Ephemeral
        });
      } else {
        await interaction.reply({
          content: '❌ Falha ao limpar a fila.',
          flags: MessageFlags.Ephemeral
        });
      }
    }
  }
};
