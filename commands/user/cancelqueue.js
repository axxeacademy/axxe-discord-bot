// commands/player/cancelqueue.js
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const db = require('../../utils/db'); // ← uses pooled mysql2/promise instance
const { logCommand } = require('../../utils/logger');
const { getLadderIdByChannel } = require('../../utils/ladderChannelMapping');
const { removeFromQueue } = require('../../services/queueService');


module.exports = {
  data: new SlashCommandBuilder()
    .setName('cancelqueue')
    .setDescription('Remover-se da fila de matchmaking'),

  async execute(interaction) {
    const ladderId = await getLadderIdByChannel(interaction.channelId);
    if (!ladderId) {
      return interaction.reply({
        content: '❌ Este comando não pode ser usado neste canal.',
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const discordId = interaction.user.id;

    try {
      // Use queueService to remove from queue and log exit in ladder_queue_history
      const competitionId = 1; // TODO: fetch dynamically if needed
      // Try to remove; if not in queue, nothing happens
      await removeFromQueue(discordId, ladderId, competitionId, 'cancelled');

      // Check if user was in the queue (for feedback)
      const [checkRows] = await db.execute(
        'SELECT * FROM ladder_queue_history WHERE discord_id = ? AND ladder_id = ? AND competition_id = ? AND left_reason = "cancelled" ORDER BY queued_at DESC LIMIT 1',
        [discordId, ladderId, competitionId]
      );

      if (checkRows.length > 0) {
        await interaction.editReply({ content: '✅ Saiu da fila de matchmaking.' });
        await logCommand(interaction, `${interaction.user.tag} saiu da fila de matchmaking (ladder ${ladderId}).`);
      } else {
        await interaction.editReply({ content: '❌ Não estava na fila de matchmaking.' });
        await logCommand(interaction, `${interaction.user.tag} tentou sair da fila mas não estava nela (ladder ${ladderId}).`);
      }
    } catch (err) {
      console.error('❌ Erro em /cancelqueue:', err);
      await interaction.editReply({ content: '❌ Erro ao tentar sair da fila.' });
    }
  },
};
