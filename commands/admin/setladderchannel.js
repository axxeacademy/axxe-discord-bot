// commands/admin/setladderchannel.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../utils/db'); // <- pooled connection from utils/db.js
const { MessageFlags } = require('discord.js'); 


module.exports = {
  data: new SlashCommandBuilder()
    .setName('setladderchannel')
    .setDescription('Associar o canal Discord atual a uma ladder pelo nome da ladder')
    .addStringOption(option =>
      option.setName('ladder_name')
        .setDescription('O nome da ladder para associar a este canal')
        .setRequired(true)
        .setAutocomplete(true)
    ),

  async execute(interaction) {
    // Handle autocomplete first
    if (interaction.isAutocomplete()) {
      const focusedValue = interaction.options.getFocused() || '';
      try {
        const [rows] = await db.execute(
          // safe LIKE search; lets MySQL use the index on name when possible
          'SELECT name FROM ladders WHERE name LIKE CONCAT("%", ?, "%") LIMIT 25',
          [focusedValue]
        );
        return interaction.respond(rows.map(r => ({ name: r.name, value: r.name })));
      } catch (err) {
        console.error('❌ Autocomplete ladders error:', err);
        return interaction.respond([]);
      }
    }

    // Permission check (Discord.js v14)
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({
        content: '❌ Não tem permissão para usar este comando.',
        flags: MessageFlags.Ephemeral
      });
    }

    const ladderName = interaction.options.getString('ladder_name', true);
    const channelId = interaction.channel?.id;

    if (!channelId) {
      return interaction.reply({
        content: '❌ Não foi possível identificar este canal.',
        flags: MessageFlags.Ephemeral
      });
    }

    try {
      await interaction.deferReply({ ephemeral: false });

      // Find ladder_id by ladder name
      const [ladderRows] = await db.execute(
        'SELECT id FROM ladders WHERE name = ? LIMIT 1',
        [ladderName]
      );

      if (ladderRows.length === 0) {
        return interaction.editReply({
          content: `❌ Ladder com o nome "${ladderName}" não encontrada.`
        });
      }

      const ladderId = ladderRows[0].id;

      // Insert or update the mapping (table: discord_channel_ladders)
      await db.execute(
        `INSERT INTO discord_channel_ladders (channel_id, ladder_id)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE ladder_id = VALUES(ladder_id)`,
        [channelId, ladderId]
      );

      return interaction.editReply({
        content: `✅ Canal <#${channelId}> foi associado à ladder "${ladderName}" (ID: ${ladderId}).`
      });
    } catch (err) {
      console.error('❌ Erro ao associar o canal à ladder:', err);
      const msg = err?.code ? `❌ Falha: ${err.code}` : '❌ Falha ao associar o canal à ladder.';
      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({ content: msg });
      }
      return interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  }
};
