// services/matchMessages.js
const { EmbedBuilder } = require('discord.js');

function scoreLineFor(p1Score, p2Score, pen1 = null, pen2 = null) {
  const base = `${p1Score} - ${p2Score}`;
  if (pen1 == null || pen2 == null) return base;
  return `${p1Score} (${pen1}) - (${pen2}) ${p2Score}`;
}

// Simple delta formatter like "+12" / "-8", with optional checkpoint flair
function formatDelta(n, checkpoint = false) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0';
  const s = n > 0 ? `+${n}` : `${n}`;
  return checkpoint ? `${s} ⭐` : s;
}

/**
 * Build a unified match state embed.
 *
 * @param {Object} p
 * @param {'reported'|'disputed'|'confirmed'} p.state
 * @param {number} p.matchId
 * @param {Object} p.p1  { gamertag, mention, icon? }
 * @param {Object} p.p2  { gamertag, mention, icon? }
 * @param {Object} [p.scores] { s1, s2, pen1, pen2 }
 * @param {string} [p.scoreLineOverride]  If provided, used as description instead of scores
 * @param {Object} [p.elo] for confirmed:
 *    {
 *      p1Delta, p2Delta, p1Pre, p1New, p2Pre, p2New,
 *      p1Checkpoint?, p2Checkpoint?, isDraw?, footerText?
 *      // OR pass p1DeltaText/p2DeltaText if already formatted
 *      p1DeltaText?, p2DeltaText?
 *    }
 */
function buildMatchEmbed(p) {
  const { state, matchId, p1, p2, scores = {}, scoreLineOverride, elo } = p;

  const title =
    state === 'confirmed' ? `🆚 Jogo #${matchId} Confirmado` :
    state === 'reported'  ? `📝 Jogo #${matchId} Reportado`  :
                            `⚠️ Jogo #${matchId} em Disputa`;

  const color =
    state === 'confirmed'
      ? (elo?.isDraw ? 0x99AAB5 : 0x57F287)
      : state === 'reported'
        ? 0xFEE75C
        : 0xED4245;

  const desc = scoreLineOverride ?? scoreLineFor(scores.s1, scores.s2, scores.pen1, scores.pen2);

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(desc)
    .setTimestamp()
    .setColor(color);

  if (state === 'confirmed' && elo) {
    const p1DeltaText = elo.p1DeltaText ?? formatDelta(elo.p1Delta, !!elo.p1Checkpoint);
    const p2DeltaText = elo.p2DeltaText ?? formatDelta(elo.p2Delta, !!elo.p2Checkpoint);

    embed.addFields(
      {
        name: p1.gamertag,
        value:
          `${p1.icon ? `${p1.icon} ` : ''}${p1.mention}\n` +
          `Elo: **${p1DeltaText}**\n` +
          `Elo: ${elo.p1Pre} → **${elo.p1New}**`,
        inline: true
      },
      {
        name: p2.gamertag,
        value:
          `${p2.icon ? `${p2.icon} ` : ''}${p2.mention}\n` +
          `Elo: **${p2DeltaText}**\n` +
          `Elo: ${elo.p2Pre} → **${elo.p2New}**`,
        inline: true
      }
    );

    if (elo.footerText) embed.setFooter({ text: elo.footerText });
  } else {
    // Non-confirmed — same structure but neutral Elo
    embed.addFields(
      {
        name: p1.gamertag,
        value: `${p1.icon ? `${p1.icon} ` : ''}${p1.mention}\nΔ Elo: *a aguardar confirmação*`,
        inline: true
      },
      {
        name: p2.gamertag,
        value: `${p2.icon ? `${p2.icon} ` : ''}${p2.mention}\nΔ Elo: *a aguardar confirmação*`,
        inline: true
      }
    );
    // Optional footer (e.g., "Reportado por X", "Disputa aberta por Y")
    if (elo?.footerText) embed.setFooter({ text: elo.footerText });
  }

  return embed;
}

module.exports = { buildMatchEmbed, scoreLineFor, formatDelta };
