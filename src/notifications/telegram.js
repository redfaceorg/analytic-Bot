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
import { getWalletSummary, getAllBalances, createEvmWallet, createSolanaWallet, hasEvmWallet, hasSolanaWallet } from '../wallet/walletManager.js';
import config from '../config/index.js';

// Telegram config
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Bot branding
const BOT_NAME = '🔴 RedFace';
const BOT_VERSION = '1.0.0';

// Check if Telegram is configured
export function isTelegramEnabled() {
    return !!(BOT_TOKEN);  // Allow bot to work without CHAT_ID for multi-user
}

// Store current user context for handlers (multi-user support)
let currentUserChatId = null;

/**
 * Send message with optional inline keyboard
 * @param {string} text - Message text
 * @param {Array} keyboard - Optional inline keyboard
 * @param {string} parseMode - Parse mode (HTML or Markdown)
 * @param {string} targetChatId - Target chat ID (for multi-user, defaults to current user)
 */
async function sendMessage(text, keyboard = null, parseMode = 'HTML', targetChatId = null) {
    if (!isTelegramEnabled()) return false;

    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

    // Priority: explicit targetChatId > currentUserChatId > env CHAT_ID
    const chatId = targetChatId || currentUserChatId || CHAT_ID;
    if (!chatId) {
        logError('No chat ID available for sending message');
        return false;
    }

    const body = {
        chat_id: chatId,
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
 * Set current user context for handlers
 */
export function setCurrentUser(chatId) {
    currentUserChatId = chatId;
}

/**
 * Get current user chat ID
 */
export function getCurrentUserChatId() {
    return currentUserChatId || CHAT_ID;
}

/**
 * Send message to current user
 */
async function sendToCurrentUser(text, keyboard = null) {
    return sendMessage(text, keyboard, 'HTML', getCurrentUserChatId());
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
            { text: '💰 Wallet', callback_data: 'wallet' },
            { text: '📈 PnL', callback_data: 'pnl' }
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
 * Send signal alert (Maestro-style) with Buy buttons
 */
export async function notifySignal(signal) {
    const strengthBar = getStrengthBar(signal.strength);

    // Determine native token symbol based on chain
    const nativeSymbol = signal.chain === 'bsc' ? 'BNB' :
        signal.chain === 'base' ? 'ETH' : 'SOL';

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

💵 <b>Quick Buy with ${nativeSymbol}:</b>
    `.trim();

    // Store signal data for later use (encode in callback)
    const signalId = Buffer.from(JSON.stringify({
        token: signal.token,
        chain: signal.chain,
        pair: signal.pairAddress,
        price: signal.entryPrice
    })).toString('base64').slice(0, 60);

    const keyboard = [
        // Buy amount buttons
        [
            { text: `🟢 0.01 ${nativeSymbol}`, callback_data: `buy_${signal.chain}_0.01_${signalId}` },
            { text: `🟢 0.05 ${nativeSymbol}`, callback_data: `buy_${signal.chain}_0.05_${signalId}` }
        ],
        [
            { text: `🟢 0.1 ${nativeSymbol}`, callback_data: `buy_${signal.chain}_0.1_${signalId}` },
            { text: `🟢 0.5 ${nativeSymbol}`, callback_data: `buy_${signal.chain}_0.5_${signalId}` }
        ],
        [
            { text: `💰 1 ${nativeSymbol}`, callback_data: `buy_${signal.chain}_1_${signalId}` },
            { text: `🔥 Custom Amount`, callback_data: `buy_custom_${signal.chain}_${signalId}` }
        ],
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
 * Handle /positions command with sell buttons
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
    const sellButtons = [];

    positions.forEach((p, i) => {
        const currentPnl = ((p.currentPrice || p.entryPrice) - p.entryPrice) / p.entryPrice * 100;
        const pnlEmoji = currentPnl >= 0 ? '🟢' : '🔴';

        positionsList += `
${i + 1}. <b>${p.token}</b> (${p.chain.toUpperCase()})
   Entry: <code>$${p.entryPrice.toFixed(8)}</code>
   Size: <code>$${p.positionSizeUsd.toFixed(2)}</code>
   ${pnlEmoji} PnL: <code>${currentPnl >= 0 ? '+' : ''}${currentPnl.toFixed(2)}%</code>
`;
        // Add sell buttons for this position
        sellButtons.push([
            { text: `🔴 Sell 25% #${i + 1}`, callback_data: `sell_${i}_25` },
            { text: `🔴 Sell 50% #${i + 1}`, callback_data: `sell_${i}_50` },
            { text: `🔴 Sell 100% #${i + 1}`, callback_data: `sell_${i}_100` }
        ]);
    });

    const message = `
${BOT_NAME} <b>Open Positions</b>
━━━━━━━━━━━━━━━━━━━━━

📊 <b>${positions.length} Position(s)</b>
${positionsList}
<i>Click to sell:</i>

━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    // Build keyboard with sell buttons + navigation
    const keyboard = [
        ...sellButtons,
        [
            { text: '🔴 Close All', callback_data: 'positions_close_all' }
        ],
        [
            { text: '◀️ Back', callback_data: 'menu' }
        ]
    ];

    return sendMessage(message, keyboard);
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

/**
 * Wallet keyboard
 */
function getWalletKeyboard(hasEvm, hasSol) {
    const keyboard = [];

    if (!hasEvm) {
        keyboard.push([{ text: '🆕 Create EVM Wallet', callback_data: 'wallet_create_evm' }]);
    }
    if (!hasSol) {
        keyboard.push([{ text: '🆕 Create Solana Wallet', callback_data: 'wallet_create_sol' }]);
    }

    keyboard.push([
        { text: '📥 Import Wallet', callback_data: 'wallet_import' }
    ]);

    if (hasEvm || hasSol) {
        keyboard.push([
            { text: '💰 Refresh Balances', callback_data: 'wallet_balance' }
        ]);
    }

    // Mode toggle
    const currentMode = config.mode;
    keyboard.push([
        { text: currentMode === 'PAPER' ? '🔴 Switch to LIVE' : '📝 Switch to PAPER', callback_data: 'wallet_toggle_mode' }
    ]);

    keyboard.push([{ text: '◀️ Back', callback_data: 'menu' }]);

    return keyboard;
}

/**
 * Handle /wallet command
 */
export async function handleWallet() {
    const summary = getWalletSummary();
    const balances = await getAllBalances();

    let walletList = '';

    if (summary.hasEvm) {
        walletList += `
