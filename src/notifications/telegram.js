/**
 * RedFace Trading Bot - Telegram Bot
 * 
 * Full-featured Telegram bot with Maestro-style UI:
 *   - Interactive inline keyboard buttons
 *   - Rich formatted messages
 *   - Commands: /start, /status, /positions, /pnl, /settings, /help
 */

import { logInfo, logError } from '../logging/logger.js';
import { getStatus } from '../automation/scheduler.js';
import { getBalance, getOpenPositions } from '../automation/state.js';
import { getPnLSummary } from '../logging/pnlTracker.js';
import config from '../config/index.js';

// Telegram config
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Bot branding
const BOT_NAME = '🔴 RedFace';
const BOT_VERSION = '1.0.0';

// Check if Telegram is configured
export function isTelegramEnabled() {
    return !!(BOT_TOKEN && CHAT_ID);
}

/**
 * Send message with optional inline keyboard
 */
async function sendMessage(text, keyboard = null, parseMode = 'HTML') {
    if (!isTelegramEnabled()) return false;

    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

    const body = {
        chat_id: CHAT_ID,
        text,
        parse_mode: parseMode,
        disable_web_page_preview: true
    };

    if (keyboard) {
        body.reply_markup = { inline_keyboard: keyboard };
    }

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const error = await response.text();
            logError('Telegram send failed', { error });
            return false;
        }
        return true;
    } catch (err) {
        logError('Telegram error', err);
        return false;
    }
}

/**
 * Create Maestro-style status card
 */
function createStatusCard(status) {
    const modeEmoji = status.mode === 'LIVE' ? '🔴' : '📝';
    const statusEmoji = status.isRunning ? '🟢' : '🔴';

    return `
${BOT_NAME} <b>Trading Bot</b>
━━━━━━━━━━━━━━━━━━━━━

${statusEmoji} <b>Status:</b> ${status.isRunning ? 'Running' : 'Stopped'}
${modeEmoji} <b>Mode:</b> ${status.mode}

📊 <b>Portfolio</b>
┌ Balance: <code>$${(status.balance || 0).toFixed(2)}</code>
├ Positions: <code>${status.positions || 0}</code>
└ Watchlist: <code>${status.watchlist || 0} tokens</code>

📈 <b>Today's Performance</b>
┌ PnL: <code>${(status.dailyPnl || 0) >= 0 ? '+' : ''}$${(status.dailyPnl || 0).toFixed(2)}</code>
├ Trades: <code>${status.dailyTrades || 0}</code>
└ Win Rate: <code>${(status.winRate || 0).toFixed(0)}%</code>

⏱ <b>Uptime:</b> ${formatUptime(status.uptime)}

━━━━━━━━━━━━━━━━━━━━━
    `.trim();
}

/**
 * Format uptime
 */
function formatUptime(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hrs > 0) return `${hrs}h ${mins}m`;
    return `${mins}m`;
}

/**
 * Main menu keyboard (Maestro-style)
 */
function getMainMenuKeyboard() {
    return [
        [
            { text: '📊 Status', callback_data: 'status' },
            { text: '💼 Positions', callback_data: 'positions' }
        ],
        [
            { text: '📈 PnL', callback_data: 'pnl' },
            { text: '🔔 Signals', callback_data: 'signals' }
        ],
        [
            { text: '⚙️ Settings', callback_data: 'settings' },
            { text: '❓ Help', callback_data: 'help' }
        ],
        [
            { text: '🔄 Refresh', callback_data: 'refresh' }
        ]
    ];
}

/**
 * Positions keyboard
 */
function getPositionsKeyboard() {
    return [
        [
            { text: '📊 View All', callback_data: 'positions_all' },
            { text: '🔴 Close All', callback_data: 'positions_close_all' }
        ],
        [
            { text: '◀️ Back', callback_data: 'menu' }
        ]
    ];
}

/**
 * Settings keyboard
 */
function getSettingsKeyboard() {
    return [
        [
            { text: `🎯 TP: ${config.takeProfit?.multiplier || 5}x`, callback_data: 'settings_tp' },
            { text: `🛑 SL: ${config.risk?.stopLossPercent || 5}%`, callback_data: 'settings_sl' }
        ],
        [
            { text: `📊 Max Trades: ${config.risk?.maxTradesPerDay || 15}`, callback_data: 'settings_trades' }
        ],
        [
            { text: '◀️ Back', callback_data: 'menu' }
        ]
    ];
}

// ==================== NOTIFICATIONS ====================

/**
 * Send signal alert (Maestro-style)
 */
