/**
 * RedFace Trading Bot - Token Analyzer
 * 
 * Provides token information, honeypot detection, and safety checks
 */

import { logInfo, logError } from '../logging/logger.js';

// Honeypot checker APIs
const HONEYPOT_API = 'https://api.honeypot.is/v2';

/**
 * Get detailed token information
 */
export async function getTokenInfo(chain, tokenAddress) {
    try {
        // Fetch from DexScreener
        const dexUrl = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;
        const response = await fetch(dexUrl);
        const data = await response.json();

        if (!data.pairs || data.pairs.length === 0) {
            return { success: false, error: 'Token not found' };
        }

        // Get the main pair (highest liquidity)
        const pairs = data.pairs.filter(p => p.chainId === chain);
        if (pairs.length === 0) {
            return { success: false, error: `Token not found on ${chain}` };
        }

        const mainPair = pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];

        return {
            success: true,
            token: {
                name: mainPair.baseToken?.name || 'Unknown',
                symbol: mainPair.baseToken?.symbol || '???',
                address: tokenAddress,
                chain: chain,
                price: parseFloat(mainPair.priceUsd) || 0,
                priceChange: {
                    m5: mainPair.priceChange?.m5 || 0,
                    h1: mainPair.priceChange?.h1 || 0,
                    h24: mainPair.priceChange?.h24 || 0
                },
                volume24h: mainPair.volume?.h24 || 0,
                liquidity: mainPair.liquidity?.usd || 0,
                marketCap: mainPair.fdv || 0,
                pairAddress: mainPair.pairAddress,
                dexId: mainPair.dexId,
                txns24h: {
                    buys: mainPair.txns?.h24?.buys || 0,
                    sells: mainPair.txns?.h24?.sells || 0
                },
                url: mainPair.url
            }
        };
    } catch (err) {
        logError('Failed to get token info', err);
        return { success: false, error: 'Failed to fetch token data' };
    }
}

/**
 * Check if token is a honeypot (BSC/ETH only)
 */
export async function checkHoneypot(chain, tokenAddress) {
    try {
        // Only works for BSC and ETH compatible chains
        if (chain !== 'bsc' && chain !== 'base' && chain !== 'ethereum') {
            return { isHoneypot: false, reason: 'Chain not supported for honeypot check' };
        }

        const chainId = chain === 'bsc' ? 56 : chain === 'base' ? 8453 : 1;
        const url = `${HONEYPOT_API}/IsHoneypot?address=${tokenAddress}&chainID=${chainId}`;

        const response = await fetch(url, {
            headers: { 'accept': 'application/json' }
        });

        if (!response.ok) {
            // If API fails, return unknown
            return { isHoneypot: null, reason: 'Could not verify' };
        }

        const data = await response.json();

        return {
            isHoneypot: data.honeypotResult?.isHoneypot || false,
            reason: data.honeypotResult?.honeypotReason || 'Safe',
            buyTax: data.simulationResult?.buyTax || 0,
            sellTax: data.simulationResult?.sellTax || 0,
            transferTax: data.simulationResult?.transferTax || 0,
            isOpenSource: data.contractCode?.openSource || false,
            holderCount: data.holderAnalysis?.holders || 0,
            riskLevel: calculateRiskLevel(data)
        };
    } catch (err) {
        logError('Honeypot check failed', err);
        return { isHoneypot: null, reason: 'Check failed' };
    }
}

/**
 * Calculate risk level based on honeypot data
 */
function calculateRiskLevel(data) {
    let risk = 0;

    // Check for honeypot
    if (data.honeypotResult?.isHoneypot) return 'SCAM';

    // High taxes are red flags
    const buyTax = data.simulationResult?.buyTax || 0;
    const sellTax = data.simulationResult?.sellTax || 0;

    if (sellTax > 50) return 'EXTREME';
    if (sellTax > 20) risk += 3;
    if (sellTax > 10) risk += 2;
    if (buyTax > 10) risk += 1;

    // Not open source is risky
    if (!data.contractCode?.openSource) risk += 2;

    // Low holders is risky
    if ((data.holderAnalysis?.holders || 0) < 50) risk += 1;

    if (risk >= 5) return 'HIGH';
    if (risk >= 3) return 'MEDIUM';
    return 'LOW';
}

/**
 * Full token safety analysis
 */
export async function analyzeToken(chain, tokenAddress) {
    const [tokenInfo, honeypot] = await Promise.all([
        getTokenInfo(chain, tokenAddress),
        checkHoneypot(chain, tokenAddress)
    ]);

    return {
        ...tokenInfo,
        safety: honeypot
    };
}

/**
 * Get safety emoji based on risk level
 */
export function getSafetyEmoji(riskLevel) {
    switch (riskLevel) {
        case 'SCAM': return '🚨';
        case 'EXTREME': return '⛔';
        case 'HIGH': return '🔴';
        case 'MEDIUM': return '🟡';
        case 'LOW': return '🟢';
        default: return '⚪';
    }
}

/**
 * Format token info message for Telegram
 */
export function formatTokenMessage(analysis) {
    if (!analysis.success) {
        return `❌ ${analysis.error}`;
    }

    const t = analysis.token;
    const s = analysis.safety;
    const safetyEmoji = getSafetyEmoji(s.riskLevel);

    const priceChangeColor = t.priceChange.h24 >= 0 ? '🟢' : '🔴';

    return `
🔴 <b>RedFace Token Scanner</b>
━━━━━━━━━━━━━━━━━━━━━

🪙 <b>${t.name}</b> (${t.symbol})
🔗 Chain: <code>${t.chain.toUpperCase()}</code>

💰 <b>Price:</b> <code>$${t.price.toFixed(8)}</code>

📈 <b>Price Change</b>
┌ 5m: <code>${t.priceChange.m5}%</code>
├ 1h: <code>${t.priceChange.h1}%</code>
└ 24h: ${priceChangeColor} <code>${t.priceChange.h24}%</code>

📊 <b>Stats</b>
┌ Volume 24h: <code>$${formatNumber(t.volume24h)}</code>
├ Liquidity: <code>$${formatNumber(t.liquidity)}</code>
├ Market Cap: <code>$${formatNumber(t.marketCap)}</code>
└ Trades 24h: <code>${t.txns24h.buys + t.txns24h.sells}</code>

${safetyEmoji} <b>Safety: ${s.riskLevel || 'UNKNOWN'}</b>
┌ Honeypot: <code>${s.isHoneypot === null ? 'Unknown' : s.isHoneypot ? '⚠️ YES' : '✅ No'}</code>
├ Buy Tax: <code>${s.buyTax || 0}%</code>
├ Sell Tax: <code>${s.sellTax || 0}%</code>
└ Open Source: <code>${s.isOpenSource ? '✅' : '❌'}</code>

━━━━━━━━━━━━━━━━━━━━━
    `.trim();
}

/**
 * Format large numbers
 */
function formatNumber(num) {
    if (!num) return '0';
    if (num >= 1000000000) return (num / 1000000000).toFixed(2) + 'B';
    if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(2) + 'K';
    return num.toFixed(2);
}

export default {
    getTokenInfo,
    checkHoneypot,
    analyzeToken,
    formatTokenMessage,
    getSafetyEmoji
};