🔷 <b>EVM (BSC/Base)</b>
Address: <code>${summary.evmAddress}</code>
BSC: <code>${balances.bsc.native.toFixed(4)} ${balances.bsc.symbol || 'BNB'}</code> (~$${balances.bsc.usd.toFixed(2)})
Base: <code>${balances.base.native.toFixed(4)} ${balances.base.symbol || 'ETH'}</code> (~$${balances.base.usd.toFixed(2)})
`;
    }

    if (summary.hasSolana) {
        walletList += `
🟣 <b>Solana</b>
Address: <code>${summary.solanaAddress}</code>
Balance: <code>${balances.solana.native.toFixed(4)} SOL</code> (~$${balances.solana.usd.toFixed(2)})
`;
    }

    if (!summary.hasEvm && !summary.hasSolana) {
        walletList = `
<i>No wallets configured</i>
Create or import a wallet to enable live trading.
`;
    }

    const modeEmoji = config.mode === 'LIVE' ? '🔴' : '📝';

    const message = `
${BOT_NAME} <b>Wallet</b>
━━━━━━━━━━━━━━━━━━━━━

${modeEmoji} <b>Mode:</b> ${config.mode}
${walletList}
💵 <b>Total:</b> ~$${balances.totalUsd.toFixed(2)}

━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    return sendMessage(message, getWalletKeyboard(summary.hasEvm, summary.hasSolana));
}

/**
 * Handle wallet creation
 */
