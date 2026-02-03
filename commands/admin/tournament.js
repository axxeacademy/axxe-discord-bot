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
                .addStringOption(option => option.setName('edition').setDescription('Edição (ex: #03)').setRequired(false))
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
                const edition = interaction.options.getString('edition') || null;

                const id = await tournamentService.createCompetition(name, slug, 'tournament', format, { created_by: interaction.user.id }, edition);

                return interaction.editReply(`✅ Competição "${name}" criada com ID: **${id}**${edition ? ` (Edição ${edition})` : ''}`);

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

            } else if (subcommand === 'status') {
                const compId = interaction.options.getInteger('competition_id');

                // Fetch basic info
                const [compRows] = await require('../../utils/db').execute('SELECT * FROM competitions WHERE id = ?', [compId]);
                if (!compRows.length) return interaction.editReply('❌ Competição não encontrada.');
                const comp = compRows[0];

                // Fetch matches
                const [matches] = await require('../../utils/db').execute(
                    `SELECT tm.*, 
                            COALESCE(u1.gamertag, u1.username) as p1name, 
                            COALESCE(u2.gamertag, u2.username) as p2name 
                     FROM tournament_matches tm
                     LEFT JOIN users u1 ON tm.player1_id = u1.id
                     LEFT JOIN users u2 ON tm.player2_id = u2.id
                     WHERE tm.competition_id = ? 
                     ORDER BY tm.round ASC, tm.id ASC`,
                    [compId]
                );

                if (!matches.length) return interaction.editReply(`ℹ️ A competição está em estado: **${comp.status}**, mas não há jogos gerados.`);

                // Build Summary
                let statusMsg = `**🏆 ${comp.name}** (Estado: ${comp.status})\n\n`;

                // Group by rounds
                const rounds = {};
                matches.forEach(m => {
                    let rName = '';
                    if (m.round_slug) {
                        rName = (m.bracket_side === 'grand_final') ? 'Grand Final' : `Round ${m.round_slug}`;
                    } else {
                        // Fallback
                        rName = (m.bracket_side === 'grand_final') ? 'Grand Final' : `Round ${m.round} (${m.bracket_side === 'losers' ? 'Losers' : 'Winners'})`;
                    }

                    if (!rounds[rName]) rounds[rName] = [];
                    rounds[rName].push(m);
                });

                for (const [rName, ms] of Object.entries(rounds)) {
                    statusMsg += `__${rName}__\n`;
                    ms.forEach(m => {
                        const p1 = m.p1name || 'BYE'; // Map null to BYE if status implies? Or just null.
                        const p2 = m.p2name || 'BYE';
                        const score = (m.status === 'completed' || m.status === 'pending_confirmation')
                            ? `**${m.player1_score} - ${m.player2_score}**`
                            : 'vs';

                        let icon = '📅';
                        if (m.status === 'completed') icon = '✅';
                        else if (m.status === 'pending_confirmation') icon = '⏳';
                        else if (m.status === 'scheduled') icon = '📅';

                        statusMsg += `\`#${m.id}\` ${icon} ${p1} ${score} ${p2}\n`;
                    });
                    statusMsg += '\n';
                }

                if (statusMsg.length > 2000) statusMsg = statusMsg.substring(0, 1990) + '...';

                return interaction.editReply(statusMsg);
            }

        } catch (error) {
            console.error('Tournament command error:', error);
            return interaction.editReply(`❌ Erro: ${error.message}`);
        }
    }
};
