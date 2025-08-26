// commands/user/ladder-setGamerTag.js
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const db = require('../../utils/db');
const languageService = require('../../services/languageService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ladder-setgamertag')
    .setDescription('Defina o seu gamertag para poder entrar nas filas.')
    .addStringOption(option =>
      option
        .setName('gamertag')
        .setDescription('O seu gamertag')
        .setRequired(true)
    ),

  async execute(interaction) {
    const discordId = interaction.user.id;
    const rawGamertag = interaction.options.getString('gamertag');
    const gamertag = (rawGamertag || '').trim();

    // Defer to avoid token expiry if DB is slow
    try { await interaction.deferReply({ flags: MessageFlags.Ephemeral }); } catch {}

    if (!gamertag) {
      return interaction.editReply({
        content: languageService.getMessage('pt-PT', 'must_set_gamertag'),
      });
    }

    try {
      // Ensure the user exists first
      const [[userRow]] = await db.execute(
        'SELECT id, language FROM users WHERE discord_id = ? LIMIT 1',
        [discordId]
      );

      if (!userRow) {
        return interaction.editReply({
          content: languageService.getMessage('pt-PT', 'not_registered'),
        });
      }

      await db.execute(
        'UPDATE users SET gamertag = ? WHERE discord_id = ?',
        [gamertag, discordId]
      );

      // Optionally, you could validate length or characters here if needed:
      // if (gamertag.length > 50) { ... }

      return interaction.editReply({
        content: '✅ Gamertag definido com sucesso.',
      });
    } catch (error) {
      console.error('❌ DB Error in /ladder-setGamerTag:', error);
      try {
        return interaction.editReply({
          content: '❌ Erro ao definir o gamertag.',
        });
      } catch {}
    }
  }
};
