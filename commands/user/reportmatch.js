// commands/user/reportmatch.js
const { SlashCommandBuilder } = require('@discordjs/builders');
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
    await interaction.deferReply({ flags: 64 });

    try {
      if (!interaction.channel.isThread()) {
        return interaction.editReply({ content: '❌ Este comando só pode ser usado em threads.' });
      }

      // Ladder id
      let ladderId = null;
      if (interaction.channel.isThread()) ladderId = await getLadderIdByChannel(interaction.channel.parentId);
      if (!ladderId) ladderId = await getLadderIdByChannel(interaction.channel.id);
      if (!ladderId) {
        return interaction.editReply({ content: '❌ Este comando não pode ser usado neste canal.' });
      }

      const matchIdMatch = interaction.channel.name.match(/^Match #(\d+)/);
      const matchId = matchIdMatch ? parseInt(matchIdMatch[1]) : NaN;

      const score1 = interaction.options.getInteger('yourscore');
      const score2 = interaction.options.getInteger('opponentscore');
      const penaltyScore1Raw = interaction.options.getInteger('penaltyscore1');
      const penaltyScore2Raw = interaction.options.getInteger('penaltyscore2');
      const reporterDiscordId = interaction.user.id;
      const reporterTag = interaction.user.tag;

      const norm = v => (v === undefined || v === null ? null : Number(v));
      let penaltyScore1 = norm(penaltyScore1Raw);
      let penaltyScore2 = norm(penaltyScore2Raw);

      // Main logic (no internal error reply)
      const [matchRows] = await execute(
        'SELECT * FROM ladder_matches WHERE id = ? AND ladder_id = ?',
        [matchId, ladderId]
      );
      if (matchRows.length === 0) {
        return interaction.editReply({ content: '❌ Jogo não encontrado.' });
      }

      const match = matchRows[0];

      // 🚫 Hard stop while disputed
      if (match.status === 'disputed') {
        return interaction.editReply({
          content: '⚠️ Este jogo está **em disputa**. Não pode ser reportado novamente.\nUm administrador deve usar `/solvedispute` para o colocar em **pendente**.'
        });
      }

      if (match.status !== 'pending') {
        return interaction.editReply({
          content: '❌ Este jogo já foi confirmado e não pode ser alterado.'
        });
      }

      // Identify reporter
      const [[me]] = await execute(
        'SELECT id, gamertag, username, discord_id FROM users WHERE discord_id = ?',
        [reporterDiscordId]
      );
      if (!me) {
        return interaction.editReply({ content: '❌ Não está registado na ladder.' });
      }

      const reporterPlayerId = me.id;
      const reporterIsPlayer1 = match.player1_id === reporterPlayerId;
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

      // Persist (swap if reporter is p2)
      const valuesIfP1 = [score1, score2, penaltyScore1, penaltyScore2, 'pending', reporterPlayerId, matchId, ladderId];
      const valuesIfP2 = [score2, score1, penaltyScore2, penaltyScore1, 'pending', reporterPlayerId, matchId, ladderId];

      const [updateRes] = await execute(
        `UPDATE ladder_matches
         SET player1_score = ?, player2_score = ?, penalty_score1 = ?, penalty_score2 = ?, status = ?, reported_by = ?
         WHERE id = ? AND ladder_id = ? AND status = 'pending'`,
        reporterIsPlayer1 ? valuesIfP1 : valuesIfP2
      );
      if (updateRes.affectedRows === 0) {
        return interaction.editReply({
          content: '❌ Não foi possível atualizar o resultado (o jogo pode ter mudado de estado).'
        });
      }

      // Re-read for canonical order/scores
      const [[current]] = await execute(
        'SELECT player1_id, player2_id, player1_score, player2_score, penalty_score1, penalty_score2 FROM ladder_matches WHERE id = ? AND ladder_id = ?',
        [matchId, ladderId]
      );

      // Fetch players for embed labels/mentions
      const [[p1]] = await execute(
        'SELECT gamertag, username, discord_id FROM users WHERE id = ?',
        [current.player1_id]
      );
      const [[p2]] = await execute(
        'SELECT gamertag, username, discord_id FROM users WHERE id = ?',
        [current.player2_id]
      );

      const p1Gamertag = p1?.gamertag || p1?.username || 'Jogador 1';
      const p2Gamertag = p2?.gamertag || p2?.username || 'Jogador 2';

      const embed = buildMatchEmbed({
        state: 'reported',
        matchId,
        p1: { gamertag: p1Gamertag, mention: p1?.discord_id ? `<@${p1.discord_id}>` : (p1?.username || 'Jogador 1') },
        p2: { gamertag: p2Gamertag, mention: p2?.discord_id ? `<@${p2.discord_id}>` : (p2?.username || 'Jogador 2') },
        scores: { s1: current.player1_score, s2: current.player2_score, pen1: current.penalty_score1, pen2: current.penalty_score2 },
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

      // --- Timer logic unchanged ---
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
          } catch {}
        }
      }, 60000);

      const timeout = setTimeout(async () => {
        clearInterval(interval);
        const matchService = require('../../services/matchService');
        const [[m]] = await execute(
          'SELECT status FROM ladder_matches WHERE id = ? AND ladder_id = ?',
          [matchId, ladderId]
        );
        if (!m) return;

        if (m.status === 'pending') {
          const success = await matchService.confirmMatch(client, matchId, ladderId, thread, { source: 'auto' });
          try {
            if (success) {
              await timerMessage.edit('✅ Jogo confirmado automaticamente pelo sistema após 5 minutos.');
              try { if (!thread.archived) await thread.setArchived(true); } catch {}
            } else {
              await timerMessage.edit('❌ Falha ao confirmar automaticamente o jogo.');
            }
          } catch {}
        } else if (m.status === 'disputed') {
          try { await timerMessage.edit('⚠️ O jogo foi colocado em **disputa**. A confirmação automática foi cancelada.'); } catch {}
        } else {
          try { await timerMessage.edit('✅ Jogo já confirmado.'); } catch {}
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
        // If editReply fails, just log
        console.error('Falha ao enviar mensagem de erro:', e);
      }
    }
  }
};

module.exports.confirmationTimers = confirmationTimers;
