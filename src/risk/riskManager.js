/**
 * DEX Trading Bot - Risk Manager
 * 
 * Enforces all risk limits:
 *   - Max trades per day
 *   - Risk per trade
 *   - Max daily drawdown
 *   - Position sizing
 */

import { logInfo, logWarn, logError } from '../logging/logger.js';
import config from '../config/index.js';

// Daily state (resets at midnight UTC)
let dailyState = {
    tradeCount: 0,
    totalPnL: 0,
    startBalance: 0,
    date: new Date().toDateString()
};

/**
 * Initialize risk manager with starting balance
 */
export function initRiskManager(startingBalance) {
    dailyState.startBalance = startingBalance;
    dailyState.date = new Date().toDateString();
    logInfo(`Risk manager initialized. Balance: $${startingBalance}`);
}

/**
 * Check if daily reset needed
 */
function checkDailyReset() {
    const today = new Date().toDateString();

    if (dailyState.date !== today) {
        logInfo('🌅 Daily reset triggered');
        dailyState = {
            tradeCount: 0,
            totalPnL: 0,
            startBalance: dailyState.startBalance + dailyState.totalPnL,
            date: today
        };
    }
}

/**
 * Check if a new trade is allowed
 * @returns {Object} { allowed: boolean, reason: string }
 */
export function canTrade() {
    checkDailyReset();

    // Check trade count limit
    if (dailyState.tradeCount >= config.risk.maxTradesPerDay) {
        return {
            allowed: false,
            reason: `Max daily trades reached (${config.risk.maxTradesPerDay})`
        };
    }

    // Check daily drawdown
    const currentDrawdown = (dailyState.totalPnL / dailyState.startBalance) * 100;

    if (currentDrawdown <= -config.risk.maxDailyDrawdown) {
        return {
            allowed: false,
            reason: `Max daily drawdown reached (${config.risk.maxDailyDrawdown}%)`
        };
    }

    return { allowed: true, reason: '' };
}

/**
 * Calculate position size for a trade
 * @param {number} balance - Current balance
 * @param {number} entryPrice - Entry price
 * @param {number} stopLoss - Stop loss price
 * @returns {Object} Position sizing
 */
export function calculatePositionSize(balance, entryPrice, stopLoss) {
    // Risk amount in dollars
    const riskAmount = balance * (config.risk.riskPerTrade / 100);

    // Price distance to stop loss
    const stopDistance = Math.abs(entryPrice - stopLoss);
    const stopPercent = (stopDistance / entryPrice) * 100;

    // Position size = Risk Amount / Stop Distance %
    const positionSize = riskAmount / (stopPercent / 100);

    // Number of tokens
    const tokenAmount = positionSize / entryPrice;

    return {
        positionSizeUsd: Math.min(positionSize, balance * 0.25), // Max 25% of balance
        tokenAmount,
        riskAmount,
        stopPercent: stopPercent.toFixed(2)
    };
}

/**
 * Record a completed trade
 * @param {number} pnl - Profit/loss in dollars
 */
export function recordTrade(pnl) {
    checkDailyReset();

    dailyState.tradeCount++;
    dailyState.totalPnL += pnl;

    const pnlPercent = (pnl / dailyState.startBalance) * 100;

    logInfo(`Trade recorded: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)`);
    logInfo(`Daily stats: ${dailyState.tradeCount} trades, ${dailyState.totalPnL >= 0 ? '+' : ''}$${dailyState.totalPnL.toFixed(2)} total PnL`);
}

/**
 * Get current daily stats
 */
export function getDailyStats() {
    checkDailyReset();

    return {
        date: dailyState.date,
        tradesExecuted: dailyState.tradeCount,
        tradesRemaining: config.risk.maxTradesPerDay - dailyState.tradeCount,
        totalPnL: dailyState.totalPnL,
        drawdownPercent: ((dailyState.totalPnL / dailyState.startBalance) * 100).toFixed(2),
        startBalance: dailyState.startBalance
    };
}

/**
 * Validate signal before execution
 * @param {Object} signal - Trading signal
 * @param {number} balance - Current balance
 * @returns {Object} { valid: boolean, reason: string, position: Object }
 */
export function validateSignal(signal, balance) {
    // Check if trading is allowed
    const tradingCheck = canTrade();
    if (!tradingCheck.allowed) {
        return { valid: false, reason: tradingCheck.reason };
    }

    // Check signal strength (min 20)
    if (signal.strength < 20) {
        return { valid: false, reason: `Signal too weak (${signal.strength}/100)` };
    }

    // Calculate position size
    const position = calculatePositionSize(balance, signal.entryPrice, signal.stopLoss);

    // Check minimum position size ($10)
    if (position.positionSizeUsd < 10) {
        return { valid: false, reason: 'Position size too small ($10 minimum)' };
    }

    // Check liquidity (position should be < 5% of liquidity)
    if (position.positionSizeUsd > signal.liquidity * 0.05) {
        return { valid: false, reason: 'Position too large for liquidity' };
    }

    return { valid: true, reason: '', position };
}

/**
 * Force daily reset (for testing)
 */
export function forceDailyReset() {
    dailyState = {
        tradeCount: 0,
        totalPnL: 0,
        startBalance: dailyState.startBalance,
        date: new Date().toDateString()
    };
}

export default {
    initRiskManager,
    canTrade,
    calculatePositionSize,
    recordTrade,
    getDailyStats,
    validateSignal,
    forceDailyReset
};
