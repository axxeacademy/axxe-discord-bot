const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageFlags } = require('discord.js');
const db = require('../../utils/db');
const matchService = require('../../services/matchService');
const languageService = require('../../services/languageService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cancelmatch')
    .setDescription('Desfaz um jogo confirmado, revertendo ELO e estatísticas.')
    .addIntegerOption(option =>
      option.setName('matchid')
        .setDescription('ID do jogo a desfazer')
        .setRequired(true)
    ),

  async execute(interaction) {
    const matchId = interaction.options.getInteger('matchid');
    let deferred = false;
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      deferred = true;
    } catch (e) {}

    // Fetch match details
    const match = await matchService.getMatchById(matchId);
    if (!match) {
      if (deferred) {
        return interaction.editReply({ content: '❌ Jogo não encontrado.' });
      }
      return;
    }
    if (match.status !== 'confirmed') {
      if (deferred) {
        return interaction.editReply({ content: '❌ Só é possível desfazer jogos confirmados.' });
      }
      return;
    }

    // Fetch ELO history for this match
    const [eloRows] = await db.execute(
      'SELECT * FROM ladder_elo_history WHERE match_id = ?',
      [matchId]
    );
    if (eloRows.length !== 2) {
      if (deferred) {
        return interaction.editReply({ content: '❌ Não foi possível encontrar histórico de ELO para este jogo.' });
      }
      return;
    }

    // Map player_id to old_elo
    const eloMap = {};
    for (const row of eloRows) {
      eloMap[row.player_id] = row.old_elo;
    }

    // Fetch current player stats
    const [statsRows] = await db.execute(
      'SELECT * FROM ladder_player_stats WHERE player_id IN (?, ?) AND ladder_id = ?',
      [match.player1_id, match.player2_id, match.ladder_id]
    );
    if (statsRows.length !== 2) {
      if (deferred) {
        return interaction.editReply({ content: '❌ Não foi possível encontrar estatísticas dos jogadores.' });
      }
      return;
    }

    // Determine match result for stats reversal
    const isDraw = match.player1_score === match.player2_score;
    let winnerId = null;
    if (!isDraw) {
      winnerId = match.player1_score > match.player2_score ? match.player1_id : match.player2_id;
    }

    // Prepare stat reversals
    const updates = [];
    for (const stats of statsRows) {
      const isP1 = stats.player_id === match.player1_id;
      const result = isDraw ? 0.5 : (stats.player_id === winnerId ? 1 : 0);
      const isWinner = result === 1;
      const isPenaltyDecided = (match.penalty_score1 !== null && match.penalty_score2 !== null);

      // Reverse stats
      let games_played = Math.max(0, stats.games_played - 1);
      let wins = Math.max(0, stats.wins - (result === 1 ? 1 : 0));
      let draws = Math.max(0, stats.draws - ((result === 0.5 && !isPenaltyDecided) ? 1 : 0));
      let losses = Math.max(0, stats.losses - (result === 0 ? 1 : 0));
      let goals_scored = Math.max(0, stats.goals_scored - (isP1 ? match.player1_score : match.player2_score));
      let goals_conceded = Math.max(0, stats.goals_conceded - (isP1 ? match.player2_score : match.player1_score));
      let points = Math.max(0, stats.points - (result === 1 ? 3 : (result === 0.5 && !isPenaltyDecided) ? 1 : 0));
      let goal_diff = goals_scored - goals_conceded;
      let win_streak = isWinner ? Math.max(0, stats.win_streak - 1) : 0;

      updates.push({
        player_id: stats.player_id,
        elo_rating: eloMap[stats.player_id],
        games_played,
        wins,
        draws,
        losses,
        goals_scored,
        goals_conceded,
        points,
        goal_diff,
        win_streak
      });
    }

    // Update player stats and delete ELO history in a transaction
    try {
      await db.query('START TRANSACTION');
      for (const u of updates) {
        await db.execute(
          `UPDATE ladder_player_stats
           SET elo_rating = ?, games_played = ?, wins = ?, draws = ?, losses = ?, goals_scored = ?, goals_conceded = ?, points = ?, goal_diff = ?, win_streak = ?
           WHERE player_id = ? AND ladder_id = ?`,
          [u.elo_rating, u.games_played, u.wins, u.draws, u.losses, u.goals_scored, u.goals_conceded, u.points, u.goal_diff, u.win_streak, u.player_id, match.ladder_id]
        );
      }
      await db.execute('DELETE FROM ladder_elo_history WHERE match_id = ?', [matchId]);
      await db.execute('UPDATE ladder_matches SET status = ? WHERE id = ?', ['cancelled', matchId]);
      await db.query('COMMIT');
    } catch (err) {
      try { await db.query('ROLLBACK'); } catch (rollbackErr) {
        console.error('Rollback failed:', rollbackErr);
      }
      console.error('Erro ao desfazer o jogo:', err);
      if (deferred) {
        return interaction.editReply({ content: `❌ Erro ao desfazer o jogo: ${err.message || err}` });
      }
      return;
    }

    if (deferred) {
      return interaction.editReply({ content: '✅ Jogo desfeito com sucesso. ELO e estatísticas revertidos.' });
    }
  }
};