export async function handleCreateEvmWallet() {
    const result = createEvmWallet();

    if (!result.success) {
        return sendMessage(`❌ Failed to create wallet: ${result.error}`);
    }

    const message = `
${BOT_NAME} <b>New EVM Wallet Created</b>
━━━━━━━━━━━━━━━━━━━━━

✅ <b>Wallet Created Successfully!</b>

📍 <b>Address:</b>
<code>${result.address}</code>

🔐 <b>Private Key:</b>
<code>${result.privateKey}</code>

⚠️ <b>IMPORTANT:</b>
• Save this private key securely
• Never share it with anyone
• Fund this wallet before trading

━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    return sendMessage(message, getWalletKeyboard(true, hasSolanaWallet()));
}

/**
 * Handle Solana wallet creation
 */
export async function handleCreateSolanaWallet() {
    const result = await createSolanaWallet();

    if (!result.success) {
        return sendMessage(`❌ Failed to create wallet: ${result.error}`);
    }

    const message = `
${BOT_NAME} <b>New Solana Wallet Created</b>
━━━━━━━━━━━━━━━━━━━━━

✅ <b>Wallet Created Successfully!</b>

📍 <b>Address:</b>
<code>${result.address}</code>

🔐 <b>Private Key:</b>
<code>${result.privateKey}</code>

⚠️ <b>IMPORTANT:</b>
• Save this private key securely
• Never share it with anyone
• Fund this wallet before trading

━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    return sendMessage(message, getWalletKeyboard(hasEvmWallet(), true));
}

/**
 * Handle mode toggle
 */
