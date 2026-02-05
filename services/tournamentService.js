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
async function createCompetition(name, slug, type, format, settings = {}, edition = null) {
    const settingsJson = JSON.stringify(settings);

    // Auto-detect active season if not provided (though for now we just look it up)
    const seasonId = await getActiveSeasonId();

    const [result] = await execute(
        'INSERT INTO competitions (name, slug, type, format, settings, status, edition, season_id) VALUES (?, ?, ?, ?, ?, "draft", ?, ?)',
        [name, slug, type, format, settingsJson, edition, seasonId]
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

    // Create bracket structure based on format
    if (comp.format === 'double_elimination') {
        await generateDoubleEliminationBracket(competitionId, channel);
    } else {
        // Fallback or error
        throw new Error(`Format ${comp.format} not fully implemented in Phase 2.`);
    }

    // Update status
    await execute('UPDATE competitions SET status = "active" WHERE id = ?', [competitionId]);
}

/**
 * Core logic to generate Double Elim tables matches.
 * Implements Phase 2: Power-of-2 Padding, Round Slugs, Losers Bracket.
 */
async function generateDoubleEliminationBracket(competitionId, channel) {
    // 1. Fetch Participants ordered by seed (defaulting to join order if seed is null)
    const [dbParticipants] = await execute(
        'SELECT * FROM tournament_participants WHERE competition_id = ? ORDER BY COALESCE(seed, 999), joined_at ASC',
        [competitionId]
    );

    // 2. Pad to Power of 2 based on count or max seed
    let maxSeedFound = 0;
    dbParticipants.forEach(p => { if (p.seed > maxSeedFound) maxSeedFound = p.seed; });

    const targetSize = getNextPowerOfTwo(Math.max(dbParticipants.length, maxSeedFound));

    // Create a fixed-size array for the slots
    let participants = new Array(targetSize).fill(null).map((_, i) => ({ user_id: null, is_bye: true }));

    // Place participants in their seeded slots (1-indexed)
    let unseeded = [];
    dbParticipants.forEach(p => {
        if (p.seed && p.seed <= targetSize) {
            participants[p.seed - 1] = { ...p, is_bye: false };
        } else {
            unseeded.push(p);
        }
    });

    // Fill remaining slots with unseeded participants
    let slotIdx = 0;
    for (const p of unseeded) {
        while (slotIdx < targetSize && !participants[slotIdx].is_bye) {
            slotIdx++;
        }
        if (slotIdx < targetSize) {
            participants[slotIdx] = { ...p, is_bye: false };
        }
    }

    // Shuffle here if desired, otherwise seeds are based on join order

    const N = participants.length;
    // N is essentially participant count for WB Round 1 calculation.
    // E.g. 8 players -> 4 matches in W1.

    // We will generate the tree structure in memory then insert.
    // Structure:
    // WB Matches: Level 1 (Round 1), Level 2...
    // LB Matches: Complex linking.

    // For MVP phase 2, let's strictly follow standard DE.
    const numRoundsWB = Math.log2(N);

    let wbMatches = {}; // round -> array of matchIds
    let lbMatches = {}; // round -> array of matchIds

    // --- Generate Winners Bracket ---
    let matchCountInRound = N / 2;
    for (let r = 1; r <= numRoundsWB; r++) {
        wbMatches[r] = [];
        const roundSlug = `W${r}`;
        for (let i = 0; i < matchCountInRound; i++) {
            // Create Empty Match
            const [res] = await execute(
                'INSERT INTO tournament_matches (competition_id, round, bracket_side, round_slug, status) VALUES (?, ?, ?, ?, "scheduled")',
                [competitionId, r, 'winners', roundSlug]
            );
            wbMatches[r].push(res.insertId);
        }
        matchCountInRound /= 2;
    }

    // --- Generate Losers Bracket ---
    // Number of LB rounds = 2 * (numRoundsWB - 1). 
    // E.g. 8 players (3 WB rounds) -> 4 LB rounds.
    // L1: 2 matches (Losers of W1)
    // L2: 2 matches (Winners of L1 vs Losers of W2)
    // L3: 1 match
    // ...
    // Simplified logic:
    // R1 LB: N/4 matches.
    // R2 LB: N/4 matches.
    // R3 LB: N/8 matches.
    // R4 LB: N/8 matches.

    const numRoundsLB = 2 * (numRoundsWB - 1);
    if (numRoundsLB > 0) {
        let lbCount = N / 4;
        let lbRoundNameIndex = 1;

        for (let r = 1; r <= numRoundsLB; r++) {
            lbMatches[r] = [];
            const roundSlug = `L${r}`;
            for (let i = 0; i < lbCount; i++) {
                const [res] = await execute(
                    'INSERT INTO tournament_matches (competition_id, round, bracket_side, round_slug, status) VALUES (?, ?, ?, ?, "scheduled")',
                    [competitionId, r, 'losers', roundSlug]
                );
                lbMatches[r].push(res.insertId);
            }
            if (r % 2 === 0) lbCount /= 2; // Decrease every 2 rounds
        }
    }

    // --- Generate Grand Final ---
    const [gf] = await execute(
        'INSERT INTO tournament_matches (competition_id, round, bracket_side, round_slug, status) VALUES (?, ?, ?, ?, "scheduled")',
        [competitionId, numRoundsWB + 1, 'grand_final', 'GF']
    );
    const gfMatchId = gf.insertId;

    // --- LINKING ---
    // Link WB -> WB
    // W1 matches [0,1] -> W2 match [0]
    for (let r = 1; r < numRoundsWB; r++) {
        const currentRound = wbMatches[r];
        const nextRound = wbMatches[r + 1];
        for (let i = 0; i < currentRound.length; i++) {
            const parentId = nextRound[Math.floor(i / 2)];
            await execute('UPDATE tournament_matches SET next_match_win = ? WHERE id = ?', [parentId, currentRound[i]]);
        }
    }
    // WB Final -> GF
    await execute('UPDATE tournament_matches SET next_match_win = ? WHERE id = ?', [gfMatchId, wbMatches[numRoundsWB][0]]);
    // LB Final -> GF
    if (numRoundsLB > 0) {
        await execute('UPDATE tournament_matches SET next_match_loss = ? WHERE id = ?', [gfMatchId, lbMatches[numRoundsLB][0]]); // Wait, GF checks logic
        // Actually GF has P1 from WB Final, P2 from LB Final.
        // So WB Final win -> GF P1
        // LB Final win -> GF P2

        // Let's set manual fields if needed, but standard `next_match_win` implies a slot.
        // We might need to be smart in `processResult` to know which slot.
        // The standard usually is: WB Final Winner -> GF (Wait). LB Final Winner -> GF.
        await execute('UPDATE tournament_matches SET next_match_win = ? WHERE id = ?', [gfMatchId, lbMatches[numRoundsLB][0]]);
    }

    // Link WB -> LB (Drop logic)
    // W1 losers -> L1
    // W2 losers -> L2
    if (numRoundsLB > 0) {
        // W1 Losers -> L1
        // Mapping: Top half of W1 losers go to L1 top? 
        // Simple mapping: W1[i] loser -> L1[floor(i/2)]
        const w1 = wbMatches[1];
        const l1 = lbMatches[1];
        for (let i = 0; i < w1.length; i++) {
            const targetL = l1[Math.floor(i / 2)];
            await execute('UPDATE tournament_matches SET next_match_loss = ? WHERE id = ?', [targetL, w1[i]]);
        }

        // W2 Losers -> L2
        // L2 takes Winners of L1 (p1) vs Losers of W2 (p2)
        // W2[i] loser -> L2[i]
        /*
           Logic is complex for generic N, but for 8 players:
           W1 (4 matches) -> L1 (2 matches)
           W2 (2 matches) -> L2 (2 matches)
           ...
           Let's rely on standard bracket maps or just simplified 'next_match_loss'
        */

        // Generic Linking for Drops is risky to hardcode perfectly without a library.
        // For Phase 2 MVP: Hardcode links for 4 and 8 players specifically or use smart indexing.

        // Let's implement dynamic looking:
        // Rule: Loser of WB Round R drops to LB Round (R*2 - 1) or (R*2 - 2)?
        // W1 -> L1
        // W2 -> L2 (meets L1 winners)
        // W3 -> L4 (meets L3 winners)

        // General Formula: Loser of WB Round R (where R>1) drops to LB Round (R-1)*2
        // Exception R=1 -> L1.

        for (let r = 1; r < numRoundsWB; r++) {
            const wRoundInfo = wbMatches[r];
            let targetLbRoundIdx = (r === 1) ? 1 : (r - 1) * 2;
            // Wait, standard DE:
            // W1 Losers -> L1.
            // W2 Losers -> L3?? No, L2 is L1 winners vs W2 losers.
            targetLbRoundIdx = (r === 1) ? 1 : (r * 2) - 2;
            // e.g. R=2 -> 4-2 = 2. Correct.
            // e.g. R=3 -> 6-2 = 4. Correct.

            const lRoundTarget = lbMatches[targetLbRoundIdx];
            // map w matches to l matches
            // usually in correct order or reverse order to avoid premature rematch.
            // simple order for now.
            for (let i = 0; i < wRoundInfo.length; i++) {
                // Determine target match in LB
                // If W round has K matches, L target round also has K matches (feeding in).
                // Wait, L1 has N/4 matches. W1 has N/2. So 2 W1 feed 1 L1.
                // L2 has N/4 matches. W2 has N/4. So 1 W2 feeds 1 L2.
                let targetMatchId;
                if (r === 1) {
                    targetMatchId = lRoundTarget[Math.floor(i / 2)]; // 2->1
                } else {
                    targetMatchId = lRoundTarget[i]; // 1->1
                }

                await execute('UPDATE tournament_matches SET next_match_loss = ? WHERE id = ?', [targetMatchId, wRoundInfo[i]]);
            }
        }
    }

    // Link LB -> LB (Progression)
    // L1 -> L2, L2 -> L3...
    if (numRoundsLB > 0) {
        for (let r = 1; r < numRoundsLB; r++) {
            const currentRound = lbMatches[r];
            const nextRound = lbMatches[r + 1];
            // If rounds have same num matches (e.g. L2->L3, 2 matches -> 1 match? No.)
            // Pattern: N/4, N/4, N/8, N/8...
            // Odd to Even round transition (L1->L2): Matches count same. 1->1 link.
            // Even to Odd round transition (L2->L3): Matches halve. 2->1 link.

            for (let i = 0; i < currentRound.length; i++) {
                let parentId;
                if (currentRound.length === nextRound.length) {
                    parentId = nextRound[i];
                } else {
                    parentId = nextRound[Math.floor(i / 2)];
                }
                await execute('UPDATE tournament_matches SET next_match_win = ? WHERE id = ?', [parentId, currentRound[i]]);
            }
        }
    }

    // --- SEEDING ROUND 1 ---
    const round1MatchIds = wbMatches[1];
    for (let i = 0; i < round1MatchIds.length; i++) {
        const p1 = participants[i * 2];
        const p2 = participants[i * 2 + 1];
        const matchId = round1MatchIds[i];

        // Assign Players
        const p1Id = p1.is_bye ? null : p1.user_id;
        const p2Id = p2.is_bye ? null : p2.user_id;

        await execute(
            'UPDATE tournament_matches SET player1_id = ?, player2_id = ? WHERE id = ?',
            [p1Id, p2Id, matchId]
        );

        // AUTO-ADVANCE BYES
        // If one player is null/bye, the other auto wins.
        if (!p1Id || !p2Id) {
            const winnerId = p1Id || p2Id;
            if (winnerId) {
                // Auto-win logic
                // We need to call processResult effectively.
                // But we can't do it easily here as it's async recursive.
                // Better to mark status 'completed' and manually push next.
                // Or just let the checkAndCreateThread handle "Bye" threads?
                // User requirement: "Thread created 'PLAYER vs BYE' and no possibility to introduce result. Match created with P1 having won."

                // So we DO create the thread, but auto-win it immediately? 
                // Let's create the thread, then immediately process win.
                if (channel) {
                    await checkAndCreateThread(channel, matchId, true).then(async () => {
                        // After thread creation, auto-win
                        // Wait, checkAndCreateThread logic needs update to handle BYE vs Player
                        await processTournamentMatchResult(matchId, winnerId, channel);
                    });
                }
            } else {
                // Double Bye? Should not happen with valid seeding unless 1 player tournament.
            }
        } else {
            // Normal Match
            if (channel) await checkAndCreateThread(channel, matchId);
        }
    }
}

/**
 * Check if match has both players and create thread if so.
 */
async function checkAndCreateThread(channel, matchId, isInitialBye = false) {
    console.log(`[Tournament] Checking thread creation for match ${matchId}. InitialBye=${isInitialBye}`);

    // Lazy load
    const matchService = require('./matchService');

    // [NEW] Check Duplication explicitly
    const hasThread = await matchService.isThreadRegistered(matchId, 'tournament');
    if (hasThread) {
        console.log(`[Tournament] Match ${matchId} already has a thread. Skipping.`);
        return;
    }

    const [rows] = await execute(
        `SELECT tm.*, c.edition 
         FROM tournament_matches tm 
         JOIN competitions c ON tm.competition_id = c.id
         WHERE tm.id = ?`,
        [matchId]
    );
    if (!rows.length) return;
    const match = rows[0];
    console.log(`[Tournament] Match data for ${matchId}: Edition=${match.edition}, Slug=${match.round_slug}`);

    const p1Id = match.player1_id;
    const p2Id = match.player2_id;

    // [NEW] CONDITION: Require both players UNLESS it's an initial seed-BYE
    const canCreate = (p1Id && p2Id) || (isInitialBye && (p1Id || p2Id));

    if (canCreate) {
        const p1 = await getUserDetails(p1Id);
        const p2 = await getUserDetails(p2Id);

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
                console.log(`[Tournament] Thread created for match ${matchId}`);
            } catch (err) {
                console.error(`[Tournament] FAILED to create thread for match ${matchId}:`, err);
            }
        }
    } else {
        console.log(`[Tournament] Match ${matchId} waiting for both players. Slots: [${p1Id}, ${p2Id}]`);
    }
}

