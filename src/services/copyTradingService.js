/**
 * RedFace Trading Bot - Copy Trading Service
 * 
 * Allows users to follow and copy trades from top traders
 */

import { logInfo, logError } from '../logging/logger.js';

// Copy trading configuration
const MAX_COPY_TRADERS = 3;  // Max traders to follow
const DEFAULT_COPY_AMOUNT_PERCENT = 10;  // Copy with 10% of original size

// Copy trading tracking (in-memory, should be moved to Supabase)
const copyTradeData = {
    followers: new Map(),  // userId -> [traderId1, traderId2, ...]
    traders: new Map(),    // traderId -> { totalPnl, trades, followers: [] }
    copySettings: new Map() // userId -> { enabled, amountPercent, maxPerTrade }
};

/**
 * Follow a trader
 */
export function followTrader(followerId, traderId) {
    if (followerId === traderId) {
        return { success: false, error: 'Cannot follow yourself' };
    }

    const currentFollowing = copyTradeData.followers.get(followerId) || [];

    if (currentFollowing.includes(traderId)) {
        return { success: false, error: 'Already following this trader' };
    }

    if (currentFollowing.length >= MAX_COPY_TRADERS) {
        return { success: false, error: `Max ${MAX_COPY_TRADERS} traders can be followed` };
    }

    currentFollowing.push(traderId);
    copyTradeData.followers.set(followerId, currentFollowing);

    // Add follower to trader's list
    const traderData = copyTradeData.traders.get(traderId) || { totalPnl: 0, trades: 0, followers: [] };
    traderData.followers.push(followerId);
    copyTradeData.traders.set(traderId, traderData);

    logInfo(`User ${followerId} now following trader ${traderId}`);

    return { success: true, following: currentFollowing };
}

/**
 * Unfollow a trader
 */
export function unfollowTrader(followerId, traderId) {
    const currentFollowing = copyTradeData.followers.get(followerId) || [];
    const index = currentFollowing.indexOf(traderId);

    if (index === -1) {
        return { success: false, error: 'Not following this trader' };
    }

    currentFollowing.splice(index, 1);
    copyTradeData.followers.set(followerId, currentFollowing);

    // Remove follower from trader's list
    const traderData = copyTradeData.traders.get(traderId);
    if (traderData) {
        const followerIndex = traderData.followers.indexOf(followerId);
        if (followerIndex !== -1) {
            traderData.followers.splice(followerIndex, 1);
        }
    }

    return { success: true, following: currentFollowing };
}

/**
 * Get user's followed traders
 */
export function getFollowedTraders(userId) {
    return copyTradeData.followers.get(userId) || [];
}

/**
 * Get trader's followers
 */
export function getTraderFollowers(traderId) {
    const traderData = copyTradeData.traders.get(traderId);
    return traderData?.followers || [];
}

/**
 * Update copy settings
 */
export function updateCopySettings(userId, settings) {
    const current = copyTradeData.copySettings.get(userId) || {
        enabled: true,
        amountPercent: DEFAULT_COPY_AMOUNT_PERCENT,
        maxPerTrade: 100 // Max $100 per copy trade
    };

    const updated = { ...current, ...settings };
    copyTradeData.copySettings.set(userId, updated);

    return updated;
}

/**
 * Get copy settings
 */
export function getCopySettings(userId) {
    return copyTradeData.copySettings.get(userId) || {
        enabled: true,
        amountPercent: DEFAULT_COPY_AMOUNT_PERCENT,
        maxPerTrade: 100
    };
}

/**
 * Record a trade for copy trading propagation
 */
export function recordTradeForCopying(traderId, trade) {
    // Update trader stats
    const traderData = copyTradeData.traders.get(traderId) || { totalPnl: 0, trades: 0, followers: [] };
    traderData.trades += 1;
    if (trade.pnl) {
        traderData.totalPnl += trade.pnl;
    }
    copyTradeData.traders.set(traderId, traderData);

    // Get followers to notify for copy trading
    const followers = traderData.followers || [];

    logInfo(`Trade recorded for ${traderId}. ${followers.length} followers will be notified.`);

    return {
        traderId,
        followers,
        trade
    };
}

/**
 * Get top traders for leaderboard
 */
export function getTopTraders(limit = 10) {
    const traders = Array.from(copyTradeData.traders.entries())
        .map(([id, data]) => ({
            traderId: id,
            ...data,
            winRate: data.trades > 0 ? (data.wins || 0) / data.trades * 100 : 0
        }))
        .sort((a, b) => b.totalPnl - a.totalPnl)
        .slice(0, limit);

    return traders;
}

/**
 * Format copy trading message
 */
export function formatCopyTradeMessage(userId) {
    const following = getFollowedTraders(userId);
    const settings = getCopySettings(userId);

    if (following.length === 0) {
        return `
🤖 <b>Copy Trading</b>
━━━━━━━━━━━━━━━━━━━━━

<i>Not following any traders</i>

Browse the leaderboard to find top traders!
        `.trim();
    }

    const tradersList = following.map((traderId, i) => {
        const data = copyTradeData.traders.get(traderId) || { totalPnl: 0, trades: 0 };
        const pnlEmoji = data.totalPnl >= 0 ? '🟢' : '🔴';
        return `${i + 1}. Trader***${traderId.slice(-4)} ${pnlEmoji} $${data.totalPnl.toFixed(2)}`;
    }).join('\n');

    return `
🤖 <b>Copy Trading</b>
━━━━━━━━━━━━━━━━━━━━━

📊 <b>Following ${following.length}/${MAX_COPY_TRADERS} Traders</b>
${tradersList}

⚙️ <b>Settings</b>
┌ Enabled: ${settings.enabled ? '✅' : '❌'}
├ Copy Size: ${settings.amountPercent}%
└ Max/Trade: $${settings.maxPerTrade}

━━━━━━━━━━━━━━━━━━━━━
    `.trim();
}

export default {
    followTrader,
    unfollowTrader,
    getFollowedTraders,
    getTraderFollowers,
    updateCopySettings,
    getCopySettings,
    recordTradeForCopying,
    getTopTraders,
    formatCopyTradeMessage
};