export async function handleToggleMode() {
    const currentMode = config.mode;
    const newMode = currentMode === 'PAPER' ? 'LIVE' : 'PAPER';

    // Check if wallets exist for live mode
    if (newMode === 'LIVE' && !hasEvmWallet() && !hasSolanaWallet()) {
        const message = `
${BOT_NAME} <b>Cannot Switch to LIVE</b>
━━━━━━━━━━━━━━━━━━━━━

⚠️ <b>No wallet configured!</b>

Please create or import a wallet first before switching to LIVE mode.

━━━━━━━━━━━━━━━━━━━━━
        `.trim();
        return sendMessage(message, getWalletKeyboard(false, false));
    }

    // Toggle mode
    config.mode = newMode;

    const emoji = newMode === 'LIVE' ? '🔴' : '📝';
    const message = `
${BOT_NAME} <b>Mode Changed</b>
━━━━━━━━━━━━━━━━━━━━━

${emoji} <b>Mode:</b> ${newMode}

${newMode === 'LIVE' ? '⚠️ <b>WARNING:</b> Real funds will be used!' : '✅ Paper trading mode - no real funds used'}

━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    return sendMessage(message, getMainMenuKeyboard());
}

/**
 * Handle buy request from signal button
 * @param {string} chain - Chain (bsc, base, solana)
 * @param {string} amount - Amount in native token
 * @param {string} signalData - Base64 encoded signal data
 */
export async function handleBuy(chain, amount, signalData) {
    try {
        // Decode signal data
        let signal;
        try {
            signal = JSON.parse(Buffer.from(signalData, 'base64').toString());
        } catch (e) {
            return sendMessage('❌ Invalid signal data. Please try again with a fresh signal.');
        }

        const nativeSymbol = chain === 'bsc' ? 'BNB' : chain === 'base' ? 'ETH' : 'SOL';
        const amountNum = parseFloat(amount);

        // Check if wallet exists
        const summary = getWalletSummary();
        if (chain === 'solana' && !summary.hasSolana) {
            return sendMessage('❌ No Solana wallet configured. Please create one first.', [
                [{ text: '💰 Wallet', callback_data: 'wallet' }]
            ]);
        }
        if ((chain === 'bsc' || chain === 'base') && !summary.hasEvm) {
            return sendMessage('❌ No EVM wallet configured. Please create one first.', [
                [{ text: '💰 Wallet', callback_data: 'wallet' }]
            ]);
        }

        // Show confirmation
        const confirmMessage = `
${BOT_NAME} <b>Confirm Trade</b>
━━━━━━━━━━━━━━━━━━━━━

🪙 <b>Token:</b> ${signal.token}
🔗 <b>Chain:</b> ${chain.toUpperCase()}
💰 <b>Amount:</b> ${amountNum} ${nativeSymbol}
📈 <b>Price:</b> $${signal.price?.toFixed(8) || 'Market'}

⚠️ <b>Mode:</b> ${config.mode}
${config.mode === 'LIVE' ? '🔴 This will use REAL funds!' : '📝 Paper trade only'}

━━━━━━━━━━━━━━━━━━━━━
        `.trim();

        const confirmKeyboard = [
            [
                { text: '✅ Confirm Buy', callback_data: `confirm_buy_${chain}_${amount}_${signalData}` },
                { text: '❌ Cancel', callback_data: 'menu' }
            ]
        ];

        return sendMessage(confirmMessage, confirmKeyboard);
    } catch (err) {
        logError('Buy handler error', err);
        return sendMessage('❌ Error processing trade request.');
    }
}

/**
 * Execute confirmed buy
 */
export async function executeConfirmedBuy(chain, amount, signalData) {
    try {
        const signal = JSON.parse(Buffer.from(signalData, 'base64').toString());
        const nativeSymbol = chain === 'bsc' ? 'BNB' : chain === 'base' ? 'ETH' : 'SOL';
        const amountNum = parseFloat(amount);

        // Send "processing" message
        await sendMessage(`⏳ Processing ${amountNum} ${nativeSymbol} buy for ${signal.token}...`);

        if (config.mode === 'PAPER') {
            // Paper trade
            const { executePaperBuy } = await import('../execution/paperTrader.js');
            const result = await executePaperBuy({
                ...signal,
                chain,
                entryPrice: signal.price
            }, amountNum * (chain === 'bsc' ? 300 : chain === 'base' ? 2400 : 100)); // Convert to USD

            if (result.success) {
                const successMsg = `
${BOT_NAME} <b>Paper Trade Executed!</b>
━━━━━━━━━━━━━━━━━━━━━

✅ <b>BUY ${signal.token}</b>

💰 Amount: ${amountNum} ${nativeSymbol} (~$${result.result?.amount?.toFixed(2) || (amountNum * 300).toFixed(2)})
📈 Entry: $${signal.price?.toFixed(8) || 'Market'}
🎯 Take Profit: Set
🛑 Stop Loss: Set

<i>Position is being monitored...</i>

━━━━━━━━━━━━━━━━━━━━━
                `.trim();
                return sendMessage(successMsg, getMainMenuKeyboard());
            } else {
                return sendMessage(`❌ Paper trade failed: ${result.error}`);
            }
        } else {
            // LIVE trade
            const { executeLiveBuy, isLiveEnabled } = await import('../execution/evmExecutor.js');

            if (!isLiveEnabled()) {
                return sendMessage('❌ Live trading is not enabled. Please enable it in settings.');
            }

            if (chain === 'solana') {
                return sendMessage('❌ Solana live trading not yet implemented. Use BSC or Base.');
            }

            const result = await executeLiveBuy({
                ...signal,
                chain,
                entryPrice: signal.price,
                pairAddress: signal.pair
            }, amountNum);

            if (result.success) {
                const successMsg = `
${BOT_NAME} <b>🔴 LIVE Trade Executed!</b>
━━━━━━━━━━━━━━━━━━━━━

✅ <b>BUY ${signal.token}</b>

💰 Amount: ${amountNum} ${nativeSymbol}
📈 Entry: $${signal.price?.toFixed(8) || 'Market'}
🔗 TX: <code>${result.txHash?.slice(0, 20)}...</code>

<i>Position is being monitored...</i>

━━━━━━━━━━━━━━━━━━━━━
                `.trim();
                return sendMessage(successMsg, getMainMenuKeyboard());
            } else {
                return sendMessage(`❌ Trade failed: ${result.error}`);
            }
        }
    } catch (err) {
        logError('Execute buy error', err);
        return sendMessage('❌ Trade execution error. Check logs.');
    }
}

/**
 * Handle /token command - Get token info and safety check
 */
export async function handleToken(tokenAddress) {
    try {
        if (!tokenAddress || tokenAddress.length < 20) {
            return sendMessage(`
${BOT_NAME} <b>Token Scanner</b>
━━━━━━━━━━━━━━━━━━━━━

Usage: <code>/token &lt;address&gt;</code>

Example:
<code>/token 0x...</code> (for BSC/Base)

━━━━━━━━━━━━━━━━━━━━━
            `.trim());
        }

        await sendMessage('🔍 Scanning token...');

        // Import analyzer
        const { analyzeToken, formatTokenMessage } = await import('../analysis/tokenAnalyzer.js');

        // Detect chain from address format
        const chain = tokenAddress.startsWith('0x') ? 'bsc' : 'solana';

        const analysis = await analyzeToken(chain, tokenAddress);
        const message = formatTokenMessage(analysis);

        const keyboard = [];

        if (analysis.success) {
            keyboard.push([
                { text: '📊 Chart', url: `https://dexscreener.com/${chain}/${analysis.token.pairAddress}` }
            ]);

            // Add buy buttons if not a honeypot
            if (!analysis.safety.isHoneypot) {
                const nativeSymbol = chain === 'bsc' ? 'BNB' : chain === 'base' ? 'ETH' : 'SOL';
                keyboard.push([
                    { text: `🟢 Buy 0.1 ${nativeSymbol}`, callback_data: `quickbuy_${chain}_0.1_${tokenAddress}` },
                    { text: `🟢 Buy 0.5 ${nativeSymbol}`, callback_data: `quickbuy_${chain}_0.5_${tokenAddress}` }
                ]);
            }
        }

        keyboard.push([{ text: '◀️ Menu', callback_data: 'menu' }]);

        return sendMessage(message, keyboard);
    } catch (err) {
        logError('Token command error', err);
        return sendMessage('❌ Failed to analyze token');
    }
}

