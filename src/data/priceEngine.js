/**
 * DEX Trading Bot - Price Engine
 * 
 * Fetches and caches price data from DexScreener
 * Builds candles for strategy analysis
 */

import { getPairByAddress, parsePairData, searchTokens, getTopPairsByChain, getNewPairs, getBoostedTokens, getTopGainers } from './dexscreener.js';
import { logInfo, logError, logDebug } from '../logging/logger.js';
import config from '../config/index.js';

// Price cache: { chainId: { pairAddress: { data, timestamp } } }
const priceCache = new Map();
const CACHE_TTL = 10000; // 10 seconds

// Candle storage: { chainId: { pairAddress: [candles] } }
const candleStorage = new Map();
const MAX_CANDLES = 100; // Keep last 100 candles per pair

/**
 * Get cached price or fetch new
 */
export async function getPrice(chainId, pairAddress) {
    const cacheKey = `${chainId}:${pairAddress}`;
    const cached = priceCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
    }

    try {
        const pair = await getPairByAddress(chainId, pairAddress);
        const parsed = parsePairData(pair);

        if (parsed) {
            priceCache.set(cacheKey, {
                data: parsed,
                timestamp: Date.now()
            });

            // Update candles
            updateCandle(chainId, pairAddress, parsed);
        }

        return parsed;
    } catch (err) {
        logError(`Failed to fetch price for ${pairAddress}`, err);
        return cached?.data || null; // Return stale data if available
    }
}

/**
 * Update candle with new price data
 */
function updateCandle(chainId, pairAddress, priceData) {
    const key = `${chainId}:${pairAddress}`;

    if (!candleStorage.has(key)) {
        candleStorage.set(key, []);
    }

    const candles = candleStorage.get(key);
    const now = Date.now();
    const candleInterval = 5 * 60 * 1000; // 5 minutes

    // Find current candle period
    const periodStart = Math.floor(now / candleInterval) * candleInterval;

    const lastCandle = candles[candles.length - 1];

    if (lastCandle && lastCandle.periodStart === periodStart) {
        // Update existing candle
        lastCandle.high = Math.max(lastCandle.high, priceData.price.usd);
        lastCandle.low = Math.min(lastCandle.low, priceData.price.usd);
        lastCandle.close = priceData.price.usd;
        lastCandle.volume = priceData.volume.m5;
        lastCandle.timestamp = now;
    } else {
        // Create new candle
        const newCandle = {
            periodStart,
            timestamp: now,
            open: priceData.price.usd,
            high: priceData.price.usd,
            low: priceData.price.usd,
            close: priceData.price.usd,
            volume: priceData.volume.m5
        };

        candles.push(newCandle);

        // Trim old candles
        if (candles.length > MAX_CANDLES) {
            candles.shift();
        }
    }
}

/**
 * Get candles for a pair
 */
export function getCandles(chainId, pairAddress, count = 12) {
    const key = `${chainId}:${pairAddress}`;
    const candles = candleStorage.get(key) || [];
    return candles.slice(-count);
}

/**
 * Calculate average volume over N candles
 */
export function getAverageVolume(chainId, pairAddress, periods = 12) {
    const candles = getCandles(chainId, pairAddress, periods);

    if (candles.length === 0) return 0;

    const totalVolume = candles.reduce((sum, c) => sum + (c.volume || 0), 0);
    return totalVolume / candles.length;
}

/**
 * Get price change percentage
 */
export function getPriceChange(chainId, pairAddress, periods = 1) {
    const candles = getCandles(chainId, pairAddress, periods + 1);

    if (candles.length < 2) return 0;

    const oldPrice = candles[0].close;
    const newPrice = candles[candles.length - 1].close;

    if (oldPrice === 0) return 0;

    return ((newPrice - oldPrice) / oldPrice) * 100;
}

/**
 * Search for tradeable pairs on a chain
 * Combines multiple sources for maximum coverage (100+ tokens)
 */
export async function findTradablePairs(chainId, query = '') {
    try {
        let allPairs = [];

        if (query) {
            // If query provided, use search
            const searchResults = await searchTokens(query);
            allPairs = searchResults.filter(p => p.chainId === chainId);
        } else {
            // Combine multiple sources for comprehensive coverage
            logInfo(`Scanning ${chainId.toUpperCase()} for gems...`);

            // 1. Top pairs by chain (established tokens)
            const topPairs = await getTopPairsByChain(chainId);
            allPairs.push(...topPairs);

            // 2. New pairs / fresh launches (micro caps)
            try {
                const newPairs = await getNewPairs(chainId);
                allPairs.push(...newPairs);
                logDebug(`Found ${newPairs.length} new pairs on ${chainId}`);
            } catch (e) { /* continue */ }

            // 3. Boosted/trending tokens
            try {
                const boosted = await getBoostedTokens(chainId);
                allPairs.push(...boosted);
                logDebug(`Found ${boosted.length} boosted tokens on ${chainId}`);
            } catch (e) { /* continue */ }

            // 4. Top gainers (momentum plays)
            try {
                const gainers = await getTopGainers(chainId);
                allPairs.push(...gainers);
                logDebug(`Found ${gainers.length} top gainers on ${chainId}`);
            } catch (e) { /* continue */ }
        }

        // Deduplicate by pair address
        const seen = new Set();
        const uniquePairs = allPairs.filter(p => {
            const key = p.pairAddress || p.address;
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        // Filter by liquidity (lower threshold for micro caps: $500)
        const MIN_LIQUIDITY = 500; // Changed from $1000 to $500 for micro caps

        const filtered = uniquePairs
            .filter(p => (p.liquidity?.usd || 0) >= MIN_LIQUIDITY)
            .map(p => parsePairData(p))
            .filter(p => p !== null);

        logInfo(`Found ${filtered.length} tradable pairs on ${chainId}`);

        // Return up to 50 pairs per chain (100+ total across chains)
        return filtered.slice(0, 50);
    } catch (err) {
        logError(`Failed to search pairs on ${chainId}`, err);
        return [];
    }
}

/**
 * Get market snapshot for a pair
 */
export async function getMarketSnapshot(chainId, pairAddress) {
    const price = await getPrice(chainId, pairAddress);

    if (!price) return null;

    const candles = getCandles(chainId, pairAddress, 12);
    const avgVolume = getAverageVolume(chainId, pairAddress, 12);

    return {
        ...price,
        candles,
        avgVolume1h: avgVolume,
        volumeRatio: avgVolume > 0 ? price.volume.m5 / avgVolume : 0,
        priceChange1h: getPriceChange(chainId, pairAddress, 12)
    };
}

export default {
    getPrice,
    getCandles,
    getAverageVolume,
    getPriceChange,
    findTradablePairs,
    getMarketSnapshot
};
