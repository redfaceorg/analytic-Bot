/**
 * RedFace Trading Bot - Per-User Wallet Manager
 * 
 * Handles wallet creation, import, and storage per user
 * Each user (by Telegram ID) has their own wallets
 * Keys are encrypted before storing in database
 */

import { ethers } from 'ethers';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import crypto from 'crypto';
import { logInfo, logError, logWarn } from '../logging/logger.js';
import { getSupabase } from '../database/supabase.js';

// Encryption key from environment (generate a random one if needed)
const ENCRYPTION_KEY = process.env.WALLET_ENCRYPTION_KEY || 'redface-bot-encryption-key-32ch'; // Must be 32 chars

// ==================== ENCRYPTION ====================

/**
 * Encrypt a private key
 */
function encryptKey(privateKey) {
    try {
        const iv = crypto.randomBytes(16);
        const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
        const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);

        let encrypted = cipher.update(privateKey, 'utf8', 'hex');
        encrypted += cipher.final('hex');

        return iv.toString('hex') + ':' + encrypted;
    } catch (err) {
        logError('Encryption failed', err);
        throw new Error('Failed to encrypt key');
    }
}

/**
 * Decrypt a private key
 */
function decryptKey(encryptedData) {
    try {
        const [ivHex, encrypted] = encryptedData.split(':');
        const iv = Buffer.from(ivHex, 'hex');
        const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);

        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    } catch (err) {
        logError('Decryption failed', err);
        throw new Error('Failed to decrypt key');
    }
}

// ==================== USER MANAGEMENT ====================

/**
 * Get or create user by Telegram ID
 */
export async function getOrCreateUser(telegramId, username = null) {
    try {
        const supabase = getSupabase();
        if (!supabase) {
            logWarn('Supabase not configured, using in-memory');
            return { id: telegramId, telegram_id: telegramId, username };
        }

        // Check if user exists
        const { data: existingUser, error: fetchError } = await supabase
            .from('users')
            .select('*')
            .eq('telegram_id', telegramId)
            .single();

        if (existingUser) {
            // Update username if changed
            if (username && existingUser.username !== username) {
                await supabase
                    .from('users')
                    .update({ username, updated_at: new Date().toISOString() })
                    .eq('id', existingUser.id);
            }
            return existingUser;
        }

        // Create new user
        const referralCode = `RF${telegramId.toString().slice(-6)}${Date.now().toString(36).slice(-4)}`.toUpperCase();

        const { data: newUser, error: createError } = await supabase
            .from('users')
            .insert({
                telegram_id: telegramId,
                username: username,
                referral_code: referralCode,
                settings: {
                    mode: 'PAPER',
                    take_profit: 5,
                    stop_loss: 5,
                    onboarding_completed: false,
                    auto_trade_enabled: false,
                    auto_trade_amount: 0.1,
                    profit_alert_thresholds: [25, 50, 100]
                }
            })
            .select()
            .single();

        if (createError) {
            logError('Failed to create user', createError);
            return null;
        }

        logInfo(`New user created: ${telegramId} (${username || 'no username'})`);
        return newUser;
    } catch (err) {
        logError('getOrCreateUser error', err);
        return null;
    }
}

/**
 * Get user by Telegram ID
 */
export async function getUserByTelegramId(telegramId) {
    const supabase = getSupabase();
    if (!supabase) return null;

    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', telegramId)
        .single();

    return data;
}

/**
 * Update user settings
 */
export async function updateUserSettings(telegramId, settings) {
    const supabase = getSupabase();
    if (!supabase) return null;

    const user = await getUserByTelegramId(telegramId);
    if (!user) return null;

    const newSettings = { ...user.settings, ...settings };

    const { data, error } = await supabase
        .from('users')
        .update({ settings: newSettings, updated_at: new Date().toISOString() })
        .eq('telegram_id', telegramId)
        .select()
        .single();

    return data;
}

// ==================== WALLET MANAGEMENT ====================

/**
 * Create new EVM wallet for user
 */
