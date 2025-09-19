// utils/notifyAdmins.js
// Centralized helpers to notify Ladder Admins in match threads (and elsewhere)

const config = require('../config');

/**
 * Ensure the bot can post to this thread (join & unarchive if needed)
 */
async function ensureThreadWritable(thread) {
  try {
    // Unarchive if needed
    if (thread.archived) {
      try { await thread.setArchived(false); } catch (e) {
        console.warn('[notifyAdmins] Failed to unarchive thread:', e?.message || e);
      }
    }
    // Join if possible (new threads often require join before sending)
    if (thread.joinable) {
      try { await thread.join(); } catch (e) {
        // not fatal
      }
    }
  } catch (e) {
    console.warn('[notifyAdmins] ensureThreadWritable error:', e?.message || e);
  }
}

/**
 * Build the admin mentions string from config
 */
function buildAdminMentions() {
  const ids = config.discord?.ladderAdminRoleIds || [];
  if (!ids.length) return '';
  // NOTE: Role must be mentionable, or bot needs "Mention @everyone, @here, and All Roles"
  return ids.map(id => `<@&${id}>`).join(' ');
}

/**
 * Generic notifier
 * @param {ThreadChannel|TextChannel} target - where to post
 * @param {string} message - final message content (already formatted)
 */
async function notifyLadderAdminsGeneric(target, message) {
  try {
    await ensureThreadWritable(target);
    if (!message || !message.trim()) return;
    await target.send(message);
  } catch (err) {
    console.error('[notifyAdmins] notifyLadderAdminsGeneric error:', err);
  }
}

/**
 * New game created in a thread
 * @param {ThreadChannel} thread
 * @param {string} matchTitle - e.g., "Match #123 | P1 vs P2"
 * @param {string} [extra] - optional extra line(s)
 */
async function notifyLadderAdminsNewGame(thread, matchTitle, extra) {
  const mentions = buildAdminMentions();
  const lines = [
    `${mentions} novo jogo criado: **${matchTitle}**.`,
    extra ? String(extra) : null
  ].filter(Boolean);
  return notifyLadderAdminsGeneric(thread, lines.join('\n'));
}

/**
 * Dispute opened in a match
 * @param {ThreadChannel} thread
 * @param {object} data
 * @param {string} data.matchTitle
 * @param {string} data.raisedByTag - Discord tag or mention of who raised it
 * @param {string} data.reason
 * @param {string|null} [data.evidenceUrl]
 */
async function notifyLadderAdminsDisputeOpened(thread, { matchTitle, raisedByTag, reason, evidenceUrl = null }) {
  const mentions = buildAdminMentions();
  const lines = [
    `⚠️ ${mentions} **DISPUTA ABERTA** em **${matchTitle}** por ${raisedByTag}.`,
    `📝 Motivo: ${reason}`,
    evidenceUrl ? `📎 Prova: ${evidenceUrl}` : null,
    `➡️ Um admin deve avaliar e usar \`/solvedispute\`.`
  ].filter(Boolean);
  return notifyLadderAdminsGeneric(thread, lines.join('\n'));
}

/**
 * Dispute resolved by an admin
 * @param {ThreadChannel} thread
 * @param {object} data
 * @param {string} data.matchTitle
 * @param {string} data.adminTag
 * @param {string} [data.resolutionNotes]
 */
async function notifyLadderAdminsDisputeResolved(thread, { matchTitle, adminTag, resolutionNotes = '' }) {
  const mentions = buildAdminMentions();
  const lines = [
    `✅ ${mentions} **DISPUTA RESOLVIDA** em **${matchTitle}** por ${adminTag}.`,
    resolutionNotes ? `🗒️ Notas: ${resolutionNotes}` : null,
    `➡️ O jogo voltou a **pendente**.`
  ].filter(Boolean);
  return notifyLadderAdminsGeneric(thread, lines.join('\n'));
}

// Optional: keep a short alias for future flexibility
async function notifyLadderAdmins(thread, message) {
  return notifyLadderAdminsGeneric(thread, message);
}

/**
 * Check if a Discord member is an admin (has any of the admin role IDs)
 * @param {GuildMember} member
 * @returns {boolean}
 */
function isAdmin(member) {
  const adminRoleIds = config.discord?.ladderAdminRoleIds || [];
  if (!member || !member.roles || !member.roles.cache) return false;
  return adminRoleIds.some(roleId => member.roles.cache.has(roleId));
}

module.exports = {
  // Generic + alias
  notifyLadderAdminsGeneric,
  notifyLadderAdmins,

  // Purpose-specific helpers
  notifyLadderAdminsNewGame,
  notifyLadderAdminsDisputeOpened,
  notifyLadderAdminsDisputeResolved,

  // Admin check
  isAdmin,
};
