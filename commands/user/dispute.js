// commands/user/dispute.js
const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageFlags } = require('discord.js');
const db = require('../../utils/db'); // <- pooled mysql2/promise pool
const { getLadderIdByChannel } = require('../../utils/ladderChannelMapping');
const { confirmationTimers } = require('./reportmatch');
const languageService = require('../../services/languageService');
const { notifyLadderAdminsDisputeOpened } = require('../../utils/notifyAdmins');
const { logCommand } = require('../../utils/logger');
const { buildMatchEmbed } = require('../../services/matchMessages');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dispute')
    .setDescription('Colocar um jogo em disputa para revisão por um admin.')
    .addStringOption((opt) =>
      opt.setName('reason').setDescription('Explique o motivo da disputa').setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName('evidence').setDescription('Link para provas/imagens (opcional)').setRequired(false)
    ),

  async execute(interaction) {
    const thread = interaction.channel;

    // Must be in a thread
    if (!thread?.isThread?.()) {
      return interaction.reply({
        content: languageService.getMessage('pt-PT', 'command_not_in_thread'),
        flags: MessageFlags.Ephemeral,
      });
    }

    // Resolve ladder from parent (or self as fallback)
    let ladderId = await getLadderIdByChannel(thread.parentId);
    if (!ladderId) ladderId = await getLadderIdByChannel(thread.id);
    if (!ladderId) {
      return interaction.reply({
        content: languageService.getMessage('pt-PT', 'command_not_in_channel'),
        flags: MessageFlags.Ephemeral,
      });
    }

    // Parse match id from thread title
    const m = thread.name.match(/^Match #(\d+)/i);
    const matchId = m ? Number(m[1]) : NaN;
    if (!Number.isFinite(matchId)) {
      return interaction.reply({
        content:
          '❌ Não consegui identificar o ID do jogo a partir do título da thread.',
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const reason = interaction.options.getString('reason', true);
    const evidence = interaction.options.getString('evidence') || null;

    let conn;
    try {
      conn = await db.getConnection();

      // Ensure match exists + gather minimal info
      const [[matchRow]] = await conn.execute(
        `SELECT id, ladder_id, status, player1_id, player2_id,
                player1_score, player2_score, penalty_score1, penalty_score2
           FROM ladder_matches
          WHERE id = ? AND ladder_id = ?`,
        [matchId, ladderId]
      );
      if (!matchRow) {
        return interaction.editReply({ content: '❌ Jogo não encontrado.' });
      }
      if (matchRow.status === 'confirmed') {
        return interaction.editReply({
          content:
            '❌ Este jogo já foi confirmado e não pode ser colocado em disputa.',
        });
      }
      if (matchRow.status === 'disputed') {
        return interaction.editReply({
          content: '⚠️ Este jogo já está em disputa.',
        });
      }

      // Identify the disputer
      const [[me]] = await conn.execute(
        'SELECT id, gamertag, username, discord_id FROM users WHERE discord_id = ?',
        [interaction.user.id]
      );
      if (!me) {
        return interaction.editReply({
          content: '❌ Não está registado na ladder.',
        });
      }

      // Flip to disputed + insert dispute row atomically
      await conn.beginTransaction();

      // Only flip if currently pending
      const [upd] = await conn.execute(
        `UPDATE ladder_matches
            SET status = 'disputed'
          WHERE id = ? AND ladder_id = ? AND status IN ('pending')`,
        [matchId, ladderId]
      );

      if (upd.affectedRows === 0) {
        // Status changed between read and update (race) — recheck to explain
        const [[nowRow]] = await conn.execute(
          'SELECT status FROM ladder_matches WHERE id = ? AND ladder_id = ?',
          [matchId, ladderId]
        );
        await conn.rollback();
        if (!nowRow) {
          return interaction.editReply({ content: '❌ Jogo não encontrado.' });
        }
        if (nowRow.status === 'disputed') {
          return interaction.editReply({ content: '⚠️ Este jogo já está em disputa.' });
        }
        if (nowRow.status === 'confirmed') {
          return interaction.editReply({
            content:
              '❌ Este jogo foi confirmado entretanto e já não pode ser disputado.',
          });
        }
        return interaction.editReply({ content: '❌ Não foi possível abrir disputa.' });
      }

      // NOTE: Your dump doesn’t include this table. Ensure it exists:
      // ladder_match_disputes(id PK AI, match_id, ladder_id, raised_by_player_id, reason, evidence_url, status, created_at, resolved_by_admin_discord_id, resolution_notes, resolved_at)
      await conn.execute(
        `INSERT INTO ladder_match_disputes
           (match_id, ladder_id, raised_by_player_id, reason, evidence_url, status)
         VALUES (?, ?, ?, ?, ?, 'open')`,
        [matchId, ladderId, me.id, reason, evidence]
      );

      await conn.commit();

      // Stop any auto-confirm timers tied to this thread
      const timers = confirmationTimers.get(thread.id);
      if (timers) {
        if (timers.interval) clearInterval(timers.interval);
        if (timers.timeout) clearTimeout(timers.timeout);
        confirmationTimers.delete(thread.id);
      }

      // Fetch users for nicer embed labels
      const [[p1]] = await conn.execute(
        'SELECT gamertag, username, discord_id FROM users WHERE id = ?',
        [matchRow.player1_id]
      );
      const [[p2]] = await conn.execute(
        'SELECT gamertag, username, discord_id FROM users WHERE id = ?',
        [matchRow.player2_id]
      );

      const p1Gamertag = p1?.gamertag || p1?.username || 'Jogador 1';
      const p2Gamertag = p2?.gamertag || p2?.username || 'Jogador 2';

      // Build and post the "disputed" embed to the thread (public)
      const embed = buildMatchEmbed({
        state: 'disputed',
        matchId,
        p1: {
          gamertag: p1Gamertag,
          mention: p1?.discord_id ? `<@${p1.discord_id}>` : (p1?.username || 'Jogador 1'),
        },
        p2: {
          gamertag: p2Gamertag,
          mention: p2?.discord_id ? `<@${p2.discord_id}>` : (p2?.username || 'Jogador 2'),
        },
        scores: {
          s1: matchRow.player1_score,
          s2: matchRow.player2_score,
          pen1: matchRow.penalty_score1,
          pen2: matchRow.penalty_score2,
        },
        elo: { footerText: `Disputa aberta por ${interaction.user.tag}` },
      });

      // [NEW] Update thread name with icon
      try {
        const currentName = thread.name;
        if (!currentName.includes('🚨')) {
          const newName = currentName.replace(/\s*-\s*/, ' 🚨 ');
          await thread.setName(newName);
        }
      } catch (nameErr) {
        console.warn('Could not rename thread to disputed:', nameErr);
      }

      // Send the public notice in thread, then acknowledge user ephemerally
      try {
        await thread.send({ embeds: [embed] });
      } catch (postErr) {
        console.warn('Could not post disputed embed to thread:', postErr);
      }

      // Notify admin feed (best-effort)
      try {
        await notifyLadderAdminsDisputeOpened(thread, {
          matchTitle: thread.name,
          raisedByTag: `<@${interaction.user.id}>`,
          reason,
          evidenceUrl: evidence || null,
        });
      } catch (notifyErr) {
        console.warn('notifyLadderAdminsDisputeOpened failed:', notifyErr);
      }

      // Audit log (best-effort)
      try {
        await logCommand(
          interaction,
          `${interaction.user.tag} abriu uma disputa no jogo #${matchId}`,
          {
            matchId,
            ladderId,
            disputer: {
              id: me.id,
              gamertag: me.gamertag,
              discordUsername: me.username,
              discordUserId: interaction.user.id,
            },
            reason,
            evidence,
          }
        );
      } catch (logErr) {
        console.warn('logCommand failed for /dispute:', logErr);
      }

      return interaction.editReply({
        content:
          '⚠️ Disputa aberta. Um admin já foi notificado e deverá entrar em contacto nesta thread.',
      });
    } catch (err) {
      console.error('❌ Error in /dispute:', err);
      try {
        if (conn) await conn.rollback();
      } catch { }
      try {
        return interaction.editReply({
          content: '❌ Erro ao abrir disputa.',
        });
      } catch { }
    } finally {
      if (conn) conn.release();
    }
  },
};
