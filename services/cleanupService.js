// services/cleanupService.js
const { execute } = require('../utils/db');

/**
 * Cleanup ladder threads older than 24h that are already confirmed/completed.
 */
async function cleanupOldLadderThreads(client) {
    console.log('[Cleanup] Starting ladder thread cleanup task...');
    try {
        // Find ladder threads created > 24h ago that are linked to confirmed matches
        // Note: match_threads.created_at is used as the base
        const [rows] = await execute(`
            SELECT mt.thread_id, mt.match_id
            FROM match_threads mt
            JOIN ladder_matches lm ON mt.match_id = lm.id
            WHERE mt.match_type = 'ladder'
              AND lm.status = 'confirmed'
              AND mt.created_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)
        `);

        console.log(`[Cleanup] Found ${rows.length} potential ladder threads to archive.`);

        for (const row of rows) {
            try {
                // Try to fetch the thread
                const channel = await client.channels.fetch(row.thread_id).catch(() => null);
                if (channel && channel.isThread()) {
                    if (!channel.archived) {
                        await channel.setArchived(true, 'Automatic cleanup for confirmed ladder matches > 24h old');
                        console.log(`[Cleanup] Archived thread ${row.thread_id} for ladder match #${row.match_id}`);
                    }
                }
            } catch (err) {
                console.error(`[Cleanup] Failed to archive thread ${row.thread_id}:`, err.message);
            }
        }
    } catch (error) {
        console.error('[Cleanup] Error in cleanupOldLadderThreads:', error);
    }
}

function startCleanupTask(client) {
    // Run once on startup after a short delay
    setTimeout(() => cleanupOldLadderThreads(client), 30000);

    // Then run every hour
    setInterval(() => cleanupOldLadderThreads(client), 3600000);
}

module.exports = { startCleanupTask };
