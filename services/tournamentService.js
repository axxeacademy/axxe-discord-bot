// services/tournamentService.js
const { execute } = require('../utils/db');
const dayjs = require('dayjs');

// Helper to fetch user details for thread creation
async function getUserDetails(userId) {
    if (!userId) return null;
    const [rows] = await execute('SELECT id, discord_id, gamertag, username FROM users WHERE id = ?', [userId]);
    return rows[0];
}

async function getActiveSeasonId() {
    const [rows] = await execute('SELECT id FROM seasons WHERE is_active = 1 LIMIT 1');
    return rows.length ? rows[0].id : null;
}

/**
 * Create a new competition.
 */
async function createCompetition(name, slug, type, format, settings = {}, edition = null, startDate = null, startTime = null) {
    const settingsJson = JSON.stringify(settings);

    // Auto-detect active season if not provided
    const seasonId = await getActiveSeasonId();

    const [result] = await execute(
        'INSERT INTO competitions (name, slug, type, format, settings, status, edition, season_id, start_date, start_time) VALUES (?, ?, ?, ?, ?, "draft", ?, ?, ?, ?)',
        [name, slug, type, format, settingsJson, edition, seasonId, startDate, startTime]
    );
    return result.insertId;
}

/**
 * Register a user for a competition.
 */
async function registerParticipant(competitionId, userId, seed = null) {
    // Check if competition accepts registrations
    const [comp] = await execute('SELECT * FROM competitions WHERE id = ?', [competitionId]);
    if (!comp.length) throw new Error('Competition not found');
    if (comp[0].status === 'active' || comp[0].status === 'completed') {
        throw new Error('Competition is already active or finished');
    }

    // Check if already registered
    const [existing] = await execute(
        'SELECT * FROM tournament_participants WHERE competition_id = ? AND user_id = ?',
        [competitionId, userId]
    );
    if (existing.length > 0) throw new Error('User already registered');

    // Register
    await execute(
        'INSERT INTO tournament_participants (competition_id, user_id, seed, status) VALUES (?, ?, ?, "active")',
        [competitionId, userId, seed]
    );
}

function getNextPowerOfTwo(n) {
    if (n === 0) return 0;
    let count = 0;
    if (n && !(n & (n - 1))) return n; // Already power of 2
    while (n !== 0) {
        n >>= 1;
        count += 1;
    }
    return 1 << count;
}

/**
 * Start the tournament: Generate Bracket.
 */
async function startCompetition(competitionId, channel) {
    const [compRows] = await execute('SELECT * FROM competitions WHERE id = ?', [competitionId]);
    if (!compRows.length) throw new Error('Competition not found');
    const comp = compRows[0];

    if (comp.status === 'active') throw new Error('Already active');

    // Update status to active IMMEDIATELY to prevent "draft" ghosting
    await execute('UPDATE competitions SET status = "active" WHERE id = ?', [competitionId]);
    console.log(`[Tournament] Competition #${competitionId} set to ACTIVE. Generating bracket...`);

    // Create bracket structure based on format
    if (comp.format === 'double_elimination') {
        await generateDoubleEliminationBracket(competitionId, channel);
    } else {
        throw new Error(`Format ${comp.format} not fully implemented.`);
    }
}

/**
 * Core logic to generate Double Elim tables matches.
 */
