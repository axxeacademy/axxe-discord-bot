// config.js
// One import point for the bot. Reads from .env, parses, validates.

require('dotenv').config();

const fail = (m) => { throw new Error(`[config] ${m}`); };

const csv = (raw, def = []) =>
  (raw ? raw.split(',').map(s => s.trim()).filter(Boolean) : def);

const int = (raw, def = undefined) => {
  if (raw == null || raw === '') {
    if (def === undefined) fail('Missing required integer env var');
    return def;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) fail(`Expected integer, got "${raw}"`);
  return n;
};

const bool = (raw, def = undefined) => {
  if (raw == null || raw === '') {
    if (def === undefined) fail('Missing required boolean env var');
    return def;
  }
  const s = String(raw).toLowerCase();
  if (['1','true','yes','on'].includes(s)) return true;
  if (['0','false','no','off'].includes(s)) return false;
  fail(`Expected boolean, got "${raw}"`);
};

const config = {
  discord: {
    token: process.env.DISCORD_TOKEN || fail('DISCORD_TOKEN is required'),
    clientId: process.env.DISCORD_CLIENT_ID || fail('DISCORD_CLIENT_ID is required'),
    guildId: process.env.DISCORD_GUILD_ID || fail('DISCORD_GUILD_ID is required'),
    logChannelId: process.env.LOG_CHANNEL_ID || null,
    ladderAdminRoleIds: csv(process.env.LADDER_ADMIN_ROLE_IDS), // array of role snowflakes (strings)
  },
  db: {
    host: process.env.DB_HOST || fail('DB_HOST is required'),
    user: process.env.DB_USER || fail('DB_USER is required'),
    password: process.env.DB_PASSWORD || fail('DB_PASSWORD is required'),
    name: process.env.DB_NAME || fail('DB_NAME is required'),
  },
  behavior: {
    // app-level knobs (set defaults, or override via .env if you add the keys)
    autoConfirmSeconds: int(process.env.AUTO_CONFIRM_SECONDS, 300),
    timerTickSeconds: int(process.env.TIMER_TICK_SECONDS, 60),
    defaultLocale: process.env.DEFAULT_LOCALE || 'pt-PT',
    debugLogs: bool(process.env.DEBUG_LOGS ?? '', false),
  },
};

module.exports = config;