/**
 * Handle progression when a tournament match finishes.
 */
async function processTournamentMatchResult(matchId, winnerId, channel) {
    const [matchRows] = await execute('SELECT * FROM tournament_matches WHERE id = ?', [matchId]);
    if (!matchRows.length) return { error: 'Match not found' };
    const match = matchRows[0];

    // Determine Loser
    // If one was null (BYE), loser is null.
    let loserId = null;
    if (match.player1_id && match.player2_id) {
        loserId = (match.player1_id === winnerId) ? match.player2_id : match.player1_id;
    }
    // If P1 vs BYE, P1 wins, Loser is null (BYE).

    await execute(
        'UPDATE tournament_matches SET winner_id = ?, status = "completed" WHERE id = ?',
        [winnerId, matchId]
    );

    // 2. Move Winner
    if (match.next_match_win) {
        const [nextRow] = await execute('SELECT * FROM tournament_matches WHERE id = ?', [match.next_match_win]);
        if (nextRow.length) {
            const nextMatch = nextRow[0];
            // Determine slot: 
            // Phase 2: Be safer. If next match already has P1 filled, fill P2. 
            // BUT, strictly, we should fill based on bracket logic. 
            // If specific link slot logic isn't stored, greedy fill is okay for simple brackets.
            let slot = null;
            if (!nextMatch.player1_id) slot = 'player1_id';
            else if (!nextMatch.player2_id) slot = 'player2_id';

            if (slot) {
                await execute(`UPDATE tournament_matches SET ${slot} = ? WHERE id = ?`, [winnerId, match.next_match_win]);
                if (channel) await checkAndCreateThread(channel, match.next_match_win);
            }
        }
    }

    // 3. Move Loser
    if (loserId && match.next_match_loss) {
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
    } else if (loserId) {
        // Eliminated
        await execute('UPDATE tournament_participants SET status = "eliminated" WHERE user_id = ? AND competition_id = ?', [loserId, match.competition_id]);
    }

    return { success: true };
}

module.exports = {
    createCompetition,
    registerParticipant,
    startCompetition,
    processTournamentMatchResult,
    checkAndCreateThread
};
