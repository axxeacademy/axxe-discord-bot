// commands/admin/globalstats.js
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { isAdmin } = require('../../utils/notifyAdmins');
const matchService = require('../../services/matchService');
const ladderChannelMapping = require('../../utils/ladderChannelMapping');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('globalstats')
    .setDescription('Fetch global ladder statistics (admin only)'),
  async execute(interaction) {
    // Check if user is admin
    if (!isAdmin(interaction.member)) {
      return interaction.reply({ content: 'You do not have permission to use this command.', flags: MessageFlags.Ephemeral });
    }

    // Determine ladder from channel, if applicable
    const ladderId = await ladderChannelMapping.getLadderIdByChannel(interaction.channelId);
    if (!ladderId) {
      return interaction.reply({ content: 'This channel is not mapped to a ladder.', flags: MessageFlags.Ephemeral });
    }

    // Fetch stats from matchService
    try {
      const stats = await matchService.getLadderStats(ladderId);
      if (!stats) {
        return interaction.reply({ content: 'No stats found for this ladder.', flags: MessageFlags.Ephemeral });
      }

      // Fetch ladder name
      const [[ladderRow]] = await require("../../utils/db").execute(
        "SELECT name FROM ladders WHERE id = ?",
        [ladderId]
      );
      const ladderName = ladderRow ? ladderRow.name : "Ladder";

      // Fetch usernames for most active and top players
      const getUsername = async (playerId) => {
        if (!playerId) return "N/A";
        const [rows] = await require("../../utils/db").execute(
          "SELECT username FROM users WHERE id = ?",
          [playerId]
        );
        return rows[0]?.username || "N/A";
      };

      let mostActivePlayerName = "N/A";
      if (stats.mostActivePlayer && stats.mostActivePlayer.player_id) {
        mostActivePlayerName = await getUsername(stats.mostActivePlayer.player_id);
      }

      let topPlayersList = "";
      if (stats.topPlayers && stats.topPlayers.length > 0) {
        for (const p of stats.topPlayers) {
          const name = await getUsername(p.player_id);
          topPlayersList += `- ${name} (${p.wins} wins)\n`;
        }
      }

      // Format stats for display
      const statsMessage = `## 📊 Estatísticas Globais da ${ladderName}

Matches Played: ${stats.matchesPlayed}
Unique Players: ${stats.players}
Penalty Shootouts: ${stats.penaltyShootouts}
Average Goals per Match: ${stats.avgGoals}
Biggest Win Margin: ${stats.maxWinMargin}
Recent Matches (7d): ${stats.recentMatches}
Average Matches per Player: ${stats.avgMatchesPerPlayer}

Most Active Player: ${mostActivePlayerName} (${stats.mostActivePlayer?.games_played || 0} games)
Top 3 Players by Wins:
${topPlayersList || "N/A"}
`;

      return interaction.reply({ content: statsMessage });
    } catch (err) {
      console.error('Error fetching ladder stats:', err);
      return interaction.reply({ content: 'Failed to fetch ladder stats.', flags: MessageFlags.Ephemeral });
    }
  },
};
