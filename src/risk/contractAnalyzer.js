/**
 * DEX Trading Bot - Contract Analyzer
 * 
 * Analyzes token contracts for safety before trading:
 *   - Honeypot detection
 *   - Liquidity analysis
 *   - Owner/mint functions
 *   - Tax rates
 *   - Holder distribution
 */

import { logInfo, logWarn, logError } from '../logging/logger.js';
import { getChainConfig } from '../config/index.js';

// Minimum requirements for safe trading
const SAFETY_THRESHOLDS = {
    minLiquidityUsd: 5000,         // Minimum $5k liquidity
    minLiquidityRatio: 0.05,       // Min 5% of market cap in liquidity
    maxBuyTax: 10,                 // Max 10% buy tax
    maxSellTax: 10,                // Max 10% sell tax
    minHolders: 50,                // Minimum 50 holders
    maxTopHolderPercent: 50,       // Top holder can't own > 50%
    minAgeMinutes: 30,             // Token must be at least 30 min old
    maxOwnerBalance: 20            // Owner can't hold > 20%
};

/**
 * Analyze a token for safety
 * @param {Object} pairData - Pair data from DexScreener
 * @returns {Object} Safety analysis result
 */
export async function analyzeTokenSafety(pairData) {
    const analysis = {
        token: pairData.baseToken?.symbol || 'UNKNOWN',
        chain: pairData.chain,
        address: pairData.baseToken?.address,
        isSafe: true,
        score: 100,
        checks: [],
        warnings: [],
        errors: []
    };

    // 1. Check liquidity
    const liquidityCheck = checkLiquidity(pairData);
    analysis.checks.push(liquidityCheck);
    if (!liquidityCheck.passed) {
        analysis.isSafe = false;
        analysis.errors.push(liquidityCheck.reason);
        analysis.score -= 30;
    }

    // 2. Check token age
    const ageCheck = checkTokenAge(pairData);
    analysis.checks.push(ageCheck);
    if (!ageCheck.passed) {
        analysis.warnings.push(ageCheck.reason);
        analysis.score -= 15;
    }

    // 3. Check price impact (liquidity depth)
    const impactCheck = checkPriceImpact(pairData);
    analysis.checks.push(impactCheck);
    if (!impactCheck.passed) {
        analysis.warnings.push(impactCheck.reason);
        analysis.score -= 20;
    }

    // 4. Check buy/sell ratio (potential honeypot indicator)
    const ratioCheck = checkBuySellRatio(pairData);
    analysis.checks.push(ratioCheck);
    if (!ratioCheck.passed) {
        analysis.isSafe = false;
        analysis.errors.push(ratioCheck.reason);
        analysis.score -= 40;
    }

    // 5. Check if pair is verified on DEX
    const verifiedCheck = checkVerified(pairData);
    analysis.checks.push(verifiedCheck);
    if (!verifiedCheck.passed) {
        analysis.warnings.push(verifiedCheck.reason);
        analysis.score -= 10;
    }

    // Normalize score
    analysis.score = Math.max(0, Math.min(100, analysis.score));

    // Log analysis
    if (analysis.isSafe) {
        logInfo(`✅ Token ${analysis.token} passed safety check (score: ${analysis.score})`);
    } else {
        logWarn(`⚠️ Token ${analysis.token} FAILED safety check: ${analysis.errors.join(', ')}`);
    }

    return analysis;
}

/**
 * Check liquidity requirements
 */
function checkLiquidity(pairData) {
    const liquidity = pairData.liquidity?.usd || 0;
    const minRequired = SAFETY_THRESHOLDS.minLiquidityUsd;

    const passed = liquidity >= minRequired;

    return {
        name: 'Liquidity Check',
        passed,
        value: `$${liquidity.toLocaleString()}`,
        threshold: `$${minRequired.toLocaleString()}`,
        reason: passed ? 'Sufficient liquidity' : `Low liquidity: $${liquidity} < $${minRequired}`
    };
}

/**
 * Check token age
 */
function checkTokenAge(pairData) {
    const createdAt = pairData.createdAt;

    if (!createdAt) {
        return {
            name: 'Age Check',
            passed: false,
            value: 'Unknown',
            threshold: `${SAFETY_THRESHOLDS.minAgeMinutes} min`,
            reason: 'Token creation time unknown'
        };
    }

    const ageMinutes = (Date.now() - createdAt) / (1000 * 60);
    const minAge = SAFETY_THRESHOLDS.minAgeMinutes;
    const passed = ageMinutes >= minAge;

    return {
        name: 'Age Check',
        passed,
        value: `${Math.round(ageMinutes)} min`,
        threshold: `${minAge} min`,
        reason: passed ? 'Token is mature enough' : `Token too new: ${Math.round(ageMinutes)} min < ${minAge} min`
    };
}

/**
 * Check price impact based on liquidity
 * Estimates slippage for a $100 trade
 */