export async function createEvmWallet(telegramId) {
    try {
        // Get or create user
        const user = await getOrCreateUser(telegramId);
        if (!user) {
            return { success: false, error: 'User not found' };
        }

        // Check if wallet already exists
        const existingWallet = await getUserWallet(telegramId, 'evm');
        if (existingWallet) {
            return { success: false, error: 'EVM wallet already exists', wallet: existingWallet };
        }

        // Generate new wallet
        const wallet = ethers.Wallet.createRandom();
        const address = wallet.address;
        const privateKey = wallet.privateKey;

        // Encrypt private key
        const encryptedKey = encryptKey(privateKey);

        // Save to database
        const supabase = getSupabase();
        if (supabase) {
            const { error } = await supabase.from('wallets').insert({
                user_id: user.id,
                chain: 'evm',
                address: address,
                encrypted_key: encryptedKey
            });

            if (error) {
                logError('Failed to save wallet', error);
                return { success: false, error: 'Failed to save wallet' };
            }
        }

        logInfo(`EVM wallet created for ${telegramId}: ${address.slice(0, 10)}...`);

        return {
            success: true,
            address: address,
            privateKey: privateKey, // Return for user to backup - shown once
            chain: 'evm'
        };
    } catch (err) {
        logError('createEvmWallet error', err);
        return { success: false, error: err.message };
    }
}

/**
 * Create new Solana wallet for user
 */
export async function createSolanaWallet(telegramId) {
    try {
        // Get or create user
        const user = await getOrCreateUser(telegramId);
        if (!user) {
            return { success: false, error: 'User not found' };
        }

        // Check if wallet already exists
        const existingWallet = await getUserWallet(telegramId, 'solana');
        if (existingWallet) {
            return { success: false, error: 'Solana wallet already exists', wallet: existingWallet };
        }

        // Generate new wallet
        const keypair = Keypair.generate();
        const address = keypair.publicKey.toBase58();
        const privateKey = bs58.encode(keypair.secretKey);

        // Encrypt private key
        const encryptedKey = encryptKey(privateKey);

        // Save to database
        const supabase = getSupabase();
        if (supabase) {
            const { error } = await supabase.from('wallets').insert({
                user_id: user.id,
                chain: 'solana',
                address: address,
                encrypted_key: encryptedKey
            });

            if (error) {
                logError('Failed to save wallet', error);
                return { success: false, error: 'Failed to save wallet' };
            }
        }

        logInfo(`Solana wallet created for ${telegramId}: ${address.slice(0, 10)}...`);

        return {
            success: true,
            address: address,
            privateKey: privateKey, // Return for user to backup - shown once
            chain: 'solana'
        };
    } catch (err) {
        logError('createSolanaWallet error', err);
        return { success: false, error: err.message };
    }
}

/**
 * Import existing wallet for user
 */
export async function importWallet(telegramId, privateKey, chain = 'evm') {
    try {
        const user = await getOrCreateUser(telegramId);
        if (!user) {
            return { success: false, error: 'User not found' };
        }

        let address;

        if (chain === 'evm') {
            // Validate EVM private key
            try {
                const wallet = new ethers.Wallet(privateKey);
                address = wallet.address;
            } catch (e) {
                return { success: false, error: 'Invalid EVM private key' };
            }
        } else if (chain === 'solana') {
            // Validate Solana private key
            try {
                const secretKey = bs58.decode(privateKey);
                const keypair = Keypair.fromSecretKey(secretKey);
                address = keypair.publicKey.toBase58();
            } catch (e) {
                return { success: false, error: 'Invalid Solana private key' };
            }
        } else {
            return { success: false, error: 'Invalid chain' };
        }

        // Encrypt private key
        const encryptedKey = encryptKey(privateKey);

        // Save or update wallet
        const supabase = getSupabase();
        if (supabase) {
            // Delete existing wallet for this chain if any
            await supabase
                .from('wallets')
                .delete()
                .eq('user_id', user.id)
                .eq('chain', chain);

            // Insert new wallet
            const { error } = await supabase.from('wallets').insert({
                user_id: user.id,
                chain: chain,
                address: address,
                encrypted_key: encryptedKey
            });

            if (error) {
                logError('Failed to import wallet', error);
                return { success: false, error: 'Failed to import wallet' };
            }
        }

        logInfo(`Wallet imported for ${telegramId}: ${address.slice(0, 10)}...`);

        return {
            success: true,
            address: address,
            chain: chain
        };
    } catch (err) {
        logError('importWallet error', err);
        return { success: false, error: err.message };
    }
}

/**
 * Get user's wallet by chain
 */
export async function getUserWallet(telegramId, chain) {
    try {
        const supabase = getSupabase();
        if (!supabase) return null;

        const user = await getUserByTelegramId(telegramId);
        if (!user) return null;

        const { data, error } = await supabase
            .from('wallets')
            .select('*')
            .eq('user_id', user.id)
            .eq('chain', chain)
            .single();

        return data;
    } catch (err) {
        return null;
    }
}

/**
 * Get all wallets for a user
 */
export async function getUserWallets(telegramId) {
    try {
        const supabase = getSupabase();
        if (!supabase) return [];

        const user = await getUserByTelegramId(telegramId);
        if (!user) return [];

        const { data, error } = await supabase
            .from('wallets')
            .select('*')
            .eq('user_id', user.id);

        return data || [];
    } catch (err) {
        return [];
    }
}