async function generateDoubleEliminationBracket(competitionId, channel) {
    // 1. Fetch Participants
    const [dbParticipants] = await execute(
        'SELECT * FROM tournament_participants WHERE competition_id = ? ORDER BY COALESCE(seed, 999), joined_at ASC',
        [competitionId]
    );

    let maxSeedFound = 0;
    dbParticipants.forEach(p => { if (p.seed > maxSeedFound) maxSeedFound = p.seed; });
    const targetSize = getNextPowerOfTwo(Math.max(dbParticipants.length, maxSeedFound));

    let participants = new Array(targetSize).fill(null).map((_, i) => ({ user_id: null, is_bye: true }));

    let unseeded = [];
    dbParticipants.forEach(p => {
        if (p.seed && p.seed <= targetSize) {
            participants[p.seed - 1] = { ...p, is_bye: false };
        } else {
            unseeded.push(p);
        }
    });

    let slotIdx = 0;
    for (const p of unseeded) {
        while (slotIdx < targetSize && !participants[slotIdx].is_bye) {
            slotIdx++;
        }
        if (slotIdx < targetSize) {
            participants[slotIdx] = { ...p, is_bye: false };
        }
    }

    const N = participants.length;
    const numRoundsWB = Math.log2(N);

    let wbMatches = {};
    let lbMatches = {};

    // --- Generate Winners Bracket ---
    let matchCountInRound = N / 2;
    let wbMatchCounter = 1;
    for (let r = 1; r <= numRoundsWB; r++) {
        wbMatches[r] = [];
        for (let i = 0; i < matchCountInRound; i++) {
            const roundSlug = `W${wbMatchCounter++}`;
            const [res] = await execute(
                'INSERT INTO tournament_matches (competition_id, round, bracket_side, round_slug, status) VALUES (?, ?, ?, ?, "scheduled")',
                [competitionId, r, 'winners', roundSlug]
            );
            wbMatches[r].push(res.insertId);
        }
        matchCountInRound /= 2;
    }

    // --- Generate Losers Bracket ---
    const numRoundsLB = 2 * (numRoundsWB - 1);
    if (numRoundsLB > 0) {
        let lbCount = N / 4;
        let lbMatchCounter = 1;

        for (let r = 1; r <= numRoundsLB; r++) {
            lbMatches[r] = [];
            for (let i = 0; i < lbCount; i++) {
                const roundSlug = `L${lbMatchCounter++}`;
                const [res] = await execute(
                    'INSERT INTO tournament_matches (competition_id, round, bracket_side, round_slug, status) VALUES (?, ?, ?, ?, "scheduled")',
                    [competitionId, r, 'losers', roundSlug]
                );
                lbMatches[r].push(res.insertId);
            }
            if (r % 2 === 0) lbCount /= 2;
        }
    }

    // --- Generate Grand Final ---
    const [gf] = await execute(
        'INSERT INTO tournament_matches (competition_id, round, bracket_side, round_slug, status) VALUES (?, ?, ?, ?, "scheduled")',
        [competitionId, numRoundsWB + 1, 'grand_final', 'GF']
    );
    const gfMatchId = gf.insertId;

    // --- LINKING ---
    // WB -> WB
    for (let r = 1; r < numRoundsWB; r++) {
        const currentRound = wbMatches[r];
        const nextRound = wbMatches[r + 1];
        for (let i = 0; i < currentRound.length; i++) {
            const parentId = nextRound[Math.floor(i / 2)];
            const slot = (i % 2) + 1;
            await execute('UPDATE tournament_matches SET next_match_win = ?, next_match_win_slot = ? WHERE id = ?', [parentId, slot, currentRound[i]]);
        }
    }
    // WB Final -> GF
    await execute('UPDATE tournament_matches SET next_match_win = ?, next_match_win_slot = 1 WHERE id = ?', [gfMatchId, wbMatches[numRoundsWB][0]]);

    // LB Final -> GF
    if (numRoundsLB > 0) {
        await execute('UPDATE tournament_matches SET next_match_win = ?, next_match_win_slot = 2 WHERE id = ?', [gfMatchId, lbMatches[numRoundsLB][0]]);
    }

    // WB -> LB (Drop logic)
    if (numRoundsLB > 0) {
        for (let r = 1; r <= numRoundsWB; r++) {
            const wRoundInfo = wbMatches[r];
            let targetLbRoundIdx = (r === 1) ? 1 : (r * 2) - 2;
            const lRoundTarget = lbMatches[targetLbRoundIdx];
            if (!lRoundTarget) continue; // Safety check
            for (let i = 0; i < wRoundInfo.length; i++) {
                let targetMatchId;
                let slot;
                if (r === 1) {
                    targetMatchId = lRoundTarget[Math.floor(i / 2)];
                    slot = (i % 2) + 1;
                } else {
                    targetMatchId = lRoundTarget[i];
                    slot = 2; // WB losers usually go to slot 2 in 1-to-1 rounds
                }
                await execute('UPDATE tournament_matches SET next_match_loss = ?, next_match_loss_slot = ? WHERE id = ?', [targetMatchId, slot, wRoundInfo[i]]);
            }
        }
    }

    // LB -> LB
    if (numRoundsLB > 0) {
        for (let r = 1; r < numRoundsLB; r++) {
            const currentRound = lbMatches[r];
            const nextRound = lbMatches[r + 1];
            for (let i = 0; i < currentRound.length; i++) {
                let parentId;
                let slot;
                if (currentRound.length === nextRound.length) {
                    parentId = nextRound[i];
                    slot = 1; // LB winners go to slot 1 in matches where they meet WB losers
                } else {
                    parentId = nextRound[Math.floor(i / 2)];
                    slot = (i % 2) + 1;
                }
                await execute('UPDATE tournament_matches SET next_match_win = ?, next_match_win_slot = ? WHERE id = ?', [parentId, slot, currentRound[i]]);
            }
        }
    }

    // --- SEEDING ROUND 1 ---
    const round1MatchIds = wbMatches[1];
    for (let i = 0; i < round1MatchIds.length; i++) {
        const p1 = participants[i * 2];
        const p2 = participants[i * 2 + 1];
        const matchId = round1MatchIds[i];

        const p1Id = p1.is_bye ? null : p1.user_id;
        const p2Id = p2.is_bye ? null : p2.user_id;

        await execute(
            'UPDATE tournament_matches SET player1_id = ?, player2_id = ?, p1_ready = 1, p2_ready = 1 WHERE id = ?',
            [p1Id, p2Id, matchId]
        );

        // Auto-advance if BYE present
        if (!p1Id || !p2Id) {
            const winnerId = p1Id || p2Id;
            if (winnerId) {
                // We'll process result but wait for loop to finish for batch effects
                // Actually for initial Round 1, we CAN create threads immediately as requested by "normal BYE logic"
                if (channel) {
                    await checkAndCreateThread(channel, matchId, true);
                    await processTournamentMatchResult(matchId, winnerId, channel);
                }
            } else if (p1.is_bye && p2.is_bye) {
                // Double bye
                await execute('UPDATE tournament_matches SET status = "completed" WHERE id = ?', [matchId]);
                await processTournamentMatchResult(matchId, null, channel);
            }
        } else {
            if (channel) await checkAndCreateThread(channel, matchId);
        }
    }
}

