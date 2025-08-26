// commands/user/leaderboard.js
const { SlashCommandBuilder } = require('discord.js');
const { execute } = require('../../utils/db');
const { getLadderIdByChannel } = require('../../utils/ladderChannelMapping');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Ver a classificação atual da ladder')
    .addStringOption(option =>
      option.setName('topx-players')
        .setDescription('Escolha o número de jogadores para mostrar (5, 10 ou 15)')
        .setRequired(false)
        .addChoices(
          { name: 'Top 5', value: '5' },
          { name: 'Top 10', value: '10' },
          { name: 'Top 15', value: '15' },
        ))
    .addStringOption(option =>
      option.setName('filtrar')
        .setDescription('Filtrar tipos de jogadores (placeholder)')
        .setRequired(false)
        .addChoices(
          { name: 'Amigos', value: 'friends' },
          { name: 'AXXE Academy Students', value: 'academy' },  // not implemented in DB yet
          { name: 'Jogadores Pro', value: 'pro' }               // not implemented in DB yet
        )),

  async execute(interaction) {
    try {
      const ladderId = await getLadderIdByChannel(interaction.channelId);
      if (!ladderId) {
        await interaction.reply({
          content: '❌ Este comando não pode ser usado neste canal.',
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      // Validate & sanitize "topX"
      const rawTop = interaction.options.getString('topx-players') || '10';
      let topX = parseInt(rawTop, 10);
      if (![5, 10, 15].includes(topX)) topX = 10; // hard guard (also prevents NaN)

      const filter = interaction.options.getString('filtrar');

      // NOTE about filters:
      // Your `users` table (per your dump) has no `is_academy_student` or `is_pro_player`.
      // So we *don’t* add SQL WHERE pieces for those. If user picks them, we’ll just warn inline.
      let filterNotice = '';
      if (filter === 'academy' || filter === 'pro') {
        filterNotice =
          '\n> ℹ️ Filtro avançado selecionado mas ainda não suportado (colunas não existem na tabela `users`).';
      }
      // "friends" would require a friends list tied to the invoking user. Not available here either.
      // We keep it no-op for now.

      // Build SQL (IMPORTANT: inline LIMIT as a number → avoids mysqld_stmt_execute issues)
      // Also: stick to columns that exist in your schema.
      const sql = `
        SELECT
          u.username,
          COALESCE(u.gamertag, u.username) AS gamertag,
          s.player_id,
          s.elo_rating,
          s.games_played,
          s.wins,
          s.losses,
          s.goals_scored,
          s.goals_conceded,
          s.goal_diff,
          s.win_streak
        FROM ladder_player_stats s
        JOIN users u ON u.id = s.player_id
        WHERE s.ladder_id = ?
        ORDER BY s.elo_rating DESC, s.points DESC, s.goal_diff DESC
        LIMIT ${topX}
      `;

      // Only one placeholder: ladder_id
      const [rows] = await execute(sql, [ladderId]);

      if (!rows || rows.length === 0) {
        await interaction.editReply('❌ Ainda não há dados da ladder disponíveis para os filtros selecionados.');
        return;
      }

      // Render
      const pct = (wins, played) =>
        played > 0 ? ((wins / played) * 100).toFixed(Number.isInteger((wins / played) * 100) ? 0 : 2) : '0';

      let text = `## 🏆 Classificação da Ladder - Top ${topX}\n`;

      rows.forEach((p, idx) => {
        const fire = p.win_streak > 3 ? ' 🔥' : '';
        const wperc = pct(p.wins, p.games_played);

        text += `\n**#${idx + 1} | ${p.elo_rating} - ${p.gamertag}${fire}**\n`;
        text += `🎮 **J:** ${p.games_played} | **V:** ${p.wins} | **D:** ${p.losses} | `;
        text += `**GM:** ${p.goals_scored || 0} | **GS:** ${p.goals_conceded || 0} | `;
        text += `**DG:** ${p.goal_diff || 0} | **W%:** ${wperc}%\n`;
      });

      text += `\n_(As diferenças de ELO apresentadas são diárias, contadas a partir das 00h00 do dia de hoje. 🔥 = winstreak > 3)_${filterNotice}`;

      await interaction.editReply({ content: text });
    } catch (err) {
      console.error('❌ Error loading leaderboard:', err);
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply('❌ Falha ao carregar a classificação.');
        } else {
          await interaction.reply({ content: '❌ Falha ao carregar a classificação.', ephemeral: true });
        }
      } catch {
        // swallow
      }
    }
  },
};
