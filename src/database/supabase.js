/**
 * RedFace Trading Bot - Supabase Database
 * 
 * Multi-user database for:
 * - User accounts (by Telegram ID)
 * - Encrypted wallets
 * - Trade history
 * - User settings
 */

import { createClient } from '@supabase/supabase-js';
import { logInfo, logError } from '../logging/logger.js';

// Supabase credentials
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zvauhirqqwrsqzmzqras.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;

// Create client
let supabase = null;

/**
 * Initialize Supabase client
 */
export function initSupabase() {
    if (!SUPABASE_KEY) {
        logError('Supabase key not configured');
        return false;
    }

    try {
        supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
        logInfo('Supabase connected');
        return true;
    } catch (err) {
        logError('Failed to connect to Supabase', err);
        return false;
    }
}

/**
 * Get Supabase client
 */
export function getSupabase() {
    if (!supabase) {
        initSupabase();
    }
    return supabase;
}

// ==================== USER MANAGEMENT ====================

/**
 * Get or create user by Telegram ID
 */
export async function getOrCreateUser(telegramId, username = null) {
    const db = getSupabase();
    if (!db) return null;

    try {
        // Check if user exists
        const { data: existing, error: fetchError } = await db
            .from('users')
            .select('*')
            .eq('telegram_id', telegramId.toString())
            .single();

        if (existing) {
            return existing;
        }

        // Create new user
        const { data: newUser, error: insertError } = await db
            .from('users')
            .insert({
                telegram_id: telegramId.toString(),
                username: username,
                settings: {
                    mode: 'PAPER',
                    take_profit: 5,
                    stop_loss: 5,
                    max_trades_per_day: 15
                }
            })
            .select()
            .single();

        if (insertError) {
            logError('Failed to create user', insertError);
            return null;
        }

        logInfo(`New user registered: ${telegramId}`);
        return newUser;
    } catch (err) {
        logError('User lookup error', err);
        return null;
    }
}

/**
 * Get user by Telegram ID
 */
export async function getUser(telegramId) {
    const db = getSupabase();
    if (!db) return null;

    const { data, error } = await db
        .from('users')
        .select('*')
        .eq('telegram_id', telegramId.toString())
        .single();

    return data;
}

/**
 * Update user settings
 */
export async function updateUserSettings(telegramId, settings) {
    const db = getSupabase();
    if (!db) return false;

    const { error } = await db
        .from('users')
        .update({ settings })
        .eq('telegram_id', telegramId.toString());

    return !error;
}

// ==================== WALLET MANAGEMENT ====================

/**
 * Save user wallet (encrypted)
 */
export async function saveWallet(userId, chain, address, encryptedKey) {
    const db = getSupabase();
    if (!db) return false;

    // Check if wallet exists
    const { data: existing } = await db
        .from('wallets')
        .select('id')
        .eq('user_id', userId)
        .eq('chain', chain)
        .single();

    if (existing) {
        // Update existing
        const { error } = await db
            .from('wallets')
            .update({ address, encrypted_key: encryptedKey })
            .eq('id', existing.id);
        return !error;
    }

    // Insert new
    const { error } = await db
        .from('wallets')
        .insert({
            user_id: userId,
            chain,
            address,
            encrypted_key: encryptedKey
        });

    return !error;
}

/**
 * Get user wallets
 */
export async function getUserWallets(userId) {
    const db = getSupabase();
    if (!db) return [];

    const { data, error } = await db
        .from('wallets')
        .select('*')
        .eq('user_id', userId);

    return data || [];
}

/**
 * Get wallet by chain
 */
export async function getWalletByChain(userId, chain) {
    const db = getSupabase();
    if (!db) return null;

    const { data } = await db
        .from('wallets')
        .select('*')
        .eq('user_id', userId)
        .eq('chain', chain)
        .single();

    return data;
}

// ==================== TRADE MANAGEMENT ====================

/**
 * Record a trade
 */
export async function recordTrade(userId, trade) {
    const db = getSupabase();
    if (!db) return false;

    const { error } = await db
        .from('trades')
        .insert({
            user_id: userId,
            chain: trade.chain,
            token: trade.token,
            action: trade.action,
            entry_price: trade.entryPrice,
            exit_price: trade.exitPrice || null,
            amount: trade.amount,
            pnl: trade.pnl || 0,
            pnl_percent: trade.pnlPercent || 0,
            status: trade.status || 'OPEN'
        });

    return !error;
}

/**
 * Get user trades
 */
export async function getUserTrades(userId, limit = 20) {
    const db = getSupabase();
    if (!db) return [];

    const { data } = await db
        .from('trades')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

    return data || [];
}

/**
 * Get user open positions
 */
export async function getUserPositions(userId) {
    const db = getSupabase();
    if (!db) return [];

    const { data } = await db
        .from('trades')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'OPEN');

    return data || [];
}

/**
 * Update trade (close position)
 */
export async function closeTrade(tradeId, exitPrice, pnl, pnlPercent) {
    const db = getSupabase();
    if (!db) return false;

    const { error } = await db
        .from('trades')
        .update({
            exit_price: exitPrice,
            pnl,
            pnl_percent: pnlPercent,
            status: 'CLOSED',
            closed_at: new Date().toISOString()
        })
        .eq('id', tradeId);

    return !error;
}

/**
 * Get user PnL summary
 */
export async function getUserPnLSummary(userId) {
    const db = getSupabase();
    if (!db) return { totalPnl: 0, totalTrades: 0, wins: 0, losses: 0 };

    const { data: trades } = await db
        .from('trades')
        .select('pnl, status')
        .eq('user_id', userId)
        .eq('status', 'CLOSED');

    if (!trades || trades.length === 0) {
        return { totalPnl: 0, totalTrades: 0, wins: 0, losses: 0, winRate: 0 };
    }

    const totalPnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const wins = trades.filter(t => t.pnl >= 0).length;
    const losses = trades.filter(t => t.pnl < 0).length;

    return {
        totalPnl,
        totalTrades: trades.length,
        wins,
        losses,
        winRate: trades.length > 0 ? (wins / trades.length) * 100 : 0
    };
}

// ==================== INITIALIZATION ====================

// Auto-init on import
initSupabase();

export default {
    initSupabase,
    getSupabase,
    getOrCreateUser,
    getUser,
    updateUserSettings,
    saveWallet,
    getUserWallets,
    getWalletByChain,
    recordTrade,
    getUserTrades,
    getUserPositions,
    closeTrade,
    getUserPnLSummary
};
