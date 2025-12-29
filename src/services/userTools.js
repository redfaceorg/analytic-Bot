/**
 * RedFace Trading Bot - User Tools Service
 * 
 * Price Alerts, Watchlist, Portfolio, DCA, Limit Orders
 */

import { logInfo, logError } from '../logging/logger.js';

// ==================== PRICE ALERTS ====================

// Store alerts: userId -> [{ tokenAddress, chain, condition, price, active }]
const priceAlerts = new Map();

/**
 * Add a price alert
 */
export function addPriceAlert(userId, alert) {
    const userAlerts = priceAlerts.get(userId) || [];
    const newAlert = {
        id: Date.now().toString(),
        tokenAddress: alert.tokenAddress,
        tokenName: alert.tokenName || 'Unknown',
        chain: alert.chain,
        condition: alert.condition, // 'above' or 'below'
        targetPrice: alert.targetPrice,
        active: true,
        createdAt: new Date()
    };
    userAlerts.push(newAlert);
    priceAlerts.set(userId, userAlerts);

    logInfo(`Price alert added for ${userId}: ${newAlert.tokenName} ${newAlert.condition} $${newAlert.targetPrice}`);
    return newAlert;
}

/**
 * Get user's price alerts
 */
export function getUserAlerts(userId) {
    return priceAlerts.get(userId) || [];
}

/**
 * Remove a price alert
 */
export function removeAlert(userId, alertId) {
    const userAlerts = priceAlerts.get(userId) || [];
    const filtered = userAlerts.filter(a => a.id !== alertId);
    priceAlerts.set(userId, filtered);
    return true;
}

/**
 * Check alerts against current prices
 */
export function checkAlerts(prices) {
    const triggeredAlerts = [];

    for (const [userId, alerts] of priceAlerts.entries()) {
        for (const alert of alerts) {
            if (!alert.active) continue;

            const currentPrice = prices[alert.tokenAddress];
            if (!currentPrice) continue;

            const triggered =
                (alert.condition === 'above' && currentPrice >= alert.targetPrice) ||
                (alert.condition === 'below' && currentPrice <= alert.targetPrice);

            if (triggered) {
                alert.active = false;
                triggeredAlerts.push({ userId, alert, currentPrice });
            }
        }
    }

    return triggeredAlerts;
}

// ==================== WATCHLIST ====================

// Store watchlist: userId -> [{ tokenAddress, chain, name, addedAt }]
const watchlists = new Map();

/**
 * Add token to watchlist
 */
export function addToWatchlist(userId, token) {
    const list = watchlists.get(userId) || [];

    // Check if already in watchlist
    if (list.find(t => t.tokenAddress === token.tokenAddress)) {
        return { success: false, error: 'Already in watchlist' };
    }

    if (list.length >= 20) {
        return { success: false, error: 'Watchlist full (max 20 tokens)' };
    }

    list.push({
        tokenAddress: token.tokenAddress,
        chain: token.chain,
        name: token.name || 'Unknown',
        symbol: token.symbol || '???',
        addedAt: new Date()
    });

    watchlists.set(userId, list);
    return { success: true, watchlist: list };
}

/**
 * Remove from watchlist
 */
export function removeFromWatchlist(userId, tokenAddress) {
    const list = watchlists.get(userId) || [];
    const filtered = list.filter(t => t.tokenAddress !== tokenAddress);
    watchlists.set(userId, filtered);
    return { success: true, watchlist: filtered };
}

/**
 * Get user's watchlist
 */
export function getWatchlist(userId) {
    return watchlists.get(userId) || [];
}

// ==================== PORTFOLIO TRACKER ====================

// Store portfolio: userId -> [{ tokenAddress, chain, amount, avgPrice }]
const portfolios = new Map();

/**
 * Add/Update portfolio holding
 */
export function updatePortfolio(userId, holding) {
    const portfolio = portfolios.get(userId) || [];
    const existing = portfolio.find(h => h.tokenAddress === holding.tokenAddress);

    if (existing) {
        // Update average price
        const totalValue = (existing.amount * existing.avgPrice) + (holding.amount * holding.price);
        existing.amount += holding.amount;
        existing.avgPrice = totalValue / existing.amount;
    } else {
        portfolio.push({
            tokenAddress: holding.tokenAddress,
            chain: holding.chain,
            name: holding.name || 'Unknown',
            symbol: holding.symbol || '???',
            amount: holding.amount,
            avgPrice: holding.price
        });
    }

    portfolios.set(userId, portfolio);
    return portfolio;
}

/**
 * Get user portfolio
 */
export function getPortfolio(userId) {
    return portfolios.get(userId) || [];
}

// ==================== LIMIT ORDERS ====================

// Store limit orders: userId -> [{ type, tokenAddress, chain, price, amount, status }]
const limitOrders = new Map();

