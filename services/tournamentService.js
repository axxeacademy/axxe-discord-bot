// services/tournamentService.js
const { execute } = require('../utils/db');
const dayjs = require('dayjs');

// Helper to fetch user details for thread creation
async function getUserDetails(userId) {
    const [rows] = await execute('SELECT id, discord_id, gamertag, username FROM users WHERE id = ?', [userId]);
    return rows[0];
}

/**
 * Create a new competition.
 */
async function createCompetition(name, slug, type, format, settings = {}) {
    const settingsJson = JSON.stringify(settings);
    const [result] = await execute(
        'INSERT INTO competitions (name, slug, type, format, settings, status) VALUES (?, ?, ?, ?, ?, "draft")',
        [name, slug, type, format, settingsJson]
    );
    return result.insertId;
}

/**
 * Register a user for a competition.
 */
async function registerParticipant(competitionId, userId) {
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
        'INSERT INTO tournament_participants (competition_id, user_id, status) VALUES (?, ?, "active")',
        [competitionId, userId]
    );
}

function getBracketSize(participantCount) {
    let size = 2;
    while (size < participantCount) size *= 2;
    return size;
}

/**
 * Start the tournament: Generate Bracket.
 * @param {number} competitionId
 * @param {TextChannel} channel - The Discord channel context for creating threads.
 */
async function startCompetition(competitionId, channel) {
    const [compRows] = await execute('SELECT * FROM competitions WHERE id = ?', [competitionId]);
    if (!compRows.length) throw new Error('Competition not found');
    const comp = compRows[0];

    if (comp.status === 'active') throw new Error('Already active');

    // Create bracket structure based on format
    if (comp.format === 'double_elimination') {
        await generateDoubleEliminationBracket(competitionId, channel); // Pass channel
    } else {
        // Basic fallback for single elim if needed or error
        if (comp.format === 'single_elimination') {
            // Placeholder
            throw new Error('Single Elimination not fully implemented in this refactor.');
        }
        await generateDoubleEliminationBracket(competitionId, channel);
    }

    // Update status
    await execute('UPDATE competitions SET status = "active" WHERE id = ?', [competitionId]);
}

/**
 * Core logic to generate Double Elim tables matches.
 */
async function generateDoubleEliminationBracket(competitionId, channel) {
    const [participants] = await execute(
        'SELECT * FROM tournament_participants WHERE competition_id = ? ORDER BY joined_at ASC',
        [competitionId]
    );
    const N = participants.length;
    if (N < 4) throw new Error('Need at least 4 players for Double Elimination.');

    const bracketSize = getBracketSize(N);

    const wbTree = [];
    let currentRoundMatches = bracketSize / 2;
    let roundNum = 1;

    while (currentRoundMatches >= 1) {
        wbTree[roundNum] = [];
        for (let i = 0; i < currentRoundMatches; i++) {
            // Create match
            const side = (currentRoundMatches === 1) ? 'grand_final' : 'winners';
            const [res] = await execute(
                'INSERT INTO tournament_matches (competition_id, round, bracket_side, status) VALUES (?, ?, ?, "scheduled")',
                [competitionId, roundNum, side]
            );
            wbTree[roundNum].push(res.insertId);
        }
        currentRoundMatches /= 2;
        roundNum++;
    }
    const totalWBRounds = roundNum - 1;

    // Link WB matches
    for (let r = 1; r < totalWBRounds; r++) {
        const matches = wbTree[r];
        const nextMatches = wbTree[r + 1];
        for (let i = 0; i < matches.length; i++) {
            const nextMatchIndex = Math.floor(i / 2);
            const nextMatchId = nextMatches[nextMatchIndex];
            await execute('UPDATE tournament_matches SET next_match_win = ? WHERE id = ?', [nextMatchId, matches[i]]);
        }
    }

    // Seeding R1 & Creating Threads
    const round1 = wbTree[1];
    for (let i = 0; i < round1.length; i++) {
        const p1 = participants[i * 2];
        const p2 = participants[i * 2 + 1];

        const matchId = round1[i];
        if (p1 && p2) {
            await execute(
                'UPDATE tournament_matches SET player1_id = ?, player2_id = ? WHERE id = ?',
                [p1.user_id, p2.user_id, matchId]
            );
            // Auto create thread!
            if (channel) {
                await checkAndCreateThread(channel, matchId);
            }
        } else if (p1 && !p2) {
            // BYE
            await execute(
                'UPDATE tournament_matches SET player1_id = ? WHERE id = ?',
                [p1.user_id, matchId]
            );
            // Advance winner immediately? 
            // For MVP safety, keep manual or just let it sit.
        }
    }
}