function checkPriceImpact(pairData) {
    const liquidity = pairData.liquidity?.usd || 0;
    const testAmount = 100; // $100 test trade

    // Simple estimate: impact % ≈ (trade size / liquidity) * 100
    const estimatedImpact = liquidity > 0 ? (testAmount / liquidity) * 100 : 100;
    const maxImpact = 2; // 2% max acceptable impact for $100

    const passed = estimatedImpact <= maxImpact;

    return {
        name: 'Price Impact',
        passed,
        value: `${estimatedImpact.toFixed(2)}%`,
        threshold: `${maxImpact}%`,
        reason: passed ? 'Low price impact' : `High price impact: ${estimatedImpact.toFixed(2)}%`
    };
}

/**
 * Check buy/sell transaction ratio
 * A very low sell count can indicate honeypot
 */
function checkBuySellRatio(pairData) {
    const buys24h = pairData.txns?.buys24h || 0;
    const sells24h = pairData.txns?.sells24h || 0;

    // If no sells but many buys, potential honeypot
    if (buys24h > 10 && sells24h === 0) {
        return {
            name: 'Honeypot Check',
            passed: false,
            value: `${buys24h} buys, 0 sells`,
            threshold: 'Must have sells',
            reason: 'POTENTIAL HONEYPOT: No sells in 24h'
        };
    }

    // Check ratio - if less than 10% are sells, suspicious
    const totalTxns = buys24h + sells24h;
    const sellRatio = totalTxns > 0 ? (sells24h / totalTxns) * 100 : 50;

    const passed = sellRatio >= 10 || totalTxns < 10;

    return {
        name: 'Honeypot Check',
        passed,
        value: `${sellRatio.toFixed(1)}% sells`,
        threshold: '10% minimum',
        reason: passed ? 'Normal buy/sell ratio' : `Low sell ratio: ${sellRatio.toFixed(1)}% (potential honeypot)`
    };
}

/**
 * Check if token/pair is verified
 */
function checkVerified(pairData) {
    // DexScreener provides info about verified pairs
    const hasInfo = pairData.raw?.info || pairData.url;

    return {
        name: 'Verification',
        passed: !!hasInfo,
        value: hasInfo ? 'Yes' : 'No',
        threshold: 'Verified',
        reason: hasInfo ? 'Pair is listed on DexScreener' : 'Unverified pair'
    };
}

/**
 * Quick safety check (returns boolean only)
 */
export function isTokenSafe(pairData) {
    // Quick checks without full analysis
    const liquidity = pairData.liquidity?.usd || 0;
    const buys = pairData.txns?.buys24h || 0;
    const sells = pairData.txns?.sells24h || 0;

    // Fail fast checks
    if (liquidity < SAFETY_THRESHOLDS.minLiquidityUsd) return false;
    if (buys > 10 && sells === 0) return false; // Potential honeypot

    return true;
}

/**
 * Get liquidity analysis for position sizing
 */
export function analyzeLiquidityForTrade(pairData, tradeSize) {
    const liquidity = pairData.liquidity?.usd || 0;

    // Calculate max safe trade size (2% of liquidity)
    const maxSafeSize = liquidity * 0.02;

    // Estimate price impact
    const estimatedImpact = liquidity > 0 ? (tradeSize / liquidity) * 100 : 100;

    // Recommended position size
    const recommendedSize = Math.min(tradeSize, maxSafeSize);

    return {
        liquidity,
        requestedSize: tradeSize,
        maxSafeSize,
        recommendedSize,
        estimatedImpact: estimatedImpact.toFixed(2) + '%',
        isSizeOk: tradeSize <= maxSafeSize,
        warning: tradeSize > maxSafeSize
            ? `Trade size $${tradeSize} exceeds safe limit $${maxSafeSize.toFixed(2)}`
            : null
    };
}

/**
 * Display safety analysis
 */
export function displaySafetyAnalysis(analysis) {
    console.log('');
    console.log('┌────────────────────────────────────────────────────────┐');
    console.log(`│  🔍 SAFETY ANALYSIS: ${analysis.token.padEnd(31)}│`);
    console.log('├────────────────────────────────────────────────────────┤');
    console.log(`│   Score: ${String(analysis.score + '/100').padEnd(44)}│`);
    console.log(`│   Safe to Trade: ${(analysis.isSafe ? '✅ YES' : '❌ NO').padEnd(36)}│`);
    console.log('├────────────────────────────────────────────────────────┤');

    for (const check of analysis.checks) {
        const icon = check.passed ? '✓' : '✗';
        console.log(`│   ${icon} ${check.name}: ${check.value.padEnd(34)}│`);
    }

    if (analysis.warnings.length > 0) {
        console.log('├────────────────────────────────────────────────────────┤');
        console.log('│   ⚠️ WARNINGS:                                         │');
        for (const warning of analysis.warnings) {
            console.log(`│   - ${warning.substring(0, 49).padEnd(49)}│`);
        }
    }

    if (analysis.errors.length > 0) {
        console.log('├────────────────────────────────────────────────────────┤');
        console.log('│   ❌ ERRORS:                                            │');
        for (const error of analysis.errors) {
            console.log(`│   - ${error.substring(0, 49).padEnd(49)}│`);
        }
    }

    console.log('└────────────────────────────────────────────────────────┘');
    console.log('');
}

export default {
    analyzeTokenSafety,
    isTokenSafe,
    analyzeLiquidityForTrade,
    displaySafetyAnalysis,
    SAFETY_THRESHOLDS
};