/**
 * Get decrypted wallet for trading
 */
export async function getWalletForTrading(telegramId, chain) {
    try {
        const wallet = await getUserWallet(telegramId, chain === 'bsc' || chain === 'base' ? 'evm' : chain);
        if (!wallet || !wallet.encrypted_key) {
            return null;
        }

        const privateKey = decryptKey(wallet.encrypted_key);

        if (chain === 'solana') {
            const secretKey = bs58.decode(privateKey);
            return Keypair.fromSecretKey(secretKey);
        } else {
            // EVM wallet
            return new ethers.Wallet(privateKey);
        }
    } catch (err) {
        logError('getWalletForTrading error', err);
        return null;
    }
}

/**
 * Export private key for user backup
 * @param {string} telegramId - User's Telegram ID
 * @param {string} chain - 'evm' or 'solana'
 * @returns {Promise<{success: boolean, privateKey?: string, error?: string}>}
 */
export async function exportPrivateKey(telegramId, chain = 'evm') {
    try {
        const wallet = await getUserWallet(telegramId, chain);
        if (!wallet || !wallet.encrypted_key) {
            return { success: false, error: 'No wallet found for this chain' };
        }

        const privateKey = decryptKey(wallet.encrypted_key);
        return { success: true, privateKey, address: wallet.address };
    } catch (err) {
        logError('exportPrivateKey error', err);
        return { success: false, error: 'Failed to decrypt key' };
    }
}

/**
 * Get user wallet summary for display with REAL balances
 */
export async function getWalletSummary(telegramId) {
    const wallets = await getUserWallets(telegramId);
    const user = await getUserByTelegramId(telegramId);

    const evmWallet = wallets.find(w => w.chain === 'evm');
    const solWallet = wallets.find(w => w.chain === 'solana');

    let evmBalance = '0';
    let baseBalance = '0';
    let solBalance = '0';

    // Fetch real EVM balances (BSC and Base)
    if (evmWallet?.address) {
        try {
            const { ethers } = await import('ethers');

            // BSC Balance
            const bscRpc = process.env.BSC_RPC_URL || 'https://bsc-dataseed1.binance.org';
            const bscProvider = new ethers.JsonRpcProvider(bscRpc);
            const bscBal = await bscProvider.getBalance(evmWallet.address);
            evmBalance = ethers.formatEther(bscBal);

            // Base Balance
            const baseRpc = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
            const baseProvider = new ethers.JsonRpcProvider(baseRpc);
            const baseBal = await baseProvider.getBalance(evmWallet.address);
            baseBalance = ethers.formatEther(baseBal);
        } catch (err) {
            logError('Failed to fetch EVM balances', err);
        }
    }

    // Fetch real Solana balance
    if (solWallet?.address) {
        try {
            const { Connection, PublicKey, LAMPORTS_PER_SOL } = await import('@solana/web3.js');
            const solRpc = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
            const connection = new Connection(solRpc);
            const pubkey = new PublicKey(solWallet.address);
            const balance = await connection.getBalance(pubkey);
            solBalance = (balance / LAMPORTS_PER_SOL).toFixed(6);
        } catch (err) {
            logError('Failed to fetch Solana balance', err);
        }
    }

    return {
        hasEvm: !!evmWallet,
        hasSolana: !!solWallet,
        evmAddress: evmWallet?.address || null, // Same address for BSC and Base
        solanaAddress: solWallet?.address || null,
        evmBalance, // BSC (BNB)
        baseBalance, // Base (ETH)
        solBalance, // Solana (SOL)
        mode: user?.settings?.mode || 'PAPER',
        username: user?.username || null
    };
}

/**
 * Toggle trading mode for user
 */
export async function toggleTradingMode(telegramId) {
    const user = await getUserByTelegramId(telegramId);
    if (!user) return null;

    const newMode = user.settings?.mode === 'PAPER' ? 'LIVE' : 'PAPER';
    const updated = await updateUserSettings(telegramId, { mode: newMode });

    return updated?.settings?.mode || newMode;
}

/**
 * Get user's trading mode
 */
export async function getUserMode(telegramId) {
    const user = await getUserByTelegramId(telegramId);
    return user?.settings?.mode || 'PAPER';
}

/**
 * Check if user has completed onboarding
 */
export async function hasCompletedOnboarding(telegramId) {
    const user = await getUserByTelegramId(telegramId);
    return user?.settings?.onboarding_completed === true;
}

/**
 * Mark onboarding as complete for user
 */
