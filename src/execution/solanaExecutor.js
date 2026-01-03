/**
 * DEX Trading Bot - Solana Executor
 * 
 * Handles live trade execution on Solana via Jupiter API
 * Uses @solana/web3.js for blockchain interaction
 * 
 * ⚠️ DISABLED BY DEFAULT - Only enabled when ENABLE_LIVE_TRADING=true
 */

import { Connection, Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { logInfo, logTrade, logError, logWarn } from '../logging/logger.js';
import config, { getChainConfig } from '../config/index.js';
import { executeWithRetry } from './paperTrader.js';
import { processTradeFee, transferFeeToDevWallet, calculateTradingFee } from '../services/feeService.js';

// Jupiter API endpoint
const JUPITER_API = 'https://quote-api.jup.ag/v6';

// SOL mint address
const SOL_MINT = 'So11111111111111111111111111111111111111112';

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
        const rpc = process.env.SOLANA_RPC_URL || config.rpc?.solana || chainConfig?.rpcDefault || 'https://api.mainnet-beta.solana.com';
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
    const walletObj = await getSolanaWallet();

    const balance = await conn.getBalance(walletObj.publicKey);
    return balance / 1e9; // Convert lamports to SOL
}

/**
 * Get Jupiter quote for a swap
 */
async function getJupiterQuote(inputMint, outputMint, amountInLamports, slippageBps = 100) {
    const url = `${JUPITER_API}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountInLamports}&slippageBps=${slippageBps}`;

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Jupiter quote failed: ${response.status}`);
    }

    return await response.json();
}

/**
 * Get Jupiter swap transaction
 */
async function getJupiterSwapTx(quoteResponse, userPublicKey) {
    const response = await fetch(`${JUPITER_API}/swap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            quoteResponse,
            userPublicKey: userPublicKey.toString(),
            wrapAndUnwrapSol: true,
            dynamicComputeUnitLimit: true,
            prioritizationFeeLamports: 'auto'
        })
    });

    if (!response.ok) {
        throw new Error(`Jupiter swap tx failed: ${response.status}`);
    }

    return await response.json();
}

/**
 * Execute a live buy on Solana via Jupiter
 * @param {Object} signal - Trading signal
 * @param {Object} positionSize - Position sizing
 * @param {Object} userWallet - Optional user wallet (Keypair from getWalletForTrading)
 * @returns {Promise<Object>} Transaction result
 */
export async function executeSolanaBuy(signal, positionSize, userWallet = null) {
    if (!isSolanaLiveEnabled()) {
        logError('Solana live trading is not enabled!');
        return { success: false, error: 'Solana live trading disabled' };
    }

    logWarn(`🔴 [SOLANA LIVE] Executing BUY: ${signal.token}`);

    const result = await executeWithRetry(async () => {
        const conn = getConnection();

        // Use user wallet if provided, otherwise fall back to global wallet
        const walletObj = userWallet || await getSolanaWallet();
        if (userWallet) {
            logInfo(`Using per-user wallet: ${walletObj.publicKey.toString().slice(0, 10)}...`);
        }

        // Calculate amount in lamports (SOL * 1e9)
        const solAmount = positionSize.positionSizeUsd / (signal.entryPrice || 1);
        const amountInLamports = Math.floor(solAmount * 1e9);

        logInfo(`Getting Jupiter quote: ${solAmount.toFixed(4)} SOL -> ${signal.token}`);

        // Get quote (SOL -> Token)
        const quoteResponse = await getJupiterQuote(
            SOL_MINT,
            signal.tokenAddress,
            amountInLamports,
            100 // 1% slippage
        );

        logInfo(`Quote received: ${quoteResponse.outAmount} tokens expected`);

        // Get swap transaction
        const { swapTransaction } = await getJupiterSwapTx(quoteResponse, walletObj.publicKey);

        // Deserialize and sign
        const swapTxBuf = Buffer.from(swapTransaction, 'base64');
        const transaction = VersionedTransaction.deserialize(swapTxBuf);
        transaction.sign([walletObj]);

        // Send transaction
        const txHash = await conn.sendRawTransaction(transaction.serialize(), {
            skipPreflight: true,
            maxRetries: 3
        });

        logInfo(`Transaction sent: ${txHash}`);

        // Wait for confirmation
        const confirmation = await conn.confirmTransaction(txHash, 'confirmed');

        if (confirmation.value.err) {
            throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
        }

        logInfo(`Transaction confirmed: ${txHash}`);

        // Log the trade
        logTrade({
            action: 'SOLANA_LIVE_BUY',
            chain: 'solana',
            token: signal.token,
            tokenAddress: signal.tokenAddress,
            txHash,
            amount: solAmount,
            tokensReceived: quoteResponse.outAmount
        });

        return {
            success: true,
            txHash,
            tokensReceived: quoteResponse.outAmount,
            amountSpent: solAmount
        };
    });

    return result;
}

