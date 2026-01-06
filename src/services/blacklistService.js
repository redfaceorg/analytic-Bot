/**
 * RedFace Trading Bot - Wallet Blacklist Service (Kill-Switch)
 * 
 * Manages blocked wallet addresses for regulatory compliance.
 * Prevents transactions to/from flagged wallets.
 */

import { logInfo, logError, logWarn } from '../logging/logger.js';
import { getSupabase } from '../database/supabase.js';

// In-memory cache for fast lookups
const blacklistCache = new Set();
let cacheInitialized = false;

/**
 * Initialize blacklist from database
 */
export async function initializeBlacklist() {
    if (cacheInitialized) return;

    const supabase = getSupabase();
    if (!supabase) {
        logWarn('Supabase not configured, blacklist will use memory-only mode');
        cacheInitialized = true;
        return;
    }

    try {
        const { data, error } = await supabase
            .from('wallet_blacklist')
            .select('wallet_address');

        if (error) throw error;

        if (data) {
            data.forEach(row => blacklistCache.add(row.wallet_address.toLowerCase()));
            logInfo(`Blacklist initialized with ${blacklistCache.size} addresses`);
        }

        cacheInitialized = true;
    } catch (err) {
        logError('Failed to initialize blacklist', err);
        cacheInitialized = true; // Continue without persisted blacklist
    }
}

/**
 * Check if a wallet address is blacklisted
 * @param {string} address - Wallet address to check
 * @returns {boolean} True if blacklisted
 */
export function isWalletBlacklisted(address) {
    if (!address) return false;
    return blacklistCache.has(address.toLowerCase());
}

/**
 * Add wallet to blacklist
 * @param {string} address - Wallet address to block
 * @param {string} reason - Reason for blocking
 * @param {string} addedBy - Admin who added (optional)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function addToBlacklist(address, reason = 'Regulatory compliance', addedBy = 'system') {
    if (!address) {
        return { success: false, error: 'No address provided' };
    }

    const normalizedAddress = address.toLowerCase();

    // Add to cache immediately
    blacklistCache.add(normalizedAddress);
    logInfo(`Wallet ${address} added to blacklist: ${reason}`);

    // Persist to database
    const supabase = getSupabase();
    if (supabase) {
        try {
            const { error } = await supabase
                .from('wallet_blacklist')
                .upsert({
                    wallet_address: normalizedAddress,
                    reason,
                    added_by: addedBy
                }, { onConflict: 'wallet_address' });

            if (error) throw error;
        } catch (err) {
            logError('Failed to persist blacklist entry', err);
            // Still return success since cache is updated
        }
    }

    return { success: true };
}

/**
 * Remove wallet from blacklist
 * @param {string} address - Wallet address to unblock
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function removeFromBlacklist(address) {
    if (!address) {
        return { success: false, error: 'No address provided' };
    }

    const normalizedAddress = address.toLowerCase();

    // Remove from cache
    blacklistCache.delete(normalizedAddress);
    logInfo(`Wallet ${address} removed from blacklist`);

    // Remove from database
    const supabase = getSupabase();
    if (supabase) {
        try {
            await supabase
                .from('wallet_blacklist')
                .delete()
                .eq('wallet_address', normalizedAddress);
        } catch (err) {
            logError('Failed to remove blacklist entry from DB', err);
        }
    }

    return { success: true };
}

/**
 * Get all blacklisted wallets
 * @returns {Promise<Array<{address: string, reason: string, addedAt: string}>>}
 */
export async function getBlacklist() {
    const supabase = getSupabase();
    if (!supabase) {
        // Return from cache
        return Array.from(blacklistCache).map(addr => ({
            address: addr,
            reason: 'Unknown',
            addedAt: 'Unknown'
        }));
    }

    try {
        const { data, error } = await supabase
            .from('wallet_blacklist')
            .select('wallet_address, reason, created_at')
            .order('created_at', { ascending: false });

        if (error) throw error;

        return (data || []).map(row => ({
            address: row.wallet_address,
            reason: row.reason,
            addedAt: row.created_at
        }));
    } catch (err) {
        logError('Failed to fetch blacklist', err);
        return [];
    }
}

/**
 * Get blacklist count
 */
export function getBlacklistCount() {
    return blacklistCache.size;
}

export default {
    initializeBlacklist,
    isWalletBlacklisted,
    addToBlacklist,
    removeFromBlacklist,
    getBlacklist,
    getBlacklistCount
};
