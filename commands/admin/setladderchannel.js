// commands/admin/setladderchannel.js
const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const db = require('../../utils/db'); // <- pooled connection from utils/db.js


module.exports = {
  data: new SlashCommandBuilder()
    .setName('setladderchannel')
    .setDescription('Associar o canal Discord atual a uma ladder pelo slug da ladder')
    .addStringOption(option =>
      option.setName('ladder_slug')
        .setDescription('O slug único da ladder para associar a este canal')
        .setRequired(true)
        .setAutocomplete(true)
    ),

  async execute(interaction) {
    // Handle autocomplete first
if (interaction.isAutocomplete()) {
  const focusedValue = interaction.options.getFocused() || '';
  console.log(`[DEBUG] Autocomplete triggered for ladder_slug. Focused value: "${focusedValue}"`);
  try {
    const [rows] = await db.execute(
      // safe LIKE search; lets MySQL use the index on slug when possible
      'SELECT slug, name FROM ladders WHERE slug LIKE CONCAT("%", ?, "%") LIMIT 25',
      [focusedValue]
    );
    console.log(`[DEBUG] Autocomplete DB returned ${rows.length} ladders:`, rows.map(r => r.slug));
    // Show both slug and name for clarity in the dropdown
    return interaction.respond(rows.map(r => ({
      name: `${r.slug} (${r.name})`,
      value: r.slug
    })));
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

    const ladderSlug = interaction.options.getString('ladder_slug', true);
    const channelId = interaction.channel?.id;

    if (!channelId) {
      return interaction.reply({
        content: '❌ Não foi possível identificar este canal.',
        flags: MessageFlags.Ephemeral
      });
    }

    try {
      await interaction.deferReply();

      // Find ladder_id by ladder slug
      const [ladderRows] = await db.execute(
        'SELECT id, name FROM ladders WHERE slug = ? LIMIT 1',
        [ladderSlug]
      );

      if (ladderRows.length === 0) {
        return interaction.editReply({
          content: `❌ Ladder com o slug "${ladderSlug}" não encontrada.`
        });
      }

      const ladderId = ladderRows[0].id;
      const ladderName = ladderRows[0].name;

      // Insert or update the mapping (table: discord_channel_ladders)
      await db.execute(
        `INSERT INTO discord_channel_ladders (channel_id, ladder_id)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE ladder_id = VALUES(ladder_id)`,
        [channelId, ladderId]
      );

      return interaction.editReply({
        content: `✅ Canal <#${channelId}> foi associado à ladder "${ladderName}" (slug: ${ladderSlug}, ID: ${ladderId}).`
      });
    } catch (err) {
      console.error('❌ Erro ao associar o canal à ladder:', err);
      const msg = err?.code ? `❌ Falha: ${err.code}` : '❌ Falha ao associar o canal à ladder.';
      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({ content: msg, flags: MessageFlags.Ephemeral });
      }
      return interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  }
};
