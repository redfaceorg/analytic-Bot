/**
 * DEX Trading Bot - Main Scheduler
 * 
 * Runs the main trading loop:
 *   1. Fetch market data
 *   2. Analyze for signals
 *   3. Execute trades (paper or live)
 *   4. Monitor open positions
 *   5. Handle exits
 */

import { logInfo, logWarn, logError, logStartup } from '../logging/logger.js';
import config, { getEnabledChains } from '../config/index.js';
import { getMarketSnapshot, findTradablePairs } from '../data/priceEngine.js';
import { analyzeForSignal, checkExitConditions, getStrategyDescription } from '../strategy/volumeSpike.js';
import { canTrade, validateSignal, getDailyStats, initRiskManager } from '../risk/riskManager.js';
import { loadState, saveState, getBalance, getOpenPositions, getWatchlist, addToWatchlist } from './state.js';
import { executePaperBuy, executePaperSell } from '../execution/paperTrader.js';
import { executeLiveBuy, executeLiveSell, isLiveEnabled } from '../execution/evmExecutor.js';
import { recordPnL, displayPnLReport } from '../logging/pnlTracker.js';

// Main loop interval (30 seconds)
const MAIN_LOOP_INTERVAL = 30000;

// Position check interval (10 seconds)
const POSITION_CHECK_INTERVAL = 10000;

// Running flag
let isRunning = false;
let mainLoopId = null;
let positionLoopId = null;

/**
 * Initialize the bot
 */
export async function initialize() {
    logInfo('Initializing bot...');

    // Load persisted state
    loadState();

    // Initialize risk manager with total balance
    const totalBalance = getEnabledChains().reduce(
        (sum, chain) => sum + getBalance(chain),
        0
    );
    initRiskManager(totalBalance);

    // Log strategy info
    const strategy = getStrategyDescription();
    logInfo(`Strategy: ${strategy.name}`);
    logInfo(`Entry: ${strategy.entry}`);
    logInfo(`Take Profit: ${strategy.takeProfit}`);
    logInfo(`Stop Loss: ${strategy.stopLoss}`);

    // Discover tradable pairs if watchlist is empty
    const watchlist = getWatchlist();
    if (watchlist.length === 0) {
        logInfo('Discovering tradable pairs...');
        await discoverPairs();
    }

    logInfo('Initialization complete');
}

/**
 * Discover and add tradable pairs to watchlist
 */
async function discoverPairs() {
    const chains = getEnabledChains();

    for (const chainId of chains) {
        try {
            logInfo(`Discovering pairs on ${chainId.toUpperCase()}...`);

            // Search for trending tokens
            const pairs = await findTradablePairs(chainId, '');

            for (const pair of pairs.slice(0, 5)) { // Top 5 per chain
                addToWatchlist({
                    chainId,
                    pairAddress: pair.pairAddress,
                    symbol: pair.baseToken.symbol
                });
                logInfo(`Added ${pair.baseToken.symbol} on ${chainId}`);
            }
        } catch (err) {
            logError(`Failed to discover pairs on ${chainId}`, err);
        }
    }
}

/**
 * Main trading loop iteration
 */
async function mainLoopIteration() {
    if (!isRunning) return;

    const watchlist = getWatchlist();

    if (watchlist.length === 0) {
        logWarn('Watchlist is empty, discovering pairs...');
        await discoverPairs();
        return;
    }

    // Check if we can trade today
    const tradingCheck = canTrade();
    if (!tradingCheck.allowed) {
        logWarn(`Trading paused: ${tradingCheck.reason}`);
        return;
    }

    // Iterate through watchlist
    for (const item of watchlist) {
        try {
            // Get market snapshot
            const snapshot = await getMarketSnapshot(item.chainId, item.pairAddress);

            if (!snapshot) {
                continue;
            }

            // Analyze for entry signal
            const signal = analyzeForSignal(snapshot);

            if (signal) {
                logInfo(`🎯 Signal detected: ${signal.token} on ${signal.chain.toUpperCase()}`);

                // Validate signal with risk manager
                const balance = getBalance(signal.chain);
                const validation = validateSignal(signal, balance);

                if (!validation.valid) {
                    logWarn(`Signal rejected: ${validation.reason}`);
                    continue;
                }

                // Execute trade (paper or live)
                if (config.mode === 'PAPER' || config.mode === 'READ_ONLY') {
                    await executePaperTrade(signal, validation.position);
                } else if (config.mode === 'LIVE' && config.enableLiveTrading) {
                    // Live trading (EVM chains only for now)
                    if (signal.chain === 'bsc' || signal.chain === 'base') {
                        await executeLiveBuy(signal, validation.position);
                    } else {
                        logWarn(`Live trading not supported on ${signal.chain} yet`);
                    }
                }
            }
        } catch (err) {
            logError(`Error processing ${item.symbol}`, err);
        }
    }
}

