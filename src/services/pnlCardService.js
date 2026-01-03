/**
 * RedFace Trading Bot - PnL Card Generator
 * 
 * Generates shareable PnL result cards for completed trades
 * Uses HTML/CSS template rendered to image
 */

import { logInfo, logError } from '../logging/logger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Logo path
const LOGO_PATH = path.join(__dirname, '../assets/redface_logo.jpg');

/**
 * Generate HTML template for PnL card
 */
function generatePnLCardHTML(tradeData) {
    const {
        token = 'TOKEN',
        chain = 'BSC',
        entryPrice = 0,
        exitPrice = 0,
        profitUsd = 0,
        profitPercent = 0,
        duration = '0m 0s',
        isProfit = true
    } = tradeData;

    const profitColor = isProfit ? '#00ff88' : '#ff4444';
    const profitSign = isProfit ? '+' : '';
    const glowColor = isProfit ? 'rgba(0, 255, 136, 0.4)' : 'rgba(255, 68, 68, 0.4)';

    return `
<!DOCTYPE html>
<html>
<head>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            width: 1200px;
            height: 630px;
            background: linear-gradient(135deg, #1a1a1a 0%, #2d1f1f 50%, #1a1a1a 100%);
            font-family: 'Segoe UI', Arial, sans-serif;
            display: flex;
            overflow: hidden;
            position: relative;
        }

        /* Red accent lines */
        .accent-line {
            position: absolute;
            background: linear-gradient(90deg, transparent, #8b2635, transparent);
            height: 2px;
            width: 100%;
        }
        .accent-line.top { top: 20px; }
        .accent-line.bottom { bottom: 20px; }

        /* Left panel */
        .left-panel {
            flex: 1;
            padding: 40px;
            display: flex;
            flex-direction: column;
            justify-content: center;
        }

        .logo-section {
            margin-bottom: 30px;
        }

        .logo-section img {
            width: 180px;
            height: auto;
        }

        .token-info {
            margin-bottom: 20px;
        }

        .token-name {
            font-size: 42px;
            font-weight: bold;
            color: #fff;
            text-shadow: 0 0 20px rgba(139, 38, 53, 0.5);
        }

        .chain-badge {
            display: inline-block;
            background: linear-gradient(135deg, #8b2635, #5a1a23);
            color: #fff;
            padding: 6px 16px;
            border-radius: 20px;
            font-size: 14px;
            font-weight: bold;
            margin-top: 10px;
        }

        .trade-details {
            color: #888;
            font-size: 16px;
            line-height: 2;
        }

        .trade-details .label {
            color: #666;
        }

        .trade-details .value {
            color: #ccc;
            font-family: 'Consolas', monospace;
        }

        /* Right panel - Profit display */
        .right-panel {
            flex: 1.2;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            position: relative;
        }

        .profit-glow {
            position: absolute;
            width: 400px;
            height: 400px;
            background: radial-gradient(circle, ${glowColor} 0%, transparent 70%);
            filter: blur(40px);
            animation: pulse 2s ease-in-out infinite;
        }

        @keyframes pulse {
            0%, 100% { transform: scale(1); opacity: 0.8; }
            50% { transform: scale(1.1); opacity: 1; }
        }

        .profit-percent {
            font-size: 120px;
            font-weight: 900;
            color: ${profitColor};
            text-shadow: 0 0 60px ${glowColor}, 0 0 100px ${glowColor};
            z-index: 10;
            letter-spacing: -5px;
        }

        .profit-usd {
            font-size: 36px;
            font-weight: bold;
            color: ${profitColor};
            margin-top: 10px;
            z-index: 10;
        }

        .duration {
            color: #666;
            font-size: 18px;
            margin-top: 20px;
            z-index: 10;
        }

        /* Footer */
        .footer {
            position: absolute;
            bottom: 35px;
            left: 0;
            right: 0;
            text-align: center;
            color: #555;
            font-size: 14px;
        }

        .footer span {
            color: #8b2635;
            font-weight: bold;
        }

        /* Energy particles */
        .particle {
            position: absolute;
            width: 4px;
            height: 4px;
            background: ${profitColor};
            border-radius: 50%;
            opacity: 0.6;
        }
    </style>
</head>
<body>
    <div class="accent-line top"></div>
    <div class="accent-line bottom"></div>

    <div class="left-panel">
        <div class="logo-section">
            <img src="data:image/jpeg;base64,LOGO_BASE64_PLACEHOLDER" alt="RedFace" />
        </div>
        
        <div class="token-info">
            <div class="token-name">${token}</div>
            <div class="chain-badge">${chain.toUpperCase()}</div>
        </div>

        <div class="trade-details">
            <div><span class="label">Entry:</span> <span class="value">$${formatPrice(entryPrice)}</span></div>
            <div><span class="label">Exit:</span> <span class="value">$${formatPrice(exitPrice)}</span></div>
        </div>
    </div>

    <div class="right-panel">
        <div class="profit-glow"></div>
        <div class="profit-percent">${profitSign}${profitPercent.toFixed(1)}%</div>
        <div class="profit-usd">${profitSign}$${Math.abs(profitUsd).toFixed(2)}</div>
        <div class="duration">⏱️ ${duration}</div>
    </div>

    <div class="footer">Powered by <span>RedFace</span> Trading Bot</div>
</body>
</html>
    `.trim();
}

