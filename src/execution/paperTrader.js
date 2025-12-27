/**
 * DEX Trading Bot - Paper Trader
 * 
 * Simulates trade execution for paper trading mode:
 *   - Simulated balance management
 *   - Fake transaction execution
 *   - PnL tracking
 *   - Auto-retry on simulated failures
 */

import { logInfo, logTrade, logError } from '../logging/logger.js';
import config from '../config/index.js';
import { getBalance, updateBalance, addPosition, closePosition, getOpenPositions } from '../automation/state.js';
import { recordTrade, getDailyStats } from '../risk/riskManager.js';

// Simulated slippage range (0.1% to 0.5%)
const MIN_SLIPPAGE = 0.001;
const MAX_SLIPPAGE = 0.005;

// Simulated failure rate (5% chance)
const FAILURE_RATE = 0.05;

/**
 * Simulate network latency
 */
function simulateLatency() {
    const latency = 100 + Math.random() * 400; // 100-500ms
    return new Promise(resolve => setTimeout(resolve, latency));
}

/**
 * Calculate simulated slippage
 */
function calculateSlippage(price, isBuy) {
    const slippage = MIN_SLIPPAGE + Math.random() * (MAX_SLIPPAGE - MIN_SLIPPAGE);
    // Buy = price goes up, Sell = price goes down
    return isBuy ? price * (1 + slippage) : price * (1 - slippage);
}

/**
 * Simulate a random transaction failure
 */
function shouldSimulateFail() {
    return Math.random() < FAILURE_RATE;
}

/**
 * Execute with auto-retry
 * @param {Function} executeFn - Function to execute
 * @param {number} maxRetries - Max retry attempts
 * @param {number} delayMs - Delay between retries
 * @returns {Promise<Object>} Result
 */
export async function executeWithRetry(executeFn, maxRetries = null, delayMs = null) {
    maxRetries = maxRetries || config.execution.maxRetries;
    delayMs = delayMs || config.execution.retryDelayMs;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const result = await executeFn();
            return { success: true, result, attempts: attempt };
        } catch (error) {
            logError(`Attempt ${attempt}/${maxRetries} failed: ${error.message}`);

            if (attempt < maxRetries) {
                // Exponential backoff
                const backoffDelay = delayMs * Math.pow(1.5, attempt - 1);
                logInfo(`Retrying in ${Math.round(backoffDelay)}ms...`);
                await new Promise(resolve => setTimeout(resolve, backoffDelay));
            }
        }
    }

    return { success: false, error: 'Max retries exceeded', attempts: maxRetries };
}

/**
 * Execute a paper buy order
 * @param {Object} signal - Trading signal
 * @param {Object} positionSize - Position sizing from risk manager
 * @returns {Promise<Object>} Trade result
 */