export async function notifySignal(signal) {
    const strengthBar = getStrengthBar(signal.strength);

    const message = `
${BOT_NAME} <b>Signal Detected</b>
━━━━━━━━━━━━━━━━━━━━━

🪙 <b>${signal.token}</b>
🔗 Chain: <code>${signal.chain.toUpperCase()}</code>

💰 <b>Entry Price</b>
<code>$${signal.entryPrice.toFixed(8)}</code>

📊 <b>Analysis</b>
┌ Volume: <code>${signal.volumeRatio}x spike</code>
├ Change: <code>+${signal.priceChange5m}%</code>
└ Strength: ${strengthBar} <code>${signal.strength}/100</code>

🎯 <b>Targets</b>
┌ Take Profit: <code>$${signal.takeProfit.toFixed(8)}</code>
├ Stop Loss: <code>$${signal.stopLoss.toFixed(8)}</code>
└ Max Hold: <code>30 min</code>

💧 Liquidity: <code>$${formatNumber(signal.liquidity)}</code>

━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    const keyboard = [
        [
            { text: '📊 View Chart', url: `https://dexscreener.com/${signal.chain}/${signal.pairAddress}` }
        ],
        [
            { text: '◀️ Menu', callback_data: 'menu' }
        ]
    ];

    return sendMessage(message, keyboard);
}

/**
 * Send trade execution alert
 */
export async function notifyTrade(trade) {
    const isBuy = trade.action === 'BUY';
    const emoji = isBuy ? '🟢' : '🔴';

    const message = `
${BOT_NAME} <b>${trade.action} Executed</b>
━━━━━━━━━━━━━━━━━━━━━

${emoji} <b>${trade.token}</b>
🔗 Chain: <code>${trade.chain.toUpperCase()}</code>

💰 <b>Trade Details</b>
┌ Price: <code>$${trade.price.toFixed(8)}</code>
├ Amount: <code>$${trade.amount.toFixed(2)}</code>
└ Mode: <code>${trade.mode || 'PAPER'}</code>

${isBuy ? `🎯 <b>Targets Set</b>
┌ Take Profit: <code>$${trade.takeProfit?.toFixed(8) || 'N/A'}</code>
└ Stop Loss: <code>$${trade.stopLoss?.toFixed(8) || 'N/A'}</code>` : ''}

━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    return sendMessage(message);
}

/**
 * Send position exit alert
 */
export async function notifyExit(exit) {
    const isProfit = exit.pnl >= 0;
    const emoji = isProfit ? '✅' : '❌';
    const pnlColor = isProfit ? '🟢' : '🔴';

    const message = `
${BOT_NAME} <b>Position Closed</b>
━━━━━━━━━━━━━━━━━━━━━

${emoji} <b>${exit.token}</b>
🔗 Chain: <code>${exit.chain.toUpperCase()}</code>

📋 <b>Exit Reason:</b> ${exit.reason}

💰 <b>Trade Summary</b>
┌ Entry: <code>$${exit.entryPrice.toFixed(8)}</code>
├ Exit: <code>$${exit.exitPrice.toFixed(8)}</code>
└ Change: <code>${exit.pnlPercent}%</code>

${pnlColor} <b>PnL:</b> <code>${isProfit ? '+' : ''}$${exit.pnl.toFixed(2)}</code>

━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    return sendMessage(message);
}

/**
 * Send daily summary
 */
export async function notifyDailySummary(summary) {
    const isProfit = summary.totalPnl >= 0;
    const emoji = isProfit ? '📈' : '📉';

    const message = `
${BOT_NAME} <b>Daily Summary</b>
━━━━━━━━━━━━━━━━━━━━━

${emoji} <b>Performance</b>
┌ Total PnL: <code>${isProfit ? '+' : ''}$${summary.totalPnl.toFixed(2)}</code>
├ Trades: <code>${summary.totalTrades}</code>
├ Win Rate: <code>${summary.winRate.toFixed(1)}%</code>
└ Profit Factor: <code>${summary.profitFactor.toFixed(2)}</code>

📊 <b>Details</b>
┌ Wins: <code>${summary.wins}</code>
├ Losses: <code>${summary.losses}</code>
├ Best: <code>+$${summary.biggestWin.toFixed(2)}</code>
└ Worst: <code>-$${summary.biggestLoss.toFixed(2)}</code>

💰 <b>Balance:</b> <code>$${summary.balance.toFixed(2)}</code>

━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    return sendMessage(message, getMainMenuKeyboard());
}

/**
 * Send status message
 */
export async function notifyStatus(status) {
    const message = createStatusCard(status);
    return sendMessage(message, getMainMenuKeyboard());
}

/**
 * Send startup notification
 */
export async function notifyStartup(botConfig) {
    const message = `
${BOT_NAME} <b>Bot Started</b>
━━━━━━━━━━━━━━━━━━━━━

🚀 <b>Configuration</b>
┌ Mode: <code>${botConfig.mode}</code>
├ Chains: <code>${botConfig.chains.join(', ')}</code>
├ Take Profit: <code>${botConfig.takeProfit}x</code>
└ Stop Loss: <code>${botConfig.stopLoss}%</code>

💰 <b>Balance:</b> <code>$${botConfig.balance.toFixed(2)}</code>
📊 <b>Watching:</b> <code>${botConfig.watchlist} tokens</code>

<i>Monitoring for volume spikes...</i>

━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    return sendMessage(message, getMainMenuKeyboard());
}

