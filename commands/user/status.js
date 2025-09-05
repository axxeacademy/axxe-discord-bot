// commands/user/status.js
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { execute } = require('../../utils/db');
const { getLadderIdByChannel } = require('../../utils/ladderChannelMapping');

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
      let queueStatusMsg = '';
      let inQueue = false;
      let minutes = 0, seconds = 0;
      if (queueRows.length === 0) {
        queueStatusMsg = '❌ Você não está na fila. Para encontrar um oponente escreva /findmatch';
      } else {
        inQueue = true;
        const lookingSince = new Date(queueRows[0].looking_since);
        const now = new Date();
        const elapsedMs = now - lookingSince;
        minutes = Math.floor(elapsedMs / 60000);
        seconds = Math.floor((elapsedMs % 60000) / 1000);
        queueStatusMsg = `📊 Entrou na fila há **${minutes}m ${seconds}s**.`;
      }

      // Total in queue for this ladder
      const [totalInQueueRows] = await execute(
        'SELECT COUNT(*) AS total FROM ladder_match_queue WHERE ladder_id = ?',
        [ladderId]
      );
      const totalInQueue = totalInQueueRows[0]?.total ?? 0;

      // Total active games (pending or disputed) for this ladder
      const [activeGamesRows] = await execute(
        "SELECT COUNT(*) AS total FROM ladder_matches WHERE ladder_id = ? AND status IN ('pending', 'disputed')",
        [ladderId]
      );
      const totalActiveGames = activeGamesRows[0]?.total ?? 0;

      await interaction.reply({
        content:
          `${queueStatusMsg}\n` +
          `👥 Atualmente há **${totalInQueue}** jogadores na fila.\n` +
          `🎮 Jogos a decorrer neste momento: **${totalActiveGames}**`,
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
