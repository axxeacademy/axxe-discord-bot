// commands/user/reportmatch.js
const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageFlags } = require('discord.js');
const { execute } = require('../../utils/db');
const { logCommand } = require('../../utils/logger');
const matchService = require('../../services/matchService'); // [NEW] Import service for context
const { getLadderIdByChannel } = require('../../utils/ladderChannelMapping');
const { buildMatchEmbed } = require('../../services/matchMessages');

const confirmationTimers = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reportmatch')
    .setDescription('Reportar o resultado de um jogo (Resultado Jogador 1 vs Resultado Jogador 2).')
    .setDMPermission(false)
    .addIntegerOption(option =>
      option.setName('score_player1').setDescription('Golos/Pontos do Jogador 1 (Home/Cima)').setRequired(true))
    .addIntegerOption(option =>
      option.setName('score_player2').setDescription('Golos/Pontos do Jogador 2 (Away/Baixo)').setRequired(true))
    .addIntegerOption(option =>
      option.setName('penalty_player1').setDescription('Penalties do Jogador 1 (Opcional)').setRequired(false))
    .addIntegerOption(option =>
      option.setName('penalty_player2').setDescription('Penalties do Jogador 2 (Opcional)').setRequired(false)),

  async execute(interaction) {
    const now = Date.now();
    await interaction.deferReply();

    try {
      if (!interaction.channel.isThread()) {
        return interaction.editReply({ content: '❌ Este comando só pode ser usado em threads.' });
      }

      // [NEW] Resolve Context via MatchService
      const matchContext = await matchService.getMatchContext(interaction.channel.id);

      const matchIdMatch = interaction.channel.name.match(/^Match #(\d+)/i) || interaction.channel.name.match(/match\s*#(\d+)/i);
      const matchId = matchIdMatch ? parseInt(matchIdMatch[1]) : NaN;

      if (!matchContext && !matchId) {
        return interaction.editReply({ content: '❌ Não foi possível identificar o ID do jogo.' });
      }

      // Fallback ID if context missing (migration period)
      const finalMatchId = matchContext ? matchContext.matchId : matchId;
      const type = matchContext ? matchContext.type : 'ladder'; // Default to ladder if unknown (Legacy)

      const s1 = interaction.options.getInteger('score_player1');
      const s2 = interaction.options.getInteger('score_player2');
      const p1Raw = interaction.options.getInteger('penalty_player1');
      const p2Raw = interaction.options.getInteger('penalty_player2');
      const reporterDiscordId = interaction.user.id;
      const reporterTag = interaction.user.tag;

      const norm = v => (v === undefined || v === null ? null : Number(v));
      let penaltyScore1 = norm(p1Raw);
      let penaltyScore2 = norm(p2Raw);

      // Fetch Match Data
      let match = null;
      let isTournament = (type === 'tournament');
      let ladderId = null;

      if (isTournament) {
        const [rows] = await execute('SELECT * FROM tournament_matches WHERE id = ?', [finalMatchId]);
        if (rows.length > 0) match = rows[0];
      } else {
        // Ladder lookup
        try {
          if (interaction.channel.isThread()) ladderId = await getLadderIdByChannel(interaction.channel.parentId);
          if (!ladderId) ladderId = await getLadderIdByChannel(interaction.channel.id);
        } catch { }

        if (ladderId) {
          const [rows] = await execute('SELECT * FROM ladder_matches WHERE id = ? AND ladder_id = ?', [finalMatchId, ladderId]);
          if (rows.length > 0) match = rows[0];
        } else {
          // Try open lookup?
          const [rows] = await execute('SELECT * FROM ladder_matches WHERE id = ?', [finalMatchId]);
          if (rows.length > 0) {
            match = rows[0];
            ladderId = match.ladder_id;
          }
        }
      }

      if (!match) {
        return interaction.editReply({ content: '❌ Jogo não encontrado.' });
      }

      // --- VALIDATION AND UPDATES ---

      if (match.status === 'disputed') {
        return interaction.editReply({
          content: '⚠️ Este jogo está **em disputa**. Não pode ser reportado novamente.\nUm administrador deve resolver o conflito.'
        });
      }

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

      const isAdmin = interaction.member.permissions.has('Administrator');

      if (!me && !isAdmin) {
        return interaction.editReply({ content: '❌ Não está registado no sistema.' });
      }

      const reporterPlayerId = me?.id;
      const reporterIsPlayer1 = match.player1_id === reporterPlayerId;
      const reporterIsPlayer2 = match.player2_id === reporterPlayerId;

      if (!reporterIsPlayer1 && !reporterIsPlayer2 && !isAdmin) {
        return interaction.editReply({ content: '❌ Você não participa neste jogo e não é administrador.' });
      }

      // Penalties validation
      if (s1 !== s2) {
        penaltyScore1 = null;
        penaltyScore2 = null;
      } else {
        if (penaltyScore1 === null || penaltyScore2 === null) {
          return interaction.editReply({ content: '❌ Jogo empatado no tempo regulamentar. Tem de indicar as penalidades.' });
        }
        if (penaltyScore1 === penaltyScore2) {
          return interaction.editReply({ content: '❌ Empates não são permitidos nos penalties.' });
        }
      }

      // Scores are absolute now - No swapping needed
      const realP1Score = s1;
      const realP2Score = s2;
      const realP1Pen = penaltyScore1;
      const realP2Pen = penaltyScore2;

      if (isTournament) {
        await execute(
          `UPDATE tournament_matches
             SET player1_score = ?, player2_score = ?, penalty_score1 = ?, penalty_score2 = ?, reported_by = ?, status = 'pending_confirmation', reported_at = NOW()
             WHERE id = ?`,
          [realP1Score, realP2Score, realP1Pen, realP2Pen, reporterPlayerId || null, finalMatchId]
        );
      } else {
        const values = [realP1Score, realP2Score, realP1Pen, realP2Pen, 'pending', reporterPlayerId, finalMatchId, ladderId];
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

      // Fetch Players INFO (Securely)
      const [[p1User]] = await execute('SELECT id, gamertag, username, discord_id FROM users WHERE id = ?', [match.player1_id]);
      const [[p2User]] = await execute('SELECT id, gamertag, username, discord_id FROM users WHERE id = ?', [match.player2_id]);

      const p1Gamertag = p1User?.gamertag || p1User?.username || 'Player 1';
      const p2Gamertag = p2User?.gamertag || p2User?.username || 'Player 2';
      const p1Mention = p1User?.discord_id ? `<@${p1User.discord_id}>` : p1Gamertag;
      const p2Mention = p2User?.discord_id ? `<@${p2User.discord_id}>` : p2Gamertag;

      const embed = buildMatchEmbed({
        state: 'reported',
        matchId: finalMatchId,
        p1: { gamertag: p1Gamertag, mention: p1Mention },
        p2: { gamertag: p2Gamertag, mention: p2Mention },
        scores: { s1: realP1Score, s2: realP2Score, pen1: realP1Pen, pen2: realP2Pen },
        elo: { footerText: `Reportado por ${reporterTag}` },
        showElo: !isTournament // [NEW] Hide Elo for tournaments
      });

      await interaction.editReply({ embeds: [embed] });

      // Notify opponent (if not admin reporting for them)
      let mention = 'Participantes';
      if (reporterIsPlayer1 && p2User?.discord_id) mention = `<@${p2User.discord_id}>`;
      if (reporterIsPlayer2 && p1User?.discord_id) mention = `<@${p1User.discord_id}>`;
      if (!reporterIsPlayer1 && !reporterIsPlayer2) mention = 'Participantes';

      await interaction.channel.send(
        `📝 O resultado do jogo foi reportado por <@${reporterDiscordId}>.\n` +
        `Por favor, ${mention}, confirme o resultado usando \`/confirmmatch\`.\n` +
        `Confirmação automática em 5 minutos.`
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

        let currentStatus = null;
        let isTourn = false;

        // Re-check type using context or fallback
        // We know finalMatchId and type/isTournament from above closure scope
        // Re-read DB
        if (isTournament) {
          const [m] = await execute('SELECT status FROM tournament_matches WHERE id = ?', [finalMatchId]);
          currentStatus = m?.status;
          isTourn = true;
        } else {
          const [m] = await execute('SELECT status FROM ladder_matches WHERE id = ?', [finalMatchId]);
          currentStatus = m?.status;
          isTourn = false;
        }

        if ((isTourn && currentStatus === 'pending_confirmation') || (!isTourn && currentStatus === 'pending')) {
          const successRes = await matchService.confirmMatch(client, finalMatchId, ladderId, thread, { source: 'auto' });
          try {
            if (successRes && successRes.ok) {
              await timerMessage.edit('✅ Jogo confirmado automaticamente.');
              try { if (!thread.archived) await thread.setArchived(true); } catch { }
            } else {
              await timerMessage.edit('❌ Falha ao confirmar automaticamente.');
            }
          } catch { }
        } else if (currentStatus === 'disputed') {
          try { await timerMessage.edit('⚠️ Em disputa. Auto-confirm cancelado.'); } catch { }
        } else {
          try { await timerMessage.edit('✅ Já confirmado.'); } catch { }
        }
      }, 300000);

      confirmationTimers.set(thread.id, { interval, timeout });

      await logCommand(
        interaction,
        `${reporterTag} reported match ${finalMatchId}: ${s1}-${s2}`,
        { threadId: interaction.channel.id, threadName: interaction.channel.name }
      );

    } catch (err) {
      console.error('Erro ao processar /reportmatch:', err);
      try { await interaction.editReply({ content: '❌ Ocorreu um erro.' }); } catch (e) { }
    }
  }
};

module.exports.confirmationTimers = confirmationTimers;
