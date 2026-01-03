/**
 * DEX Trading Bot - EVM Executor
 * 
 * Handles live trade execution on EVM chains (BSC, Base)
 * Uses ethers.js for blockchain interaction
 * 
 * ⚠️ DISABLED BY DEFAULT - Only enabled when ENABLE_LIVE_TRADING=true
 */

import { ethers } from 'ethers';
import { logInfo, logTrade, logError, logWarn } from '../logging/logger.js';
import config, { getChainConfig } from '../config/index.js';
import { executeWithRetry } from './paperTrader.js';
import { processTradeFee, transferFeeToDevWallet, calculateTradingFee } from '../services/feeService.js';

// Standard ERC20 ABI (minimal)
const ERC20_ABI = [
    'function approve(address spender, uint256 amount) returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function balanceOf(address account) view returns (uint256)',
    'function decimals() view returns (uint8)'
];

// Uniswap V2 Router ABI (minimal)
const ROUTER_ABI = [
    'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) payable returns (uint[] memory amounts)',
    'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) returns (uint[] memory amounts)',
    'function getAmountsOut(uint amountIn, address[] calldata path) view returns (uint[] memory amounts)',
    'function WETH() view returns (address)'
];

// Provider cache
const providers = new Map();
const wallets = new Map();

/**
 * Check if live trading is enabled
 */
export function isLiveEnabled() {
    return config.mode === 'LIVE' && config.enableLiveTrading;
}

/**
 * Initialize provider for a chain
 */
export function getProvider(chainId) {
    if (!providers.has(chainId)) {
        const chainConfig = getChainConfig(chainId);
        if (!chainConfig) {
            throw new Error(`Unknown chain: ${chainId}`);
        }

        const rpc = config.rpc[chainId] || chainConfig.rpcDefault;
        const provider = new ethers.JsonRpcProvider(rpc);
        providers.set(chainId, provider);
        logInfo(`Provider initialized for ${chainId}: ${rpc}`);
    }

    return providers.get(chainId);
}

/**
 * Get wallet for a chain
 */
export function getWallet(chainId) {
    if (!wallets.has(chainId)) {
        const privateKey = process.env.EVM_PRIVATE_KEY;

        if (!privateKey) {
            throw new Error('EVM_PRIVATE_KEY not set in environment');
        }

        const provider = getProvider(chainId);
        const wallet = new ethers.Wallet(privateKey, provider);
        wallets.set(chainId, wallet);
        logInfo(`Wallet initialized for ${chainId}: ${wallet.address.slice(0, 10)}...`);
    }

    return wallets.get(chainId);
}

/**
 * Get native token balance
 */
export async function getNativeBalance(chainId) {
    const wallet = getWallet(chainId);
    const balance = await wallet.provider.getBalance(wallet.address);
    return ethers.formatEther(balance);
}

/**
 * Get token balance
 */
export async function getTokenBalance(chainId, tokenAddress) {
    const wallet = getWallet(chainId);
    const token = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);

    const [balance, decimals] = await Promise.all([
        token.balanceOf(wallet.address),
        token.decimals()
    ]);

    return ethers.formatUnits(balance, decimals);
}

/**
 * Approve token spending
 */
async function approveToken(chainId, tokenAddress, spenderAddress, amount) {
    const wallet = getWallet(chainId);
    const token = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);

    const currentAllowance = await token.allowance(wallet.address, spenderAddress);

    if (currentAllowance >= amount) {
        logInfo('Token already approved');
        return true;
    }

    logInfo(`Approving token ${tokenAddress} for ${spenderAddress}...`);

    const tx = await token.approve(spenderAddress, ethers.MaxUint256);
    await tx.wait();

    logInfo(`Token approved: ${tx.hash}`);
    return true;
}

/**
 * Execute a live buy on EVM chain
 * @param {Object} signal - Trading signal
 * @param {Object} positionSize - Position sizing
 * @param {Object} userWallet - Optional user wallet (from getWalletForTrading)
 * @returns {Promise<Object>} Transaction result
 */
export async function executeLiveBuy(signal, positionSize, userWallet = null) {
    if (!isLiveEnabled()) {
        logError('Live trading is not enabled!');
        return { success: false, error: 'Live trading disabled' };
    }

    logWarn(`🔴 [LIVE] Executing BUY: ${signal.token} on ${signal.chain.toUpperCase()}`);

    const result = await executeWithRetry(async () => {
        const chainConfig = getChainConfig(signal.chain);

        // Use user wallet if provided, otherwise fall back to global wallet
        let wallet;
        if (userWallet) {
            const provider = getProvider(signal.chain);
            wallet = userWallet.connect(provider);
            logInfo(`Using per-user wallet: ${wallet.address.slice(0, 10)}...`);
        } else {
            wallet = getWallet(signal.chain);
        }
        const router = new ethers.Contract(chainConfig.dex.router, ROUTER_ABI, wallet);

        // Get WETH address
        const weth = await router.WETH();

        // Build path: WETH -> Token
        const path = [weth, signal.tokenAddress];

        // Calculate amounts
        const amountIn = ethers.parseEther((positionSize.positionSizeUsd / signal.entryPrice).toString());

        // Get expected output
        const amounts = await router.getAmountsOut(amountIn, path);
        const expectedOut = amounts[amounts.length - 1];

        // Apply slippage tolerance
        const slippageMultiplier = 1 - (config.execution.slippageTolerance / 100);
        const amountOutMin = expectedOut * BigInt(Math.floor(slippageMultiplier * 1000)) / 1000n;

        // Deadline: 5 minutes
        const deadline = Math.floor(Date.now() / 1000) + 300;

        logInfo(`Executing swap: ${ethers.formatEther(amountIn)} ${chainConfig.nativeToken.symbol} -> ${signal.token}`);
        logInfo(`Min output: ${ethers.formatUnits(amountOutMin, 18)} tokens`);

        // Execute swap
        const tx = await router.swapExactETHForTokens(
            amountOutMin,
            path,
            wallet.address,
            deadline,
            { value: amountIn }
        );

        logInfo(`Transaction sent: ${tx.hash}`);

        // Wait for confirmation
        const receipt = await tx.wait();

        logInfo(`Transaction confirmed in block ${receipt.blockNumber}`);

        // Log the trade
        logTrade({
            action: 'LIVE_BUY',
            chain: signal.chain,
            token: signal.token,
            txHash: tx.hash,
            block: receipt.blockNumber,
            gasUsed: receipt.gasUsed.toString()
        });

        return {
            txHash: tx.hash,
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed.toString()
        };
    });

    return result;
}

