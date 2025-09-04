// commands/player/mystats.js
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const dayjs = require('dayjs');
const { execute } = require('../../utils/db'); // <-- use pooled db helpers
const { getLadderIdByChannel } = require('../../utils/ladderChannelMapping');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mystats')
    .setDescription('Veja as suas estatísticas e classificação completas na ladder'),

  async execute(interaction) {
    const ladderId = await getLadderIdByChannel(interaction.channel.id);
    if (!ladderId) {
      return await interaction.reply({
        content: '❌ Este comando não pode ser usado neste canal.',
        flags: MessageFlags.Ephemeral
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const user = interaction.user;

    try {
      // Get ladder name
      const [[ladderRow]] = await execute(
        'SELECT name FROM ladders WHERE id = ?',
        [ladderId]
      );
      const ladderName = ladderRow ? ladderRow.name : 'Ladder';

      // Get player ID
      const [[playerRow]] = await execute(
        'SELECT id FROM users WHERE discord_id = ?',
        [user.id]
      );

      if (!playerRow) {
        return await interaction.editReply('❌ Não está registado na ladder.');
      }

      const playerId = playerRow.id;

      // Get user stats (scoped to ladder)
      const [[stats]] = await execute(
        'SELECT * FROM ladder_player_stats WHERE player_id = ? AND ladder_id = ?',
        [playerId, ladderId]
      );

      if (!stats) {
        return await interaction.editReply('ℹ️ Ainda não tem jogos registados.');
      }

      // Get average stats (scoped to ladder)
      const [[avg]] = await execute(
        `
        SELECT 
          AVG(games_played) AS avg_games,
          AVG(points)       AS avg_points,
          AVG(goal_diff)    AS avg_gd
        FROM ladder_player_stats
        WHERE ladder_id = ?
        `,
        [ladderId]
      );
      // (avg is calculated but not displayed yet—kept for parity with original logic)

      // Get player rank (scoped to ladder)
      const [rankRows] = await execute(
        `
        SELECT player_id
        FROM ladder_player_stats
        WHERE ladder_id = ?
        ORDER BY points DESC, goal_diff DESC
        `,
        [ladderId]
      );

      const rank = rankRows.findIndex(row => row.player_id === playerId) + 1;

      // Format last played
      const lastPlayed = stats.last_played
        ? dayjs(stats.last_played).format('YYYY-MM-DD HH:mm')
        : 'Never';

      // Calculate days since last match
      const daysSinceLastMatch = stats.last_played
        ? dayjs().diff(dayjs(stats.last_played), 'day')
        : 'N/A';

      // Get all matches for this player in this ladder
      const [allMatchesRows] = await execute(
        `
        SELECT player1_id, player2_id, player1_score, player2_score,
               penalty_score1, penalty_score2, match_date
        FROM ladder_matches
        WHERE (player1_id = ? OR player2_id = ?)
          AND ladder_id = ?
          AND status = 'confirmed'
        ORDER BY match_date DESC
        `,
        [playerId, playerId, ladderId]
      );

      // Build last 5 games string "W" or "L" (no ties, use penalty to decide)
      let lastResults = '';
      let wins = 0, losses = 0;
      for (const [i, game] of allMatchesRows.entries()) {
        const isPlayer1 = game.player1_id === playerId;
        const playerScore = isPlayer1 ? game.player1_score : game.player2_score;
        const opponentScore = isPlayer1 ? game.player2_score : game.player1_score;
        const penaltyScorePlayer = isPlayer1 ? game.penalty_score1 : game.penalty_score2;
        const penaltyScoreOpponent = isPlayer1 ? game.penalty_score2 : game.penalty_score1;

        let resultChar = '';
        if (playerScore > opponentScore) {
          wins++;
          resultChar = 'W';
        } else if (playerScore < opponentScore) {
          losses++;
          resultChar = 'L';
        } else {
          // No ties: check penalties to determine winner
          if (
            penaltyScorePlayer !== null && penaltyScoreOpponent !== null &&
            (penaltyScorePlayer !== penaltyScoreOpponent)
          ) {
            if (penaltyScorePlayer > penaltyScoreOpponent) {
              wins++;
              resultChar = 'W';
            } else {
              losses++;
              resultChar = 'L';
            }
          } else {
            // If penalty scores are equal or null, treat as loss (kept same as original logic)
            losses++;
            resultChar = 'L';
          }
        }
        if (i < 5) lastResults = resultChar + lastResults; // reverse order for display
      }

      // Calculate win rate based on recalculated stats
      const totalGames = wins + losses;
      const winRate = totalGames > 0 ? ((wins / totalGames) * 100).toFixed(1) : '0.0';

      // Convert lastResults to emoji format
      const lastResultsEmoji = lastResults.replace(/W/g, '✅').replace(/L/g, '❌');

      // Calculate additional per-game stats using recalculated totalGames
      const goalsScoredPerGame = totalGames > 0 ? (stats.goals_scored / totalGames).toFixed(2) : '0.00';
      const goalsConcededPerGame = totalGames > 0 ? (stats.goals_conceded / totalGames).toFixed(2) : '0.00';
      const avgGoalMargin = totalGames > 0 ? (stats.goal_diff / totalGames).toFixed(2) : '0.00';

      const reply = `
## 📊 Estatísticas da ${ladderName} de ${user.gamertag || user.username}

🏅 **Rank #**${rank} | **Elo** ${stats.elo_rating}

⏮️ **Últimos Resultados:** ${lastResultsEmoji}

🎮 **Jogos:** ${totalGames} | ✅ **Vitórias:** ${wins} | ❌ **Derrotas:** ${losses}
📈 **Taxa de Vitória:** ${winRate}%
🔥 **Winstreak:** ${stats.winstreak || stats.win_streak || 0}

⚽ **Golos Marcados:** ${stats.goals_scored} | 🛡️ **Golos Sofridos:** ${stats.goals_conceded}
➕ **Diferença de Golos:** ${stats.goal_diff}

📊 **GPJ:** ${goalsScoredPerGame}
📉 **GSPJ:** ${goalsConcededPerGame}
⚖️ **Margem Média de Golos:** ${avgGoalMargin}

----------------------------------------

🕒 **Último Jogo:** ${lastPlayed}
⏳ **Dias Desde o Último Jogo:** ${daysSinceLastMatch}
      `;

      await interaction.editReply({ content: reply.trim() });

    } catch (err) {
      console.error('❌ Error in /mystats:', err);
      await interaction.editReply('❌ Falha ao obter as suas estatísticas.');
    }
  }
};
