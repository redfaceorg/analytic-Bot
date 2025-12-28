/**
 * DEX Trading Bot - PnL Tracker
 * 
 * Tracks and reports profit/loss metrics:
 *   - Per-trade PnL
 *   - Daily PnL
 *   - Total PnL
 *   - Win rate
 *   - Average trade performance
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logInfo } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dataDir = join(__dirname, '../../data');
const pnlFile = join(dataDir, 'pnl.json');

// Ensure data directory exists
try {
    mkdirSync(dataDir, { recursive: true });
} catch (err) {
    // Directory exists
}

// PnL state
let pnlData = {
    trades: [],           // All completed trades
    dailyPnL: {},         // { 'YYYY-MM-DD': pnl }
    totalPnL: 0,
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    biggestWin: 0,
    biggestLoss: 0,
    avgWin: 0,
    avgLoss: 0
};

/**
 * Load PnL data from disk
 */
export function loadPnLData() {
    try {
        if (existsSync(pnlFile)) {
            const data = readFileSync(pnlFile, 'utf-8');
            pnlData = { ...pnlData, ...JSON.parse(data) };
            logInfo('PnL data loaded');
        }
    } catch (err) {
        // Use defaults
    }
}

/**
 * Save PnL data to disk
 */
export function savePnLData() {
    try {
        writeFileSync(pnlFile, JSON.stringify(pnlData, null, 2));
    } catch (err) {
        // Handle silently
    }
}

/**
 * Record a completed trade
 * @param {Object} trade - Completed trade data
 */
export function recordPnL(trade) {
    const { pnl, chain, token, entryPrice, exitPrice, pnlPercent, reason } = trade;

    const today = new Date().toISOString().split('T')[0];

    // Add to trades array
    pnlData.trades.push({
        timestamp: Date.now(),
        date: today,
        chain,
        token,
        entryPrice,
        exitPrice,
        pnl,
        pnlPercent,
        reason
    });

    // Update daily PnL
    pnlData.dailyPnL[today] = (pnlData.dailyPnL[today] || 0) + pnl;

    // Update totals
    pnlData.totalPnL += pnl;
    pnlData.totalTrades++;

    if (pnl >= 0) {
        pnlData.winningTrades++;
        if (pnl > pnlData.biggestWin) {
            pnlData.biggestWin = pnl;
        }
    } else {
        pnlData.losingTrades++;
        if (pnl < pnlData.biggestLoss) {
            pnlData.biggestLoss = pnl;
        }
    }

    // Calculate averages
    if (pnlData.winningTrades > 0) {
        const winningSum = pnlData.trades
            .filter(t => t.pnl >= 0)
            .reduce((sum, t) => sum + t.pnl, 0);
        pnlData.avgWin = winningSum / pnlData.winningTrades;
    }

    if (pnlData.losingTrades > 0) {
        const losingSum = pnlData.trades
            .filter(t => t.pnl < 0)
            .reduce((sum, t) => sum + t.pnl, 0);
        pnlData.avgLoss = losingSum / pnlData.losingTrades;
    }

    savePnLData();
}

/**
 * Get win rate percentage
 */
export function getWinRate() {
    if (pnlData.totalTrades === 0) return 0;
    return (pnlData.winningTrades / pnlData.totalTrades) * 100;
}

/**
 * Get profit factor (gross profit / gross loss)
 */
export function getProfitFactor() {
    const grossProfit = pnlData.trades
        .filter(t => t.pnl >= 0)
        .reduce((sum, t) => sum + t.pnl, 0);

    const grossLoss = Math.abs(pnlData.trades
        .filter(t => t.pnl < 0)
        .reduce((sum, t) => sum + t.pnl, 0));

    if (grossLoss === 0) return grossProfit > 0 ? Infinity : 0;
    return grossProfit / grossLoss;
}

/**
 * Get PnL summary
 */
export function getPnLSummary() {
    return {
        totalPnL: pnlData.totalPnL || 0,
        totalTrades: pnlData.totalTrades || 0,
        wins: pnlData.winningTrades || 0,
        losses: pnlData.losingTrades || 0,
        winningTrades: pnlData.winningTrades || 0,
        losingTrades: pnlData.losingTrades || 0,
        winRate: getWinRate() || 0,  // Return number, not string
        profitFactor: getProfitFactor() || 0,  // Return number, not string
        biggestWin: pnlData.biggestWin || 0,
        biggestLoss: Math.abs(pnlData.biggestLoss) || 0,
        avgWin: pnlData.avgWin || 0,
        avgLoss: pnlData.avgLoss || 0,
        todayPnl: pnlData.dailyPnL[new Date().toISOString().split('T')[0]] || 0,
        todayTrades: pnlData.trades.filter(t => t.date === new Date().toISOString().split('T')[0]).length
    };
}

/**
 * Get daily PnL for last N days
 */
export function getDailyPnLHistory(days = 7) {
    const result = [];
    const today = new Date();

    for (let i = 0; i < days; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];

        result.push({
            date: dateStr,
            pnl: pnlData.dailyPnL[dateStr] || 0
        });
    }

    return result.reverse();
}

/**
 * Get recent trades
 */
export function getRecentTrades(count = 10) {
    return pnlData.trades.slice(-count);
}

/**
 * Display PnL report
 */
export function displayPnLReport() {
    const summary = getPnLSummary();

    console.log('');
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║                   📊 PnL REPORT                        ║');
    console.log('╠════════════════════════════════════════════════════════╣');
    console.log(`║  Total PnL:       ${(summary.totalPnL >= 0 ? '+' : '') + '$' + summary.totalPnL.toFixed(2).padEnd(35)}║`);
    console.log(`║  Total Trades:    ${String(summary.totalTrades).padEnd(36)}║`);
    console.log(`║  Win Rate:        ${(summary.winRate.toFixed(1) + '%').padEnd(36)}║`);
    console.log(`║  Profit Factor:   ${summary.profitFactor.toFixed(2).padEnd(36)}║`);
    console.log('╠════════════════════════════════════════════════════════╣');
    console.log(`║  Winning Trades:  ${String(summary.winningTrades).padEnd(36)}║`);
    console.log(`║  Losing Trades:   ${String(summary.losingTrades).padEnd(36)}║`);
    console.log(`║  Biggest Win:     ${('+$' + summary.biggestWin.toFixed(2)).padEnd(36)}║`);
    console.log(`║  Biggest Loss:    ${('$' + summary.biggestLoss.toFixed(2)).padEnd(36)}║`);
    console.log('╚════════════════════════════════════════════════════════╝');
    console.log('');
}

/**
 * Reset PnL data (for testing)
 */
export function resetPnL() {
    pnlData = {
        trades: [],
        dailyPnL: {},
        totalPnL: 0,
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        biggestWin: 0,
        biggestLoss: 0,
        avgWin: 0,
        avgLoss: 0
    };
    savePnLData();
}

// Load on module init
loadPnLData();

export default {
    recordPnL,
    getWinRate,
    getProfitFactor,
    getPnLSummary,
    getDailyPnLHistory,
    getRecentTrades,
    displayPnLReport,
    resetPnL
};
