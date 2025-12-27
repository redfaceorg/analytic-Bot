/**
 * DEX Trading Bot - State Manager
 * 
 * Manages persistent state:
 *   - Open positions
 *   - Trade history
 *   - Watchlist
 *   - PnL tracking
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logInfo, logError } from '../logging/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dataDir = join(__dirname, '../../data');
const stateFile = join(dataDir, 'state.json');

// Ensure data directory exists
try {
    mkdirSync(dataDir, { recursive: true });
} catch (err) {
    // Directory exists
}

// In-memory state
let state = {
    // Paper trading balance per chain
    balances: {
        bsc: 1000,    // $1000 starting balance
        base: 1000,
        solana: 1000
    },

    // Open positions: { positionId: positionData }
    positions: {},

    // Trade history
    trades: [],

    // Watchlist: [{ chainId, pairAddress, symbol }]
    watchlist: [],

    // Total PnL tracking
    totalPnL: 0,

    // Last update timestamp
    lastUpdated: null
};

/**
 * Load state from disk
 */
export function loadState() {
    try {
        if (existsSync(stateFile)) {
            const data = readFileSync(stateFile, 'utf-8');
            state = { ...state, ...JSON.parse(data) };
            logInfo('State loaded from disk');
        } else {
            logInfo('No existing state, using defaults');
        }
    } catch (err) {
        logError('Failed to load state', err);
    }

    return state;
}

/**
 * Save state to disk
 */
export function saveState() {
    try {
        state.lastUpdated = new Date().toISOString();
        writeFileSync(stateFile, JSON.stringify(state, null, 2));
    } catch (err) {
        logError('Failed to save state', err);
    }
}

/**
 * Get current balance for a chain
 */
export function getBalance(chainId) {
    return state.balances[chainId] || 0;
}

/**
 * Update balance for a chain
 */
export function updateBalance(chainId, amount) {
    state.balances[chainId] = (state.balances[chainId] || 0) + amount;
    saveState();
    return state.balances[chainId];
}

/**
 * Set balance for a chain (for paper trading reset)
 */
export function setBalance(chainId, amount) {
    state.balances[chainId] = amount;
    saveState();
}

/**
 * Add a new position
 */
export function addPosition(position) {
    const positionId = `${position.chain}:${position.pairAddress}:${Date.now()}`;

    state.positions[positionId] = {
        ...position,
        id: positionId,
        status: 'open',
        openedAt: Date.now()
    };

    saveState();
    logInfo(`Position opened: ${positionId}`);

    return positionId;
}

/**
 * Close a position
 */
export function closePosition(positionId, exitPrice, exitReason) {
    const position = state.positions[positionId];

    if (!position) {
        logError(`Position not found: ${positionId}`);
        return null;
    }

    const pnl = (exitPrice - position.entryPrice) * position.tokenAmount;
    const pnlPercent = ((exitPrice - position.entryPrice) / position.entryPrice) * 100;

    // Record trade
    const trade = {
        ...position,
        exitPrice,
        exitReason,
        pnl,
        pnlPercent,
        closedAt: Date.now(),
        holdTime: Date.now() - position.openedAt
    };

    state.trades.push(trade);
    state.totalPnL += pnl;

    // Update balance
    updateBalance(position.chain, pnl);

    // Remove from open positions
    delete state.positions[positionId];

    saveState();
    logInfo(`Position closed: ${positionId}, PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`);

    return trade;
}

/**
 * Get all open positions
 */
export function getOpenPositions() {
    return Object.values(state.positions);
}

/**
 * Get open positions for a chain
 */
export function getPositionsByChain(chainId) {
    return Object.values(state.positions).filter(p => p.chain === chainId);
}

/**
 * Add to watchlist
 */
export function addToWatchlist(item) {
    // Avoid duplicates
    const exists = state.watchlist.some(
        w => w.chainId === item.chainId && w.pairAddress === item.pairAddress
    );

    if (!exists) {
        state.watchlist.push(item);
        saveState();
    }
}

/**
 * Remove from watchlist
 */
export function removeFromWatchlist(chainId, pairAddress) {
    state.watchlist = state.watchlist.filter(
        w => !(w.chainId === chainId && w.pairAddress === pairAddress)
    );
    saveState();
}

/**
 * Get watchlist
 */
export function getWatchlist() {
    return state.watchlist;
}

/**
 * Get trade history
 */
export function getTradeHistory(limit = 50) {
    return state.trades.slice(-limit);
}

/**
 * Get total PnL
 */
export function getTotalPnL() {
    return state.totalPnL;
}

/**
 * Get state summary
 */
export function getStateSummary() {
    return {
        balances: state.balances,
        openPositions: Object.keys(state.positions).length,
        totalTrades: state.trades.length,
        totalPnL: state.totalPnL,
        watchlistSize: state.watchlist.length,
        lastUpdated: state.lastUpdated
    };
}

/**
 * Reset state (for testing)
 */
export function resetState() {
    state = {
        balances: { bsc: 1000, base: 1000, solana: 1000 },
        positions: {},
        trades: [],
        watchlist: [],
        totalPnL: 0,
        lastUpdated: null
    };
    saveState();
}

export default {
    loadState,
    saveState,
    getBalance,
    updateBalance,
    setBalance,
    addPosition,
    closePosition,
    getOpenPositions,
    getPositionsByChain,
    addToWatchlist,
    removeFromWatchlist,
    getWatchlist,
    getTradeHistory,
    getTotalPnL,
    getStateSummary,
    resetState
};
