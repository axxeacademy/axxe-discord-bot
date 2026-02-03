// commands/user/reportmatch.js
const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageFlags } = require('discord.js');
const { EmbedBuilder } = require('discord.js');
const { execute } = require('../../utils/db'); // ✅ pooled db helpers
const { logCommand } = require('../../utils/logger');
const { getLadderIdByChannel } = require('../../utils/ladderChannelMapping');
const languageService = require('../../services/languageService');
const { buildMatchEmbed } = require('../../services/matchMessages');

const confirmationTimers = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reportmatch')
    .setDescription('Reportar o resultado de um jogo contra outro jogador.')
    .setDMPermission(false) // Explicitly disallow DMs, allow in guild threads
    .addIntegerOption(option =>
      option.setName('yourscore').setDescription('O seu resultado').setRequired(true))
    .addIntegerOption(option =>
      option.setName('opponentscore').setDescription('Resultado do adversário').setRequired(true))
    .addIntegerOption(option =>
      option.setName('penaltyscore1').setDescription('Pontuação de penalidade do jogador 1 (opcional)').setRequired(false))
    .addIntegerOption(option =>
      option.setName('penaltyscore2').setDescription('Pontuação de penalidade do jogador 2 (opcional)').setRequired(false)),

  async execute(interaction) {
    // Log time between interaction creation and handler execution
    const now = Date.now();
    const created = interaction.createdTimestamp || (interaction.createdAt ? interaction.createdAt.getTime() : now);

    // Always defer reply at the start
    await interaction.deferReply();

    try {
      if (!interaction.channel.isThread()) {
        return interaction.editReply({ content: '❌ Este comando só pode ser usado em threads.' });
      }

      let ladderId = null;
      try {
        if (interaction.channel.isThread()) ladderId = await getLadderIdByChannel(interaction.channel.parentId);
        if (!ladderId) ladderId = await getLadderIdByChannel(interaction.channel.id);
      } catch { }

      const matchIdMatch = interaction.channel.name.match(/^Match #(\d+)/i) || interaction.channel.name.match(/match\s*#(\d+)/i);
      const matchId = matchIdMatch ? parseInt(matchIdMatch[1]) : NaN;
      if (!matchId) return interaction.editReply({ content: '❌ Não foi possível identificar o ID do jogo pelo nome da thread.' });

      const score1 = interaction.options.getInteger('yourscore');
      const score2 = interaction.options.getInteger('opponentscore');
      const penaltyScore1Raw = interaction.options.getInteger('penaltyscore1');
      const penaltyScore2Raw = interaction.options.getInteger('penaltyscore2');
      const reporterDiscordId = interaction.user.id;
      const reporterTag = interaction.user.tag;

      const norm = v => (v === undefined || v === null ? null : Number(v));
      let penaltyScore1 = norm(penaltyScore1Raw);
      let penaltyScore2 = norm(penaltyScore2Raw);

      // --- IDENTIFY MATCH TYPE ---
      let isTournament = false;
      let match = null;

      // 1. Try LADDER
      if (ladderId) {
        const [matchRows] = await execute(
          'SELECT * FROM ladder_matches WHERE id = ? AND ladder_id = ?',
          [matchId, ladderId]
        );
        if (matchRows.length > 0) {
          match = matchRows[0];
        }
      }

      // 2. Try TOURNAMENT if not found
      if (!match) {
        const [tRows] = await execute(
          'SELECT * FROM tournament_matches WHERE id = ?',
          [matchId]
        );
        if (tRows.length > 0) {
          match = tRows[0];
          isTournament = true;
        }
      }

      if (!match) {
        return interaction.editReply({ content: '❌ Jogo não encontrado.' });
      }

      // --- VALIDATION AND UPDATES ---

      // 🚫 Hard stop while disputed (exists in generic structure? YES in migration)
      if (match.status === 'disputed') {
        return interaction.editReply({
          content: '⚠️ Este jogo está **em disputa**. Não pode ser reportado novamente.\nUm administrador deve resolver o conflito.'
        });
      }

      // Check confirmed
      // Tournament uses 'completed' or 'pending_confirmation'. Ladder uses 'confirmed'.
      const isConfirmed = isTournament ? (match.status === 'completed') : (match.status === 'confirmed');
      const isPending = isTournament ? (match.status === 'scheduled' || match.status === 'pending_confirmation') : (match.status === 'pending');

      if (!isPending) {
        return interaction.editReply({
          content: '❌ Este jogo já foi concluído e não pode ser alterado.'
        });
      }

      // Identify reporter
      const [[me]] = await execute(
        'SELECT id, gamertag, username, discord_id FROM users WHERE discord_id = ?',
        [reporterDiscordId]
      );
      if (!me) {
        return interaction.editReply({ content: '❌ Não está registado no sistema.' });
      }

      const reporterPlayerId = me.id;
      const reporterIsPlayer1 = match.player1_id === reporterPlayerId;
      const reporterIsPlayer2 = match.player2_id === reporterPlayerId;

      if (!reporterIsPlayer1 && !reporterIsPlayer2) {
        return interaction.editReply({ content: '❌ Você não participa neste jogo.' });
      }

      const opponentPlayerId = reporterIsPlayer1 ? match.player2_id : match.player1_id;

      const [[opp]] = await execute(
        'SELECT id, gamertag, username, discord_id FROM users WHERE id = ?',
        [opponentPlayerId]
      );

      // Penalties rules
      if (score1 !== score2) {
        penaltyScore1 = null;
        penaltyScore2 = null;
      } else {
        if (penaltyScore1 === null || penaltyScore2 === null) {
          return interaction.editReply({
            content: '❌ Jogo empatado no tempo regulamentar. Tem de indicar as penalidades de ambos os jogadores.'
          });
        }
        if (penaltyScore1 === penaltyScore2) {
          return interaction.editReply({
            content: '❌ Empates não são permitidos. O resultado deve ser uma vitória ou derrota.'
          });
        }
      }

      // Prepare Update
      // NOTE: reporterIsPlayer1 means 'score1' is THEIR score (P1 score), score2 is OPPONENT (P2).
      // If reporterIsPlayer2, 'score1' is THEIR score (P2 score), score2 is OPPONENT (P1).

      const realP1Score = reporterIsPlayer1 ? score1 : score2;
      const realP2Score = reporterIsPlayer1 ? score2 : score1;
      const realP1Pen = reporterIsPlayer1 ? penaltyScore1 : penaltyScore2;
      const realP2Pen = reporterIsPlayer1 ? penaltyScore2 : penaltyScore1;

      if (isTournament) {
        // TOURNAMENT UPDATE
        await execute(
          `UPDATE tournament_matches
             SET player1_score = ?, player2_score = ?, reported_by = ?, status = 'pending_confirmation', reported_at = NOW()
             WHERE id = ?`,
          [realP1Score, realP2Score, reporterPlayerId, matchId]
        );
      } else {
        // LADDER UPDATE
        const values = [realP1Score, realP2Score, realP1Pen, realP2Pen, 'pending', reporterPlayerId, matchId, ladderId];
        const [updateRes] = await execute(
          `UPDATE ladder_matches
             SET player1_score = ?, player2_score = ?, penalty_score1 = ?, penalty_score2 = ?, status = ?, reported_by = ?
             WHERE id = ? AND ladder_id = ? AND status = 'pending'`,
          values
        );
        if (updateRes.affectedRows === 0) {
          return interaction.editReply({ content: '❌ Não foi possível atualizar. Estado inválido.' });
        }
      }

      // Re-read for embed
      // Standardize data for embed builder
      const p1Gamertag = me.id === match.player1_id ? (me.gamertag || me.username) : (opp?.gamertag || opp?.username || 'Player 1');
      const p2Gamertag = me.id === match.player2_id ? (me.gamertag || me.username) : (opp?.gamertag || opp?.username || 'Player 2');
      const p1Mention = me.id === match.player1_id ? `<@${me.discord_id}>` : (opp?.discord_id ? `<@${opp.discord_id}>` : p1Gamertag);
      const p2Mention = me.id === match.player2_id ? `<@${me.discord_id}>` : (opp?.discord_id ? `<@${opp.discord_id}>` : p2Gamertag);

      const embed = buildMatchEmbed({
        state: 'reported',
        matchId,
        p1: { gamertag: p1Gamertag, mention: p1Mention },
        p2: { gamertag: p2Gamertag, mention: p2Mention },
        scores: { s1: realP1Score, s2: realP2Score, pen1: realP1Pen, pen2: realP2Pen },
        elo: { footerText: `Reportado por ${reporterTag}` }
      });

      await interaction.editReply({ embeds: [embed] });

      // Notify opponent
      const mention = opp?.discord_id ? `<@${opp.discord_id}>` : (opp?.username || 'oponente');
      await interaction.channel.send(
        `📝 O resultado do jogo foi reportado por <@${reporterDiscordId}>.\n\n` +
        `Por favor, ${mention}, confirme o resultado usando o comando \`/confirmmatch\` nesta thread.\n\n` +
        `Se não confirmar em 5 minutos, o resultado será confirmado automaticamente.`
      );

      // --- Timer logic ---
      const client = interaction.client;
      const thread = interaction.channel;
      const timerMessage = await thread.send('⏳ A aguardar confirmação... 5:00 minutos restantes (update a cada 60s).');

      let remainingSeconds = 300;
      const interval = setInterval(async () => {
        remainingSeconds -= 60;
        if (remainingSeconds >= 0) {
          const minutes = Math.floor(remainingSeconds / 60);
          const seconds = remainingSeconds % 60;
          try {
            const fresh = await thread.fetch();
            if (fresh.archived) return;
            await timerMessage.edit(`⏳ A aguardar confirmação... ${minutes}:${seconds.toString().padStart(2, '0')} minutos restantes.`);
          } catch { }
        }
      }, 60000);

      const timeout = setTimeout(async () => {
        clearInterval(interval);
        const matchService = require('../../services/matchService'); // Lazy load

        let currentStatus = null;
        if (isTournament) {
          const [m] = await execute('SELECT status FROM tournament_matches WHERE id = ?', [matchId]);
          currentStatus = m?.status; // 'pending_confirmation'
        } else {
          const [m] = await execute('SELECT status FROM ladder_matches WHERE id = ?', [matchId]);
          currentStatus = m?.status; // 'pending'
        }

        if ((isTournament && currentStatus === 'pending_confirmation') || (!isTournament && currentStatus === 'pending')) {
          const successRes = await matchService.confirmMatch(client, matchId, ladderId, thread, { source: 'auto' });
          try {
            if (successRes && successRes.ok) {
              await timerMessage.edit('✅ Jogo confirmado automaticamente pelo sistema após 5 minutos.');
              try { if (!thread.archived) await thread.setArchived(true); } catch { }
            } else {
              await timerMessage.edit('❌ Falha ao confirmar automaticamente o jogo.');
            }
          } catch { }
        } else if (currentStatus === 'disputed') {
          try { await timerMessage.edit('⚠️ O jogo foi colocado em **disputa**. A confirmação automática foi cancelada.'); } catch { }
        } else {
          try { await timerMessage.edit('✅ Jogo já confirmado.'); } catch { }
        }
      }, 300000);

      confirmationTimers.set(thread.id, { interval, timeout });

      // Logging
      await logCommand(
        interaction,
        `${reporterTag} reported a match: ${score1} - ${score2}` + (score1 === score2 ? ` (pens: ${penaltyScore1}-${penaltyScore2})` : ''),
        { threadId: interaction.channel.id, threadName: interaction.channel.name }
      );
    } catch (err) {
      console.error('Erro ao processar /reportmatch:', err);
      try {
        await interaction.editReply({ content: '❌ Ocorreu um erro ao reportar o jogo.' });
      } catch (e) {
        console.error('Falha ao enviar mensagem de erro:', e);
      }
    }
  }
};

module.exports.confirmationTimers = confirmationTimers;
