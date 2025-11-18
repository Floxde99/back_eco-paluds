const { PrismaClient } = require('../generated/prisma/client');
const prisma = new PrismaClient();

const DEFAULT_CLEANUP_INTERVAL_MS = parseInt(process.env.REFRESH_TOKEN_CLEANUP_INTERVAL_MS || '', 10)
  || 60 * 60 * 1000; // 1 hour

let cleanupTimer = null;

/**
 * Remove expired refresh tokens from the database.
 * Accepts an optional Prisma client to reuse an existing connection.
 */
const purgeExpiredRefreshTokens = async (client = prisma) => {
  if (!client) {
    throw new Error('A Prisma client instance is required to purge refresh tokens.');
  }

  try {
    const result = await client.refreshToken.deleteMany({
      where: { expiresAt: { lt: new Date() } }
    });

    if (result.count > 0) {
      console.log(`[refreshTokenCleanup] Deleted ${result.count} expired refresh tokens.`);
    }

    return result.count;
  } catch (error) {
    console.error('[refreshTokenCleanup] Failed to delete expired refresh tokens:', error);
    return 0;
  }
};

/**
 * Start a periodic cleanup task so the table never keeps expired entries for long.
 */
const startRefreshTokenCleanup = (
  client = prisma,
  intervalMs = DEFAULT_CLEANUP_INTERVAL_MS
) => {
  if (cleanupTimer) {
    return cleanupTimer;
  }

  const safeInterval = Number(intervalMs) > 0 ? Number(intervalMs) : DEFAULT_CLEANUP_INTERVAL_MS;

  // Run once at startup so previously expired tokens are removed quickly.
  purgeExpiredRefreshTokens(client);

  cleanupTimer = setInterval(() => purgeExpiredRefreshTokens(client), safeInterval);
  if (typeof cleanupTimer.unref === 'function') {
    cleanupTimer.unref();
  }

  return cleanupTimer;
};

module.exports = {
  purgeExpiredRefreshTokens,
  startRefreshTokenCleanup
};
