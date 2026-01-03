/**
 * RedFace Trading Bot - Rate Limiter
 * 
 * Prevents excessive trading by limiting trades per user per day
 */

import { logInfo, logWarn } from '../logging/logger.js';

// Rate limit configuration
const DEFAULT_MAX_TRADES_PER_DAY = 20;
const DEFAULT_MAX_TRADES_PER_HOUR = 5;

// In-memory rate tracking (should be moved to Redis for production)
const userTradeCounts = new Map();

/**
 * Check if user can trade (rate limit check)
 */
export function canUserTrade(userId, maxPerDay = DEFAULT_MAX_TRADES_PER_DAY, maxPerHour = DEFAULT_MAX_TRADES_PER_HOUR) {
    const now = Date.now();
    const hourAgo = now - 60 * 60 * 1000;
    const dayAgo = now - 24 * 60 * 60 * 1000;

    const userData = userTradeCounts.get(userId) || { trades: [] };

    // Clean old entries
    userData.trades = userData.trades.filter(t => t > dayAgo);

    // Count trades in last hour and day
    const tradesLastHour = userData.trades.filter(t => t > hourAgo).length;
    const tradesLastDay = userData.trades.length;

    if (tradesLastHour >= maxPerHour) {
        logWarn(`Rate limit: User ${userId} exceeded hourly limit (${tradesLastHour}/${maxPerHour})`);
        return {
            allowed: false,
            reason: `Hourly limit reached (${tradesLastHour}/${maxPerHour}). Try again later.`,
            tradesLastHour,
            tradesLastDay
        };
    }

    if (tradesLastDay >= maxPerDay) {
        logWarn(`Rate limit: User ${userId} exceeded daily limit (${tradesLastDay}/${maxPerDay})`);
        return {
            allowed: false,
            reason: `Daily limit reached (${tradesLastDay}/${maxPerDay}). Try again tomorrow.`,
            tradesLastHour,
            tradesLastDay
        };
    }

    return {
        allowed: true,
        tradesRemaining: maxPerDay - tradesLastDay,
        tradesLastHour,
        tradesLastDay
    };
}

/**
 * Record a trade for rate limiting
 */
export function recordTrade(userId) {
    const userData = userTradeCounts.get(userId) || { trades: [] };
    userData.trades.push(Date.now());
    userTradeCounts.set(userId, userData);

    logInfo(`Trade recorded for rate limit: User ${userId} has ${userData.trades.length} trades today`);
}

/**
 * Get user's trade stats
 */
export function getUserTradeStats(userId) {
    const now = Date.now();
    const hourAgo = now - 60 * 60 * 1000;
    const dayAgo = now - 24 * 60 * 60 * 1000;

    const userData = userTradeCounts.get(userId) || { trades: [] };
    userData.trades = userData.trades.filter(t => t > dayAgo);

    return {
        tradesLastHour: userData.trades.filter(t => t > hourAgo).length,
        tradesLastDay: userData.trades.length,
        maxPerHour: DEFAULT_MAX_TRADES_PER_HOUR,
        maxPerDay: DEFAULT_MAX_TRADES_PER_DAY
    };
}

/**
 * Reset user's rate limit (admin only)
 */
export function resetUserRateLimit(userId) {
    userTradeCounts.delete(userId);
    logInfo(`Rate limit reset for user ${userId}`);
}

export default {
    canUserTrade,
    recordTrade,
    getUserTradeStats,
    resetUserRateLimit
};