/**
 * Execute a paper trade using the paper trader module
 */
async function executePaperTrade(signal, positionSize) {
    if (config.mode === 'READ_ONLY') {
        logInfo(`📖 [READ_ONLY] Would buy ${signal.token} @ $${signal.entryPrice}`);
        logInfo(`   Position: $${positionSize.positionSizeUsd.toFixed(2)}`);
        logInfo(`   Take Profit: $${signal.takeProfit.toFixed(6)}`);
        logInfo(`   Stop Loss: $${signal.stopLoss.toFixed(6)}`);
        return;
    }

    // Use paper trader with auto-retry
    const result = await executePaperBuy(signal, positionSize);

    if (!result.success) {
        logError(`Failed to execute paper buy: ${result.error}`);
    }
}

/**
 * Position monitoring loop
 */
async function positionLoopIteration() {
    if (!isRunning) return;

    const positions = getOpenPositions();

    if (positions.length === 0) {
        return;
    }

    logInfo(`Monitoring ${positions.length} open position(s)...`);

    for (const position of positions) {
        try {
            // Get current market data
            const snapshot = await getMarketSnapshot(position.chain, position.pairAddress);

            if (!snapshot) {
                continue;
            }

            // Check exit conditions
            const exitSignal = checkExitConditions(position, snapshot);

            if (exitSignal) {
                logInfo(`🚪 Exit signal: ${exitSignal.type} for ${position.token}`);

                // Execute paper sell with auto-retry
                const result = await executePaperSell(position, exitSignal.exitPrice, exitSignal.reason);

                if (result.success) {
                    // Record in PnL tracker
                    recordPnL({
                        pnl: result.result.pnl,
                        chain: position.chain,
                        token: position.token,
                        entryPrice: position.entryPrice,
                        exitPrice: result.result.executionPrice,
                        pnlPercent: result.result.pnlPercent,
                        reason: exitSignal.reason
                    });
                }
            }
        } catch (err) {
            logError(`Error monitoring position ${position.id}`, err);
        }
    }
}

/**
 * Start the bot
 */
export async function start() {
    if (isRunning) {
        logWarn('Bot is already running');
        return;
    }

    isRunning = true;
    logStartup(config);

    await initialize();

    // Start main loop
    logInfo('Starting main loop...');
    mainLoopId = setInterval(mainLoopIteration, MAIN_LOOP_INTERVAL);

    // Start position monitor
    logInfo('Starting position monitor...');
    positionLoopId = setInterval(positionLoopIteration, POSITION_CHECK_INTERVAL);

    // Run immediately
    await mainLoopIteration();

    logInfo('🟢 Bot is running');
}

/**
 * Stop the bot
 */
export function stop() {
    logInfo('Stopping bot...');

    isRunning = false;

    if (mainLoopId) {
        clearInterval(mainLoopId);
        mainLoopId = null;
    }

    if (positionLoopId) {
        clearInterval(positionLoopId);
        positionLoopId = null;
    }

    saveState();

    // Display PnL report on shutdown
    displayPnLReport();

    logInfo('🔴 Bot stopped');
}

/**
 * Check if bot is running
 */
export function isActive() {
    return isRunning;
}

/**
 * Get bot status
 */
export function getStatus() {
    return {
        running: isRunning,
        mode: config.mode,
        dailyStats: getDailyStats(),
        openPositions: getOpenPositions().length,
        watchlistSize: getWatchlist().length
    };
}

export default {
    initialize,
    start,
    stop,
    isActive,
    getStatus
};
