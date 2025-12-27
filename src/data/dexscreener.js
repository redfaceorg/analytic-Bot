/**
 * DEX Trading Bot - DexScreener API Client
 * 
 * Fetches real-time price, volume, and liquidity data from DexScreener
 * Free API, no authentication required
 * 
 * API Docs: https://docs.dexscreener.com/api/reference
 */

import { logInfo, logError, logDebug } from '../logging/logger.js';

const BASE_URL = 'https://api.dexscreener.com/latest/dex';

// Rate limiting - DexScreener allows ~300 requests/minute
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 200; // 200ms between requests

/**
 * Fetch with rate limiting and error handling
 */
async function fetchWithRateLimit(url) {
    // Enforce rate limiting
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;

    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
        await sleep(MIN_REQUEST_INTERVAL - timeSinceLastRequest);
    }

    lastRequestTime = Date.now();

    try {
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
    } catch (error) {
        logError(`DexScreener API error: ${url}`, error);
        throw error;
    }
}

/**
 * Sleep helper
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get token pairs by chain
 * @param {string} chainId - Chain ID (bsc, base, solana)
 * @param {string} tokenAddress - Token contract address
 * @returns {Promise<Object>} Pair data
 */
export async function getTokenPairs(chainId, tokenAddress) {
    const url = `${BASE_URL}/tokens/${tokenAddress}`;
    logDebug(`Fetching token pairs: ${tokenAddress} on ${chainId}`);

    const data = await fetchWithRateLimit(url);

    // Filter pairs for specific chain
    const pairs = data.pairs?.filter(p => p.chainId === chainId) || [];

    return pairs;
}

/**
 * Search for tokens by query
 * @param {string} query - Search query
 * @returns {Promise<Array>} Matching pairs
 */
export async function searchTokens(query) {
    const url = `${BASE_URL}/search?q=${encodeURIComponent(query)}`;
    logDebug(`Searching tokens: ${query}`);

    const data = await fetchWithRateLimit(url);
    return data.pairs || [];
}

/**
 * Get top pairs for a chain by volume
 * @param {string} chainId - Chain ID
 * @returns {Promise<Array>} Top pairs
 */
export async function getTopPairsByChain(chainId) {
    // DexScreener doesn't have a direct "top pairs" endpoint for chains
    // But we can search for popular tokens or use the pairs endpoint
    const url = `${BASE_URL}/pairs/${chainId}`;

    // Note: This endpoint requires specific pair addresses
    // For discovery, we'll use a different approach
    logDebug(`Getting pairs for chain: ${chainId}`);

    // Workaround: Search for common base tokens on each chain
    const baseTokens = {
        bsc: ['WBNB', 'BUSD', 'USDT'],
        base: ['WETH', 'USDbC', 'USDC'],
        solana: ['SOL', 'USDC', 'USDT']
    };

    const results = [];
    for (const token of baseTokens[chainId] || []) {
        try {
            const pairs = await searchTokens(`${token} ${chainId}`);
            results.push(...pairs.filter(p => p.chainId === chainId).slice(0, 10));
        } catch (err) {
            // Continue on error
        }
    }

    return results;
}

/**
 * Get pair data by address
 * @param {string} chainId - Chain ID
 * @param {string} pairAddress - Pair contract address
 * @returns {Promise<Object>} Pair data
 */
export async function getPairByAddress(chainId, pairAddress) {
    const url = `${BASE_URL}/pairs/${chainId}/${pairAddress}`;
    logDebug(`Fetching pair: ${pairAddress} on ${chainId}`);

    const data = await fetchWithRateLimit(url);
    return data.pairs?.[0] || null;
}

/**
 * Get new pairs on a chain (24h activity)
 * Great for finding degen opportunities
 * @param {string} chainId - Chain ID
 * @returns {Promise<Array>} New pairs
 */
export async function getNewPairs(chainId) {
    // DexScreener profiles endpoint shows trending/new tokens
    const url = `https://api.dexscreener.com/token-profiles/latest/v1`;

    try {
        const data = await fetchWithRateLimit(url);
        // Filter by chain
        return data.filter(p => p.chainId === chainId).slice(0, 50);
    } catch (err) {
        // Fallback: return empty array
        return [];
    }
}

/**
 * Parse pair data into standardized format
 * @param {Object} pair - Raw DexScreener pair data
 * @returns {Object} Standardized pair data
 */
export function parsePairData(pair) {
    if (!pair) return null;

    return {
        chain: pair.chainId,
        pairAddress: pair.pairAddress,
        dex: pair.dexId,

        // Base token (usually the traded token)
        baseToken: {
            address: pair.baseToken?.address,
            symbol: pair.baseToken?.symbol,
            name: pair.baseToken?.name
        },

        // Quote token (usually stablecoin or native)
        quoteToken: {
            address: pair.quoteToken?.address,
            symbol: pair.quoteToken?.symbol,
            name: pair.quoteToken?.name
        },

        // Price data
        price: {
            usd: parseFloat(pair.priceUsd) || 0,
            native: parseFloat(pair.priceNative) || 0,
            change5m: pair.priceChange?.m5 || 0,
            change1h: pair.priceChange?.h1 || 0,
            change6h: pair.priceChange?.h6 || 0,
            change24h: pair.priceChange?.h24 || 0
        },

        // Volume data
        volume: {
            m5: pair.volume?.m5 || 0,
            h1: pair.volume?.h1 || 0,
            h6: pair.volume?.h6 || 0,
            h24: pair.volume?.h24 || 0
        },

        // Liquidity
        liquidity: {
            usd: pair.liquidity?.usd || 0,
            base: pair.liquidity?.base || 0,
            quote: pair.liquidity?.quote || 0
        },

        // Transaction counts
        txns: {
            m5: (pair.txns?.m5?.buys || 0) + (pair.txns?.m5?.sells || 0),
            h1: (pair.txns?.h1?.buys || 0) + (pair.txns?.h1?.sells || 0),
            h24: (pair.txns?.h24?.buys || 0) + (pair.txns?.h24?.sells || 0),
            buys24h: pair.txns?.h24?.buys || 0,
            sells24h: pair.txns?.h24?.sells || 0
        },

        // Metadata
        createdAt: pair.pairCreatedAt,
        url: pair.url,

        // Raw data for reference
        raw: pair
    };
}

/**
 * Fetch and parse multiple pairs
 * @param {string} chainId - Chain ID
 * @param {Array<string>} pairAddresses - Array of pair addresses
 * @returns {Promise<Array>} Parsed pair data
 */
export async function fetchMultiplePairs(chainId, pairAddresses) {
    const results = [];

    for (const address of pairAddresses) {
        try {
            const pair = await getPairByAddress(chainId, address);
            if (pair) {
                results.push(parsePairData(pair));
            }
        } catch (err) {
            logError(`Failed to fetch pair ${address}`, err);
        }
    }

    return results;
}

export default {
    getTokenPairs,
    searchTokens,
    getTopPairsByChain,
    getPairByAddress,
    getNewPairs,
    parsePairData,
    fetchMultiplePairs
};
