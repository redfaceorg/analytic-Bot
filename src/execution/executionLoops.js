/**
 * RedFace Trading Bot - Execution Loops
 * 
 * Monitors and executes:
 * - DCA plans on schedule
 * - Limit orders when price hits target
 * - Price alerts
 * - Fee collection
 */

import { logInfo, logError, logWarn } from '../logging/logger.js';
import config from '../config/index.js';
import { getSupabase } from '../database/supabase.js';
import { executeLiveBuy, executeLiveSell, isLiveEnabled } from '../execution/evmExecutor.js';
import { executePaperBuy, executePaperSell } from '../execution/paperTrader.js';
import { getTokenInfo } from '../analysis/tokenAnalyzer.js';
import { getFeeWallet, TRADING_FEE_PERCENT } from '../services/feeService.js';
import { ethers } from 'ethers';

// Execution intervals
const DCA_CHECK_INTERVAL = 60000;  // Check every minute
const LIMIT_ORDER_INTERVAL = 30000;  // Check every 30 seconds
const ALERT_CHECK_INTERVAL = 30000;  // Check every 30 seconds

let dcaLoopId = null;
let limitOrderLoopId = null;
let alertLoopId = null;

// ==================== DCA EXECUTION ====================

/**
 * Start DCA execution loop
 */
export function startDCALoop() {
    if (dcaLoopId) return;

    logInfo('Starting DCA execution loop...');
    dcaLoopId = setInterval(checkAndExecuteDCA, DCA_CHECK_INTERVAL);

    // Run immediately
    checkAndExecuteDCA();
}

/**
 * Stop DCA loop
 */
export function stopDCALoop() {
    if (dcaLoopId) {
        clearInterval(dcaLoopId);
        dcaLoopId = null;
    }
}

/**
 * Check and execute due DCA plans
 */
async function checkAndExecuteDCA() {
    try {
        const supabase = getSupabase();
        if (!supabase) return;

        const now = new Date().toISOString();

        // Get due DCA plans
        const { data: duePlans, error } = await supabase
            .from('dca_plans')
            .select('*, users(telegram_id, settings)')
            .eq('active', true)
            .lte('next_buy', now);

        if (error) {
            logError('Failed to fetch DCA plans', error);
            return;
        }

        if (!duePlans || duePlans.length === 0) return;

        logInfo(`Found ${duePlans.length} DCA plans due for execution`);

        for (const plan of duePlans) {
            await executeDCAPlan(plan);
        }
    } catch (err) {
        logError('DCA loop error', err);
    }
}

/**
 * Execute a DCA plan
 */
