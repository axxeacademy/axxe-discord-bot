// commands/player/cancelqueue.js
const { SlashCommandBuilder } = require('discord.js');
const db = require('../../utils/db'); // ← uses pooled mysql2/promise instance
const { logCommand } = require('../../utils/logger');
const { getLadderIdByChannel } = require('../../utils/ladderChannelMapping');
const { MessageFlags } = require('discord.js');

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
      // Be explicit about ladder to avoid removing entries from other ladders
      const [result] = await db.execute(
        'DELETE FROM ladder_match_queue WHERE discord_id = ? AND ladder_id = ?',
        [discordId, ladderId]
      );

      if (result.affectedRows > 0) {
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