/**
 * Check if match has both players and create thread if so.
 */
async function checkAndCreateThread(channel, matchId) {
    const [rows] = await execute('SELECT * FROM tournament_matches WHERE id = ?', [matchId]);
    if (!rows.length) return;
    const match = rows[0];

    // Check if thread already created (how? maybe separate DB field? Or check channel threads?
    // For now, simpler to not spam. Migration has no thread_id column.
    // Let's assume we won't double create for this iteration, or use logger.

    if (match.player1_id && match.player2_id) {
        const p1 = await getUserDetails(match.player1_id);
        const p2 = await getUserDetails(match.player2_id);
        if (p1 && p2) {
            // Lazy load matchService to avoid circular dependency
            const matchService = require('./matchService');
            if (matchService.createMatchThread) {
                await matchService.createMatchThread(
                    channel,
                    p1.discord_id,
                    p2.discord_id,
                    matchId,
                    p1.gamertag || p1.username,
                    p2.gamertag || p2.username,
                    'tournament' // [NEW] Explicit type
                );
                // Update status to pending_confirmation? No, keep scheduled until reported.
            }
        }
    }
}

/**
 * Handle progression when a tournament match finishes.
 * @param {number} matchId
 * @param {number} winnerId
 * @param {TextChannel} channel - Context for new thread creation.
 */
async function processTournamentMatchResult(matchId, winnerId, channel) {
    const [matchRows] = await execute('SELECT * FROM tournament_matches WHERE id = ?', [matchId]);
    if (!matchRows.length) return { error: 'Match not found' };
    const match = matchRows[0];

    const loserId = (match.player1_id === winnerId) ? match.player2_id : match.player1_id;

    await execute(
        'UPDATE tournament_matches SET winner_id = ?, status = "completed" WHERE id = ?',
        [winnerId, matchId]
    );

    // 2. Move Winner
    if (match.next_match_win) {
        const [nextRow] = await execute('SELECT * FROM tournament_matches WHERE id = ?', [match.next_match_win]);
        if (nextRow.length) {
            const nextMatch = nextRow[0];
            // Determing slot: If p1 empty, take p1. Else p2.
            // Be careful not to overwrite if someone is already waiting there (from the other branch)
            let slot = null;
            if (!nextMatch.player1_id) slot = 'player1_id';
            else if (!nextMatch.player2_id) slot = 'player2_id';

            if (slot) {
                await execute(`UPDATE tournament_matches SET ${slot} = ? WHERE id = ?`, [winnerId, match.next_match_win]);
                // Check thread creation
                if (channel) await checkAndCreateThread(channel, match.next_match_win);
            }
        }
    }

    // 3. Move Loser
    if (match.next_match_loss) {
        const [nextLossRow] = await execute('SELECT * FROM tournament_matches WHERE id = ?', [match.next_match_loss]);
        if (nextLossRow.length) {
            const nextlossMatch = nextLossRow[0];
            let slot = null;
            if (!nextlossMatch.player1_id) slot = 'player1_id';
            else if (!nextlossMatch.player2_id) slot = 'player2_id';

            if (slot) {
                await execute(`UPDATE tournament_matches SET ${slot} = ? WHERE id = ?`, [loserId, match.next_match_loss]);
                if (channel) await checkAndCreateThread(channel, match.next_match_loss);
            }
        }
    } else {
        await execute('UPDATE tournament_participants SET status = "eliminated" WHERE user_id = ? AND competition_id = ?', [loserId, match.competition_id]);
    }

    return { success: true };
}

module.exports = {
    createCompetition,
    registerParticipant,
    startCompetition,
    processTournamentMatchResult,
    checkAndCreateThread // Exported just in case
};