async function executeDCAPlan(plan) {
    try {
        logInfo(`Executing DCA: ${plan.token_name} - $${plan.amount_usd}`);

        const userMode = plan.users?.settings?.mode || 'PAPER';

        // Get current token price
        const tokenInfo = await getTokenInfo(plan.chain, plan.token_address);
        if (!tokenInfo.success) {
            logError(`Failed to get token info for DCA: ${plan.token_address}`);
            return;
        }

        const signal = {
            token: plan.token_name,
            tokenAddress: plan.token_address,
            chain: plan.chain,
            entryPrice: tokenInfo.token.price
        };

        const positionSize = {
            positionSizeUsd: plan.amount_usd
        };

        let result;
        if (userMode === 'LIVE' && isLiveEnabled()) {
            result = await executeLiveBuy(signal, positionSize);
        } else {
            result = await executePaperBuy(signal, positionSize);
        }

        // Update DCA plan
        const supabase = getSupabase();
        const nextBuy = calculateNextBuy(plan.interval);

        await supabase
            .from('dca_plans')
            .update({
                next_buy: nextBuy.toISOString(),
                total_invested: plan.total_invested + plan.amount_usd,
                total_buys: plan.total_buys + 1
            })
            .eq('id', plan.id);

        logInfo(`DCA executed: ${plan.token_name}, next: ${nextBuy.toISOString()}`);

        // Send notification to user (TODO: implement notifyDCA)
    } catch (err) {
        logError('DCA execution failed', err);
    }
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

// ==================== LIMIT ORDER EXECUTION ====================

/**
 * Start limit order monitoring loop
 */
export function startLimitOrderLoop() {
    if (limitOrderLoopId) return;

    logInfo('Starting limit order monitoring loop...');
    limitOrderLoopId = setInterval(checkAndExecuteLimitOrders, LIMIT_ORDER_INTERVAL);

    // Run immediately
    checkAndExecuteLimitOrders();
}

/**
 * Stop limit order loop
 */
export function stopLimitOrderLoop() {
    if (limitOrderLoopId) {
        clearInterval(limitOrderLoopId);
        limitOrderLoopId = null;
    }
}

/**
 * Check and execute triggered limit orders
 */
async function checkAndExecuteLimitOrders() {
    try {
        const supabase = getSupabase();
        if (!supabase) return;

        // Get pending limit orders
        const { data: orders, error } = await supabase
            .from('limit_orders')
            .select('*, users(telegram_id, settings)')
            .eq('status', 'pending');

        if (error) {
            logError('Failed to fetch limit orders', error);
            return;
        }

        if (!orders || orders.length === 0) return;

        // Check each order
        for (const order of orders) {
            await checkLimitOrder(order);
        }
    } catch (err) {
        logError('Limit order loop error', err);
    }
}

/**
 * Check and potentially execute a limit order
 */
async function checkLimitOrder(order) {
    try {
        // Get current price
        const tokenInfo = await getTokenInfo(order.chain, order.token_address);
        if (!tokenInfo.success) return;

        const currentPrice = tokenInfo.token.price;
        let shouldExecute = false;

        // Check if target hit
        if (order.order_type === 'buy') {
            // Buy when price drops below target
            shouldExecute = currentPrice <= order.target_price;
        } else {
            // Sell when price rises above target
            shouldExecute = currentPrice >= order.target_price;
        }

        if (!shouldExecute) return;

        logInfo(`Limit order triggered: ${order.order_type} ${order.token_name} at $${currentPrice}`);

        const userMode = order.users?.settings?.mode || 'PAPER';
        let result;

        if (order.order_type === 'buy') {
            const signal = {
                token: order.token_name,
                tokenAddress: order.token_address,
                chain: order.chain,
                entryPrice: currentPrice
            };
            const positionSize = { positionSizeUsd: order.amount_usd || order.amount };

            if (userMode === 'LIVE' && isLiveEnabled()) {
                result = await executeLiveBuy(signal, positionSize);
            } else {
                result = await executePaperBuy(signal, positionSize);
            }
        } else {
            // Sell logic
            const position = {
                token: order.token_name,
                tokenAddress: order.token_address,
                chain: order.chain
            };

            if (userMode === 'LIVE' && isLiveEnabled()) {
                result = await executeLiveSell(position, currentPrice, 'LIMIT_ORDER');
            } else {
                result = await executePaperSell(position, currentPrice, 'LIMIT_ORDER');
            }
        }

        // Update order status
        const supabase = getSupabase();
        await supabase
            .from('limit_orders')
            .update({
                status: 'filled',
                filled_at: new Date().toISOString(),
                tx_hash: result?.txHash || null
            })
            .eq('id', order.id);

        logInfo(`Limit order filled: ${order.id}`);
    } catch (err) {
        logError('Limit order check failed', err);
    }
}

// ==================== PRICE ALERTS ====================

/**
 * Start price alert monitoring loop
 */
export function startAlertLoop() {
    if (alertLoopId) return;

    logInfo('Starting price alert monitoring loop...');
    alertLoopId = setInterval(checkPriceAlerts, ALERT_CHECK_INTERVAL);

    // Run immediately
    checkPriceAlerts();
}

/**
 * Stop alert loop
 */
export function stopAlertLoop() {
    if (alertLoopId) {
        clearInterval(alertLoopId);
        alertLoopId = null;
    }
}

/**
 * Check and trigger price alerts
 */
async function checkPriceAlerts() {
    try {
        const supabase = getSupabase();
        if (!supabase) return;

        // Get active alerts
        const { data: alerts, error } = await supabase
            .from('price_alerts')
            .select('*, users(telegram_id)')
            .eq('active', true);

        if (error || !alerts || alerts.length === 0) return;

        for (const alert of alerts) {
            await checkAlert(alert);
        }
    } catch (err) {
        logError('Alert loop error', err);
    }
}

/**
 * Check a single price alert
 */
async function checkAlert(alert) {
    try {
        // Get current price
        const tokenInfo = await getTokenInfo(alert.chain, alert.token_address);
        if (!tokenInfo.success) return;

        const currentPrice = tokenInfo.token.price;
        let triggered = false;

        if (alert.condition === 'above' && currentPrice >= alert.target_price) {
            triggered = true;
        } else if (alert.condition === 'below' && currentPrice <= alert.target_price) {
            triggered = true;
        }

        if (!triggered) return;

        // Trigger alert
        logInfo(`Price alert triggered: ${alert.token_name} ${alert.condition} $${alert.target_price}`);

        const supabase = getSupabase();
        await supabase
            .from('price_alerts')
            .update({
                active: false,
                triggered_at: new Date().toISOString(),
                current_price: currentPrice
            })
            .eq('id', alert.id);

        // TODO: Send Telegram notification to user
    } catch (err) {
        logError('Alert check failed', err);
    }
}

// ==================== FEE COLLECTION ====================

/**
 * Collect trading fee by sending to fee wallet
 * @param {string} chain - Chain to send on
 * @param {number} feeAmountNative - Fee amount in native token
 * @param {string} userId - User ID for tracking
 * @param {string} tradeId - Trade ID for reference
 */
export async function collectFeeOnChain(chain, feeAmountNative, userId, tradeId) {
    try {
        if (!isLiveEnabled()) {
            logInfo('Fee collection skipped - not in live mode');
            return { success: false, error: 'Not live' };
        }

        const feeWallet = getFeeWallet(chain);
        if (!feeWallet) {
            logError('No fee wallet configured');
            return { success: false, error: 'No fee wallet' };
        }

        const { getWallet } = await import('../execution/evmExecutor.js');
        const wallet = getWallet(chain);

        const feeAmount = ethers.parseEther(feeAmountNative.toString());

        logInfo(`Sending fee: ${feeAmountNative} to ${feeWallet}`);

        const tx = await wallet.sendTransaction({
            to: feeWallet,
            value: feeAmount
        });

        const receipt = await tx.wait();

        logInfo(`Fee collected: ${tx.hash}`);

        // Record in database
        const supabase = getSupabase();
        if (supabase) {
            await supabase.from('fees').insert({
                trade_id: tradeId,
                user_id: userId,
                fee_amount: feeAmountNative,
                net_amount: feeAmountNative,
                chain,
                tx_hash: tx.hash
            });
        }

        return { success: true, txHash: tx.hash };
    } catch (err) {
        logError('Fee collection failed', err);
        return { success: false, error: err.message };
    }
}

// ==================== START ALL LOOPS ====================

/**
 * Start all execution loops
 */
export function startAllLoops() {
    startDCALoop();
    startLimitOrderLoop();
    startAlertLoop();
    logInfo('All execution loops started');
}

/**
 * Stop all execution loops
 */
export function stopAllLoops() {
    stopDCALoop();
    stopLimitOrderLoop();
    stopAlertLoop();
    logInfo('All execution loops stopped');
}

export default {
    startDCALoop,
    stopDCALoop,
    startLimitOrderLoop,
    stopLimitOrderLoop,
    startAlertLoop,
    stopAlertLoop,
    startAllLoops,
    stopAllLoops,
    collectFeeOnChain
};