/**
 * Execute a live sell on EVM chain
 * @param {Object} position - Open position
 * @param {number} currentPrice - Current market price
 * @param {string} reason - Exit reason
 * @param {Object} userWallet - Optional user wallet (from getWalletForTrading)
 * @returns {Promise<Object>} Transaction result
 */
export async function executeLiveSell(position, currentPrice, reason, userWallet = null) {
    if (!isLiveEnabled()) {
        logError('Live trading is not enabled!');
        return { success: false, error: 'Live trading disabled' };
    }

    logWarn(`🔴 [LIVE] Executing SELL: ${position.token} on ${position.chain.toUpperCase()}`);
    logInfo(`Reason: ${reason}`);

    const result = await executeWithRetry(async () => {
        const chainConfig = getChainConfig(position.chain);

        // Use user wallet if provided, otherwise fall back to global wallet
        let wallet;
        if (userWallet) {
            const provider = getProvider(position.chain);
            wallet = userWallet.connect(provider);
            logInfo(`Using per-user wallet: ${wallet.address.slice(0, 10)}...`);
        } else {
            wallet = getWallet(position.chain);
        }
        const router = new ethers.Contract(chainConfig.dex.router, ROUTER_ABI, wallet);

        // Get WETH address
        const weth = await router.WETH();

        // Get token balance
        const token = new ethers.Contract(position.tokenAddress, ERC20_ABI, wallet);
        const tokenBalance = await token.balanceOf(wallet.address);
        const decimals = await token.decimals();

        // Approve router if needed
        await approveToken(position.chain, position.tokenAddress, chainConfig.dex.router, tokenBalance);

        // Build path: Token -> WETH
        const path = [position.tokenAddress, weth];

        // Get expected output
        const amounts = await router.getAmountsOut(tokenBalance, path);
        const expectedOut = amounts[amounts.length - 1];

        // Apply slippage tolerance
        const slippageMultiplier = 1 - (config.execution.slippageTolerance / 100);
        const amountOutMin = expectedOut * BigInt(Math.floor(slippageMultiplier * 1000)) / 1000n;

        // Deadline: 5 minutes
        const deadline = Math.floor(Date.now() / 1000) + 300;

        logInfo(`Executing swap: ${ethers.formatUnits(tokenBalance, decimals)} ${position.token} -> ${chainConfig.nativeToken.symbol}`);
        logInfo(`Min output: ${ethers.formatEther(amountOutMin)} ${chainConfig.nativeToken.symbol}`);

        // Execute swap
        const tx = await router.swapExactTokensForETH(
            tokenBalance,
            amountOutMin,
            path,
            wallet.address,
            deadline
        );

        logInfo(`Transaction sent: ${tx.hash}`);

        // Wait for confirmation
        const receipt = await tx.wait();

        logInfo(`Transaction confirmed in block ${receipt.blockNumber}`);

        // Log the trade
        logTrade({
            action: 'LIVE_SELL',
            chain: position.chain,
            token: position.token,
            reason: reason,
            txHash: tx.hash,
            block: receipt.blockNumber,
            gasUsed: receipt.gasUsed.toString()
        });

        // Collect fee and transfer to dev wallet
        const proceedsFloat = parseFloat(ethers.formatEther(expectedOut));
        const feeUsd = calculateTradingFee(proceedsFloat);

        if (feeUsd > 0.0001) { // Only transfer if fee is meaningful
            try {
                await processTradeFee(position.userId, proceedsFloat, position.referrerId, tx.hash);

                // Transfer net fee (70%) to dev wallet
                const netFeeNative = feeUsd * 0.7; // 70% after referral
                await transferFeeToDevWallet(position.chain, netFeeNative, wallet);
                logInfo(`💰 Fee collected: ${feeUsd.toFixed(6)} ${chainConfig.nativeToken.symbol}`);
            } catch (feeErr) {
                logError('Fee transfer failed (trade still succeeded)', feeErr);
            }
        }

        return {
            txHash: tx.hash,
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed.toString(),
            proceeds: ethers.formatEther(expectedOut),
            feeCollected: feeUsd
        };
    });

    return result;
}

/**
 * Check wallet connection and balance
 */
export async function checkWalletStatus(chainId) {
    try {
        const wallet = getWallet(chainId);
        const balance = await getNativeBalance(chainId);
        const chainConfig = getChainConfig(chainId);

        return {
            connected: true,
            address: wallet.address,
            chain: chainId,
            balance: `${balance} ${chainConfig.nativeToken.symbol}`
        };
    } catch (err) {
        return {
            connected: false,
            error: err.message
        };
    }
}

export default {
    isLiveEnabled,
    getProvider,
    getWallet,
    getNativeBalance,
    getTokenBalance,
    executeLiveBuy,
    executeLiveSell,
    checkWalletStatus
};
