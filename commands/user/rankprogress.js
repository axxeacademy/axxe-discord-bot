// commands/player/rankprogress.js
const { SlashCommandBuilder, MessageFlags, AttachmentBuilder } = require('discord.js');
const { execute } = require('../../utils/db'); // ✅ use pooled helpers
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const tz = require('dayjs/plugin/timezone');
const { getLadderIdByChannel } = require('../../utils/ladderChannelMapping');

dayjs.extend(utc);
dayjs.extend(tz);

const WIDTH = 900;
const HEIGHT = 420;
const BACKGROUND = 'rgba(24, 26, 27, 1)'; // nice dark bg for Discord

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rankprogress')
    .setDescription('Show your Elo evolution as a chart.')
    .addIntegerOption(opt =>
      opt
        .setName('days')
        .setDescription('How many days back (default 15, max 90)')
        .setMinValue(1)
        .setMaxValue(90)
    ),

  async execute(interaction) {
    try {
      const ladderId = await getLadderIdByChannel(interaction.channelId);
      if (!ladderId) {
        return interaction.reply({ content: '❌ Este comando não pode ser usado neste canal.', flags: MessageFlags.Ephemeral });
      }

      const days = interaction.options.getInteger('days') ?? 15;
      const timezone = 'Europe/Lisbon'; // if you later store this on ladders, fetch it

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      // Fetch ladder name for title
      const [[ladderRow]] = await execute(
        'SELECT name FROM ladders WHERE id = ?',
        [ladderId]
      );
      const ladderName = ladderRow ? ladderRow.name : 'Ladder';

      const discordId = interaction.user.id;

      // 1) get player id from users
      const [[player]] = await execute(
        'SELECT id FROM users WHERE discord_id = ? LIMIT 1',
        [discordId]
      );
      if (!player) {
        return interaction.editReply('❌ Não encontrei o teu registo. Faz login no site/ladder primeiro.');
      }

      // 2) get Elo history points (last N days) for this ladder
      const [rows] = await execute(
        `
          SELECT changed_at, new_elo
          FROM ladder_elo_history
          WHERE player_id = ?
            AND ladder_id = ?
            AND changed_at >= (UTC_TIMESTAMP() - INTERVAL ? DAY)
          ORDER BY changed_at ASC
        `,
        [player.id, ladderId, days]
      );

      if (!rows.length) {
        return interaction.editReply(`ℹ️ Não há registos de Elo nos últimos **${days}** dias.`);
      }

      // Prepare labels/data
      const labels = rows.map(r =>
        dayjs.utc(r.changed_at).tz(timezone).format('DD MMM HH:mm')
      );
      const data = rows.map(r => r.new_elo);

      // If only 1 point, add a tiny “ghost” to render a line
      if (data.length === 1) {
        labels.unshift(dayjs.utc(rows[0].changed_at).tz(timezone).subtract(1, 'minute').format('DD MMM HH:mm'));
        data.unshift(data[0]);
      }

      // 3) Render chart
      const chartJSNodeCanvas = new ChartJSNodeCanvas({
        width: WIDTH,
        height: HEIGHT,
        backgroundColour: BACKGROUND,
      });

      const configuration = {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: `Elo (${days}d)`,
              data,
              borderWidth: 3,
              tension: 0.25,
              pointRadius: 0,
              borderColor: 'rgba(99, 179, 237, 1)',
              fill: true,
              backgroundColor: 'rgba(99, 179, 237, 0.15)',
            },
          ],
        },
        options: {
          responsive: false,
          plugins: {
            title: {
              display: true,
              text: `Elo Progress • ${interaction.user.username}`,
              color: '#e5e7eb',
              font: { size: 18, weight: '600' },
            },
            legend: {
              labels: { color: '#cbd5e1' },
            },
            tooltip: {
              callbacks: {
                label: ctx => ` Elo: ${ctx.parsed.y}`,
              },
            },
          },
          scales: {
            x: {
              ticks: { color: '#cbd5e1' },
              grid: { color: 'rgba(148, 163, 184, 0.15)' },
            },
            y: {
              ticks: { color: '#cbd5e1' },
              grid: { color: 'rgba(148, 163, 184, 0.15)' },
              beginAtZero: false,
            },
          },
        },
      };

      const buffer = await chartJSNodeCanvas.renderToBuffer(configuration, 'image/png');

      // 4) Send as image
      const attachment = new AttachmentBuilder(buffer, { name: 'elo_progress.png' });

      const first = data[0];
      const last = data[data.length - 1];
      const delta = last - first;
      const arrow = delta > 0 ? '📈' : delta < 0 ? '📉' : '➖';

      // Build title with number of games, ladder name, and user
      const userTitle = interaction.user.gamertag || interaction.user.username;
      const numGames = rows.length;
      const title = `## 📈 Progresso de Elo nos últimos ${days} dias na ${ladderName} de ${userTitle}`;

      await interaction.editReply({
        content: `${title}\n\n${arrow} **Elo** ${first} → ${last} (${delta >= 0 ? '+' : ''}${delta}) • Últimos **${days}** dias | Número de Jogos Realizados: ${numGames}`,
        files: [attachment],
      });
    } catch (err) {
      console.error('/rankprogress error:', err);
      if (interaction.deferred || interaction.replied) {
        return interaction.editReply('❌ Ocorreu um erro a gerar o gráfico.');
      }
      return interaction.reply({ content: '❌ Ocorreu um erro a gerar o gráfico.', flags: MessageFlags.Ephemeral });
    }
  },
};
