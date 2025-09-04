// commands/user/headtohead.js
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const db = require('../../utils/db'); // pooled mysql2/promise
const { getLadderIdByChannel } = require('../../utils/ladderChannelMapping');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('headtohead')
    .setDescription('See your record vs a specific opponent.')
    .addUserOption(option =>
      option
        .setName('opponent')
        .setDescription('The opponent to see your record against')
        .setRequired(true)
    ),

  async execute(interaction) {
    const ladderId = await getLadderIdByChannel(interaction.channel.id);
    if (!ladderId) {
      return interaction.reply({
        content: '❌ This command cannot be used in this channel.',
        flags: MessageFlags.Ephemeral,
      });
    }
    // Fetch ladder name
    let ladderName = null;
    try {
      const [[ladderRow]] = await db.execute('SELECT name FROM ladders WHERE id = ?', [ladderId]);
      ladderName = ladderRow?.name || null;
    } catch (e) {
      console.error('Error fetching ladder name:', e);
      ladderName = null;
    }
    if (!ladderName) {
      ladderName = `ID ${ladderId}`;
    }

    const me = interaction.user;
    const opponentUser = interaction.options.getUser('opponent');

    if (!opponentUser) {
      return interaction.reply({
        content: '❌ You must specify an opponent user.',
        flags: MessageFlags.Ephemeral,
      });
    }
    if (opponentUser.id === me.id) {
      return interaction.reply({
        content: '❌ You cannot check head-to-head against yourself.',
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      // Resolve both users to internal player IDs
      const [[meRow]] = await db.execute(
        'SELECT id, gamertag, username FROM users WHERE discord_id = ?',
        [me.id]
      );
      const [[oppRow]] = await db.execute(
        'SELECT id, gamertag, username FROM users WHERE discord_id = ?',
        [opponentUser.id]
      );

      if (!meRow) {
        return interaction.editReply('❌ You are not registered in the ladder.');
      }
      if (!oppRow) {
        return interaction.editReply('❌ The specified opponent is not registered in the ladder.');
      }

      const playerId = meRow.id;
      const opponentId = oppRow.id;
      const playerGamertag = meRow.gamertag ?? meRow.username ?? me.username;
      const opponentGamertag = oppRow.gamertag ?? oppRow.username ?? opponentUser.username;

      // Aggregate H2H stats for this ladder
      const [aggRows] = await db.execute(
        `
        SELECT 
          SUM(
            CASE 
              WHEN (player1_id = ? AND player2_id = ? AND (player1_score > player2_score OR (player1_score = player2_score AND COALESCE(penalty_score1, -1) > COALESCE(penalty_score2, -1))))
                OR (player2_id = ? AND player1_id = ? AND (player2_score > player1_score OR (player2_score = player1_score AND COALESCE(penalty_score2, -1) > COALESCE(penalty_score1, -1))))
              THEN 1 ELSE 0 
            END
          ) AS wins,
          SUM(
            CASE 
              WHEN (player1_id = ? AND player2_id = ? AND (player1_score < player2_score OR (player1_score = player2_score AND COALESCE(penalty_score2, -1) > COALESCE(penalty_score1, -1))))
                OR (player2_id = ? AND player1_id = ? AND (player2_score < player1_score OR (player2_score = player1_score AND COALESCE(penalty_score1, -1) > COALESCE(penalty_score2, -1))))
              THEN 1 ELSE 0 
            END
          ) AS losses,
          SUM(CASE WHEN player1_id = ? THEN player1_score WHEN player2_id = ? THEN player2_score ELSE 0 END) AS goals_scored,
          SUM(CASE WHEN player1_id = ? THEN player2_score WHEN player2_id = ? THEN player1_score ELSE 0 END) AS goals_conceded,
          MAX(match_date) AS last_match_date
        FROM ladder_matches
        WHERE ladder_id = ?
          AND (
            (player1_id = ? AND player2_id = ?)
            OR
            (player1_id = ? AND player2_id = ?)
          )
        `,
        [
          // wins calc
          playerId, opponentId, playerId, opponentId,
          playerId, opponentId, playerId, opponentId,
          // goals for/against
          playerId, playerId,
          playerId, playerId,
          // scope to ladder
          ladderId,
          // pairs
          playerId, opponentId, opponentId, playerId,
        ]
      );

      const agg = aggRows?.[0] || {};
      const wins = Number(agg.wins || 0);
      const losses = Number(agg.losses || 0);
      const goalsScored = Number(agg.goals_scored || 0);
      const goalsConceded = Number(agg.goals_conceded || 0);
      const totalMatches = wins + losses;
      const winPercentage = totalMatches > 0 ? ((wins / totalMatches) * 100).toFixed(1) : '0.0';
      const lastMatchDate = agg.last_match_date
        ? new Date(agg.last_match_date).toLocaleDateString('pt-PT')
        : 'N/A';

      if (totalMatches === 0) {
        return interaction.editReply(`Não tem jogos registados contra ${opponentUser.username}.`);
      }

      // Elo delta between these two for this ladder
      const [eloRows] = await db.execute(
        `
        SELECT 
          SUM(CASE WHEN player_id = ? THEN delta ELSE 0 END) AS player_elo_gain,
          SUM(CASE WHEN player_id = ? THEN delta ELSE 0 END) AS opponent_elo_gain
        FROM ladder_elo_history
        WHERE ladder_id = ?
          AND match_id IN (
            SELECT id 
            FROM ladder_matches
            WHERE ladder_id = ?
              AND (
                (player1_id = ? AND player2_id = ?)
                OR
                (player1_id = ? AND player2_id = ?)
              )
          )
        `,
        [playerId, opponentId, ladderId, ladderId, playerId, opponentId, opponentId, playerId]
      );
      const playerEloGain = Number(eloRows?.[0]?.player_elo_gain || 0);
      const opponentEloGain = Number(eloRows?.[0]?.opponent_elo_gain || 0);
      const eloDiff = playerEloGain - opponentEloGain;

      // Last 5 matches between them (this ladder)
      const [lastFiveMatches] = await db.execute(
        `
        SELECT 
          player1_id, player2_id, player1_score, player2_score, penalty_score1, penalty_score2, match_date
        FROM ladder_matches
        WHERE ladder_id = ?
          AND (
            (player1_id = ? AND player2_id = ?)
            OR
            (player1_id = ? AND player2_id = ?)
          )
        ORDER BY match_date DESC
        LIMIT 5
        `,
        [ladderId, playerId, opponentId, opponentId, playerId]
      );

      let lastFiveGamesStr = '';
      for (const match of lastFiveMatches) {
        const p1Name = match.player1_id === playerId ? (playerGamertag || me.username) : (opponentGamertag || opponentUser.username);
        const p2Name = match.player2_id === playerId ? (playerGamertag || me.username) : (opponentGamertag || opponentUser.username);

        // Determine result for playerId
        let icon = '';
        if (match.player1_score === match.player2_score) {
          // Penalty logic for draws
          const pen1 = match.penalty_score1 ?? '-';
          const pen2 = match.penalty_score2 ?? '-';
          if (match.penalty_score1 != null && match.penalty_score2 != null && match.penalty_score1 !== match.penalty_score2) {
            if (
              (match.player1_id === playerId && match.penalty_score1 > match.penalty_score2) ||
              (match.player2_id === playerId && match.penalty_score2 > match.penalty_score1)
            ) {
              icon = '✅';
            } else {
              icon = '❌';
            }
          } else {
            icon = '➖';
          }
          lastFiveGamesStr += `${icon} ${p1Name} ${match.player1_score} (${pen1}) - (${pen2}) ${match.player2_score} ${p2Name}\n`;
        } else {
          // Regular win/loss
          let playerScore, oppScore;
          if (match.player1_id === playerId) {
            playerScore = match.player1_score;
            oppScore = match.player2_score;
          } else {
            playerScore = match.player2_score;
            oppScore = match.player1_score;
          }
          if (playerScore > oppScore) {
            icon = '✅';
          } else {
            icon = '❌';
          }
          lastFiveGamesStr += `${icon} ${p1Name} ${match.player1_score} - ${match.player2_score} ${p2Name}\n`;
        }
      }

      const reply =
        `##📊 Registo Head-to-Head contra ${opponentUser.username} - ${ladderName}:\n\n` +
        `🎮 **Jogos:** ${totalMatches} | ✅ **Vitórias:** ${wins} | ❌ **Derrotas:** ${losses}\n\n` +
        `**Percentagem de Vitórias:** ${winPercentage}%\n\n` +
        `**Golos Marcados:** ${goalsScored}\n` +
        `**Golos Sofridos:** ${goalsConceded}\n` +
        `**Diferença de Golos:** ${goalsScored - goalsConceded}\n\n` +
        `📅 **Últimos 5 Jogos:**\n${lastFiveGamesStr || '—'}\n` +
        `⏳ **Último Jogo:** ${lastMatchDate}\n` +
        `⚖️ **Diferença de Elo contra o oponente:** ${eloDiff}`;

      await interaction.editReply(reply);
    } catch (error) {
      console.error('Error fetching head-to-head record:', error);
      await interaction.editReply('❌ An error occurred while fetching the head-to-head record.');
    }
  },
};