/**
 * Check if all matches in a specific round of a competition are completed.
 */
async function isRoundFinished(competitionId, round, bracketSide) {
    const [rows] = await execute(
        'SELECT COUNT(*) as unfinished FROM tournament_matches WHERE competition_id = ? AND round = ? AND bracket_side = ? AND status != "completed"',
        [competitionId, round, bracketSide]
    );
    return rows[0].unfinished === 0;
}

/**
 * Trigger thread creation for all matches that are now "Ready" (p1_ready and p2_ready) but have no thread.
 */
async function triggerReadyMatches(competitionId, channel) {
    const matchService = require('./matchService');
    const [matches] = await execute(
        `SELECT id FROM tournament_matches 
         WHERE competition_id = ? AND p1_ready = 1 AND p2_ready = 1 
         AND status != "completed"`,
        [competitionId]
    );

    for (const m of matches) {
        const hasThread = await matchService.isThreadRegistered(m.id, 'tournament');
        if (!hasThread) {
            await checkAndCreateThread(channel, m.id);

            // Check for Auto-completion in newly created threads if they are BYEs
            const [rows] = await execute('SELECT player1_id, player2_id FROM tournament_matches WHERE id = ?', [m.id]);
            if (rows.length) {
                const { player1_id, player2_id } = rows[0];
                if (!player1_id || !player2_id) {
                    const winnerId = player1_id || player2_id;
                    if (winnerId) {
                        await processTournamentMatchResult(m.id, winnerId, channel);
                    } else {
                        // Double bye auto completion
                        await execute('UPDATE tournament_matches SET status = "completed" WHERE id = ?', [m.id]);
                        await processTournamentMatchResult(m.id, null, channel);
                    }
                }
            }
        }
    }
}

/**
 * Check if match has both slots ready and create thread if so.
 */
async function checkAndCreateThread(channel, matchId, isInitialBye = false) {
    const matchService = require('./matchService');
    const hasThread = await matchService.isThreadRegistered(matchId, 'tournament');
    if (hasThread) return;

    const [rows] = await execute(
        `SELECT tm.*, c.edition 
         FROM tournament_matches tm 
         JOIN competitions c ON tm.competition_id = c.id
         WHERE tm.id = ?`,
        [matchId]
    );
    if (!rows.length) return;
    const match = rows[0];

    // Use readiness flags
    if (match.p1_ready && match.p2_ready) {
        const p1 = await getUserDetails(match.player1_id);
        const p2 = await getUserDetails(match.player2_id);

        const p1Name = p1 ? (p1.gamertag || p1.username) : 'BYE';
        const p2Name = p2 ? (p2.gamertag || p2.username) : 'BYE';
        const p1Discord = p1 ? p1.discord_id : null;
        const p2Discord = p2 ? p2.discord_id : null;

        if (matchService.createMatchThread) {
            try {
                await matchService.createMatchThread(
                    channel,
                    p1Discord,
                    p2Discord,
                    matchId,
                    p1Name,
                    p2Name,
                    'tournament',
                    match.edition,
                    match.round_slug
                );
            } catch (err) {
                console.error(`[Tournament] FAILED to create thread for match ${matchId}:`, err);
            }
        }
    }
}

/**
 * Handle progression when a tournament match finishes.
 */
