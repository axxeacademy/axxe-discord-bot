// commands/admin/tournament.js
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const tournamentService = require('../../services/tournamentService');
const { getLadderIdByChannel } = require('../../utils/ladderChannelMapping');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('tournament')
        .setDescription('Gerir torneios e competições')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub =>
            sub
                .setName('create')
                .setDescription('Criar uma nova competição')
                .addStringOption(option => option.setName('name').setDescription('Nome do torneio').setRequired(true))
                .addStringOption(option => option.setName('slug').setDescription('Slug único (ex: cup-2025)').setRequired(true))
                .addStringOption(option =>
                    option.setName('format')
                        .setDescription('Formato')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Double Elimination', value: 'double_elimination' },
                            { name: 'Single Elimination', value: 'single_elimination' }
                        )
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('register')
                .setDescription('Registar um jogador num torneio')
                .addIntegerOption(option => option.setName('competition_id').setDescription('ID da competição').setRequired(true))
                .addUserOption(option => option.setName('user').setDescription('O utilizador a registar').setRequired(true))
        )
        .addSubcommand(sub =>
            sub
                .setName('start')
                .setDescription('Iniciar o torneio (Gera a Bracket)')
                .addIntegerOption(option => option.setName('competition_id').setDescription('ID da competição').setRequired(true))
        )
        .addSubcommand(sub =>
            sub
                .setName('status')
                .setDescription('Ver estado do torneio')
                .addIntegerOption(option => option.setName('competition_id').setDescription('ID da competição').setRequired(true))
        ),

    async execute(interaction) {
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        }

        const subcommand = interaction.options.getSubcommand();

        try {
            if (subcommand === 'create') {
                const name = interaction.options.getString('name');
                const slug = interaction.options.getString('slug');
                const format = interaction.options.getString('format');

                const id = await tournamentService.createCompetition(name, slug, 'tournament', format, { created_by: interaction.user.id });

                return interaction.editReply(`✅ Competição "${name}" criada com ID: **${id}**`);

            } else if (subcommand === 'register') {
                const compId = interaction.options.getInteger('competition_id');
                const user = interaction.options.getUser('user');

                // Need to ensure user exists in our DB 'users' table first? 
                const db = require('../../utils/db');
                const [rows] = await db.execute('SELECT id FROM users WHERE discord_id = ?', [user.id]);

                if (!rows.length) {
                    // Create if missing (lazy reg)
                    await db.execute('INSERT INTO users (discord_id, username) VALUES (?, ?)', [user.id, user.username]);
                }
                const [rows2] = await db.execute('SELECT id FROM users WHERE discord_id = ?', [user.id]);
                const dbUserId = rows2[0].id;

                await tournamentService.registerParticipant(compId, dbUserId);
                return interaction.editReply(`✅ ${user.username} registado na competição #${compId}.`);

            } else if (subcommand === 'start') {
                const compId = interaction.options.getInteger('competition_id');
                // Pass interaction.channel so the service can create threads here!
                await tournamentService.startCompetition(compId, interaction.channel);
                return interaction.editReply(`🚀 Torneio #${compId} iniciado! A bracket foi gerada.`);
            }

        } catch (error) {
            console.error('Tournament command error:', error);
            return interaction.editReply(`❌ Erro: ${error.message}`);
        }
    }
};
