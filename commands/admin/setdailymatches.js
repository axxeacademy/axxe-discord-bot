const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('../../utils/db');
const { getLadderIdByChannel } = require('../../utils/ladderChannelMapping');
const languageService = require('../../services/languageService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setdailymatches')
    .setDescription('Define o limite diário de jogos entre dois jogadores para uma ladder.')
    .addStringOption(option =>
      option.setName('ladder_slug')
        .setDescription('Slug da ladder (ex: testeoriginal)')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('limit')
        .setDescription('Novo limite diário de jogos entre dois jogadores')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Check admin permissions (redundant, but extra safety)
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.editReply({
        content: '❌ Apenas administradores podem usar este comando.'
      });
    }

    const ladderSlug = interaction.options.getString('ladder_slug', true);
    const limit = interaction.options.getInteger('limit', true);

    if (limit < 1) {
      return interaction.editReply({
        content: '❌ O limite deve ser um número inteiro positivo.'
      });
    }

    // Find ladder by slug
    const [ladderRows] = await db.execute(
      'SELECT id, name FROM ladders WHERE slug = ?',
      [ladderSlug]
    );
    if (ladderRows.length === 0) {
      return interaction.editReply({
        content: `❌ Ladder com slug "${ladderSlug}" não encontrada.`
      });
    }
    const ladderId = ladderRows[0].id;
    const ladderName = ladderRows[0].name;

    // Check if this channel is mapped to the ladder
    const channelId = interaction.channel.id;
    const [channelRows] = await db.execute(
      'SELECT * FROM discord_channel_ladders WHERE ladder_id = ? AND channel_id = ?',
      [ladderId, channelId]
    );
    if (channelRows.length === 0) {
      return interaction.editReply({
        content: `❌ Este comando só pode ser usado no canal Discord associado à ladder **${ladderName}** (${ladderSlug}).`
      });
    }

    // Update the limit
    await db.execute(
      'UPDATE ladders SET max_matches_per_opponent = ? WHERE id = ?',
      [limit, ladderId]
    );

    return interaction.editReply({
      content: `✅ O limite diário de jogos entre dois jogadores para a ladder **${ladderName}** (${ladderSlug}) foi definido para **${limit}**.`
    });
  }
};
