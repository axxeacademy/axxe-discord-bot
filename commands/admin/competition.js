// commands/admin/competition.js
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const tournamentService = require('../../services/tournamentService');
const { execute } = require('../../utils/db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('competition')
        .setDescription('Gerir torneios e competições')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub =>
            sub
                .setName('create')
                .setDescription('Criar uma nova competição')
                .addStringOption(option => option.setName('name').setDescription('Nome da competição').setRequired(true))
                .addStringOption(option => option.setName('slug').setDescription('Slug único (ex: cup-2025)').setRequired(true))
                .addStringOption(option =>
                    option.setName('type')
                        .setDescription('Tipo de competição')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
                .addStringOption(option =>
                    option.setName('format')
                        .setDescription('Formato da competição')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
                .addStringOption(option => option.setName('edition').setDescription('Edição (ex: #03)').setRequired(false))
                .addStringOption(option =>
                    option.setName('season')
                        .setDescription('Temporada (ex: 24/25)')
                        .setRequired(false)
                        .setAutocomplete(true)
                )
                .addStringOption(option => option.setName('start_date').setDescription('Data de início (YYYY-MM-DD)').setRequired(false))
                .addStringOption(option => option.setName('start_time').setDescription('Hora de início (HH:MM)').setRequired(false))
        )
        .addSubcommand(sub =>
            sub
                .setName('register')
                .setDescription('Registar um jogador num torneio')
                .addIntegerOption(option =>
                    option.setName('competition_id')
                        .setDescription('ID da competição')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
                .addUserOption(option => option.setName('user').setDescription('O utilizador a registar').setRequired(true))
        )
        .addSubcommand(sub =>
            sub
                .setName('start')
                .setDescription('Iniciar o torneio (Gera a Bracket)')
                .addIntegerOption(option =>
                    option.setName('competition_id')
                        .setDescription('ID da competição')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('status')
                .setDescription('Ver estado do torneio')
                .addIntegerOption(option =>
                    option.setName('competition_id')
                        .setDescription('ID da competição')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('bracket')
                .setDescription('Gerar seeding para a competição')
                .addIntegerOption(option =>
                    option.setName('competition_id')
                        .setDescription('ID da competição')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
                .addStringOption(option =>
                    option.setName('seeding_type')
                        .setDescription('Tipo de seeding')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
                .addIntegerOption(option =>
                    option.setName('ladder_id')
                        .setDescription('ID da ladder (obrigatório para seeding por ladder)')
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('script')
                .setDescription('Executar um script de torneio (Battlefy Replicator)')
                .addIntegerOption(option => option.setName('id').setDescription('ID do Script').setRequired(true))
                .addIntegerOption(option => option.setName('competition_id').setDescription('ID da competição (Opcional - para re-executar)').setRequired(false))
        ),

    async autocomplete(interaction) {
        const focusedOption = interaction.options.getFocused(true);
        let choices = [];

        if (focusedOption.name === 'type') {
            choices = [
                { name: 'Ladder', value: 'ladder' },
                { name: 'Tournament', value: 'tournament' },
                { name: 'League', value: 'league' }
            ];
        } else if (focusedOption.name === 'format') {
            choices = [
                { name: 'Double Elimination', value: 'double_elimination' },
                { name: 'Single Elimination', value: 'single_elimination' },
                { name: 'Swiss', value: 'swiss' },
                { name: 'Round Robin', value: 'round_robin' }
            ];
        } else if (focusedOption.name === 'season') {
            const [rows] = await execute('SELECT id, name, slug FROM seasons ORDER BY created_at DESC LIMIT 10');
            choices = rows.map(r => ({ name: r.name || r.slug, value: String(r.id) }));
        } else if (focusedOption.name === 'competition_id') {
            // Show last 5 competitions that are NOT active or completed
            const [rows] = await execute(
                `SELECT id, name, status, edition 
                 FROM competitions 
                 WHERE status NOT IN ('active', 'completed', 'archived') 
                 ORDER BY created_at DESC 
                 LIMIT 5`
            );
            choices = rows.map(r => ({
                name: `#${r.id} - ${r.name}${r.edition ? ` (${r.edition})` : ''} [${r.status}]`,
                value: r.id
            }));
        } else if (focusedOption.name === 'seeding_type') {
            choices = [
                { name: 'Por Data de Registo', value: 'registration' },
                { name: 'Por Classificação da Ladder', value: 'ladder' },
                { name: 'Aleatório', value: 'random' }
            ];
        }

        const filtered = choices.filter(choice =>
            choice.name.toLowerCase().includes(focusedOption.value.toLowerCase())
        );
        await interaction.respond(filtered.slice(0, 25));
    },

    async execute(interaction) {
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        }

        const subcommand = interaction.options.getSubcommand();

        try {
            if (subcommand === 'create') {
                const name = interaction.options.getString('name');
                const slug = interaction.options.getString('slug');
                const type = interaction.options.getString('type');
                const format = interaction.options.getString('format');
                const edition = interaction.options.getString('edition') || null;
                const seasonIdString = interaction.options.getString('season');
                const startDate = interaction.options.getString('start_date') || null;
                const startTime = interaction.options.getString('start_time') || null;

                const seasonId = seasonIdString ? parseInt(seasonIdString) : null;

                // Call createCompetition with the new parameters
                const id = await tournamentService.createCompetition(
                    name,
                    slug,
                    type,
                    format,
                    { created_by: interaction.user.id },
                    edition,
                    startDate,
                    startTime
                );

                // If seasonId was provided specifically, we need to update it because createCompetition defaults to active one
                if (seasonId) {
                    await execute('UPDATE competitions SET season_id = ? WHERE id = ?', [seasonId, id]);
                }

                return interaction.editReply(`✅ Competição "${name}" criada com ID: **${id}**${edition ? ` (Edição ${edition})` : ''}${startDate ? ` agendada para ${startDate}` : ''}`);

            } else if (subcommand === 'register') {
                const compId = interaction.options.getInteger('competition_id');
                const user = interaction.options.getUser('user');

                const [rows] = await execute('SELECT id FROM users WHERE discord_id = ?', [user.id]);
                if (!rows.length) {
                    await execute('INSERT INTO users (discord_id, username) VALUES (?, ?)', [user.id, user.username]);
                }
                const [rows2] = await execute('SELECT id FROM users WHERE discord_id = ?', [user.id]);
                const dbUserId = rows2[0].id;

                await tournamentService.registerParticipant(compId, dbUserId);
                return interaction.editReply(`✅ ${user.username} registado na competição #${compId}.`);

            } else if (subcommand === 'start') {
                const compId = interaction.options.getInteger('competition_id');
                await tournamentService.startCompetition(compId, interaction.channel);
                return interaction.editReply(`🚀 Competição #${compId} iniciada! A bracket foi gerada.`);

            } else if (subcommand === 'status') {
                const compId = interaction.options.getInteger('competition_id');
                const [compRows] = await execute('SELECT * FROM competitions WHERE id = ?', [compId]);
                if (!compRows.length) return interaction.editReply('❌ Competição não encontrada.');
                const comp = compRows[0];

                const [matches] = await execute(
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

                let statusMsg = `**🏆 ${comp.name}** (Estado: ${comp.status})\n\n`;
                const rounds = {};
                matches.forEach(m => {
                    let rName = m.round_slug ? (m.bracket_side === 'grand_final' ? 'Grand Final' : `Round ${m.round_slug}`) : `Round ${m.round} (${m.bracket_side})`;
                    if (!rounds[rName]) rounds[rName] = [];
                    rounds[rName].push(m);
                });

                for (const [rName, ms] of Object.entries(rounds)) {
                    statusMsg += `__${rName}__\n`;
                    ms.forEach(m => {
                        const p1 = m.p1name || 'BYE';
                        const p2 = m.p2name || 'BYE';
                        const score = (m.status === 'completed' || m.status === 'pending_confirmation') ? `**${m.player1_score} - ${m.player2_score}**` : 'vs';
                        let icon = m.status === 'completed' ? '✅' : (m.status === 'pending_confirmation' ? '⏳' : '📅');
                        statusMsg += `\`#${m.id}\` ${icon} ${p1} ${score} ${p2}\n`;
                    });
                    statusMsg += '\n';
                }
                if (statusMsg.length > 2000) statusMsg = statusMsg.substring(0, 1990) + '...';
                return interaction.editReply(statusMsg);

            } else if (subcommand === 'bracket') {
                const compId = interaction.options.getInteger('competition_id');
                const seedingType = interaction.options.getString('seeding_type');
                const ladderId = interaction.options.getInteger('ladder_id');

                // Validate ladder_id if seeding_type is 'ladder'
                if (seedingType === 'ladder' && !ladderId) {
                    return interaction.editReply('❌ O ID da ladder é obrigatório para seeding por classificação.');
                }

                try {
                    const result = await tournamentService.generateSeeding(compId, seedingType, ladderId);

                    // Fetch seeded participants to show the result
                    const [participants] = await execute(
                        `SELECT tp.seed, u.gamertag, u.username 
                         FROM tournament_participants tp
                         JOIN users u ON tp.user_id = u.id
                         WHERE tp.competition_id = ?
                         ORDER BY tp.seed ASC`,
                        [compId]
                    );

                    let seedingTypeLabel = '';
                    switch (seedingType) {
                        case 'registration': seedingTypeLabel = 'Data de Registo'; break;
                        case 'ladder': seedingTypeLabel = 'Classificação da Ladder'; break;
                        case 'random': seedingTypeLabel = 'Aleatório'; break;
                    }

                    let message = `✅ Seeding gerado com sucesso!\n\n**Tipo**: ${seedingTypeLabel}\n**Participantes**: ${result.participantCount}\n\n**Seeds:**\n`;

                    participants.forEach(p => {
                        const name = p.gamertag || p.username;
                        message += `${p.seed}. ${name}\n`;
                    });

                    if (message.length > 2000) {
                        message = message.substring(0, 1990) + '...';
                    }

                    return interaction.editReply(message);
                } catch (error) {
                    return interaction.editReply(`❌ Erro ao gerar seeding: ${error.message}`);
                }

            } else if (subcommand === 'script') {
                const scriptId = interaction.options.getInteger('id');
                const existingCompId = interaction.options.getInteger('competition_id');

                const [rows] = await execute('SELECT * FROM tournament_scripts WHERE id = ?', [scriptId]);
                if (!rows.length) return interaction.editReply('❌ Script não encontrado.');
                const script = rows[0];

                const participants = script.participants;
                const participantList = (typeof participants === 'string') ? JSON.parse(participants) : participants;
                const channelId = script.channel_id;
                const edition = script.edition;

                let compId = existingCompId;
                if (!compId) {
                    const name = `Battlefy Rep #${scriptId}`;
                    const slug = `battlefy-${scriptId}-${Date.now()}`;
                    compId = await tournamentService.createCompetition(
                        name,
                        slug,
                        'tournament',
                        'double_elimination',
                        { created_by: interaction.user.id, script_id: scriptId },
                        edition
                    );
                }

                await interaction.editReply(`ℹ️ Competição #**${compId}** em curso. A registar ${participantList.length} participantes...`);

                let currentSeed = 1;
                for (let pName of participantList) {
                    const seed = currentSeed++;
                    if (!pName || pName === 'BYE') continue;

                    let userId;
                    const [uRows] = await execute('SELECT id FROM users WHERE username = ?', [pName]);
                    if (uRows.length) {
                        userId = uRows[0].id;
                    } else {
                        const fakeDid = `dummy-${Date.now()}-${Math.random()}`;
                        const [ins] = await execute('INSERT INTO users (discord_id, username, is_in_server) VALUES (?, ?, 0)', [fakeDid, pName]);
                        userId = ins.insertId;
                    }

                    try {
                        await tournamentService.registerParticipant(compId, userId, seed);
                    } catch (e) {
                        console.error(`Failed to register ${pName}:`, e.message);
                    }
                }

                // Count registered participants
                const [countResult] = await execute(
                    'SELECT COUNT(*) as count FROM tournament_participants WHERE competition_id = ?',
                    [compId]
                );
                const registeredCount = countResult[0].count;

                return interaction.editReply(
                    `✅ Script #${scriptId} executado!\n\n` +
                    `**Competição**: #${compId}\n` +
                    `**Participantes registados**: ${registeredCount}\n\n` +
                    `Use \`/competition bracket\` para gerar o seeding e depois \`/competition start\` para iniciar.`
                );
            }

        } catch (error) {
            console.error('Competition command error:', error);
            return interaction.editReply(`❌ Erro: ${error.message}`);
        }
    }
};