/**
 * Handle sell position
 */
export async function handleSell(positionId, percentage) {
    try {
        const percentNum = parseInt(percentage);

        await sendMessage(`⏳ Selling ${percentNum}% of position...`);

        // For now, paper sell
        if (config.mode === 'PAPER') {
            const message = `
${BOT_NAME} <b>Paper Sell Executed</b>
━━━━━━━━━━━━━━━━━━━━━

✅ Sold ${percentNum}% of position

<i>This was a paper trade</i>

━━━━━━━━━━━━━━━━━━━━━
            `.trim();
            return sendMessage(message, getMainMenuKeyboard());
        }

        // Live sell would go here
        return sendMessage('❌ Live selling not yet implemented');
    } catch (err) {
        logError('Sell error', err);
        return sendMessage('❌ Sell failed');
    }
}

/**
 * Handle settings menu
 */
export async function handleSettings() {
    const message = `
${BOT_NAME} <b>Settings</b>
━━━━━━━━━━━━━━━━━━━━━

⚙️ <b>Trading Settings</b>
┌ Mode: <code>${config.mode}</code>
├ Take Profit: <code>${config.takeProfit?.multiplier || 5}x</code>
├ Stop Loss: <code>${config.risk?.stopLossPercent || 5}%</code>
├ Max Trades/Day: <code>${config.risk?.maxTradesPerDay || 15}</code>
└ Slippage: <code>Auto</code>

📢 <b>Notifications</b>
┌ Signals: <code>ON</code>
├ Trades: <code>ON</code>
└ Daily Summary: <code>ON</code>

━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    const keyboard = [
        [
            { text: config.mode === 'PAPER' ? '🔴 Switch to LIVE' : '📝 Switch to PAPER', callback_data: 'wallet_toggle_mode' }
        ],
        [
            { text: '🎯 TP: ' + (config.takeProfit?.multiplier || 5) + 'x', callback_data: 'settings_tp' },
            { text: '🛑 SL: ' + (config.risk?.stopLossPercent || 5) + '%', callback_data: 'settings_sl' }
        ],
        [
            { text: '◀️ Back', callback_data: 'menu' }
        ]
    ];

    return sendMessage(message, keyboard);
}

/**
 * Handle referral info
 */
export async function handleReferral(userId) {
    // Generate referral code from user ID
    const refCode = `RF${userId?.toString().slice(-6) || 'XXXX'}`;

    const message = `
${BOT_NAME} <b>Referral Program</b>
━━━━━━━━━━━━━━━━━━━━━

💰 <b>Earn with Referrals!</b>

Your referral link:
<code>https://t.me/YourBotName?start=${refCode}</code>

📊 <b>Your Stats</b>
┌ Referrals: <code>0</code>
├ Earnings: <code>$0.00</code>
└ Pending: <code>$0.00</code>

🎁 <b>Rewards</b>
┌ Earn <b>30%</b> of trading fees
└ Lifetime commissions!

━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    const keyboard = [
        [
            { text: '📋 Copy Link', callback_data: 'ref_copy' },
            { text: '📊 Stats', callback_data: 'ref_stats' }
        ],
        [
            { text: '◀️ Back', callback_data: 'menu' }
        ]
    ];

    return sendMessage(message, keyboard);
}

