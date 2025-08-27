// commands/user/status.js
const { SlashCommandBuilder } = require('discord.js');
const { execute } = require('../../utils/db');
const { getLadderIdByChannel } = require('../../utils/ladderChannelMapping');
const { MessageFlags } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Verifique a sua posição atual e atividade na fila de matchmaking.'),

  async execute(interaction) {
    const ladderId = await getLadderIdByChannel(interaction.channelId);
    if (!ladderId) {
      return interaction.reply({
        content: '❌ Este comando não pode ser usado neste canal.',
        flags: MessageFlags.Ephemeral
      });
    }

    const discordId = interaction.user.id;

    try {
      // Check registration
      const [playerRows] = await execute(
        'SELECT id FROM users WHERE discord_id = ?',
        [discordId]
      );
      if (playerRows.length === 0) {
        return interaction.reply({
          content: '❌ Não está registado na ladder.',
          flags: MessageFlags.Ephemeral
        });
      }

      // Check if user is in queue for this ladder
      const [queueRows] = await execute(
        'SELECT looking_since FROM ladder_match_queue WHERE discord_id = ? AND ladder_id = ?',
        [discordId, ladderId]
      );
      if (queueRows.length === 0) {
        return interaction.reply({
          content: '❌ Não está na fila de matchmaking.',
          flags: MessageFlags.Ephemeral
        });
      }

      const lookingSince = new Date(queueRows[0].looking_since);
      const now = new Date();
      const elapsedMs = now - lookingSince;
      const minutes = Math.floor(elapsedMs / 60000);
      const seconds = Math.floor((elapsedMs % 60000) / 1000);

      // Total in queue for this ladder
      const [totalInQueueRows] = await execute(
        'SELECT COUNT(*) AS total FROM ladder_match_queue WHERE ladder_id = ?',
        [ladderId]
      );
      const totalInQueue = totalInQueueRows[0]?.total ?? 0;

      await interaction.reply({
        content:
          `📊 Entrou na fila há **${minutes}m ${seconds}s**.\n` +
          `👥 Atualmente há **${totalInQueue}** jogadores na fila.`,
        flags: MessageFlags.Ephemeral
      });
    } catch (error) {
      console.error('❌ Error in /status:', error);
      await interaction.reply({
        content: '❌ Erro ao obter o estado da fila.',
        flags: MessageFlags.Ephemeral
      });
    }
  }
};
