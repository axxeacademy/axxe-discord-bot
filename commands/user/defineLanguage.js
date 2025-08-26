// commands/user/definelanguage.js
const { SlashCommandBuilder } = require('discord.js');
const db = require('../../utils/db'); // pooled mysql2/promise

module.exports = {
  data: new SlashCommandBuilder()
    .setName('definelanguage')
    .setDescription('Define a língua para as mensagens do bot')
    .addStringOption((option) =>
      option
        .setName('language')
        .setDescription('Escolha a língua')
        .setRequired(true)
        .addChoices(
          { name: 'Português', value: 'pt-PT' },
          { name: 'English', value: 'en-EN' },
          { name: 'Español', value: 'es-ES' },
          { name: 'Français', value: 'fr-FR' },
          { name: 'Deutsch', value: 'de-DE' }
        )
    ),

  async execute(interaction) {
    const language = interaction.options.getString('language', true);
    const userId = interaction.user.id;

    try {
      await interaction.deferReply({ ephemeral: true });

      const [res] = await db.execute(
        'UPDATE users SET language = ? WHERE discord_id = ?',
        [language, userId]
      );

      if (res.affectedRows === 0) {
        return interaction.editReply({
          content: 'Utilizador não encontrado na base de dados.',
        });
      }

      return interaction.editReply({
        content: `Língua definida para: ${language}`,
      });
    } catch (error) {
      console.error('Erro ao definir a língua:', error);
      try {
        return interaction.editReply({
          content: 'Ocorreu um erro ao definir a língua.',
        });
      } catch {}
    }
  },
};