export async function executePaperBuy(signal, positionSize) {
    logInfo(`📝 [PAPER] Executing BUY: ${signal.token} on ${signal.chain.toUpperCase()}`);

    const result = await executeWithRetry(async () => {
        // Simulate network latency
        await simulateLatency();

        // Simulate random failure
        if (shouldSimulateFail()) {
            throw new Error('Simulated RPC failure');
        }

        // Calculate execution price with slippage
        const executionPrice = calculateSlippage(signal.entryPrice, true);

        // Check if we have sufficient balance
        const balance = getBalance(signal.chain);
        if (balance < positionSize.positionSizeUsd) {
            throw new Error(`Insufficient balance: $${balance.toFixed(2)} < $${positionSize.positionSizeUsd.toFixed(2)}`);
        }

        // Deduct from balance
        updateBalance(signal.chain, -positionSize.positionSizeUsd);

        // Calculate actual tokens received (after slippage)
        const tokensReceived = positionSize.positionSizeUsd / executionPrice;

        // Create position
        const position = {
            chain: signal.chain,
            pairAddress: signal.pairAddress,
            token: signal.token,
            tokenAddress: signal.tokenAddress,
            entryPrice: executionPrice,
            tokenAmount: tokensReceived,
            positionSizeUsd: positionSize.positionSizeUsd,
            takeProfit: signal.takeProfit,
            stopLoss: signal.stopLoss,
            maxHoldUntil: signal.maxHoldUntil,
            signal: signal
        };

        const positionId = addPosition(position);

        // Log the trade
        logTrade({
            action: 'BUY',
            chain: signal.chain,
            token: signal.token,
            price: executionPrice,
            amount: tokensReceived,
            value: positionSize.positionSizeUsd,
            slippage: ((executionPrice - signal.entryPrice) / signal.entryPrice * 100).toFixed(3),
            positionId
        });

        return {
            positionId,
            executionPrice,
            tokensReceived,
            positionSizeUsd: positionSize.positionSizeUsd,
            slippagePercent: ((executionPrice - signal.entryPrice) / signal.entryPrice * 100)
        };
    });

    if (result.success) {
        logInfo(`✅ BUY executed after ${result.attempts} attempt(s)`);
        logInfo(`   Price: $${result.result.executionPrice.toFixed(6)} (${result.result.slippagePercent.toFixed(2)}% slippage)`);
        logInfo(`   Tokens: ${result.result.tokensReceived.toFixed(4)} ${signal.token}`);
    } else {
        logError(`❌ BUY failed: ${result.error}`);
    }

    return result;
}

/**
 * Execute a paper sell order
 * @param {Object} position - Open position to close
 * @param {number} currentPrice - Current market price
 * @param {string} reason - Exit reason
 * @returns {Promise<Object>} Trade result
 */
export async function executePaperSell(position, currentPrice, reason) {
    logInfo(`📝 [PAPER] Executing SELL: ${position.token} on ${position.chain.toUpperCase()}`);
    logInfo(`   Reason: ${reason}`);

    const result = await executeWithRetry(async () => {
        // Simulate network latency
        await simulateLatency();

        // Simulate random failure
        if (shouldSimulateFail()) {
            throw new Error('Simulated RPC failure');
        }

        // Calculate execution price with slippage
        const executionPrice = calculateSlippage(currentPrice, false);

        // Calculate proceeds
        const proceeds = position.tokenAmount * executionPrice;

        // Calculate PnL
        const pnl = proceeds - position.positionSizeUsd;
        const pnlPercent = (pnl / position.positionSizeUsd) * 100;

        // Add proceeds back to balance
        updateBalance(position.chain, proceeds);

        // Close position
        const trade = closePosition(position.id, executionPrice, reason);

        // Record trade with risk manager
        recordTrade(pnl);

        // Log the trade
        logTrade({
            action: 'SELL',
            chain: position.chain,
            token: position.token,
            price: executionPrice,
            amount: position.tokenAmount,
            value: proceeds,
            pnl: pnl,
            pnlPercent: pnlPercent,
            reason: reason,
            positionId: position.id
        });

        return {
            executionPrice,
            proceeds,
            pnl,
            pnlPercent,
            trade
        };
    });

    if (result.success) {
        const { pnl, pnlPercent } = result.result;
        const emoji = pnl >= 0 ? '🟢' : '🔴';
        logInfo(`${emoji} SELL executed after ${result.attempts} attempt(s)`);
        logInfo(`   PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)`);
    } else {
        logError(`❌ SELL failed: ${result.error}`);
    }

    return result;
}

/**
 * Get paper trading summary
 */
export function getPaperTradingSummary() {
    const dailyStats = getDailyStats();
    const positions = getOpenPositions();

    return {
        ...dailyStats,
        openPositionsCount: positions.length,
        openPositions: positions.map(p => ({
            token: p.token,
            chain: p.chain,
            entryPrice: p.entryPrice,
            positionSize: p.positionSizeUsd,
            takeProfit: p.takeProfit,
            stopLoss: p.stopLoss
        }))
    };
}

export default {
    executeWithRetry,
    executePaperBuy,
    executePaperSell,
    getPaperTradingSummary
};