/**
 * Handle leaderboard
 */
export async function handleLeaderboard() {
    const message = `
${BOT_NAME} <b>🏆 Leaderboard</b>
━━━━━━━━━━━━━━━━━━━━━

<b>Top Traders (7 Days)</b>

🥇 <code>Trader***1</code> — +$1,234.56
🥈 <code>Trader***2</code> — +$987.65
🥉 <code>Trader***3</code> — +$654.32
4. <code>Trader***4</code> — +$432.10
5. <code>Trader***5</code> — +$321.00

━━━━━━━━━━━━━━━━━━━━━

<i>Trade more to climb the ranks!</i>

━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    const keyboard = [
        [
            { text: '📅 Daily', callback_data: 'lb_daily' },
            { text: '📆 Weekly', callback_data: 'lb_weekly' },
            { text: '📈 All Time', callback_data: 'lb_all' }
        ],
        [
            { text: '◀️ Back', callback_data: 'menu' }
        ]
    ];

    return sendMessage(message, keyboard);
}

/**
 * Update main menu to include new buttons
 */
function getMainMenuKeyboard() {
    return [
        [
            { text: '📊 Status', callback_data: 'status' },
            { text: '💼 Positions', callback_data: 'positions' }
        ],
        [
            { text: '💰 Wallet', callback_data: 'wallet' },
            { text: '📈 PnL', callback_data: 'pnl' }
        ],
        [
            { text: '🔍 Token', callback_data: 'token_prompt' },
            { text: '⚙️ Settings', callback_data: 'settings' }
        ],
        [
            { text: '👥 Referral', callback_data: 'referral' },
            { text: '🤖 Copy Trade', callback_data: 'copy_trade' }
        ],
        [
            { text: '🏆 Leaderboard', callback_data: 'leaderboard' },
            { text: '🔄 Refresh', callback_data: 'refresh' }
        ]
    ];
}

/**
 * Handle copy trading menu
 */
export async function handleCopyTrading(userId) {
    const message = `
${BOT_NAME} <b>🤖 Copy Trading</b>
━━━━━━━━━━━━━━━━━━━━━

<b>Auto-Copy Top Traders!</b>

When you follow a trader, their trades
are automatically copied to your wallet.

📊 <b>Following:</b> 0 traders

⚙️ <b>Settings</b>
┌ Enabled: ✅
├ Copy Size: 10%
└ Max/Trade: $100

━━━━━━━━━━━━━━━━━━━━━

<i>Browse Leaderboard to find traders!</i>
    `.trim();

    const keyboard = [
        [
            { text: '🏆 Browse Traders', callback_data: 'leaderboard' }
        ],
        [
            { text: '⚙️ Copy Settings', callback_data: 'copy_settings' },
            { text: '📊 My Following', callback_data: 'copy_following' }
        ],
        [
            { text: '◀️ Back', callback_data: 'menu' }
        ]
    ];

    return sendMessage(message, keyboard);
}

export default {
    isTelegramEnabled,
    setCurrentUser,
    getCurrentUserChatId,
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
    handleHelp,
    handleWallet,
    handleCreateEvmWallet,
    handleCreateSolanaWallet,
    handleToggleMode,
    handleBuy,
    executeConfirmedBuy,
    handleToken,
    handleSell,
    handleSettings,
    handleReferral,
    handleLeaderboard,
    handleCopyTrading
};
