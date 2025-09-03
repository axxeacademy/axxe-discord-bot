// commands/player/mystatsfull.js
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const dayjs = require('dayjs');
const { execute } = require('../../utils/db');
const { getLadderIdByChannel } = require('../../utils/ladderChannelMapping');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mystatsfull')
    .setDescription('Veja as suas estatísticas completas e detalhadas na ladder'),

  async execute(interaction) {
    const ladderId = await getLadderIdByChannel(interaction.channelId);
    if (!ladderId) {
      return await interaction.reply({
        content: '❌ Este comando não pode ser usado neste canal.',
        flags: MessageFlags.Ephemeral
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const user = interaction.user;

    try {
      // Get player ID and gamertag
      const [[playerRow]] = await execute(
        'SELECT id, gamertag FROM users WHERE discord_id = ?',
        [user.id]
      );

      if (!playerRow) {
        return await interaction.editReply('❌ Não está registado na ladder.');
      }

      const playerId = playerRow.id;
      const playerGamertag = playerRow.gamertag || 'Undefined';

      // Current ELO & Peak ELO (scoped to ladder)
      const [[eloStats]] = await execute(
        `SELECT 
           (SELECT elo_rating 
              FROM ladder_player_stats 
             WHERE player_id = ? AND ladder_id = ? 
             LIMIT 1) AS current_elo,
           (SELECT MAX(new_elo) 
              FROM ladder_elo_history 
             WHERE player_id = ? AND ladder_id = ?) AS peak_elo`,
        [playerId, ladderId, playerId, ladderId]
      );

      // ELO change last 5 / 10 (scoped to ladder)
      const [[eloChange5]] = await execute(
        `SELECT SUM(delta) AS elo_change_5 FROM (
           SELECT delta 
             FROM ladder_elo_history 
            WHERE player_id = ? AND ladder_id = ?
            ORDER BY changed_at DESC 
            LIMIT 5
         ) sub`,
        [playerId, ladderId]
      );

      const [[eloChange10]] = await execute(
        `SELECT SUM(delta) AS elo_change_10 FROM (
           SELECT delta 
             FROM ladder_elo_history 
            WHERE player_id = ? AND ladder_id = ?
            ORDER BY changed_at DESC 
            LIMIT 10
         ) sub`,
        [playerId, ladderId]
      );

      // ELO volatility (stddev of last 10, scoped to ladder)
      const [[eloVolatility]] = await execute(
        `SELECT STDDEV(delta) AS elo_volatility FROM (
           SELECT delta 
             FROM ladder_elo_history 
            WHERE player_id = ? AND ladder_id = ?
            ORDER BY changed_at DESC 
            LIMIT 10
         ) sub`,
        [playerId, ladderId]
      );

      // Performance vs stronger opponents (scoped to ladder & confirmed)
      const [[perfVsStronger]] = await execute(
        `SELECT 
           COUNT(*) AS total_matches,
           SUM(CASE WHEN winner_id = ? THEN 1 ELSE 0 END) AS wins
         FROM (
           SELECT 
             m.id,
             CASE WHEN m.player1_id = ? THEN elo2.old_elo ELSE elo1.old_elo END AS opponent_elo_before,
             CASE WHEN m.player1_id = ? THEN elo1.old_elo ELSE elo2.old_elo END AS my_elo_before,
             CASE 
               WHEN m.player1_score > m.player2_score THEN m.player1_id
               WHEN m.player2_score > m.player1_score THEN m.player2_id
               WHEN m.player1_score = m.player2_score 
                    AND m.penalty_score1 IS NOT NULL AND m.penalty_score2 IS NOT NULL
                    AND m.penalty_score1 != m.penalty_score2
                 THEN CASE WHEN m.penalty_score1 > m.penalty_score2 THEN m.player1_id ELSE m.player2_id END
               ELSE NULL
             END AS winner_id
           FROM ladder_matches m
           LEFT JOIN ladder_elo_history elo1 
             ON elo1.match_id = m.id AND elo1.player_id = m.player1_id AND elo1.ladder_id = m.ladder_id
           LEFT JOIN ladder_elo_history elo2 
             ON elo2.match_id = m.id AND elo2.player_id = m.player2_id AND elo2.ladder_id = m.ladder_id
          WHERE (m.player1_id = ? OR m.player2_id = ?)
            AND m.ladder_id = ?
            AND m.status = 'confirmed'
         ) sub
         WHERE opponent_elo_before > my_elo_before`,
        [playerId, playerId, playerId, playerId, playerId, ladderId]
      );

      const perfVsStrongerPct =
        perfVsStronger.total_matches > 0
          ? ((perfVsStronger.wins / perfVsStronger.total_matches) * 100).toFixed(1)
          : 'N/A';

      // Expected vs Actual (scoped to ladder & confirmed)
      const [[expectedVsActual]] = await execute(
        `SELECT SUM(actual - expected) AS expected_vs_actual FROM (
           SELECT 
             CASE WHEN winner_id = ? THEN 1 ELSE 0 END AS actual,
             1 / (1 + POW(10, ((opponent_elo_before - my_elo_before) / 400))) AS expected
           FROM (
             SELECT 
               m.id,
               CASE WHEN m.player1_id = ? THEN elo2.old_elo ELSE elo1.old_elo END AS opponent_elo_before,
               CASE WHEN m.player1_id = ? THEN elo1.old_elo ELSE elo2.old_elo END AS my_elo_before,
               CASE 
                 WHEN m.player1_score > m.player2_score THEN m.player1_id
                 WHEN m.player2_score > m.player1_score THEN m.player2_id
                 WHEN m.player1_score = m.player2_score 
                      AND m.penalty_score1 IS NOT NULL AND m.penalty_score2 IS NOT NULL
                      AND m.penalty_score1 != m.penalty_score2
                   THEN CASE WHEN m.penalty_score1 > m.penalty_score2 THEN m.player1_id ELSE m.player2_id END
                 ELSE NULL
               END AS winner_id
             FROM ladder_matches m
             LEFT JOIN ladder_elo_history elo1 
               ON elo1.match_id = m.id AND elo1.player_id = m.player1_id AND elo1.ladder_id = m.ladder_id
             LEFT JOIN ladder_elo_history elo2 
               ON elo2.match_id = m.id AND elo2.player_id = m.player2_id AND elo2.ladder_id = m.ladder_id
            WHERE (m.player1_id = ? OR m.player2_id = ?)
              AND m.ladder_id = ?
              AND m.status = 'confirmed'
           ) sub
         ) sub2`,
        [playerId, playerId, playerId, playerId, playerId, ladderId]
      );

      // Clean sheets / Shutouts suffered (ladder & confirmed)
      const [[cleanSheets]] = await execute(
        `SELECT COUNT(*) AS count 
           FROM ladder_matches 
          WHERE ((player1_id = ? AND player2_score = 0) 
              OR (player2_id = ? AND player1_score = 0))
            AND ladder_id = ?
            AND status = 'confirmed'`,
        [playerId, playerId, ladderId]
      );

      const [[shutoutsSuffered]] = await execute(
        `SELECT COUNT(*) AS count 
           FROM ladder_matches 
          WHERE ((player1_id = ? AND player1_score = 0) 
              OR (player2_id = ? AND player2_score = 0))
            AND ladder_id = ?
            AND status = 'confirmed'`,
        [playerId, playerId, ladderId]
      );

      // One-goal games (ladder & confirmed)
      const [[oneGoalGames]] = await execute(
        `SELECT 
           COUNT(*) AS total,
           SUM(
             CASE 
               WHEN ((player1_id = ? AND player1_score > player2_score) 
                  OR (player2_id = ? AND player2_score > player1_score))
                 AND ABS(player1_score - player2_score) = 1 
               THEN 1 ELSE 0 
             END
           ) AS wins
         FROM ladder_matches 
        WHERE (player1_id = ? OR player2_id = ?)
          AND ladder_id = ?
          AND status = 'confirmed'
          AND ABS(player1_score - player2_score) = 1`,
        [playerId, playerId, playerId, playerId, ladderId]
      );

      const oneGoalWinRate =
        oneGoalGames.total > 0
          ? ((oneGoalGames.wins / oneGoalGames.total) * 100).toFixed(1)
          : 'N/A';

      // Avg margin in wins / losses (ladder & confirmed)
      const [[winsResult]] = await execute(
        `SELECT AVG(ABS(player1_score - player2_score)) AS avg_margin 
           FROM ladder_matches 
          WHERE ((player1_id = ? AND player1_score > player2_score) 
              OR (player2_id = ? AND player2_score > player1_score))
            AND ladder_id = ?
            AND status = 'confirmed'`,
        [playerId, playerId, ladderId]
      );
      const avgMarginWins = winsResult?.avg_margin ?? null;

      const [[lossesResult]] = await execute(
        `SELECT AVG(ABS(player1_score - player2_score)) AS avg_margin 
           FROM ladder_matches 
          WHERE ((player1_id = ? AND player1_score < player2_score) 
              OR (player2_id = ? AND player2_score < player1_score))
            AND ladder_id = ?
            AND status = 'confirmed'`,
        [playerId, playerId, ladderId]
      );
      const avgMarginLosses = lossesResult?.avg_margin ?? null;

      // BTTS % (ladder & confirmed)
      const [[bttsStats]] = await execute(
        `SELECT 
           COUNT(*) AS total_matches,
           SUM(CASE WHEN player1_score > 0 AND player2_score > 0 THEN 1 ELSE 0 END) AS btts_count
         FROM ladder_matches 
        WHERE (player1_id = ? OR player2_id = ?)
          AND ladder_id = ?
          AND status = 'confirmed'`,
        [playerId, playerId, ladderId]
      );
      const bttsPct =
        bttsStats.total_matches > 0
          ? ((bttsStats.btts_count / bttsStats.total_matches) * 100).toFixed(1)
          : 'N/A';

      // Load all confirmed matches (ladder-scoped) for streaks and activity
      const [allMatches] = await execute(
        `SELECT match_date, player1_id, player2_id, player1_score, player2_score 
           FROM ladder_matches 
          WHERE (player1_id = ? OR player2_id = ?)
            AND ladder_id = ?
            AND status = 'confirmed'
          ORDER BY match_date`,
        [playerId, playerId, ladderId]
      );

      // Longest win streak
      let longestWinStreak = 0;
      let currentStreak = 0;
      for (const match of allMatches) {
        const winnerId =
          match.player1_score > match.player2_score
            ? match.player1_id
            : match.player2_score > match.player1_score
              ? match.player2_id
              : null;

        if (winnerId === playerId) {
          currentStreak++;
          if (currentStreak > longestWinStreak) longestWinStreak = currentStreak;
        } else {
          currentStreak = 0;
        }
      }

      // Current unbeaten (win) streak: count consecutive wins from most recent
      currentStreak = 0;
      for (let i = allMatches.length - 1; i >= 0; i--) {
        const match = allMatches[i];
        const winnerId =
          match.player1_score > match.player2_score
            ? match.player1_id
            : match.player2_score > match.player1_score
              ? match.player2_id
              : null;

        if (winnerId === playerId) currentStreak++;
        else break;
      }

      // Activity metrics (ladder & confirmed)
      const [[activityStats]] = await execute(
        `SELECT 
           COUNT(*) AS total_matches,
           MIN(match_date) AS first_match,
           MAX(match_date) AS last_match
         FROM ladder_matches 
        WHERE (player1_id = ? OR player2_id = ?)
          AND ladder_id = ?
          AND status = 'confirmed'`,
        [playerId, playerId, ladderId]
      );

      const [[matchesLast30d]] = await execute(
        `SELECT COUNT(DISTINCT DATE(match_date)) AS active_days_30d 
           FROM ladder_matches 
          WHERE (player1_id = ? OR player2_id = ?)
            AND ladder_id = ?
            AND status = 'confirmed'
            AND match_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`,
        [playerId, playerId, ladderId]
      );

      const firstMatchDate = activityStats.first_match ? dayjs(activityStats.first_match) : null;
      const lastMatchDate = activityStats.last_match ? dayjs(activityStats.last_match) : null;
      const totalDays = firstMatchDate && lastMatchDate ? lastMatchDate.diff(firstMatchDate, 'day') + 1 : 1;
      const totalWeeks = totalDays / 7;
      const totalMonths = totalDays / 30;

      const matchesPerDay = totalDays > 0 ? (activityStats.total_matches / totalDays).toFixed(2) : 'N/A';
      const matchesPerWeek = totalWeeks > 0 ? (activityStats.total_matches / totalWeeks).toFixed(2) : 'N/A';
      const matchesPerMonth = totalMonths > 0 ? (activityStats.total_matches / totalMonths).toFixed(2) : 'N/A';

      let longestInactivity = 0;
      for (let i = 1; i < allMatches.length; i++) {
        const prevDate = dayjs(allMatches[i - 1].match_date);
        const currDate = dayjs(allMatches[i].match_date);
        const diffDays = currDate.diff(prevDate, 'day');
        if (diffDays > longestInactivity) longestInactivity = diffDays;
      }

      // Head-to-head leaders (ladder & confirmed)
      const [headToHead] = await execute(
        `WITH base AS (
           SELECT 
             CASE WHEN m.player1_id = ? THEN m.player2_id ELSE m.player1_id END AS opponent_id,
             CASE 
               WHEN m.player1_score > m.player2_score THEN m.player1_id
               WHEN m.player2_score > m.player1_score THEN m.player2_id
               WHEN m.player1_score = m.player2_score 
                    AND m.penalty_score1 IS NOT NULL AND m.penalty_score2 IS NOT NULL 
                    AND m.penalty_score1 != m.penalty_score2
                 THEN CASE WHEN m.penalty_score1 > m.penalty_score2 THEN m.player1_id ELSE m.player2_id END
               ELSE NULL
             END AS winner_id,
             CASE 
               WHEN m.player1_score < m.player2_score THEN m.player1_id
               WHEN m.player2_score < m.player1_score THEN m.player2_id
               WHEN m.player1_score = m.player2_score 
                    AND m.penalty_score1 IS NOT NULL AND m.penalty_score2 IS NOT NULL 
                    AND m.penalty_score1 != m.penalty_score2
                 THEN CASE WHEN m.penalty_score1 < m.penalty_score2 THEN m.player1_id ELSE m.player2_id END
               ELSE NULL
             END AS loser_id
           FROM ladder_matches m
          WHERE (m.player1_id = ? OR m.player2_id = ?)
            AND m.ladder_id = ?
            AND m.status = 'confirmed'
        )
        SELECT 
          u.gamertag AS opponent_gamertag,
          b.opponent_id,
          COUNT(*) AS games_played,
          SUM(CASE WHEN b.winner_id = ? THEN 1 ELSE 0 END) AS wins,
          SUM(CASE WHEN b.loser_id  = ? THEN 1 ELSE 0 END) AS losses
          FROM base b
          JOIN users u ON u.id = b.opponent_id
        GROUP BY b.opponent_id, u.gamertag
        ORDER BY games_played DESC
        LIMIT 5`,
        [playerId, playerId, playerId, ladderId, playerId, playerId]
      );

      // Fetch ladder name
      const ladderNameSql = 'SELECT name FROM ladders WHERE id = ?';
      const [ladderRows] = await execute(ladderNameSql, [ladderId]);
      const ladderName = ladderRows && ladderRows[0] ? ladderRows[0].name : 'Ladder';

      let reply = `## 📊 Estatísticas Completas da ${ladderName} de ${playerGamertag}\n\n`;

      reply += `🏅 **ELO Atual:** ${eloStats?.current_elo ?? 'N/A'} | **Peak ELO:** ${eloStats?.peak_elo ?? 'N/A'}\n\n`;

      reply += `📉 **ELO - Ganhos/Perdas** (Últimos 5 Jogos): ${eloChange5?.elo_change_5 || 0} | (Últimos 10 Jogos): ${eloChange10?.elo_change_10 || 0}\n`;
      reply += `📊 **ELO - Volatilidade** (Últimos 10 Jogos): ${
        eloVolatility?.elo_volatility ? Number(eloVolatility.elo_volatility).toFixed(2) : 'N/A'
      }\n\n`;

      reply += `🔥 **Performance vs Adversários Mais Fortes:** ${perfVsStrongerPct}% W\n`;
      reply += `🎯 **Expectativa vs Realidade:** ${
        expectedVsActual?.expected_vs_actual != null
          ? Number(expectedVsActual.expected_vs_actual).toFixed(2)
          : 'N/A'
      }\n\n`;

      reply += `🛡️ **Jogos Sem Sofrer Golos:** ${cleanSheets?.count || 0} | 🥅 **Jogos Sem Marcar Golos:** ${shutoutsSuffered?.count || 0}\n\n`;

      reply += `⚡ **Jogos Ganhos por 1 Golo (Clutch):** ${oneGoalWinRate}%\n`;
      reply += `💥 **Goleadas a Favor:** ${
        (await execute(
          `SELECT COUNT(*) AS count FROM ladder_matches 
             WHERE ((player1_id = ? AND player1_score > player2_score) OR (player2_id = ? AND player2_score > player1_score))
               AND ABS(player1_score - player2_score) >= ?
               AND ladder_id = ?
               AND status = 'confirmed'`,
          [playerId, playerId, 4, ladderId]
        ))[0][0].count
      } | **Goleadas Contra:** ${
        (await execute(
          `SELECT COUNT(*) AS count FROM ladder_matches 
             WHERE ((player1_id = ? AND player1_score < player2_score) OR (player2_id = ? AND player2_score < player1_score))
               AND ABS(player1_score - player2_score) >= ?
               AND ladder_id = ?
               AND status = 'confirmed'`,
          [playerId, playerId, 4, ladderId]
        ))[0][0].count
      }\n\n`;

      reply += `⚖️ **Margem Média nas Vitórias:** ${
        typeof avgMarginWins === 'number' ? avgMarginWins.toFixed(2) : 'N/A'
      } | **Margem Média nas Derrotas:** ${
        typeof avgMarginLosses === 'number' ? avgMarginLosses.toFixed(2) : 'N/A'
      }\n\n`;

      reply += `🤝 **Ambas as Equipas Marcam %:** ${bttsPct}%\n\n`;

      reply += `🔥 **Maior Win Streak:** ${longestWinStreak} | Win Streak Atual: ${currentStreak}\n\n`;

      reply += `📅 **Jogos por Dia:** ${matchesPerDay} | **por Semana:** ${matchesPerWeek} | **por Mês:** ${matchesPerMonth}\n`;
      reply += `⏳ **Mais Dias Inativo:** ${longestInactivity}\n`;
      reply += `📆 **Dias Ativo nos Últimos 30d:** ${matchesLast30d?.active_days_30d || 0}\n\n`;

      reply += `🏆 **Top 5 Adversários (Head-to-Head):**\n`;
      for (const opp of headToHead) {
        const name = opp.opponent_gamertag || `ID ${opp.opponent_id}`;
        reply += `- ${name}: ${opp.games_played} jogos, W: ${opp.wins}, L: ${opp.losses}\n`;
      }

      await interaction.editReply({ content: reply });
    } catch (err) {
      console.error('❌ Error in /mystatsfull:', err);
      await interaction.editReply('❌ Falha ao obter as suas estatísticas completas.');
    }
  }
};
