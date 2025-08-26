// commands/user/matchhistory.js
const { SlashCommandBuilder } = require('discord.js');
const dayjs = require('dayjs');
const { getLadderIdByChannel } = require('../../utils/ladderChannelMapping');
const { execute } = require('../../utils/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('matchhistory')
    .setDescription('Mostra os teus últimos (máx 20) resultados (resultado, adversário, Elo ganho/perdido)')
    .addIntegerOption(option =>
      option.setName('num-jogos')
        .setDescription('Número de Jogos a Mostrar (1–20)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const ladderId = await getLadderIdByChannel(interaction.channelId);
    if (!ladderId) {
      return interaction.reply({
        content: '❌ This command cannot be used in this channel.',
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });
    const user = interaction.user;
    const requested = interaction.options.getInteger('num-jogos') || 5;
    const safeCount = Math.max(1, Math.min(20, Number(requested) || 5)); // clamp 1–20

    try {
      // Player ID
      const [[playerRow]] = await execute(
        'SELECT id FROM users WHERE discord_id = ?',
        [user.id]
      );
      if (!playerRow) {
        return interaction.editReply('❌ You are not registered in the ladder.');
      }
      const playerId = playerRow.id;

      // Fetch last confirmed matches and join the latest elo delta for THIS player & ladder
      const sql = `
        SELECT
          m.id,
          m.player1_id, m.player2_id,
          m.player1_score, m.player2_score,
          m.penalty_score1, m.penalty_score2,
          m.match_date,
          u1.username AS username1,
          u2.username AS username2,
          leh.delta AS elo_delta_for_me
        FROM ladder_matches AS m
        JOIN users AS u1 ON u1.id = m.player1_id
        JOIN users AS u2 ON u2.id = m.player2_id
        /* latest elo row per (match, player) on this ladder */
        LEFT JOIN (
          SELECT x.match_id, x.player_id, MAX(x.id) AS max_id
          FROM ladder_elo_history x
          WHERE x.ladder_id = ?
          GROUP BY x.match_id, x.player_id
        ) latest
          ON latest.match_id = m.id
         AND latest.player_id = ?
        LEFT JOIN ladder_elo_history AS leh
          ON leh.id = latest.max_id
        WHERE (m.player1_id = ? OR m.player2_id = ?)
          AND m.ladder_id = ?
          AND m.status = 'confirmed'
        ORDER BY m.match_date DESC
        LIMIT ${safeCount}
      `;

      const params = [ladderId, playerId, playerId, playerId, ladderId];
      const [rows] = await execute(sql, params);

      if (rows.length === 0) {
        return interaction.editReply('ℹ️ No matches found.');
      }

      let reply = `## Last ${rows.length} matches for ${user.username}:\n\n`;

      for (const match of rows) {
        const isP1 = match.player1_id === playerId;
        const myScore = isP1 ? match.player1_score : match.player2_score;
        const oppScore = isP1 ? match.player2_score : match.player1_score;
        const oppName = isP1 ? match.username2 : match.username1;

        // Result (consider penalties for draws)
        let result;
        if (myScore > oppScore) result = '✅';         // win
        else if (myScore < oppScore) result = '❌';    // loss
        else {
          const myPens = isP1 ? match.penalty_score1 : match.penalty_score2;
          const oppPens = isP1 ? match.penalty_score2 : match.penalty_score1;
          if (myPens != null && oppPens != null && myPens !== oppPens) {
            result = myPens > oppPens ? '✅' : '❌';
          } else {
            result = '🤝'; // draw
          }
        }

        const date = dayjs(match.match_date).format('YYYY-MM-DD');
        const scoreStr =
          (match.penalty_score1 != null && match.penalty_score2 != null && myScore === oppScore)
            ? `${myScore}-${oppScore} (P ${isP1 ? match.penalty_score1 : match.penalty_score2}-${isP1 ? match.penalty_score2 : match.penalty_score1})`
            : `${myScore}-${oppScore}`;

        const eloDelta = match.elo_delta_for_me;
        const eloStr = (eloDelta === null || eloDelta === undefined) ? '—' : `${eloDelta > 0 ? '+' : ''}${eloDelta}`;

        reply += `**[${date}]** ${result} vs **${oppName}** — Score: **${scoreStr}** | ELO: **${eloStr}**\n`;
      }

      await interaction.editReply({ content: reply });
    } catch (err) {
      console.error('❌ Error in /matchhistory:', err);
      await interaction.editReply('❌ Failed to retrieve match history.');
    }
  }
};