export async function markOnboardingComplete(telegramId) {
    const updated = await updateUserSettings(telegramId, { onboarding_completed: true });
    logInfo(`Onboarding completed for user: ${telegramId}`);
    return updated;
}

/**
 * Get user's auto-trade settings
 */
export async function getAutoTradeSettings(telegramId) {
    const user = await getUserByTelegramId(telegramId);
    if (!user) return { enabled: false, amount: 0.1, thresholds: [25, 50, 100] };

    return {
        enabled: user.settings?.auto_trade_enabled || false,
        amount: user.settings?.auto_trade_amount || 0.1,
        thresholds: user.settings?.profit_alert_thresholds || [25, 50, 100],
        mode: user.settings?.mode || 'PAPER'
    };
}

/**
 * Update auto-trade settings
 */
export async function updateAutoTradeSettings(telegramId, settings) {
    const updates = {};
    if (typeof settings.enabled !== 'undefined') updates.auto_trade_enabled = settings.enabled;
    if (typeof settings.amount !== 'undefined') updates.auto_trade_amount = settings.amount;
    if (Array.isArray(settings.thresholds)) updates.profit_alert_thresholds = settings.thresholds;

    return updateUserSettings(telegramId, updates);
}

/**
 * Toggle auto-trade on/off
 */
export async function toggleAutoTrade(telegramId) {
    const current = await getAutoTradeSettings(telegramId);
    return updateUserSettings(telegramId, { auto_trade_enabled: !current.enabled });
}

export default {
    getOrCreateUser,
    getUserByTelegramId,
    updateUserSettings,
    createEvmWallet,
    createSolanaWallet,
    importWallet,
    exportPrivateKey,
    getUserWallet,
    getUserWallets,
    getWalletForTrading,
    getWalletSummary,
    toggleTradingMode,
    getUserMode,
    hasCompletedOnboarding,
    markOnboardingComplete,
    getAutoTradeSettings,
    updateAutoTradeSettings,
    toggleAutoTrade,
    executeWithdrawal
};

/**
 * Execute withdrawal - send funds to external address
 * @param {string} telegramId - User's Telegram ID
 * @param {string} chain - 'bsc', 'base', or 'solana'
 * @param {string} toAddress - Destination address
 * @param {number} amount - Amount to send (in native token)
 */
export async function executeWithdrawal(telegramId, chain, toAddress, amount) {
    try {
        logInfo(`Withdrawal request: ${amount} on ${chain} to ${toAddress}`);

        // Get user's wallet
        const walletType = chain === 'solana' ? 'solana' : 'evm';
        const wallet = await getUserWallet(telegramId, walletType);

        if (!wallet || !wallet.encrypted_key) {
            return { success: false, error: 'No wallet found' };
        }

        const privateKey = decryptKey(wallet.encrypted_key);

        if (chain === 'solana') {
            // Solana withdrawal
            const { Connection, PublicKey, Transaction, SystemProgram, Keypair, LAMPORTS_PER_SOL } = await import('@solana/web3.js');
            const bs58Module = await import('bs58');

            const solRpc = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
            const connection = new Connection(solRpc, 'confirmed');

            const secretKey = bs58Module.default.decode(privateKey);
            const keypair = Keypair.fromSecretKey(secretKey);

            const lamports = Math.floor(amount * LAMPORTS_PER_SOL);
            const toPubkey = new PublicKey(toAddress);

            const transaction = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: keypair.publicKey,
                    toPubkey,
                    lamports
                })
            );

            const signature = await connection.sendTransaction(transaction, [keypair]);
            await connection.confirmTransaction(signature, 'confirmed');

            logInfo(`Solana withdrawal complete: ${signature}`);
            return { success: true, txHash: signature, chain: 'solana' };

        } else {
            // EVM withdrawal (BSC or Base)
            const { ethers } = await import('ethers');

            const rpcUrls = {
                bsc: process.env.BSC_RPC_URL || 'https://bsc-dataseed1.binance.org',
                base: process.env.BASE_RPC_URL || 'https://mainnet.base.org'
            };

            const provider = new ethers.JsonRpcProvider(rpcUrls[chain] || rpcUrls.bsc);
            const signer = new ethers.Wallet(privateKey, provider);

            const tx = await signer.sendTransaction({
                to: toAddress,
                value: ethers.parseEther(amount.toString())
            });

            const receipt = await tx.wait();

            logInfo(`EVM withdrawal complete: ${tx.hash}`);
            return { success: true, txHash: tx.hash, chain };
        }
    } catch (err) {
        logError('Withdrawal failed', err);
        return { success: false, error: err.message };
    }
}
