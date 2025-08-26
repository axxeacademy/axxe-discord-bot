require('dotenv').config();

const commandIcons = {
  findmatch: '🎯',
  cancelqueue: '🚫',
  confirmmatch: '✅',
  reportmatch: '📝',
  mystats: '📊',
  status: '⏱️',
  ladder: '🏆',
  default: '🛠️'
};

async function logCommand(interaction, message, extra = {}) {
  try {
    let channel = interaction.client.channels.cache.get(process.env.LOG_CHANNEL_ID);
    if (!channel) {
      channel = await interaction.client.channels.fetch(process.env.LOG_CHANNEL_ID);
    }

    if (!channel) return;

    const cmd = interaction.commandName;
    const icon = commandIcons[cmd] || commandIcons.default;
    // Use gamertag if provided in extra, else fallback to discord username tag
    const userTag = extra.gamertag ? extra.gamertag : interaction.user.tag;
    const user = `<@${interaction.user.id}> (${userTag})`;
    const time = new Date().toLocaleString('pt-PT');

    let log = `${icon} **[/${cmd}]** used by ${user} at ${time}\n${message}`;

    // Append thread link if provided, show as clickable link with thread name if available
    if (extra.threadId && interaction.channel?.threads) {
      const threadLink = `https://discord.com/channels/${interaction.guildId}/${extra.threadId}`;
      const threadName = extra.threadName ? extra.threadName : 'Thread';
      log += `\nThread: [${threadName}](${threadLink})`;
    }

    // Append match info if provided
    if (extra.matchInfo) {
      const { player1: p1, player2: p2, threadId } = extra.matchInfo;
      const threadLink = `https://discord.com/channels/${interaction.guildId}/${threadId}`;
      if (p1 && p2) {
        // Format Discord mentions if discordUserId is available, else fallback to username string
        const player1Mention = p1.discordUserId ? `<@${p1.discordUserId}>` : p1.discordUsername;
        const player2Mention = p2.discordUserId ? `<@${p2.discordUserId}>` : p2.discordUsername;
        log += `\nMatch: ${player1Mention} (${p1.gamertag}) vs (${p2.gamertag}) ${player2Mention} `;
      }
      // Append thread link here as well to ensure it appears once
      log += `\nThread: [${extra.threadName || 'Thread'}](${threadLink})`;
    }

    // Append match result info if provided
    if (extra.matchResult) {
      const { result, eloGain, currentElo } = extra.matchResult;
      const { player1: p1, player2: p2 } = extra.matchInfo || {};
      log += `\nResult: ${result}`;
      if (eloGain && (eloGain.player1 !== undefined && eloGain.player1 !== null) && (eloGain.player2 !== undefined && eloGain.player2 !== null)) {
        log += `\nELO Gain: **${p1?.gamertag || 'Player1'}** ${eloGain.player1 >= 0 ? '+' : ''}${eloGain.player1} | **${p2?.gamertag || 'Player2'}** ${eloGain.player2 >= 0 ? '+' : ''}${eloGain.player2}`;
      }
      if (currentElo && (currentElo.player1 !== undefined && currentElo.player1 !== null) && (currentElo.player2 !== undefined && currentElo.player2 !== null)) {
        log += `\nCurrent ELO: **${p1?.gamertag || 'Player1'}:** ${currentElo.player1} | **${p2?.gamertag || 'Player2'}:** ${currentElo.player2}`;
      }
    }

    log += `\n——————————————`;

    await channel.send(log);
  } catch (err) {
    console.error('❌ Logging failed:', err);
  }
}

module.exports = { logCommand };
