// commands/admin/solvedispute.js
const { SlashCommandBuilder } = require('discord.js');
const db = require('../../utils/db'); // <-- pooled mysql2/promise pool
const { notifyLadderAdminsDisputeResolved } = require('../../utils/notifyAdmins');
const { getLadderIdByChannel } = require('../../utils/ladderChannelMapping');
const { MessageFlags } = require('discord.js'); 

module.exports = {
  data: new SlashCommandBuilder()
    .setName('solvedispute')
    .setDescription('Resolver uma disputa e colocar o jogo de volta em pendente.')
    .addStringOption((o) =>
      o
        .setName('resolution_notes')
        .setDescription('Notas/justificação da decisão (visível no registo)')
        .setRequired(true)
    ),

  async execute(interaction) {
    const thread = interaction.channel;

    // Log time between interaction creation and handler execution
    const now = Date.now();
    const created = interaction.createdTimestamp || (interaction.createdAt ? interaction.createdAt.getTime() : now);


    // Always defer reply at the start
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!thread?.isThread?.()) {
      return interaction.editReply({
        content: '❌ Este comando só pode ser usado na thread do jogo.',
      });
    }

    let conn;
    try {
      // Grab a pooled connection (so we can run a transaction later)
      conn = await db.getConnection();

      // 1) Verify admin permissions (DB-based)
      const adminDiscordId = String(interaction.user.id); // store as string; DB column is BIGINT
      const [[adminRow]] = await conn.execute(
        'SELECT * FROM admin_users WHERE discord_id = ?',
        [adminDiscordId]
      );
      if (!adminRow) {
        return interaction.editReply({
          content: '🚫 Precisa de permissões de admin para usar este comando.',
        });
      }

      // 2) Extract match id from thread title (expects "Match #123")
      const m = thread.name?.match?.(/^Match #(\d+)/);
      const matchId = m ? Number(m[1]) : NaN;
      if (!matchId || Number.isNaN(matchId)) {
        return interaction.editReply({
          content: '❌ Não consegui identificar o ID do jogo.',
        });
      }

      // 3) Resolve ladder id (prefer parent channel when inside thread)
      let ladderId = thread.parentId
        ? await getLadderIdByChannel(thread.parentId)
        : null;
      if (!ladderId) ladderId = await getLadderIdByChannel(thread.id);
      if (!ladderId) {
        return interaction.editReply({
          content: '❌ Ladder não encontrada para este canal.',
        });
      }

      // 4) Ensure the match currently is in 'disputed'
      const [[matchRow]] = await conn.execute(
        'SELECT status FROM ladder_matches WHERE id = ? AND ladder_id = ?',
        [matchId, ladderId]
      );
      if (!matchRow) {
        return interaction.editReply({
          content: '❌ Jogo não encontrado.',
        });
      }
      if (matchRow.status !== 'disputed') {
        return interaction.editReply({
          content: 'ℹ️ Este jogo não está em disputa.',
        });
      }

      // NOTE: This code expects a table `ladder_match_disputes` with an OPEN dispute row.
      // Make sure your DB has it; otherwise this part will fail.
      const resolutionNotes = interaction.options.getString('resolution_notes');

      // 5) Find latest OPEN dispute for this match
      const [[openDispute]] = await conn.execute(
        `SELECT id, raised_by_player_id
           FROM ladder_match_disputes
          WHERE match_id = ? AND ladder_id = ? AND status = 'open'
          ORDER BY id DESC
          LIMIT 1`,
        [matchId, ladderId]
      );
      if (!openDispute) {
        return interaction.editReply({
          content: '⚠️ Não foi encontrada nenhuma disputa aberta para este jogo.',
        });
      }

      // 6) Transaction: resolve dispute + flip match to pending + audit
      await conn.beginTransaction();

      await conn.execute(
        `UPDATE ladder_match_disputes
            SET status = 'resolved',
                resolved_by_admin_discord_id = ?,
                resolution_notes = ?,
                resolved_at = NOW()
          WHERE id = ?`,
        [adminDiscordId, resolutionNotes, openDispute.id]
      );

      await conn.execute(
        `UPDATE ladder_matches
            SET status = 'pending'
          WHERE id = ? AND ladder_id = ? AND status = 'disputed'`,
        [matchId, ladderId]
      );

      await conn.execute(
        `INSERT INTO admin_actions (player_id, match_id, action_type, reason, performed_by)
         VALUES (?, ?, 'resolve_dispute', ?, ?)`,
        [openDispute.raised_by_player_id, matchId, resolutionNotes, interaction.user.username]
      );

      await conn.commit();

      // 7) Thread UX: unarchive if needed, notify admins, then reply to the command
      if (thread.archived) {
        try {
          await thread.setArchived(false);
        } catch (e) {
          console.error('unarchive failed:', e);
        }
      }


      await notifyLadderAdminsDisputeResolved(thread, {
        matchTitle: thread.name,
        adminTag: interaction.user.tag,
        resolutionNotes,
      });

      await interaction.editReply({
        content:
          '✅ Disputa resolvida. O jogo voltou ao estado **pendente**. Agora pode ser reportado/confirmado de forma normal.',
      });
    } catch (err) {
      console.error('❌ /solvedispute error:', err);
      // If we were inside a transaction, try to roll back
      try {
        if (conn) await conn.rollback();
      } catch {}
      // Best-effort user feedback
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({
            content: '❌ Erro ao resolver disputa.',
            flags: MessageFlags.Ephemeral,
          });
        } else {
          await interaction.editReply({
            content: '❌ Erro ao resolver disputa.',
          });
        }
      } catch {}
    } finally {
      if (conn) conn.release();
    }
  },
};