/**
 * Format price for display
 */
function formatPrice(price) {
    if (price < 0.00001) {
        return price.toExponential(4);
    } else if (price < 1) {
        return price.toFixed(8);
    } else {
        return price.toFixed(4);
    }
}

/**
 * Format duration from milliseconds
 */
export function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
        return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    } else {
        return `${seconds}s`;
    }
}

/**
 * Generate PnL card data from trade result
 */
export function preparePnLCardData(trade) {
    const entryPrice = parseFloat(trade.entryPrice) || 0;
    const exitPrice = parseFloat(trade.exitPrice) || parseFloat(trade.currentPrice) || 0;
    const profitPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
    const profitUsd = parseFloat(trade.pnl) || 0;
    const isProfit = profitUsd >= 0;

    const entryTime = trade.entryTime || trade.created_at || Date.now();
    const exitTime = trade.exitTime || Date.now();
    const duration = formatDuration(exitTime - new Date(entryTime).getTime());

    return {
        token: trade.token || trade.tokenName || 'TOKEN',
        chain: trade.chain || 'bsc',
        entryPrice,
        exitPrice,
        profitUsd,
        profitPercent,
        duration,
        isProfit
    };
}

/**
 * Get logo as base64
 */
function getLogoBase64() {
    try {
        if (fs.existsSync(LOGO_PATH)) {
            const logoBuffer = fs.readFileSync(LOGO_PATH);
            return logoBuffer.toString('base64');
        }
    } catch (err) {
        logError('Failed to load logo', err);
    }
    return '';
}

/**
 * Generate PnL card HTML with embedded logo
 */
export function generatePnLCard(tradeData) {
    const cardData = preparePnLCardData(tradeData);
    let html = generatePnLCardHTML(cardData);

    // Embed logo as base64
    const logoBase64 = getLogoBase64();
    html = html.replace('LOGO_BASE64_PLACEHOLDER', logoBase64);

    return html;
}

/**
 * Create a simple text-based PnL summary for Telegram
 * (Fallback when image generation is not available)
 */
export function generatePnLText(trade) {
    const data = preparePnLCardData(trade);
    const emoji = data.isProfit ? '🟢' : '🔴';
    const sign = data.isProfit ? '+' : '';

    return `
🎉 <b>Trade Completed!</b>
━━━━━━━━━━━━━━━━━━━━━

🪙 <b>${data.token}</b> on ${data.chain.toUpperCase()}

${emoji} <b>PnL: ${sign}${data.profitPercent.toFixed(1)}%</b>
💰 ${sign}$${Math.abs(data.profitUsd).toFixed(2)}

📈 Entry: $${formatPrice(data.entryPrice)}
📉 Exit: $${formatPrice(data.exitPrice)}
⏱️ Duration: ${data.duration}

━━━━━━━━━━━━━━━━━━━━━
<i>Powered by RedFace</i>
    `.trim();
}

export default {
    generatePnLCard,
    generatePnLText,
    preparePnLCardData,
    formatDuration
};