async function processTournamentMatchResult(matchId, winnerId, channel) {
    const [matchRows] = await execute('SELECT * FROM tournament_matches WHERE id = ?', [matchId]);
    if (!matchRows.length) return { error: 'Match not found' };
    const match = matchRows[0];

    // Determine Loser (including BYEs)
    let loserId = null;
    if (winnerId === null) {
        // Double bye case
    } else {
        loserId = (match.player1_id === winnerId) ? match.player2_id : match.player1_id;
    }

    await execute(
        'UPDATE tournament_matches SET winner_id = ?, status = "completed" WHERE id = ?',
        [winnerId, matchId]
    );

    // 2. Move Winner
    if (match.next_match_win) {
        const slotCol = match.next_match_win_slot === 2 ? 'player2_id' : 'player1_id';
        const readyCol = match.next_match_win_slot === 2 ? 'p2_ready' : 'p1_ready';
        await execute(`UPDATE tournament_matches SET ${slotCol} = ?, ${readyCol} = 1 WHERE id = ?`, [winnerId, match.next_match_win]);
    }

    // 3. Move Loser
    if (match.next_match_loss) {
        const slotCol = match.next_match_loss_slot === 2 ? 'player2_id' : 'player1_id';
        const readyCol = match.next_match_loss_slot === 2 ? 'p2_ready' : 'p1_ready';
        await execute(`UPDATE tournament_matches SET ${slotCol} = ?, ${readyCol} = 1 WHERE id = ?`, [loserId, match.next_match_loss]);
    } else if (loserId) {
        await execute('UPDATE tournament_participants SET status = "eliminated" WHERE user_id = ? AND competition_id = ?', [loserId, match.competition_id]);
    }

    // --- BATCH ROUND LOGIC ---
    // Check if current round is finished
    const finished = await isRoundFinished(match.competition_id, match.round, match.bracket_side);
    if (finished) {
        console.log(`[Tournament] Round ${match.round} (${match.bracket_side}) finished. Triggering next matches path.`);
        if (channel) {
            // Delay slightly or use nextTick to avoid deep recursion if many auto-completes happen
            await triggerReadyMatches(match.competition_id, channel);
        }
    }

    return { success: true };
}

/**
 * Generate seeding for a competition based on the specified method.
 * @param {number} competitionId - The competition ID
 * @param {string} seedingType - 'registration', 'ladder', or 'random'
 * @param {number|null} ladderId - Required if seedingType is 'ladder'
 */
async function generateSeeding(competitionId, seedingType, ladderId = null) {
    // Validate competition exists and is in draft/registration status
    const [compRows] = await execute('SELECT * FROM competitions WHERE id = ?', [competitionId]);
    if (!compRows.length) throw new Error('Competition not found');
    const comp = compRows[0];

    if (comp.status === 'active' || comp.status === 'completed') {
        throw new Error('Cannot generate seeding for active or completed competitions');
    }

    // Fetch all participants
    const [participants] = await execute(
        'SELECT * FROM tournament_participants WHERE competition_id = ? ORDER BY joined_at ASC',
        [competitionId]
    );

    if (participants.length === 0) {
        throw new Error('No participants registered');
    }

    let seededParticipants = [];

    switch (seedingType) {
        case 'registration':
            // Seed by registration date (joined_at)
            seededParticipants = participants.map((p, index) => ({
                id: p.id,
                seed: index + 1
            }));
            break;

        case 'ladder':
            // Seed by ladder standings
            if (!ladderId) throw new Error('Ladder ID is required for ladder seeding');

            // Fetch ladder standings for all participants
            const userIds = participants.map(p => p.user_id);
            const placeholders = userIds.map(() => '?').join(',');
            const [standings] = await execute(
                `SELECT user_id, elo, wins, losses 
                 FROM ladder_standings 
                 WHERE ladder_id = ? AND user_id IN (${placeholders})
                 ORDER BY elo DESC, wins DESC`,
                [ladderId, ...userIds]
            );

            // Create a map of user_id to rank
            const rankMap = new Map();
            standings.forEach((s, index) => {
                rankMap.set(s.user_id, index + 1);
            });

            // Assign seeds based on ladder rank
            seededParticipants = participants.map(p => ({
                id: p.id,
                seed: rankMap.get(p.user_id) || 999 // Unranked players go to the end
            }));

            // Sort by seed to ensure correct order
            seededParticipants.sort((a, b) => a.seed - b.seed);

            // Reassign seeds sequentially (in case of gaps)
            seededParticipants = seededParticipants.map((p, index) => ({
                id: p.id,
                seed: index + 1
            }));
            break;

        case 'random':
            // Random seeding
            const shuffled = [...participants];
            for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            seededParticipants = shuffled.map((p, index) => ({
                id: p.id,
                seed: index + 1
            }));
            break;

        default:
            throw new Error(`Invalid seeding type: ${seedingType}`);
    }

    // Update all participants with their seeds
    for (const p of seededParticipants) {
        await execute(
            'UPDATE tournament_participants SET seed = ? WHERE id = ?',
            [p.seed, p.id]
        );
    }

    return {
        success: true,
        participantCount: seededParticipants.length,
        seedingType
    };
}

module.exports = {
    createCompetition,
    registerParticipant,
    startCompetition,
    processTournamentMatchResult,
    checkAndCreateThread,
    generateSeeding
};
