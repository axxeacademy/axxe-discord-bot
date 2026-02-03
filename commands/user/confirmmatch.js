// commands/matches/confirmmatch.js
const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageFlags } = require('discord.js');
const db = require('../../utils/db'); // pooled MySQL
const { logCommand } = require('../../utils/logger');
const { getLadderIdByChannel } = require('../../utils/ladderChannelMapping');
const matchService = require('../../services/matchService');
const { confirmationTimers } = require('../user/reportmatch');
const languageService = require('../../services/languageService');
const { getGamertagByDiscordId } = require('../../services/userService');
const config = require('../../config');

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

    // Ladder resolution (Optional now)
    let ladderId = null;
    try {
      if (thread.isThread()) {
        ladderId = await getLadderIdByChannel(thread.parentId);
      }
      if (!ladderId) ladderId = await getLadderIdByChannel(thread.id);
    } catch (e) {
      console.error('ladder id error:', e);
    }

    // [MODIFIED] Do not enforce ladderId here. MatchService handles context resolution.
    // If it's a tournament match, ladderId will be null and that's fine.

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
      const confirmerDiscordId = interaction.user.id;
      const confirmerGamertag = await getGamertagByDiscordId(confirmerDiscordId);
      const confirmerName =
        confirmerGamertag ||
        interaction.user.globalName ||
        interaction.member?.displayName ||
        interaction.user.username;

      // Fetch match details to get reporter info
      // [NOTE] getMatchById in service now checks both tables too!
      let matchDetails = await matchService.getMatchById(matchId);
      if (!matchDetails) {
        if (deferred) {
          return interaction.editReply({ content: '❌ Não foi possível encontrar os detalhes do jogo.' });
        } else {
          return;
        }
      }

      // Prevent reporter from confirming unless they have an admin role
      if (matchDetails.reported_by_discord_id && String(matchDetails.reported_by_discord_id) === String(confirmerDiscordId)) {
        const adminRoleIds = config.discord.ladderAdminRoleIds || [];
        const userRoleIds = interaction.member?.roles?.cache
          ? Array.from(interaction.member.roles.cache.keys())
          : [];
        const isAdmin = userRoleIds.some((roleId) => adminRoleIds.includes(roleId));
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
              : (result?.code === 'not_found')
                ? '❌ Jogo não encontrado no contexto atual.'
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