/**
 * Create limit order
 */
export function createLimitOrder(userId, order) {
    const orders = limitOrders.get(userId) || [];

    const newOrder = {
        id: Date.now().toString(),
        type: order.type, // 'buy' or 'sell'
        tokenAddress: order.tokenAddress,
        tokenName: order.tokenName || 'Unknown',
        chain: order.chain,
        targetPrice: order.targetPrice,
        amount: order.amount,
        status: 'pending',
        createdAt: new Date()
    };

    orders.push(newOrder);
    limitOrders.set(userId, orders);

    logInfo(`Limit order created: ${order.type} ${order.tokenName} at $${order.targetPrice}`);
    return newOrder;
}

/**
 * Get user's limit orders
 */
export function getLimitOrders(userId) {
    return limitOrders.get(userId) || [];
}

/**
 * Cancel limit order
 */
export function cancelLimitOrder(userId, orderId) {
    const orders = limitOrders.get(userId) || [];
    const order = orders.find(o => o.id === orderId);
    if (order) {
        order.status = 'cancelled';
    }
    return order;
}

// ==================== DCA (Dollar Cost Averaging) ====================

// Store DCA plans: userId -> [{ tokenAddress, chain, amount, interval, nextBuy }]
const dcaPlans = new Map();

/**
 * Create DCA plan
 */
export function createDCAPlan(userId, plan) {
    const plans = dcaPlans.get(userId) || [];

    const newPlan = {
        id: Date.now().toString(),
        tokenAddress: plan.tokenAddress,
        tokenName: plan.tokenName || 'Unknown',
        chain: plan.chain,
        amountUsd: plan.amountUsd,
        interval: plan.interval, // 'daily', 'weekly', 'monthly'
        active: true,
        nextBuy: calculateNextBuy(plan.interval),
        totalInvested: 0,
        buys: 0,
        createdAt: new Date()
    };

    plans.push(newPlan);
    dcaPlans.set(userId, plans);

    return newPlan;
}

/**
 * Calculate next DCA buy time
 */
function calculateNextBuy(interval) {
    const now = new Date();
    switch (interval) {
        case 'daily':
            return new Date(now.getTime() + 24 * 60 * 60 * 1000);
        case 'weekly':
            return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        case 'monthly':
            return new Date(now.setMonth(now.getMonth() + 1));
        default:
            return new Date(now.getTime() + 24 * 60 * 60 * 1000);
    }
}

/**
 * Get user's DCA plans
 */
export function getDCAPlans(userId) {
    return dcaPlans.get(userId) || [];
}

/**
 * Toggle DCA plan
 */
export function toggleDCAPlan(userId, planId) {
    const plans = dcaPlans.get(userId) || [];
    const plan = plans.find(p => p.id === planId);
    if (plan) {
        plan.active = !plan.active;
    }
    return plan;
}

// ==================== GAS TRACKER ====================

/**
 * Get current gas prices
 */
export async function getGasPrices() {
    try {
        // BSC gas - typically low
        const bscGas = { low: 3, standard: 5, fast: 10 };

        // ETH/Base gas - fetch from API or use estimates
        const baseGas = { low: 0.001, standard: 0.005, fast: 0.01 };

        // Solana - priority fees
        const solanaFees = { low: 0.000005, standard: 0.00001, fast: 0.00005 };

        return {
            bsc: bscGas,
            base: baseGas,
            solana: solanaFees,
            timestamp: new Date()
        };
    } catch (err) {
        logError('Failed to get gas prices', err);
        return null;
    }
}

// ==================== EXPORT TRADES ====================

/**
 * Export trades to CSV format
 */
export function exportTradesToCSV(trades) {
    const headers = 'Date,Type,Token,Chain,Amount,Price,Value,PnL,PnL%\n';

    const rows = trades.map(t => [
        new Date(t.createdAt).toISOString(),
        t.action,
        t.token,
        t.chain,
        t.amount || 0,
        t.entryPrice || 0,
        (t.amount || 0) * (t.entryPrice || 0),
        t.pnl || 0,
        t.pnlPercent || 0
    ].join(',')).join('\n');

    return headers + rows;
}

export default {
    // Price Alerts
    addPriceAlert,
    getUserAlerts,
    removeAlert,
    checkAlerts,
    // Watchlist
    addToWatchlist,
    removeFromWatchlist,
    getWatchlist,
    // Portfolio
    updatePortfolio,
    getPortfolio,
    // Limit Orders
    createLimitOrder,
    getLimitOrders,
    cancelLimitOrder,
    // DCA
    createDCAPlan,
    getDCAPlans,
    toggleDCAPlan,
    // Gas
    getGasPrices,
    // Export
    exportTradesToCSV
};
