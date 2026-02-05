const fs = require('fs');

const args = process.argv.slice(2);
if (args.length < 2) {
    console.error("Usage: node generate_sql.js <json_path> <channel_id>");
    process.exit(1);
}

const [jsonPath, channelId] = args;

try {
    const raw = fs.readFileSync(jsonPath, 'utf8');
    const participants = JSON.parse(raw);

    const sql = `
-- Battlefy Replicator SQL Export
-- Run this on your remote database to create the tournament script.
-- Note: After running this, check the auto-increment 'id' and use it in Discord: /tournament script <ID>

CREATE TABLE IF NOT EXISTS tournament_scripts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    participants JSON,
    channel_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO tournament_scripts (participants, channel_id) 
VALUES ('${JSON.stringify(participants).replace(/'/g, "''")}', '${channelId}');
    `.trim();

    console.log(sql);
} catch (e) {
    console.error("Error:", e.message);
    process.exit(1);
}