/**
 * Execute a live sell on Solana via Jupiter
 * @param {Object} position - Open position
 * @param {number} currentPrice - Current market price
 * @param {string} reason - Exit reason
 * @param {Object} userWallet - Optional user wallet (Keypair from getWalletForTrading)
 * @returns {Promise<Object>} Transaction result
 */
export async function executeSolanaSell(position, currentPrice, reason, userWallet = null) {
    if (!isSolanaLiveEnabled()) {
        logError('Solana live trading is not enabled!');
        return { success: false, error: 'Solana live trading disabled' };
    }

    logWarn(`🔴 [SOLANA LIVE] Executing SELL: ${position.token}`);
    logInfo(`Reason: ${reason}`);

    const result = await executeWithRetry(async () => {
        const conn = getConnection();

        // Use user wallet if provided, otherwise fall back to global wallet
        const walletObj = userWallet || await getSolanaWallet();
        if (userWallet) {
            logInfo(`Using per-user wallet: ${walletObj.publicKey.toString().slice(0, 10)}...`);
        }

        // Get token balance
        const tokenAccounts = await conn.getParsedTokenAccountsByOwner(
            walletObj.publicKey,
            { mint: new PublicKey(position.tokenAddress) }
        );

        if (tokenAccounts.value.length === 0) {
            throw new Error('No token balance found');
        }

        const tokenBalance = tokenAccounts.value[0].account.data.parsed.info.tokenAmount.amount;

        logInfo(`Getting Jupiter quote: ${tokenBalance} tokens -> SOL`);

        // Get quote (Token -> SOL)
        const quoteResponse = await getJupiterQuote(
            position.tokenAddress,
            SOL_MINT,
            tokenBalance,
            100 // 1% slippage
        );

        const expectedSol = parseInt(quoteResponse.outAmount) / 1e9;
        logInfo(`Quote received: ${expectedSol.toFixed(6)} SOL expected`);

        // Get swap transaction
        const { swapTransaction } = await getJupiterSwapTx(quoteResponse, walletObj.publicKey);

        // Deserialize and sign
        const swapTxBuf = Buffer.from(swapTransaction, 'base64');
        const transaction = VersionedTransaction.deserialize(swapTxBuf);
        transaction.sign([walletObj]);

        // Send transaction
        const txHash = await conn.sendRawTransaction(transaction.serialize(), {
            skipPreflight: true,
            maxRetries: 3
        });

        logInfo(`Transaction sent: ${txHash}`);

        // Wait for confirmation
        const confirmation = await conn.confirmTransaction(txHash, 'confirmed');

        if (confirmation.value.err) {
            throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
        }

        logInfo(`Transaction confirmed: ${txHash}`);

        // Log the trade
        logTrade({
            action: 'SOLANA_LIVE_SELL',
            chain: 'solana',
            token: position.token,
            tokenAddress: position.tokenAddress,
            reason,
            txHash,
            proceeds: expectedSol
        });

        // Collect fee and transfer to dev wallet
        const feeUsd = calculateTradingFee(expectedSol);

        if (feeUsd > 0.0001) {
            try {
                await processTradeFee(position.userId, expectedSol, position.referrerId, txHash);

                // Transfer net fee (70%) to dev wallet
                const netFeeSol = feeUsd * 0.7;
                await transferFeeToDevWallet('solana', netFeeSol, walletObj);
                logInfo(`💰 Fee collected: ${feeUsd.toFixed(6)} SOL`);
            } catch (feeErr) {
                logError('Fee transfer failed (trade still succeeded)', feeErr);
            }
        }

        return {
            success: true,
            txHash,
            proceeds: expectedSol,
            feeCollected: feeUsd
        };
    });

    return result;
}

/**
 * Check Solana wallet status
 */
export async function checkSolanaWalletStatus() {
    try {
        const walletObj = await getSolanaWallet();
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
