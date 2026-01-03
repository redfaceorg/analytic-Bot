/**
 * RedFace Trading Bot - Fee Service
 * 
 * Handles trading fees and referral commissions
 * Revenue model for the bot
 */

import { logInfo, logError } from '../logging/logger.js';

// Fee configuration
export const TRADING_FEE_PERCENT = 0.5; // 0.5% per trade
export const REFERRER_COMMISSION_PERCENT = 30; // 30% of fee goes to referrer

// Fee collection wallet addresses
const FEE_WALLETS = {
    evm: '0xb50ea4506b9a7d41c1bdb650bd0b00487fb6daf0',  // BSC + Base
    solana: 'ADPimQCm7wPRT3zp796Jin4SXSxYxTeibVxADf11PGEg'
};

/**
 * Get fee wallet for a chain
 */
export function getFeeWallet(chain) {
    if (chain === 'solana') {
        return FEE_WALLETS.solana;
    }
    return FEE_WALLETS.evm; // BSC, Base, etc.
}

// Fee tracking (in-memory, should be moved to Supabase for persistence)
const feeTracker = {
    totalFeesCollected: 0,
    totalReferralPaid: 0,
    feesByUser: new Map(),
    referralsByUser: new Map()
};

/**
 * Calculate trading fee for an amount
 */
export function calculateTradingFee(amountUsd) {
    return amountUsd * (TRADING_FEE_PERCENT / 100);
}

/**
 * Calculate referral commission from a fee
 */
export function calculateReferralCommission(feeAmount) {
    return feeAmount * (REFERRER_COMMISSION_PERCENT / 100);
}

/**
 * Process trade and collect fee
 * @param {string} userId - User ID
 * @param {number} tradeAmountUsd - Trade amount in USD
 * @param {string} referrerId - Referrer user ID (optional)
 * @param {string} tradeId - Trade ID for linking (optional)
 * @returns {object} Fee breakdown
 */
export async function processTradeFee(userId, tradeAmountUsd, referrerId = null, tradeId = null) {
    const fee = calculateTradingFee(tradeAmountUsd);
    let referralCommission = 0;
    let netFee = fee;

    // Pay referral commission if applicable
    if (referrerId && referrerId !== userId) {
        referralCommission = calculateReferralCommission(fee);
        netFee = fee - referralCommission;

        // Track in-memory
        const currentReferral = feeTracker.referralsByUser.get(referrerId) || 0;
        feeTracker.referralsByUser.set(referrerId, currentReferral + referralCommission);
        feeTracker.totalReferralPaid += referralCommission;

        // Persist to Supabase
        try {
            const { getSupabase } = await import('../database/supabase.js');
            const supabase = getSupabase();
            if (supabase) {
                await supabase
                    .from('referral_earnings')
                    .insert({
                        user_id: referrerId,
                        referred_user_id: userId,
                        trade_id: tradeId,
                        commission_amount: referralCommission
                    });
                logInfo(`Referral earning persisted: $${referralCommission.toFixed(4)} to ${referrerId}`);
            }
        } catch (err) {
            logError('Failed to persist referral earning', err);
        }
    }

    // Track fee collection
    feeTracker.totalFeesCollected += netFee;
    const currentUserFees = feeTracker.feesByUser.get(userId) || 0;
    feeTracker.feesByUser.set(userId, currentUserFees + fee);

    logInfo(`Fee collected: $${fee.toFixed(4)} (${TRADING_FEE_PERCENT}% of $${tradeAmountUsd.toFixed(2)})`);

    if (referralCommission > 0) {
        logInfo(`Referral commission: $${referralCommission.toFixed(4)} to ${referrerId}`);
    }

    return {
        fee,
        netFee,
        referralCommission,
        feePercent: TRADING_FEE_PERCENT
    };
}

/**
 * Get user's total fees paid
 */
export function getUserTotalFees(userId) {
    return feeTracker.feesByUser.get(userId) || 0;
}

/**
 * Get user's referral earnings
 */
export function getUserReferralEarnings(userId) {
    return feeTracker.referralsByUser.get(userId) || 0;
}

/**
 * Get fee summary
 */
export function getFeeSummary() {
    return {
        totalFeesCollected: feeTracker.totalFeesCollected,
        totalReferralPaid: feeTracker.totalReferralPaid,
        netRevenue: feeTracker.totalFeesCollected,
        feePercent: TRADING_FEE_PERCENT,
        referralPercent: REFERRER_COMMISSION_PERCENT
    };
}

/**
 * Format fee message for trade confirmation
 */
export function formatFeeMessage(tradeAmountUsd) {
    const fee = calculateTradingFee(tradeAmountUsd);
    return `💰 Trading Fee: $${fee.toFixed(4)} (${TRADING_FEE_PERCENT}%)`;
}

/**
 * Transfer fee to development wallet (on-chain)
 * @param {string} chain - Chain ID (bsc, base, solana)
 * @param {number} amountNative - Amount in native token (BNB, ETH, SOL)
 * @param {object} wallet - User's wallet for signing
 * @returns {Promise<object>} Transaction result
 */
export async function transferFeeToDevWallet(chain, amountNative, wallet) {
    const feeWallet = getFeeWallet(chain);

    if (amountNative <= 0) {
        return { success: false, error: 'Amount too small' };
    }

    try {
        if (chain === 'solana') {
            // Solana transfer
            const { Connection, PublicKey, SystemProgram, Transaction } = await import('@solana/web3.js');
            const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');

            const lamports = Math.floor(amountNative * 1e9); // SOL to lamports

            const transaction = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: wallet.publicKey,
                    toPubkey: new PublicKey(feeWallet),
                    lamports
                })
            );

            transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
            transaction.feePayer = wallet.publicKey;

            const signedTx = await wallet.signTransaction(transaction);
            const txHash = await connection.sendRawTransaction(signedTx.serialize());

            logInfo(`💰 Fee transferred to dev wallet (Solana): ${amountNative} SOL, tx: ${txHash}`);
            return { success: true, txHash, chain: 'solana' };

        } else {
            // EVM transfer (BSC, Base)
            const { ethers } = await import('ethers');
            const rpcUrl = chain === 'base'
                ? (process.env.BASE_RPC_URL || 'https://mainnet.base.org')
                : (process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org');

            const provider = new ethers.JsonRpcProvider(rpcUrl);
            const signer = new ethers.Wallet(wallet.privateKey, provider);

            const tx = await signer.sendTransaction({
                to: feeWallet,
                value: ethers.parseEther(amountNative.toString())
            });

            await tx.wait();

            logInfo(`💰 Fee transferred to dev wallet (${chain.toUpperCase()}): ${amountNative} native, tx: ${tx.hash}`);
            return { success: true, txHash: tx.hash, chain };
        }
    } catch (err) {
        logError(`Failed to transfer fee on ${chain}`, err);
        return { success: false, error: err.message };
    }
}

export default {
    FEE_WALLETS,
    TRADING_FEE_PERCENT,
    REFERRER_COMMISSION_PERCENT,
    getFeeWallet,
    calculateTradingFee,
    calculateReferralCommission,
    processTradeFee,
    getUserTotalFees,
    getUserReferralEarnings,
    getFeeSummary,
    formatFeeMessage,
    transferFeeToDevWallet
};
