// commands/matches/confirmmatch.js
const { SlashCommandBuilder, MessageFlags } = require('@discordjs/builders');
const db = require('../../utils/db'); // pooled MySQL
const { logCommand } = require('../../utils/logger');
const { getLadderIdByChannel } = require('../../utils/ladderChannelMapping');
const matchService = require('../../services/matchService');
const { confirmationTimers } = require('../user/reportmatch');
const languageService = require('../../services/languageService');
const { getGamertagByDiscordId, isAdminByDiscordId } = require('../../services/userService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('confirmmatch')
    .setDescription('Confirmar o resultado de um jogo.'),

  async execute(interaction) {
    const thread = interaction.channel;

    // Always defer so the token is safe even if DB is slow
    let deferred = false;
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      deferred = true;
    } catch (e) {
      console.error('Failed to defer reply in /confirmmatch:', e);
    }

    // Must be a thread
    if (!thread?.isThread?.()) {
      if (deferred) {
        return interaction.editReply({
          content: languageService.getMessage('pt-PT', 'command_not_in_thread'),
        });
      } else {
        return;
      }
    }

    // Ladder resolution
    let ladderId = null;
    try {
      if (thread.isThread()) {
        ladderId = await getLadderIdByChannel(thread.parentId);
      }
      if (!ladderId) ladderId = await getLadderIdByChannel(thread.id);
    } catch (e) {
      console.error('ladder id error:', e);
    }
    if (!ladderId) {
      if (deferred) {
        return interaction.editReply({
          content: languageService.getMessage('pt-PT', 'command_not_in_channel'),
        });
      } else {
        return;
      }
    }

    // Parse match id from thread name
    const m = thread.name.match(/match\s*#(\d+)/i);
    const matchId = m ? Number(m[1]) : NaN;
    if (!Number.isFinite(matchId)) {
      if (deferred) {
        return interaction.editReply({
          content: languageService.getMessage('pt-PT', 'match_id_from_title_failed'),
        });
      } else {
        return;
      }
    }

    try {
      // Let matchService handle atomic confirm logic
      const confirmerDiscordId = interaction.user.id;
      const confirmerGamertag = await getGamertagByDiscordId(confirmerDiscordId);
      const confirmerName =
        confirmerGamertag ||
        interaction.user.globalName ||
        interaction.member?.displayName ||
        interaction.user.username;

      // Fetch match details to get reporter info
      let matchDetails = await matchService.getMatchById(matchId);
      if (!matchDetails) {
        if (deferred) {
          return interaction.editReply({ content: '❌ Não foi possível encontrar os detalhes do jogo.' });
        } else {
          return;
        }
      }

      // Prevent reporter from confirming unless admin
      if (matchDetails.reported_by_discord_id && String(matchDetails.reported_by_discord_id) === String(confirmerDiscordId)) {
        const isAdmin = await isAdminByDiscordId(confirmerDiscordId);
        if (!isAdmin) {
          if (deferred) {
            return interaction.editReply({ content: '🚫 Não pode confirmar um jogo que você mesmo reportou (a não ser que seja admin).' });
          } else {
            return;
          }
        }
      }

      const result = await matchService.confirmMatch(
        interaction.client,
        matchId,
        ladderId,
        thread,
        { source: 'manual', confirmerId: confirmerDiscordId, confirmer: confirmerName }
      );

      if (!result?.ok) {
        const msg =
          result?.code === 'confirmed'
            ? '✅ Este jogo já foi confirmado.'
            : result?.code === 'disputed'
            ? '⚠️ Este jogo está em disputa. Um admin já foi notificado e resolverá o problema assim que possível.'
            : '❌ Falha na confirmação do jogo..';
        if (deferred) {
          return interaction.editReply({ content: msg });
        } else {
          return;
        }
      }

      // Cancel any running auto-confirm timers
      const timers = confirmationTimers.get(thread.id);
      if (timers) {
        if (timers.interval) clearInterval(timers.interval);
        if (timers.timeout) clearTimeout(timers.timeout);
        confirmationTimers.delete(thread.id);
      }

      // Fetch match details for logging
      matchDetails = await matchService.getMatchById(matchId);
      if (!matchDetails) {
        console.warn(`confirmmatch: match ${matchId} confirmed but details not found`);
        if (deferred) {
          return interaction.editReply({ content: '✅ Jogo confirmado com sucesso.' });
        } else {
          return;
        }
      }

      // Robust Elo logging: join back to match so we know which row belongs to who
      const [eloRows] = await db.execute(
        `
        SELECT
          leh.player_id,
          leh.delta,
          leh.new_elo,
          CASE
            WHEN leh.player_id = lm.player1_id THEN 'player1'
            WHEN leh.player_id = lm.player2_id THEN 'player2'
            ELSE 'other'
          END AS slot
        FROM ladder_elo_history leh
        JOIN ladder_matches lm ON lm.id = leh.match_id
        WHERE leh.match_id = ?
        ORDER BY leh.id DESC
        `,
        [matchId]
      );

      const bySlot = {};
      for (const row of eloRows) {
        if (!bySlot[row.slot]) bySlot[row.slot] = row; // take latest per slot
      }
      const eloGain = {
        player1: bySlot.player1?.delta ?? null,
        player2: bySlot.player2?.delta ?? null,
      };
      const currentElo = {
        player1: bySlot.player1?.new_elo ?? null,
        player2: bySlot.player2?.new_elo ?? null,
      };

      // Get both players with one query
      const [players] = await db.execute(
        `SELECT id, gamertag, username AS discordUsername, discord_id AS discordUserId
         FROM users WHERE id IN (?, ?)`,
        [matchDetails.player1_id, matchDetails.player2_id]
      );
      const player1 =
        players.find((p) => p.id === matchDetails.player1_id) || {
          gamertag: 'Unknown',
          discordUsername: 'Unknown',
          discordUserId: null,
        };
      const player2 =
        players.find((p) => p.id === matchDetails.player2_id) || {
          gamertag: 'Unknown',
          discordUsername: 'Unknown',
          discordUserId: null,
        };

      // Log command (non-fatal if it fails)
      try {
        await logCommand(interaction, `Match #${matchId} confirmed manually by ${confirmerName}`, {
          threadId: thread.id,
          threadName: thread.name,
          matchResult: {
            result: `${player1.gamertag} ${matchDetails.player1_score} - ${matchDetails.player2_score} ${player2.gamertag}`,
            eloGain,
            currentElo,
          },
          matchInfo: { player1, player2, threadId: thread.id },
        });
      } catch (logErr) {
        console.warn('Non-fatal: logCommand failed in /confirmmatch:', logErr);
      }

      if (deferred) {
        return interaction.editReply({ content: '✅ Jogo confirmado com sucesso.' });
      } else {
        return;
      }
    } catch (error) {
      console.error('❌ Erro em /confirmmatch:', error);
      try {
        if (deferred) {
          return interaction.editReply({ content: '❌ Falha na confirmação do jogo..' });
        }
      } catch (e2) {
        console.error('Failed to send error reply in /confirmmatch:', e2);
      }
    }
  },
};
