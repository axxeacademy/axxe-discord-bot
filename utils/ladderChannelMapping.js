// utils/ladderChannelMapping.js
const db = require('./db'); // <- our module above

const cache = new Map();

async function getLadderIdByChannel(channelId) {
  if (!channelId) return null;
  if (cache.has(channelId)) return cache.get(channelId);

  try {
    // table is 'discord_channel_ladders' in your SQL dump
    const [rows] = await db.execute(
      'SELECT ladder_id FROM discord_channel_ladders WHERE channel_id = ? LIMIT 1',
      [channelId]
    );
    const ladderId = rows?.[0]?.ladder_id ?? null;
    cache.set(channelId, ladderId);
    return ladderId;
  } catch (e) {
    console.error('ladderChannelMapping DB error:', e?.code || e?.message || e);
    return null;
  }
}

module.exports = { getLadderIdByChannel };
