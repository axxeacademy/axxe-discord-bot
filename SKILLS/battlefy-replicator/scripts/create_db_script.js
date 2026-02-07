const { execute } = require('../../../utils/db');
const fs = require('fs');

async function run() {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.error("Usage: node create_db_script.js <json_path> <channel_id> [edition]");
        process.exit(1);
    }

    const [jsonPath, channelId, edition] = args;

    // Read JSON
    let participants;
    try {
        const raw = fs.readFileSync(jsonPath, 'utf8');
        participants = JSON.parse(raw);
        if (!Array.isArray(participants)) {
            throw new Error("JSON must be an array of participant names");
        }
    } catch (e) {
        console.error("Failed to read/parse JSON:", e.message);
        process.exit(1);
    }

    try {
        // Ensure table exists
        await execute(`
            CREATE TABLE IF NOT EXISTS tournament_scripts (
                id INT AUTO_INCREMENT PRIMARY KEY,
                participants JSON,
                channel_id VARCHAR(255),
                edition VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Check if edition column exists (in case table existed)
        try {
            await execute('ALTER TABLE tournament_scripts ADD COLUMN edition VARCHAR(50) DEFAULT NULL');
        } catch (colErr) {
            // Likely already exists
        }

        // Insert
        const [res] = await execute(
            'INSERT INTO tournament_scripts (participants, channel_id, edition) VALUES (?, ?, ?)',
            [JSON.stringify(participants), channelId, edition || null]
        );

        console.log(`Script created with ID: ${res.insertId}`);
        process.exit(0);
    } catch (dbErr) {
        console.error("Database error:", dbErr);
        process.exit(1);
    }
}

run();
