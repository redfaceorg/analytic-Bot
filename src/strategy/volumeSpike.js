/**
 * DEX Trading Bot - Volume Spike Strategy
 * 
 * Entry Condition:
 *   - 5m volume > 3x average hourly volume
 *   - Price change > 2% in last 5m
 * 
 * Exit Conditions:
 *   - Take profit: Price reaches Xx multiplier
 *   - Stop loss: Price drops 5% from entry
 *   - Time exit: Position held > 30 minutes
 */

import { logSignal, logDebug, logWarn } from '../logging/logger.js';
import config from '../config/index.js';
import { isTokenSafe, analyzeTokenSafety } from '../risk/contractAnalyzer.js';

// Minimum liquidity for safety (avoid illiquid traps)
const MIN_LIQUIDITY_USD = 5000;

// Minimum 24h volume
const MIN_VOLUME_24H = 10000;

/**
 * Analyze market data and generate signals
 * @param {Object} snapshot - Market snapshot from priceEngine
 * @returns {Object|null} Signal if detected, null otherwise
 */
export function analyzeForSignal(snapshot) {
    if (!snapshot || !snapshot.price) {
        return null;
    }

    const {
        chain,
        pairAddress,
        baseToken,
        price,
        volume,
        liquidity,
        avgVolume1h,
        volumeRatio
    } = snapshot;

    // Safety checks
    if (liquidity.usd < MIN_LIQUIDITY_USD) {
        logDebug(`Skip ${baseToken.symbol}: Low liquidity ($${liquidity.usd})`);
        return null;
    }

    if (volume.h24 < MIN_VOLUME_24H) {
        logDebug(`Skip ${baseToken.symbol}: Low 24h volume ($${volume.h24})`);
        return null;
    }

    // Contract safety check (honeypot detection, liquidity analysis)
    if (!isTokenSafe(snapshot)) {
        logWarn(`Skip ${baseToken.symbol}: Failed contract safety check`);
        return null;
    }

    // Strategy parameters
    const { volumeMultiplier, minPriceChange } = config.strategy;

    // Check volume spike
    const hasVolumeSpike = volumeRatio >= volumeMultiplier;

    // Check price increase (5m change from DexScreener)
    const hasPriceIncrease = price.change5m >= minPriceChange;

    // Generate signal if both conditions met
    if (hasVolumeSpike && hasPriceIncrease) {
        const signal = {
            type: 'VOLUME_SPIKE_ENTRY',
            chain,
            pairAddress,
            token: baseToken.symbol,
            tokenAddress: baseToken.address,

            // Signal data
            entryPrice: price.usd,
            volumeRatio: volumeRatio.toFixed(2),
            priceChange5m: price.change5m.toFixed(2),

            // Calculated targets
            takeProfit: price.usd * config.takeProfit.multiplier,
            stopLoss: price.usd * (1 - config.risk.stopLossPercent / 100),
            maxHoldUntil: Date.now() + (config.risk.maxHoldMinutes * 60 * 1000),

            // Metadata
            liquidity: liquidity.usd,
            volume24h: volume.h24,
            timestamp: Date.now(),

            // Signal strength (0-100)
            strength: calculateSignalStrength(volumeRatio, price.change5m, liquidity.usd)
        };

        logSignal(signal);
        return signal;
    }

    return null;
}

/**
 * Calculate signal strength score (0-100)
 */
function calculateSignalStrength(volumeRatio, priceChange, liquidity) {
    let score = 0;

    // Volume score (max 40 points)
    if (volumeRatio >= 10) score += 40;
    else if (volumeRatio >= 5) score += 30;
    else if (volumeRatio >= 3) score += 20;

    // Price change score (max 30 points)
    if (priceChange >= 10) score += 30;
    else if (priceChange >= 5) score += 20;
    else if (priceChange >= 2) score += 10;

    // Liquidity score (max 30 points)
    if (liquidity >= 100000) score += 30;
    else if (liquidity >= 50000) score += 20;
    else if (liquidity >= 10000) score += 10;

    return Math.min(score, 100);
}

/**
 * Check if an open position should be exited
 * @param {Object} position - Open position
 * @param {Object} currentSnapshot - Current market snapshot
 * @returns {Object|null} Exit signal if should exit
 */
export function checkExitConditions(position, currentSnapshot) {
    if (!position || !currentSnapshot) return null;

    const currentPrice = currentSnapshot.price.usd;
    const { entryPrice, takeProfit, stopLoss, maxHoldUntil } = position;

    // Check take profit
    if (currentPrice >= takeProfit) {
        return {
            type: 'EXIT_TAKE_PROFIT',
            reason: `Price reached ${config.takeProfit.multiplier}x target`,
            exitPrice: currentPrice,
            profitPercent: ((currentPrice - entryPrice) / entryPrice * 100).toFixed(2),
            timestamp: Date.now()
        };
    }

    // Check stop loss
    if (currentPrice <= stopLoss) {
        return {
            type: 'EXIT_STOP_LOSS',
            reason: `Price dropped below ${config.risk.stopLossPercent}% stop loss`,
            exitPrice: currentPrice,
            profitPercent: ((currentPrice - entryPrice) / entryPrice * 100).toFixed(2),
            timestamp: Date.now()
        };
    }

    // Check max hold time
    if (Date.now() >= maxHoldUntil) {
        return {
            type: 'EXIT_TIME_LIMIT',
            reason: `Max hold time (${config.risk.maxHoldMinutes}m) exceeded`,
            exitPrice: currentPrice,
            profitPercent: ((currentPrice - entryPrice) / entryPrice * 100).toFixed(2),
            timestamp: Date.now()
        };
    }

    return null;
}

/**
 * Get strategy description for logging
 */
export function getStrategyDescription() {
    return {
        name: 'Volume Spike Scalping',
        entry: `Volume > ${config.strategy.volumeMultiplier}x avg AND Price +${config.strategy.minPriceChange}%`,
        takeProfit: `${config.takeProfit.multiplier}x entry price`,
        stopLoss: `${config.risk.stopLossPercent}% below entry`,
        maxHold: `${config.risk.maxHoldMinutes} minutes`
    };
}

export default {
    analyzeForSignal,
    checkExitConditions,
    getStrategyDescription
};
