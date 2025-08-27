// commands/admin/purgequeue.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { clearQueue } = require('../../services/queueService');
const { logCommand } = require('../../utils/logger');
const { getLadderIdByChannel } = require('../../utils/ladderChannelMapping');

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
