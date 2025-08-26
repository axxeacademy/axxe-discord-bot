// services/userService.js
const { execute } = require('../utils/db');

/**
 * Fetch a user's gamertag by their Discord ID.
 * Returns the gamertag string or null if not found.
 */
async function getGamertagByDiscordId(discordId) {
  const [rows] = await execute(
    'SELECT gamertag FROM users WHERE discord_id = ? LIMIT 1',
    [discordId]
  );
  return rows?.[0]?.gamertag || null;
}

/**
 * Check if a user is an admin by their Discord ID.
 * Returns true if the user is an admin, false otherwise.
 */
async function isAdminByDiscordId(discordId) {
  const [rows] = await execute(
    'SELECT 1 FROM admin_users WHERE discord_id = ? LIMIT 1',
    [discordId]
  );
  return rows.length > 0;
}

module.exports = {
  getGamertagByDiscordId,
  isAdminByDiscordId,
};
