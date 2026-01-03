/**
 * RedFace Trading Bot - Gas Service
 * 
 * Monitors network gas prices for BSC, Base, and Solana
 */

import { logError } from '../logging/logger.js';

// Default RPCs (should be env vars in production)
const BSC_RPC = process.env.BSC_RPC_URL || 'https://bsc-dataseed1.binance.org';
const BASE_RPC = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const SOLANA_RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

/**
 * Get BSC Gas Price (Gwei)
 */
export async function getBscGasPrice() {
    try {
        const { ethers } = await import('ethers');
        const provider = new ethers.JsonRpcProvider(BSC_RPC);
        const feeData = await provider.getFeeData();
        return {
            gasPrice: ethers.formatUnits(feeData.gasPrice, 'gwei'),
            formatted: `${parseFloat(ethers.formatUnits(feeData.gasPrice, 'gwei')).toFixed(2)} Gwei`
        };
    } catch (err) {
        logError('Failed to fetch BSC gas', err);
        return { gasPrice: '0', formatted: 'Unknown' };
    }
}

/**
 * Get Base Gas Price (Gwei)
 */
export async function getBaseGasPrice() {
    try {
        const { ethers } = await import('ethers');
        const provider = new ethers.JsonRpcProvider(BASE_RPC);
        const feeData = await provider.getFeeData();

        // EIP-1559 support
        const priority = feeData.maxPriorityFeePerGas ? ethers.formatUnits(feeData.maxPriorityFeePerGas, 'gwei') : '0';
        const base = feeData.gasPrice ? ethers.formatUnits(feeData.gasPrice, 'gwei') : '0';

        return {
            gasPrice: base,
            priority,
            formatted: `${parseFloat(base).toFixed(4)} Gwei`
        };
    } catch (err) {
        logError('Failed to fetch Base gas', err);
        return { gasPrice: '0', formatted: 'Unknown' };
    }
}

/**
 * Get Solana Fee / Performance
 */
export async function getSolanaStatus() {
    try {
        const { Connection } = await import('@solana/web3.js');
        const connection = new Connection(SOLANA_RPC);

        const perf = await connection.getRecentPerformanceSamples(1);
        const tps = perf && perf[0] ? (perf[0].numTransactions / perf[0].samplePeriodSecs).toFixed(0) : 'Unknown';

        return {
            tps,
            formatted: `${tps} TPS`
        };
    } catch (err) {
        logError('Failed to fetch Solana status', err);
        return { tps: '0', formatted: 'Unknown' };
    }
}

/**
 * Get all network stats
 */
export async function getNetworkStats() {
    const [bsc, base, sol] = await Promise.all([
        getBscGasPrice(),
        getBaseGasPrice(),
        getSolanaStatus()
    ]);

    return {
        bsc,
        base,
        solana: sol
    };
}

export default {
    getBscGasPrice,
    getBaseGasPrice,
    getSolanaStatus,
    getNetworkStats
};
