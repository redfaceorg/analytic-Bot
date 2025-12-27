/**
 * DEX Trading Bot - Solana Executor
 * 
 * Handles live trade execution on Solana
 * Uses @solana/web3.js for blockchain interaction
 * 
 * ⚠️ DISABLED BY DEFAULT - Only enabled when ENABLE_LIVE_TRADING=true
 * 
 * Note: Solana DEX integration is more complex than EVM.
 * This is a placeholder that logs trades for future implementation.
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { logInfo, logTrade, logError, logWarn } from '../logging/logger.js';
import config, { getChainConfig } from '../config/index.js';
import { executeWithRetry } from './paperTrader.js';

// Connection cache
let connection = null;
let wallet = null;

/**
 * Check if Solana live trading is enabled
 */
export function isSolanaLiveEnabled() {
    return config.mode === 'LIVE' &&
        config.enableLiveTrading &&
        config.enabledChains.solana;
}

/**
 * Initialize Solana connection
 */
export function getConnection() {
    if (!connection) {
        const chainConfig = getChainConfig('solana');
        const rpc = config.rpc.solana || chainConfig.rpcDefault;
        connection = new Connection(rpc, 'confirmed');
        logInfo(`Solana connection initialized: ${rpc}`);
    }

    return connection;
}

/**
 * Get Solana wallet
 */
export async function getSolanaWallet() {
    if (!wallet) {
        const privateKey = process.env.SOLANA_PRIVATE_KEY;

        if (!privateKey) {
            throw new Error('SOLANA_PRIVATE_KEY not set in environment');
        }

        try {
            // Support both base58 and array format
            if (privateKey.startsWith('[')) {
                const keyArray = JSON.parse(privateKey);
                wallet = Keypair.fromSecretKey(Uint8Array.from(keyArray));
            } else {
                // Base58 encoded
                const bs58 = await import('bs58');
                wallet = Keypair.fromSecretKey(bs58.default.decode(privateKey));
            }

            logInfo(`Solana wallet initialized: ${wallet.publicKey.toString().slice(0, 10)}...`);
        } catch (err) {
            throw new Error(`Invalid SOLANA_PRIVATE_KEY format: ${err.message}`);
        }
    }

    return wallet;
}

/**
 * Get SOL balance
 */
export async function getSolBalance() {
    const conn = getConnection();
    const walletObj = getSolanaWallet();

    const balance = await conn.getBalance(walletObj.publicKey);
    return balance / 1e9; // Convert lamports to SOL
}

/**
 * Execute a live buy on Solana
 * 
 * NOTE: Full Raydium/Jupiter integration is complex.
 * This placeholder logs the intent for future implementation.
 */
export async function executeSolanaBuy(signal, positionSize) {
    if (!isSolanaLiveEnabled()) {
        logError('Solana live trading is not enabled!');
        return { success: false, error: 'Solana live trading disabled' };
    }

    logWarn(`🔴 [SOLANA LIVE] BUY request: ${signal.token}`);
    logWarn('⚠️ Solana DEX integration pending - logging trade intent');

    // For now, log the trade intent
    logTrade({
        action: 'SOLANA_BUY_INTENT',
        chain: 'solana',
        token: signal.token,
        tokenAddress: signal.tokenAddress,
        amount: positionSize.positionSizeUsd,
        entryPrice: signal.entryPrice,
        status: 'PENDING_IMPLEMENTATION',
        timestamp: Date.now()
    });

    // TODO: Implement Raydium or Jupiter swap
    // 1. Get token accounts
    // 2. Build swap instruction
    // 3. Sign and send transaction
    // 4. Confirm transaction

    return {
        success: false,
        error: 'Solana DEX integration pending',
        logged: true
    };
}

/**
 * Execute a live sell on Solana
 */
export async function executeSolanaSell(position, currentPrice, reason) {
    if (!isSolanaLiveEnabled()) {
        logError('Solana live trading is not enabled!');
        return { success: false, error: 'Solana live trading disabled' };
    }

    logWarn(`🔴 [SOLANA LIVE] SELL request: ${position.token}`);
    logWarn('⚠️ Solana DEX integration pending - logging trade intent');

    // For now, log the trade intent
    logTrade({
        action: 'SOLANA_SELL_INTENT',
        chain: 'solana',
        token: position.token,
        tokenAddress: position.tokenAddress,
        reason: reason,
        exitPrice: currentPrice,
        status: 'PENDING_IMPLEMENTATION',
        timestamp: Date.now()
    });

    return {
        success: false,
        error: 'Solana DEX integration pending',
        logged: true
    };
}

/**
 * Check Solana wallet status
 */
export async function checkSolanaWalletStatus() {
    try {
        const walletObj = getSolanaWallet();
        const balance = await getSolBalance();

        return {
            connected: true,
            address: walletObj.publicKey.toString(),
            chain: 'solana',
            balance: `${balance.toFixed(4)} SOL`
        };
    } catch (err) {
        return {
            connected: false,
            error: err.message
        };
    }
}

export default {
    isSolanaLiveEnabled,
    getConnection,
    getSolanaWallet,
    getSolBalance,
    executeSolanaBuy,
    executeSolanaSell,
    checkSolanaWalletStatus
};
