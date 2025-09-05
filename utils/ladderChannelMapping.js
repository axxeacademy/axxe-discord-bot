// utils/ladderChannelMapping.js
const db = require('./db'); // <- our module above

const cache = new Map();
const ladderCache = new Map();

async function getChannelIdByLadder(ladderId) {
  if (!ladderId) return null;
  if (ladderCache.has(ladderId)) return ladderCache.get(ladderId);

  try {
    // table is 'discord_channel_ladders' in your SQL dump
    const [rows] = await db.execute(
      'SELECT channel_id FROM discord_channel_ladders WHERE ladder_id = ? LIMIT 1',
      [ladderId]
    );
    const channelId = rows?.[0]?.channel_id ?? null;
    ladderCache.set(ladderId, channelId);
    return channelId;
  } catch (e) {
    console.error('ladderChannelMapping DB error:', e?.code || e?.message || e);
    return null;
  }
}

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

function clearLadderChannelCache(channelId) {
  if (channelId) cache.delete(channelId);
}

function clearChannelLadderCache(ladderId) {
  if (ladderId) ladderCache.delete(ladderId);
}

module.exports = { 
  getLadderIdByChannel, 
  getChannelIdByLadder, 
  clearLadderChannelCache,
  clearChannelLadderCache
};