/**
 * Send error alert
 */
export async function notifyError(error) {
    const message = `
${BOT_NAME} <b>⚠️ Error Alert</b>
━━━━━━━━━━━━━━━━━━━━━

<b>Type:</b> <code>${error.type || 'Unknown'}</code>
<b>Message:</b> ${error.message}

<i>Check logs for details</i>

━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    return sendMessage(message);
}

// ==================== HELPERS ====================

/**
 * Get strength bar visualization
 */
function getStrengthBar(strength) {
    const filled = Math.floor(strength / 10);
    const empty = 10 - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
}

/**
 * Format large numbers
 */
function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(2) + 'K';
    return num.toFixed(2);
}

// ==================== COMMAND HANDLERS ====================

/**
 * Handle /start command
 */
export async function handleStart() {
    const status = getStatus();
    const pnl = getPnLSummary();

    const fullStatus = {
        ...status,
        isRunning: true,
        mode: config.mode,
        balance: getBalance('bsc') + getBalance('base') + getBalance('solana'),
        dailyPnl: pnl.todayPnl || 0,
        dailyTrades: pnl.todayTrades || 0,
        winRate: pnl.winRate || 0,
        uptime: process.uptime()
    };

    return notifyStatus(fullStatus);
}

/**
 * Handle /positions command
 */
export async function handlePositions() {
    const positions = getOpenPositions();

    if (positions.length === 0) {
        const message = `
${BOT_NAME} <b>Open Positions</b>
━━━━━━━━━━━━━━━━━━━━━

<i>No open positions</i>

━━━━━━━━━━━━━━━━━━━━━
        `.trim();
        return sendMessage(message, getPositionsKeyboard());
    }

    let positionsList = '';
    positions.forEach((p, i) => {
        positionsList += `
${i + 1}. <b>${p.token}</b> (${p.chain.toUpperCase()})
   Entry: <code>$${p.entryPrice.toFixed(8)}</code>
   Size: <code>$${p.positionSizeUsd.toFixed(2)}</code>
`;
    });

    const message = `
${BOT_NAME} <b>Open Positions</b>
━━━━━━━━━━━━━━━━━━━━━

📊 <b>${positions.length} Position(s)</b>
${positionsList}
━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    return sendMessage(message, getPositionsKeyboard());
}

/**
 * Handle /pnl command
 */
export async function handlePnL() {
    const summary = getPnLSummary();

    const message = `
${BOT_NAME} <b>PnL Report</b>
━━━━━━━━━━━━━━━━━━━━━

💰 <b>All Time</b>
┌ Total PnL: <code>${(summary.totalPnl || 0) >= 0 ? '+' : ''}$${(summary.totalPnl || 0).toFixed(2)}</code>
├ Total Trades: <code>${summary.totalTrades || 0}</code>
├ Win Rate: <code>${(summary.winRate || 0).toFixed(1)}%</code>
└ Profit Factor: <code>${(summary.profitFactor || 0).toFixed(2)}</code>

📊 <b>Statistics</b>
┌ Wins: <code>${summary.wins || 0}</code>
├ Losses: <code>${summary.losses || 0}</code>
├ Best Trade: <code>+$${(summary.biggestWin || 0).toFixed(2)}</code>
└ Worst Trade: <code>-$${(summary.biggestLoss || 0).toFixed(2)}</code>

━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    return sendMessage(message, getMainMenuKeyboard());
}

/**
 * Handle /help command
 */
export async function handleHelp() {
    const message = `
${BOT_NAME} <b>Help</b>
━━━━━━━━━━━━━━━━━━━━━

<b>Commands</b>
/start - Main menu
/status - Bot status
/positions - View positions
/pnl - PnL report
/help - This message

<b>Strategy</b>
Volume Spike Scalping
• Entry: Volume 3x + Price +2%
• Take Profit: ${config.takeProfit?.multiplier || 5}x
• Stop Loss: ${config.risk?.stopLossPercent || 5}%
• Max Hold: 30 min

<b>Chains</b>
• BSC (PancakeSwap)
• Base (Aerodrome)
• Solana (Raydium)

━━━━━━━━━━━━━━━━━━━━━
<i>v${BOT_VERSION}</i>
    `.trim();

    return sendMessage(message, getMainMenuKeyboard());
}

export default {
    isTelegramEnabled,
    notifySignal,
    notifyTrade,
    notifyExit,
    notifyDailySummary,
    notifyStatus,
    notifyStartup,
    notifyError,
    handleStart,
    handlePositions,
    handlePnL,
    handleHelp
};
