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
import { getSupabase } from '../database/supabase.js';
import {
    getOrCreateUser,
    getWalletSummary,
    createEvmWallet,
    createSolanaWallet,
    toggleTradingMode,
    getUserMode,
    getUserWallet,
    getWalletForTrading,
    hasCompletedOnboarding,
    markOnboardingComplete,
    getAutoTradeSettings,
    updateAutoTradeSettings,
    toggleAutoTrade,
    getUserByTelegramId
} from '../wallet/userWalletManager.js';
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
            logError(`Telegram send failed to ${chatId}: ${error}`);
            console.error('TELEGRAM ERROR DETAILS:', { chatId, error, text: text?.slice(0, 100) });
            return false;
        }
        return true;
    } catch (err) {
        logError('Telegram error', err);
        console.error('TELEGRAM CATCH ERROR:', err.message);
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
 * Check if current user is admin (defined by TELEGRAM_CHAT_ID env var)
 */
export function isAdmin() {
    if (!CHAT_ID) return false;
    return currentUserChatId?.toString() === CHAT_ID?.toString();
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
 * Main menu keyboard - see updated version below
 * (Moved to avoid duplication)
 */

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
 * Send position exit alert with shareable PnL card
 */
export async function notifyExit(exit, userId = null) {
    const isProfit = exit.pnl >= 0;
    const emoji = isProfit ? '🚀' : '📉';
    const pnlColor = isProfit ? '🟢' : '🔴';
    const hypeEmoji = isProfit ? '💎🙌' : '💪';
    const sign = isProfit ? '+' : '';
    const profitPercent = ((exit.exitPrice - exit.entryPrice) / exit.entryPrice * 100).toFixed(1);

    // Create hype-style PnL card message
    const message = `
${BOT_NAME} ${emoji} <b>Trade Complete!</b>
━━━━━━━━━━━━━━━━━━━━━

🪙 <b>${exit.token}</b> on ${exit.chain.toUpperCase()}

${pnlColor} <b>${sign}${profitPercent}%</b> ${hypeEmoji}
💰 <b>${sign}$${exit.pnl.toFixed(2)}</b>

📈 Entry: <code>$${exit.entryPrice.toFixed(8)}</code>
📉 Exit: <code>$${exit.exitPrice.toFixed(8)}</code>
📋 Reason: <i>${exit.reason}</i>

━━━━━━━━━━━━━━━━━━━━━
📤 <b>Share your ${isProfit ? 'win' : 'trade'}!</b>
    `.trim();

    // Generate share text for Twitter/X
    const shareText = encodeURIComponent(
        `${isProfit ? '🚀' : '📉'} ${sign}${profitPercent}% on $${exit.token}!\n` +
        `💰 ${sign}$${exit.pnl.toFixed(2)} profit\n\n` +
        `Made with @RedFaceBot 🔴\n` +
        `#Crypto #Trading #DeFi`
    );
    const twitterUrl = `https://twitter.com/intent/tweet?text=${shareText}`;

    const keyboard = [
        [
            { text: '🐦 Share on X', url: twitterUrl }
        ],
        [
            { text: '📊 View Positions', callback_data: 'positions' },
            { text: '📈 New Trade', callback_data: 'token_prompt' }
        ],
        [{ text: '◀️ Menu', callback_data: 'menu' }]
    ];

    return sendMessage(message, keyboard, 'HTML', userId);
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
    const telegramId = currentUserChatId?.toString();

    // Get or create user
    if (telegramId) {
        await getOrCreateUser(telegramId);

        // Check if new user needs onboarding
        const completedOnboarding = await hasCompletedOnboarding(telegramId);
        if (!completedOnboarding) {
            return showOnboardingWelcome();
        }
    }

    // Returning user - show normal status
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
 * Handle /start with referral code
 */
export async function handleStartWithReferral(refCode, chatId) {
    const telegramId = chatId?.toString() || currentUserChatId?.toString();

    // Look up referrer by code
    const supabase = getSupabase();
    let referrerId = null;

    if (supabase && refCode) {
        const { data: referrer } = await supabase
            .from('users')
            .select('id')
            .eq('referral_code', refCode.toUpperCase())
            .single();

        if (referrer) {
            referrerId = referrer.id;
            logInfo(`Referral code ${refCode} resolved to user ID ${referrerId}`);
        }
    }

    // Create user with referrer
    if (telegramId) {
        const existingUser = await getUserByTelegramId(telegramId);

        if (!existingUser) {
            // New user - create with referrer
            if (supabase && referrerId) {
                const referralCode = `RF${telegramId.slice(-6)}${Date.now().toString(36).slice(-4)}`.toUpperCase();

                const { data: newUser } = await supabase
                    .from('users')
                    .insert({
                        telegram_id: telegramId,
                        referrer_id: referrerId,
                        referral_code: referralCode,
                        settings: {
                            mode: 'PAPER',
                            take_profit: 5,
                            stop_loss: 5,
                            onboarding_completed: false
                        }
                    })
                    .select()
                    .single();

                if (newUser) {
                    logInfo(`New user ${telegramId} signed up via referral from ${referrerId}`);
                    setCurrentUser(chatId);
                    return showOnboardingWelcome();
                }
            }
        }
    }

    // Fall back to normal start
    setCurrentUser(chatId);
    return handleStart();
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
${BOT_NAME} <b>📚 Help & Tutorial</b>
━━━━━━━━━━━━━━━━━━━━━

<b>🎓 HOW TO PLACE A TRADE:</b>

<b>Step 1:</b> Create a wallet
• Tap <code>💼 Wallet</code> → Create EVM or Solana wallet

<b>Step 2:</b> Deposit funds (for LIVE mode)
• Copy your wallet address
• Send BNB/ETH/SOL to it

<b>Step 3:</b> Find a token to trade
• Use <code>/token</code> + paste contract address
• Example: <code>/token 0x123...abc</code>

<b>Step 4:</b> Buy the token
• Click <b>"Buy"</b> button on token info
• Select amount (0.1, 0.5, or 1 BNB/ETH/SOL)
• Confirm the trade!

<b>Step 5:</b> Monitor & sell
• Tap <code>📊 Positions</code> to see your trades
• Click <b>"Sell"</b> when you want to exit

━━━━━━━━━━━━━━━━━━━━━

<b>📝 PAPER vs 🔴 LIVE Mode:</b>
• PAPER = Simulated trading (fake money)
• LIVE = Real trades with your funds
• Toggle mode in <code>⚙️ Settings</code>

<b>🔧 Commands:</b>
/start - Main menu
/wallet - View wallets
/positions - Open positions
/pnl - Profit & Loss
/token - Analyze any token
/settings - Bot settings
/referral - Earn from referrals

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
 * Handle /wallet command - Per user
 */
export async function handleWallet() {
    const telegramId = currentUserChatId?.toString();
    if (!telegramId) {
        return sendMessage('❌ User not identified. Please /start first.');
    }

    // Register/update user
    await getOrCreateUser(telegramId);

    const summary = await getWalletSummary(telegramId);
    const mode = await getUserMode(telegramId);

    let walletList = '';

    if (summary.hasEvm) {
        walletList += `
🔷 <b>EVM (BSC/Base)</b>
Address: <code>${summary.evmAddress}</code>
`;
    }

    if (summary.hasSolana) {
        walletList += `
🟣 <b>Solana</b>
Address: <code>${summary.solanaAddress}</code>
`;
    }

    if (!summary.hasEvm && !summary.hasSolana) {
        walletList = `
<i>No wallets configured</i>
Create or import a wallet to enable live trading.
`;
    }

    const modeEmoji = mode === 'LIVE' ? '🔴' : '📝';

    const message = `
${BOT_NAME} <b>Wallet</b>
━━━━━━━━━━━━━━━━━━━━━

${modeEmoji} <b>Mode:</b> ${mode}
${walletList}

━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    return sendMessage(message, getWalletKeyboard(summary.hasEvm, summary.hasSolana));
}

/**
 * Handle /deposit command - Show wallet addresses for depositing funds
 */
export async function handleDeposit() {
    const telegramId = currentUserChatId?.toString();
    if (!telegramId) {
        return sendMessage('❌ User not identified. Please /start first.');
    }

    const summary = await getWalletSummary(telegramId);

    // Check if user has any wallets
    if (!summary.hasEvm && !summary.hasSolana) {
        const message = `
${BOT_NAME} <b>💰 Deposit</b>
━━━━━━━━━━━━━━━━━━━━━

⚠️ <b>No wallets configured!</b>

Create a wallet first to get deposit addresses:

━━━━━━━━━━━━━━━━━━━━━
        `.trim();

        return sendMessage(message, [
            [
                { text: '🆕 Create EVM Wallet', callback_data: 'wallet_create_evm' },
                { text: '🆕 Create Solana', callback_data: 'wallet_create_sol' }
            ],
            [{ text: '◀️ Back', callback_data: 'menu' }]
        ]);
    }

    let depositInfo = '';

    if (summary.hasEvm) {
        depositInfo += `
🔷 <b>BSC (BNB) Deposit</b>
Send <b>BNB</b> to:
<code>${summary.evmAddress}</code>
⚠️ Network: BNB Smart Chain (BEP20)

🔵 <b>Base (ETH) Deposit</b>
Send <b>ETH</b> to:
<code>${summary.evmAddress}</code>
⚠️ Network: Base

`;
    }

    if (summary.hasSolana) {
        depositInfo += `
🟣 <b>Solana (SOL) Deposit</b>
Send <b>SOL</b> to:
<code>${summary.solanaAddress}</code>
⚠️ Network: Solana
`;
    }

    const message = `
${BOT_NAME} <b>💰 Deposit Funds</b>
━━━━━━━━━━━━━━━━━━━━━
${depositInfo}
⚠️ <b>IMPORTANT:</b>
• Only send the correct token to each address
• Double-check the network before sending
• Deposits may take a few minutes to confirm

━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    const keyboard = [
        [{ text: '💼 View Wallet', callback_data: 'wallet' }],
        [{ text: '🔄 Refresh Balances', callback_data: 'wallet_balance' }],
        [{ text: '◀️ Menu', callback_data: 'menu' }]
    ];

    return sendMessage(message, keyboard);
}

/**
 * Handle /withdraw command - Show withdrawal options
 */
export async function handleWithdraw() {
    const telegramId = currentUserChatId?.toString();
    if (!telegramId) {
        return sendMessage('❌ User not identified. Please /start first.');
    }

    const summary = await getWalletSummary(telegramId);

    if (!summary.hasEvm && !summary.hasSolana) {
        return sendMessage(`
${BOT_NAME} <b>💸 Withdraw</b>
━━━━━━━━━━━━━━━━━━━━━

⚠️ No wallets configured!
Create a wallet first to withdraw.

━━━━━━━━━━━━━━━━━━━━━
        `.trim(), [[{ text: '◀️ Back', callback_data: 'menu' }]]);
    }

    let withdrawInfo = '';
    const keyboard = [];
    if (summary.hasEvm) {
        withdrawInfo += `
🔷 <b>EVM Wallet (BSC/Base)</b>
Address: <code>${summary.evmAddress}</code>
Balance: <code>${summary.evmBalance || '0'} BNB</code> (BSC)
Balance: <code>${summary.baseBalance || '0'} ETH</code> (Base)

`;
        keyboard.push([
            { text: '💸 Withdraw BNB', callback_data: 'withdraw_bnb' },
            { text: '💸 Withdraw ETH (Base)', callback_data: 'withdraw_eth' }
        ]);
    }

    if (summary.hasSolana) {
        withdrawInfo += `
🟣 <b>Solana Wallet</b>
Address: <code>${summary.solanaAddress}</code>
Balance: <code>${summary.solBalance || '0'} SOL</code>

`;
        keyboard.push([
            { text: '💸 Withdraw SOL', callback_data: 'withdraw_sol' }
        ]);
    }

    const message = `
${BOT_NAME} <b>💸 Withdraw Funds</b>
━━━━━━━━━━━━━━━━━━━━━
${withdrawInfo}
<b>To withdraw:</b>
1. Tap a withdraw button below
2. Enter destination address when prompted
3. Confirm the transaction

⚠️ Double-check addresses!
Crypto transactions are irreversible.

━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    keyboard.push([{ text: '💼 View Wallet', callback_data: 'wallet' }]);
    keyboard.push([{ text: '◀️ Back', callback_data: 'menu' }]);

    return sendMessage(message, keyboard);
}

/**
 * Handle gas price check
 */
export async function handleGas() {
    const { getNetworkStats } = await import('../services/gasService.js');

    await sendMessage('⛽ Checking network gas prices...');
    const stats = await getNetworkStats();

    const message = `
${BOT_NAME} <b>⛽ Network Status</b>
━━━━━━━━━━━━━━━━━━━━━

🔷 <b>BSC (BNB)</b>
Gas Price: <code>${stats.bsc.formatted}</code>

🔵 <b>Base (ETH)</b>
Gas Price: <code>${stats.base.formatted}</code> (EIP-1559)

🟣 <b>Solana</b>
TPS: <code>${stats.solana.formatted}</code>

━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    const keyboard = [
        [{ text: '🔄 Refresh', callback_data: 'gas' }],
        [{ text: '◀️ Back', callback_data: 'menu' }]
    ];

    return sendMessage(message, keyboard);
}

/**
 * Handle withdraw confirmation prompt
 */
export async function handleWithdrawPrompt(chain) {
    const chainNames = {
        'bnb': 'BNB (BSC)',
        'eth': 'ETH (Base)',
        'sol': 'SOL (Solana)'
    };

    const message = `
${BOT_NAME} <b>💸 Withdraw ${chainNames[chain] || chain.toUpperCase()}</b>
━━━━━━━━━━━━━━━━━━━━━

To withdraw, send a message with:
<code>/send_${chain} [address] [amount]</code>

Example:
<code>/send_${chain} 0x1234... 0.1</code>

⚠️ Make sure the address is correct!

━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    return sendMessage(message, [
        [{ text: '❌ Cancel', callback_data: 'withdraw' }]
    ]);
}

/**
 * Handle EVM wallet creation - Per user
 */
export async function handleCreateEvmWallet() {
    const telegramId = currentUserChatId?.toString();
    if (!telegramId) {
        return sendMessage('❌ User not identified. Please /start first.');
    }

    const result = await createEvmWallet(telegramId);

    if (!result.success) {
        if (result.wallet) {
            return sendMessage(`⚠️ You already have an EVM wallet:\n<code>${result.wallet.address}</code>`);
        }
        return sendMessage(`❌ Failed to create wallet: ${result.error}`);
    }

    const message = `
${BOT_NAME} <b>New EVM Wallet Created</b>
━━━━━━━━━━━━━━━━━━━━━

✅ <b>Wallet Created Successfully!</b>

📍 <b>Address:</b>
<code>${result.address}</code>

🔐 <b>Private Key:</b> Stored securely (encrypted)

⚠️ <b>IMPORTANT:</b>
• Fund this wallet to start trading
• Your key is encrypted in database
• Deposit BNB (BSC) or ETH (Base)

━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    const summary = await getWalletSummary(telegramId);
    return sendMessage(message, getWalletKeyboard(summary.hasEvm, summary.hasSolana));
}

/**
 * Handle Solana wallet creation - Per user
 */
export async function handleCreateSolanaWallet() {
    const telegramId = currentUserChatId?.toString();
    if (!telegramId) {
        return sendMessage('❌ User not identified. Please /start first.');
    }

    const result = await createSolanaWallet(telegramId);

    if (!result.success) {
        if (result.wallet) {
            return sendMessage(`⚠️ You already have a Solana wallet:\n<code>${result.wallet.address}</code>`);
        }
        return sendMessage(`❌ Failed to create wallet: ${result.error}`);
    }

    const message = `
${BOT_NAME} <b>New Solana Wallet Created</b>
━━━━━━━━━━━━━━━━━━━━━

✅ <b>Wallet Created Successfully!</b>

📍 <b>Address:</b>
<code>${result.address}</code>

🔐 <b>Private Key:</b> Stored securely (encrypted)

⚠️ <b>IMPORTANT:</b>
• Fund this wallet to start trading
• Your key is encrypted in database
• Deposit SOL to start

━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    const summary = await getWalletSummary(telegramId);
    return sendMessage(message, getWalletKeyboard(summary.hasEvm, summary.hasSolana));
}

/**
 * Handle mode toggle - Per user
 */
export async function handleToggleMode() {
    const telegramId = currentUserChatId?.toString();
    if (!telegramId) {
        return sendMessage('❌ User not identified. Please /start first.');
    }

    const summary = await getWalletSummary(telegramId);

    // Check if wallets exist for live mode
    const currentMode = await getUserMode(telegramId);
    if (currentMode === 'PAPER' && !summary.hasEvm && !summary.hasSolana) {
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
    const newMode = await toggleTradingMode(telegramId);

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

        // Check if wallet exists (only required for LIVE mode)
        const userMode = await getUserMode(currentUserChatId);
        if (userMode === 'LIVE') {
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
        }
        // PAPER mode doesn't require wallet - uses simulated balance

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
 * Handle /token command - Get token info and safety check with DANGER warnings
 */
export async function handleToken(tokenAddress) {
    try {
        if (!tokenAddress || tokenAddress.length < 20) {
            return sendMessage(`
${BOT_NAME} <b>🔍 Token Scanner</b>
━━━━━━━━━━━━━━━━━━━━━

Paste any contract address to analyze:
• Token info & price
• Liquidity & volume
• 🚨 Honeypot detection
• ⚠️ Risk assessment

<b>Usage:</b>
<code>/token 0x...</code> (BSC/Base)
<code>/token So1...</code> (Solana)

━━━━━━━━━━━━━━━━━━━━━
            `.trim(), [[{ text: '◀️ Menu', callback_data: 'menu' }]]);
        }

        await sendMessage('🔍 Analyzing contract...');

        // Import analyzer
        const { analyzeToken, getSafetyEmoji } = await import('../analysis/tokenAnalyzer.js');

        // Detect chain from address format
        let chain = 'bsc';
        if (tokenAddress.startsWith('0x')) {
            // Could be BSC or Base - default to BSC, user can specify
            chain = 'bsc';
        } else {
            chain = 'solana';
        }

        const analysis = await analyzeToken(chain, tokenAddress);

        if (!analysis.success) {
            return sendMessage(`❌ ${analysis.error}`, [[{ text: '◀️ Menu', callback_data: 'menu' }]]);
        }

        const t = analysis.token;
        const s = analysis.safety;
        const safetyEmoji = getSafetyEmoji(s.riskLevel);
        const priceChangeColor = t.priceChange.h24 >= 0 ? '🟢' : '🔴';
        const nativeSymbol = chain === 'bsc' ? 'BNB' : chain === 'base' ? 'ETH' : 'SOL';

        // Build danger warning based on risk level
        let dangerWarning = '';
        if (s.isHoneypot) {
            dangerWarning = `
🚨🚨🚨 <b>HONEYPOT DETECTED</b> 🚨🚨🚨
⛔ DO NOT BUY - YOU CANNOT SELL!
Reason: ${s.reason || 'Sell function blocked'}
━━━━━━━━━━━━━━━━━━━━━
`;
        } else if (s.riskLevel === 'SCAM' || s.riskLevel === 'EXTREME') {
            dangerWarning = `
⛔⛔⛔ <b>EXTREME DANGER</b> ⛔⛔⛔
High probability of SCAM!
• Sell Tax: ${s.sellTax || 0}%
━━━━━━━━━━━━━━━━━━━━━
`;
        } else if (s.riskLevel === 'HIGH') {
            dangerWarning = `
🔴 <b>HIGH RISK TOKEN</b>
Trade with extreme caution!
━━━━━━━━━━━━━━━━━━━━━
`;
        } else if (s.riskLevel === 'MEDIUM') {
            dangerWarning = `
🟡 <b>MEDIUM RISK</b> - Proceed with caution
━━━━━━━━━━━━━━━━━━━━━
`;
        }

        const message = `
${BOT_NAME} <b>🔍 Token Analysis</b>
━━━━━━━━━━━━━━━━━━━━━
${dangerWarning}
🪙 <b>${t.name}</b> (${t.symbol})
🔗 Chain: <code>${t.chain.toUpperCase()}</code>

💰 <b>Price:</b> <code>$${t.price.toFixed(8)}</code>

📈 <b>Price Change</b>
┌ 5m: <code>${t.priceChange.m5 >= 0 ? '+' : ''}${t.priceChange.m5}%</code>
├ 1h: <code>${t.priceChange.h1 >= 0 ? '+' : ''}${t.priceChange.h1}%</code>
└ 24h: ${priceChangeColor} <code>${t.priceChange.h24 >= 0 ? '+' : ''}${t.priceChange.h24}%</code>

📊 <b>Market Info</b>
┌ Volume 24h: <code>$${formatLargeNumber(t.volume24h)}</code>
├ Liquidity: <code>$${formatLargeNumber(t.liquidity)}</code>
├ Market Cap: <code>$${formatLargeNumber(t.marketCap)}</code>
└ Trades 24h: <code>${t.txns24h.buys + t.txns24h.sells}</code> (📈${t.txns24h.buys} / 📉${t.txns24h.sells})

${safetyEmoji} <b>Safety: ${s.riskLevel || 'UNKNOWN'}</b>
┌ Honeypot: <code>${s.isHoneypot === null ? '❓ Unknown' : s.isHoneypot ? '🚨 YES!' : '✅ No'}</code>
├ Buy Tax: <code>${s.buyTax || 0}%</code>
├ Sell Tax: <code>${s.sellTax || 0}%</code>
├ Open Source: <code>${s.isOpenSource ? '✅' : '❌'}</code>
└ Holders: <code>${s.holderCount || 'N/A'}</code>

━━━━━━━━━━━━━━━━━━━━━
        `.trim();

        const keyboard = [];

        // Always show chart
        keyboard.push([
            { text: '📊 View Chart', url: `https://dexscreener.com/${chain}/${t.pairAddress}` }
        ]);

        // Only show buy buttons if NOT a honeypot and risk is acceptable
        if (!s.isHoneypot && s.riskLevel !== 'SCAM' && s.riskLevel !== 'EXTREME') {
            if (s.riskLevel === 'HIGH') {
                keyboard.push([
                    { text: `⚠️ Buy 0.05 ${nativeSymbol} (RISKY)`, callback_data: `quickbuy_${chain}_0.05_${tokenAddress}` }
                ]);
            } else {
                keyboard.push([
                    { text: `🟢 Buy 0.1 ${nativeSymbol}`, callback_data: `quickbuy_${chain}_0.1_${tokenAddress}` },
                    { text: `🟢 Buy 0.5 ${nativeSymbol}`, callback_data: `quickbuy_${chain}_0.5_${tokenAddress}` }
                ]);
                keyboard.push([
                    { text: `💰 Buy 1 ${nativeSymbol}`, callback_data: `quickbuy_${chain}_1_${tokenAddress}` }
                ]);
            }
        } else if (s.isHoneypot) {
            // Explicit warning - no buy buttons
            keyboard.push([
                { text: '🚨 HONEYPOT - CANNOT BUY', callback_data: 'menu' }
            ]);
        }

        keyboard.push([
            { text: '⭐ Add to Watchlist', callback_data: `watchlist_add_${tokenAddress}` }
        ]);
        keyboard.push([{ text: '◀️ Menu', callback_data: 'menu' }]);

        return sendMessage(message, keyboard);
    } catch (err) {
        logError('Token command error', err);
        return sendMessage('❌ Failed to analyze token. Please check the address and try again.');
    }
}

/**
 * Format large numbers for display
 */
function formatLargeNumber(num) {
    if (!num) return '0';
    if (num >= 1000000000) return (num / 1000000000).toFixed(2) + 'B';
    if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(2) + 'K';
    return num.toFixed(2);
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
            { text: '🤖 Auto-Trade Settings', callback_data: 'autotrade' }
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
 * Handle referral info with REAL stats
 */
export async function handleReferral(userId) {
    const telegramId = userId?.toString() || currentUserChatId?.toString();
    const user = await getUserByTelegramId(telegramId);
    const refCode = user?.referral_code || `RF${telegramId?.slice(-6) || 'XXXX'}`;

    // Fetch real referral stats from Supabase
    let referralCount = 0;
    let totalEarnings = 0;

    const supabase = getSupabase();
    if (supabase && user) {
        try {
            // Count referrals
            const { count } = await supabase
                .from('users')
                .select('*', { count: 'exact', head: true })
                .eq('referrer_id', user.id);
            referralCount = count || 0;

            // Get earnings
            const { data: earnings } = await supabase
                .from('referral_earnings')
                .select('commission_amount')
                .eq('user_id', user.id);
            totalEarnings = (earnings || []).reduce((sum, e) => sum + (parseFloat(e.commission_amount) || 0), 0);
        } catch (err) {
            logError('Failed to fetch referral stats', err);
        }
    }

    const botUsername = 'RedFaceTradingBot'; // Update this
    const refLink = `https://t.me/${botUsername}?start=ref_${refCode}`;

    const message = `
${BOT_NAME} <b>Referral Program</b>
━━━━━━━━━━━━━━━━━━━━━

💰 <b>Earn with Referrals!</b>

Your referral link:
<code>${refLink}</code>

📊 <b>Your Stats</b>
┌ Referrals: <code>${referralCount}</code>
├ Earnings: <code>$${totalEarnings.toFixed(2)}</code>
└ Rate: <code>30%</code> of fees

🎁 <b>Rewards</b>
┌ Earn <b>30%</b> of trading fees
└ Lifetime commissions!

━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    const keyboard = [
        [
            { text: '📋 Copy Link', callback_data: 'ref_copy' },
            { text: '📊 Earnings', callback_data: 'ref_stats' }
        ],
        [
            { text: '◀️ Back', callback_data: 'menu' }
        ]
    ];

    return sendMessage(message, keyboard);
}

/**
 * Handle leaderboard with REAL data
 */
export async function handleLeaderboard() {
    let topTraders = [];

    const supabase = getSupabase();
    if (supabase) {
        try {
            // Get top traders by PnL (last 7 days)
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
            const { data } = await supabase
                .from('trades')
                .select('user_id, pnl')
                .gte('created_at', sevenDaysAgo);

            if (data) {
                // Aggregate by user
                const userPnL = {};
                for (const trade of data) {
                    const uid = trade.user_id;
                    if (!userPnL[uid]) userPnL[uid] = 0;
                    userPnL[uid] += parseFloat(trade.pnl) || 0;
                }

                // Sort and get top 5
                topTraders = Object.entries(userPnL)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 5)
                    .map(([id, pnl], i) => ({ rank: i + 1, id: id.slice(-6), pnl }));
            }
        } catch (err) {
            logError('Failed to fetch leaderboard', err);
        }
    }

    const medals = ['🥇', '🥈', '🥉', '4.', '5.'];
    let leaderboardText = '';

    if (topTraders.length === 0) {
        leaderboardText = '<i>No trades yet - be the first!</i>';
    } else {
        leaderboardText = topTraders.map((t, i) => {
            const sign = t.pnl >= 0 ? '+' : '';
            return `${medals[i]} <code>Trader***${t.id}</code> — ${sign}$${t.pnl.toFixed(2)}`;
        }).join('\n');
    }

    const message = `
${BOT_NAME} <b>🏆 Leaderboard</b>
━━━━━━━━━━━━━━━━━━━━━

<b>Top Traders (7 Days)</b>

${leaderboardText}

━━━━━━━━━━━━━━━━━━━━━

<i>Trade more to climb the ranks!</i>

━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    const keyboard = [
        [
            { text: '🤖 Copy Traders', callback_data: 'copy' },
            { text: '📜 My History', callback_data: 'history' }
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
    const modeText = config.mode === 'LIVE' ? '🔴 LIVE' : '📝 PAPER';
    return [
        [
            { text: '📊 Status', callback_data: 'status' },
            { text: '💼 Positions', callback_data: 'positions' }
        ],
        [
            { text: '💰 Deposit', callback_data: 'deposit' },
            { text: '💼 Wallet', callback_data: 'wallet' }
        ],
        [
            { text: '🔍 Token', callback_data: 'token_prompt' },
            { text: '📈 PnL', callback_data: 'pnl' }
        ],
        [
            { text: '🛠️ Tools', callback_data: 'tools' },
            { text: '⛽ Gas', callback_data: 'gas' },
            { text: '🤖 Copy Trade', callback_data: 'copy_trade' }
        ],
        [
            { text: '👥 Referral', callback_data: 'referral' },
            { text: '⚙️ Settings', callback_data: 'settings' }
        ],
        [
            { text: `${modeText} Mode`, callback_data: 'toggle_mode' },
            { text: '🔄 Refresh', callback_data: 'refresh' }
        ]
    ];
}

/**
 * Handle copy trading menu with real data
 */
export async function handleCopyTrading(userId) {
    const { getFollowedTraders, getCopySettings, formatCopyTradeMessage } = await import('../services/copyTradingService.js');

    const following = getFollowedTraders(userId);
    const settings = getCopySettings(userId);
    const enabledText = settings.enabled ? '✅ ON' : '❌ OFF';

    const message = `
${BOT_NAME} <b>🤖 Copy Trading</b>
━━━━━━━━━━━━━━━━━━━━━

<b>Auto-Copy Top Traders!</b>

When you follow a trader, their trades
are automatically copied to your wallet.

📊 <b>Following:</b> ${following.length}/3 traders

⚙️ <b>Settings</b>
┌ Enabled: ${enabledText}
├ Copy Size: ${settings.amountPercent}%
└ Max/Trade: $${settings.maxPerTrade}

━━━━━━━━━━━━━━━━━━━━━

<i>Browse Leaderboard to find traders!</i>
    `.trim();

    const keyboard = [
        [
            { text: '🏆 Browse Traders', callback_data: 'leaderboard' }
        ],
        [
            { text: settings.enabled ? '🔴 Disable' : '🟢 Enable', callback_data: 'copy_toggle' },
            { text: '📊 My Following', callback_data: 'copy_following' }
        ],
        [
            { text: '◀️ Back', callback_data: 'menu' }
        ]
    ];

    return sendMessage(message, keyboard);
}

/**
 * Handle trade history - show past trades
 */
export async function handleTradeHistory(userId) {
    const supabase = getSupabase();
    let trades = [];

    if (supabase) {
        try {
            const user = await getUserByTelegramId(userId);
            if (user) {
                const { data } = await supabase
                    .from('trades')
                    .select('*')
                    .eq('user_id', user.id)
                    .order('created_at', { ascending: false })
                    .limit(10);
                trades = data || [];
            }
        } catch (err) {
            logError('Failed to fetch trade history', err);
        }
    }

    let tradesDisplay = '';
    if (trades.length === 0) {
        tradesDisplay = '<i>No trades yet</i>';
    } else {
        tradesDisplay = trades.map((t, i) => {
            const isProfit = (t.pnl || 0) >= 0;
            const emoji = isProfit ? '🟢' : '🔴';
            const sign = isProfit ? '+' : '';
            const date = new Date(t.created_at).toLocaleDateString();
            return `${i + 1}. ${emoji} ${t.token_name || 'Token'} ${sign}$${(t.pnl || 0).toFixed(2)} (${date})`;
        }).join('\n');
    }

    const message = `
${BOT_NAME} <b>📜 Trade History</b>
━━━━━━━━━━━━━━━━━━━━━

<b>Last 10 Trades:</b>
${tradesDisplay}

━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    const keyboard = [
        [{ text: '📊 PnL Summary', callback_data: 'pnl' }],
        [{ text: '◀️ Back', callback_data: 'menu' }]
    ];

    return sendMessage(message, keyboard);
}

// ==================== ONBOARDING SYSTEM ====================

/**
 * Onboarding Step 1 - Welcome & Overview
 */
export async function showOnboardingWelcome() {
    const message = `
${BOT_NAME} <b>Welcome! 🎉</b>
━━━━━━━━━━━━━━━━━━━━━

👋 <b>Welcome to RedFace Trading Bot!</b>

I'm your autonomous multi-chain trading assistant, designed to help you catch profitable opportunities on:

🔷 <b>BSC</b> (PancakeSwap)
🔵 <b>Base</b> (Aerodrome)
🟣 <b>Solana</b> (Raydium)

<b>What I can do:</b>
• 📊 Detect volume spike opportunities
• 💰 Execute trades (paper or live)
• 🔔 Send real-time alerts
• 📈 Track your portfolio & PnL

Let me give you a quick tour!

━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    const keyboard = [
        [{ text: "🚀 Let's Start!", callback_data: 'onboarding_next_2' }],
        [{ text: '⏭️ Skip Guide', callback_data: 'onboarding_skip' }]
    ];

    return sendMessage(message, keyboard);
}

/**
 * Onboarding Step 2 - Wallet Setup
 */
export async function showOnboardingWallet() {
    const message = `
${BOT_NAME} <b>Step 2: Wallet Setup 💼</b>
━━━━━━━━━━━━━━━━━━━━━

To trade, you'll need a wallet. I support:

🔷 <b>EVM Wallets</b> (BSC & Base)
• Create a new wallet
• Or import your existing one

🟣 <b>Solana Wallets</b>
• Create a new wallet
• Or import your existing one

<b>🔐 Security:</b>
Your private keys are encrypted and stored securely. Only you can access them.

<i>💡 Tip: Start with Paper Mode to practice without real funds!</i>

━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    const keyboard = [
        [
            { text: '🆕 Create EVM Wallet', callback_data: 'wallet_create_evm' },
            { text: '🆕 Create Solana', callback_data: 'wallet_create_sol' }
        ],
        [{ text: '➡️ Next Step', callback_data: 'onboarding_next_3' }],
        [{ text: '⏭️ Skip Guide', callback_data: 'onboarding_skip' }]
    ];

    return sendMessage(message, keyboard);
}

/**
 * Onboarding Step 3 - Trading Modes
 */
export async function showOnboardingTrading() {
    const message = `
${BOT_NAME} <b>Step 3: Trading Modes 📊</b>
━━━━━━━━━━━━━━━━━━━━━

<b>📝 PAPER Mode</b> (Default)
• Practice with virtual funds
• No real money at risk
• Perfect for learning!

<b>🔴 LIVE Mode</b>
• Trade with real funds
• Requires funded wallet
• Real profits (and losses)

<b>🎯 My Strategy: Volume Spike Scalping</b>
I detect tokens with sudden volume increases (3x+) and price momentum, then execute quick trades targeting ${config.takeProfit?.multiplier || 5}x profit.

<b>⚙️ Risk Settings:</b>
• Take Profit: ${config.takeProfit?.multiplier || 5}x
• Stop Loss: ${config.risk?.stopLossPercent || 5}%
• Max Hold: 30 minutes

━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    const keyboard = [
        [{ text: '➡️ Next Step', callback_data: 'onboarding_next_4' }],
        [{ text: '⏭️ Skip Guide', callback_data: 'onboarding_skip' }]
    ];

    return sendMessage(message, keyboard);
}

/**
 * Onboarding Step 4 - Key Features
 */
export async function showOnboardingFeatures() {
    const message = `
${BOT_NAME} <b>Step 4: Key Features 🛠️</b>
━━━━━━━━━━━━━━━━━━━━━

<b>📊 Positions</b>
Track all your open trades with live PnL

<b>🔍 Token Scanner</b>
Analyze any token: <code>/token 0x...</code>
Get safety scores, liquidity info, and more

<b>🔔 Price Alerts</b>
Set alerts for price targets

<b>⭐ Watchlist</b>
Save tokens to monitor

<b>📅 DCA Plans</b>
Auto-buy on daily/weekly schedules

<b>🤖 Copy Trading</b>
Automatically copy top traders

<b>👥 Referral Program</b>
Earn 30% of trading fees from referrals!

━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    const keyboard = [
        [{ text: '➡️ Finish Setup', callback_data: 'onboarding_next_5' }],
        [{ text: '⏭️ Skip Guide', callback_data: 'onboarding_skip' }]
    ];

    return sendMessage(message, keyboard);
}

/**
 * Onboarding Step 5 - Completion
 */
export async function showOnboardingComplete() {
    const telegramId = currentUserChatId?.toString();

    // Mark onboarding as complete
    if (telegramId) {
        await markOnboardingComplete(telegramId);
    }

    const message = `
${BOT_NAME} <b>You're All Set! 🎉</b>
━━━━━━━━━━━━━━━━━━━━━

✅ <b>Onboarding Complete!</b>

<b>📋 All Commands:</b>
/start - Main menu & status
/wallet - Manage wallets
/positions - View open trades
/pnl - Performance report
/settings - Bot settings
/token &lt;address&gt; - Analyze any token
/referral - Your referral link
/leaderboard - Top traders
/help - Full help guide

<b>💡 Pro Tips:</b>
• Start in Paper Mode to practice
• Use /token to check tokens before buying
• Set price alerts for key levels
• Enable DCA for consistent investing

<b>🚀 Ready to catch some gains?</b>

━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    const keyboard = [
        [{ text: '🚀 Start Trading!', callback_data: 'menu' }],
        [{ text: '💼 Setup Wallet', callback_data: 'wallet' }]
    ];

    return sendMessage(message, keyboard);
}

/**
 * Skip onboarding and go to main menu
 */
export async function skipOnboarding() {
    const telegramId = currentUserChatId?.toString();

    // Mark onboarding as complete
    if (telegramId) {
        await markOnboardingComplete(telegramId);
    }

    // Show main status menu
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
 * Handle onboarding step navigation
 */
export async function handleOnboarding(step) {
    switch (step) {
        case 1:
            return showOnboardingWelcome();
        case 2:
            return showOnboardingWallet();
        case 3:
            return showOnboardingTrading();
        case 4:
            return showOnboardingFeatures();
        case 5:
            return showOnboardingComplete();
        default:
            return showOnboardingWelcome();
    }
}

// ==================== ADMIN COMMANDS ====================

/**
 * Handle /admin command - Admin Dashboard
 */
export async function handleAdmin() {
    if (!isAdmin()) {
        return sendMessage('❌ <b>Access Denied</b>\n\nThis command is only available to admins.');
    }

    const supabase = (await import('../database/supabase.js')).getSupabase();

    let totalUsers = 0;
    let todayUsers = 0;
    let totalTrades = 0;

    if (supabase) {
        try {
            const { count: userCount } = await supabase.from('users').select('*', { count: 'exact', head: true });
            totalUsers = userCount || 0;

            const today = new Date().toISOString().split('T')[0];
            const { count: newCount } = await supabase
                .from('users')
                .select('*', { count: 'exact', head: true })
                .gte('created_at', today);
            todayUsers = newCount || 0;

            const { count: tradeCount } = await supabase.from('trades').select('*', { count: 'exact', head: true });
            totalTrades = tradeCount || 0;
        } catch (err) {
            logError('Admin stats error', err);
        }
    }

    const message = `
${BOT_NAME} <b>🔐 Admin Dashboard</b>
━━━━━━━━━━━━━━━━━━━━━

👥 <b>Users</b>
┌ Total: <code>${totalUsers}</code>
└ Today: <code>${todayUsers}</code>

📊 <b>Trading</b>
┌ Total Trades: <code>${totalTrades}</code>
├ Mode: <code>${config.mode}</code>
└ Uptime: <code>${formatUptime(process.uptime())}</code>

⚙️ <b>Bot Status</b>
┌ Version: <code>${BOT_VERSION}</code>
└ Status: 🟢 Running

━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    const keyboard = [
        [
            { text: '👥 Users', callback_data: 'admin_users' },
            { text: '📊 Stats', callback_data: 'admin_stats' }
        ],
        [
            { text: '📢 Broadcast', callback_data: 'admin_broadcast' },
            { text: '🔄 Refresh', callback_data: 'admin' }
        ],
        [{ text: '◀️ Back', callback_data: 'menu' }]
    ];

    return sendMessage(message, keyboard);
}

/**
 * Handle admin users list
 */
export async function handleAdminUsers() {
    if (!isAdmin()) {
        return sendMessage('❌ <b>Access Denied</b>\n\nThis command is only available to admins.');
    }

    const supabase = (await import('../database/supabase.js')).getSupabase();

    let usersList = '<i>No users yet</i>';
    let totalUsers = 0;

    if (supabase) {
        try {
            const { data: users, count } = await supabase
                .from('users')
                .select('telegram_id, username, created_at, settings', { count: 'exact' })
                .order('created_at', { ascending: false })
                .limit(10);

            totalUsers = count || 0;

            if (users && users.length > 0) {
                usersList = users.map((u, i) => {
                    const mode = u.settings?.mode || 'PAPER';
                    const modeIcon = mode === 'LIVE' ? '🔴' : '📝';
                    const date = new Date(u.created_at).toLocaleDateString();
                    return `${i + 1}. ${modeIcon} <code>${u.username || u.telegram_id}</code> - ${date}`;
                }).join('\n');
            }
        } catch (err) {
            logError('Admin users error', err);
        }
    }

    const message = `
${BOT_NAME} <b>👥 User List</b>
━━━━━━━━━━━━━━━━━━━━━

Total: <code>${totalUsers}</code> users

<b>Recent Users (Last 10):</b>
${usersList}

━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    const keyboard = [
        [{ text: '◀️ Back', callback_data: 'admin' }]
    ];

    return sendMessage(message, keyboard);
}

/**
 * Handle admin stats
 */
export async function handleAdminStats() {
    if (!isAdmin()) {
        return sendMessage('❌ <b>Access Denied</b>\n\nThis command is only available to admins.');
    }

    const supabase = (await import('../database/supabase.js')).getSupabase();

    let stats = {
        totalTrades: 0,
        buyCount: 0,
        sellCount: 0,
        totalVolume: 0,
        totalPnl: 0,
        dcaPlans: 0,
        alerts: 0
    };

    if (supabase) {
        try {
            const { count: tradeCount } = await supabase.from('trades').select('*', { count: 'exact', head: true });
            stats.totalTrades = tradeCount || 0;

            const { count: buyCount } = await supabase.from('trades').select('*', { count: 'exact', head: true }).eq('action', 'BUY');
            stats.buyCount = buyCount || 0;

            const { count: sellCount } = await supabase.from('trades').select('*', { count: 'exact', head: true }).eq('action', 'SELL');
            stats.sellCount = sellCount || 0;

            const { data: volumeData } = await supabase.from('trades').select('amount_usd');
            if (volumeData) {
                stats.totalVolume = volumeData.reduce((sum, t) => sum + (parseFloat(t.amount_usd) || 0), 0);
            }

            const { data: pnlData } = await supabase.from('trades').select('pnl');
            if (pnlData) {
                stats.totalPnl = pnlData.reduce((sum, t) => sum + (parseFloat(t.pnl) || 0), 0);
            }

            const { count: dcaCount } = await supabase.from('dca_plans').select('*', { count: 'exact', head: true });
            stats.dcaPlans = dcaCount || 0;

            const { count: alertCount } = await supabase.from('price_alerts').select('*', { count: 'exact', head: true });
            stats.alerts = alertCount || 0;
        } catch (err) {
            logError('Admin stats error', err);
        }
    }

    const pnlEmoji = stats.totalPnl >= 0 ? '🟢' : '🔴';

    const message = `
${BOT_NAME} <b>📊 Trading Statistics</b>
━━━━━━━━━━━━━━━━━━━━━

📈 <b>Trades</b>
┌ Total: <code>${stats.totalTrades}</code>
├ Buys: <code>${stats.buyCount}</code>
└ Sells: <code>${stats.sellCount}</code>

💰 <b>Volume & PnL</b>
┌ Volume: <code>$${stats.totalVolume.toFixed(2)}</code>
└ ${pnlEmoji} PnL: <code>${stats.totalPnl >= 0 ? '+' : ''}$${stats.totalPnl.toFixed(2)}</code>

⚙️ <b>Features</b>
┌ DCA Plans: <code>${stats.dcaPlans}</code>
└ Alerts: <code>${stats.alerts}</code>

━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    const keyboard = [
        [{ text: '🔄 Refresh', callback_data: 'admin_stats' }],
        [{ text: '◀️ Back', callback_data: 'admin' }]
    ];

    return sendMessage(message, keyboard);
}

/**
 * Handle broadcast message prompt
 */
export async function handleBroadcastPrompt() {
    if (!isAdmin()) {
        return sendMessage('❌ <b>Access Denied</b>\n\nThis command is only available to admins.');
    }

    const message = `
${BOT_NAME} <b>📢 Broadcast Message</b>
━━━━━━━━━━━━━━━━━━━━━

To send a message to all users, use:

<code>/broadcast Your message here</code>

Example:
<code>/broadcast 🚀 New feature available! Check /help for details.</code>

━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    return sendMessage(message, [[{ text: '◀️ Back', callback_data: 'admin' }]]);
}

/**
 * Handle broadcast - Send message to all users
 */
export async function handleBroadcast(messageText) {
    if (!isAdmin()) {
        return sendMessage('❌ <b>Access Denied</b>\n\nThis command is only available to admins.');
    }

    if (!messageText || messageText.trim().length === 0) {
        return handleBroadcastPrompt();
    }

    const supabase = (await import('../database/supabase.js')).getSupabase();

    if (!supabase) {
        return sendMessage('❌ Database not configured');
    }

    await sendMessage('📢 Broadcasting message...');

    try {
        const { data: users } = await supabase.from('users').select('telegram_id');

        if (!users || users.length === 0) {
            return sendMessage('❌ No users to broadcast to');
        }

        const broadcastMessage = `
${BOT_NAME} <b>📢 Announcement</b>
━━━━━━━━━━━━━━━━━━━━━

${messageText}

━━━━━━━━━━━━━━━━━━━━━
        `.trim();

        let sent = 0;
        let failed = 0;

        for (const user of users) {
            try {
                await sendMessage(broadcastMessage, null, 'HTML', user.telegram_id);
                sent++;
            } catch (err) {
                failed++;
            }
            // Small delay to avoid rate limiting
            await new Promise(r => setTimeout(r, 100));
        }

        return sendMessage(`✅ <b>Broadcast Complete</b>\n\n📤 Sent: ${sent}\n❌ Failed: ${failed}`);
    } catch (err) {
        logError('Broadcast error', err);
        return sendMessage('❌ Broadcast failed');
    }
}

// ==================== AUTO-TRADE SYSTEM ====================

/**
 * Handle auto-trade settings menu
 */
export async function handleAutoTradeSettings() {
    const telegramId = currentUserChatId?.toString();
    if (!telegramId) {
        return sendMessage('❌ User not identified. Please /start first.');
    }

    const settings = await getAutoTradeSettings(telegramId);
    const statusEmoji = settings.enabled ? '🟢' : '🔴';
    const statusText = settings.enabled ? 'ENABLED' : 'DISABLED';

    const message = `
${BOT_NAME} <b>🤖 Auto-Trade Settings</b>
━━━━━━━━━━━━━━━━━━━━━

${statusEmoji} <b>Auto-Trade:</b> ${statusText}

When enabled, the bot will automatically execute trades when signals are detected.

<b>Current Settings:</b>
┌ Trade Amount: <code>${settings.amount}</code> (per trade)
├ Mode: <code>${settings.mode}</code>
└ Profit Alerts: <code>${settings.thresholds.join('%, ')}%</code>

⚠️ <b>WARNING:</b>
Auto-trading uses REAL funds in LIVE mode!
Start with small amounts to test.

━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    const toggleText = settings.enabled ? '🔴 Disable Auto-Trade' : '🟢 Enable Auto-Trade';

    const keyboard = [
        [{ text: toggleText, callback_data: 'autotrade_toggle' }],
        [
            { text: '💰 Set Amount: 0.05', callback_data: 'autotrade_amount_0.05' },
            { text: '💰 Set Amount: 0.1', callback_data: 'autotrade_amount_0.1' }
        ],
        [
            { text: '💰 Set Amount: 0.25', callback_data: 'autotrade_amount_0.25' },
            { text: '💰 Set Amount: 0.5', callback_data: 'autotrade_amount_0.5' }
        ],
        [{ text: '◀️ Back', callback_data: 'settings' }]
    ];

    return sendMessage(message, keyboard);
}

/**
 * Toggle auto-trade and show confirmation
 */
export async function handleAutoTradeToggle() {
    const telegramId = currentUserChatId?.toString();
    if (!telegramId) return;

    const updated = await toggleAutoTrade(telegramId);
    const settings = await getAutoTradeSettings(telegramId);

    const statusText = settings.enabled ? '🟢 ENABLED' : '🔴 DISABLED';
    await sendMessage(`Auto-Trade is now ${statusText}`);

    return handleAutoTradeSettings();
}

/**
 * Set auto-trade amount
 */
export async function handleSetAutoTradeAmount(amount) {
    const telegramId = currentUserChatId?.toString();
    if (!telegramId) return;

    await updateAutoTradeSettings(telegramId, { amount: parseFloat(amount) });
    await sendMessage(`✅ Auto-trade amount set to <code>${amount}</code>`);

    return handleAutoTradeSettings();
}

/**
 * Notify user of a detected signal with Trade/Skip buttons
 */
export async function notifySignalToUser(signal, userId) {
    const settings = await getAutoTradeSettings(userId);
    const nativeSymbol = signal.chain === 'bsc' ? 'BNB' : signal.chain === 'base' ? 'ETH' : 'SOL';

    // Create signal ID for callback
    const signalId = Buffer.from(JSON.stringify({
        token: signal.token,
        chain: signal.chain,
        pair: signal.pairAddress,
        price: signal.entryPrice
    })).toString('base64').slice(0, 60);

    const message = `
${BOT_NAME} <b>🚨 New Signal!</b>
━━━━━━━━━━━━━━━━━━━━━

🪙 <b>${signal.token}</b> on ${signal.chain.toUpperCase()}

💰 Entry: <code>$${signal.entryPrice.toFixed(8)}</code>
📊 Volume: <code>${signal.volumeRatio}x spike</code>
📈 Change: <code>+${signal.priceChange5m}%</code>
💪 Strength: <code>${signal.strength}/100</code>

🎯 Take Profit: <code>$${signal.takeProfit.toFixed(8)}</code>
🛑 Stop Loss: <code>$${signal.stopLoss.toFixed(8)}</code>

${settings.enabled ? '🤖 <b>Auto-Trade:</b> Will execute automatically!' : '👆 <b>Tap below to trade or skip</b>'}

━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    const keyboard = [];

    if (!settings.enabled) {
        // Manual mode - show trade buttons
        keyboard.push([
            { text: `🟢 Trade ${settings.amount} ${nativeSymbol}`, callback_data: `signal_trade_${signalId}` },
            { text: '⏭️ Skip', callback_data: 'signal_skip' }
        ]);
        keyboard.push([
            { text: `💰 Trade 0.5 ${nativeSymbol}`, callback_data: `quickbuy_${signal.chain}_0.5_${signal.tokenAddress}` }
        ]);
    } else {
        // Auto mode - show what's happening
        keyboard.push([
            { text: '🤖 Auto-Trading...', callback_data: 'menu' }
        ]);
    }

    keyboard.push([{ text: '📊 View Chart', url: `https://dexscreener.com/${signal.chain}/${signal.pairAddress}` }]);

    return sendMessage(message, keyboard, 'HTML', userId);
}

/**
 * Notify user of profit threshold reached with sell suggestion
 */
export async function notifyProfitAlert(position, currentProfit, userId) {
    const profitEmoji = currentProfit >= 100 ? '🚀' : currentProfit >= 50 ? '🔥' : '📈';

    const message = `
${BOT_NAME} <b>${profitEmoji} Profit Alert!</b>
━━━━━━━━━━━━━━━━━━━━━

🪙 <b>${position.token}</b> is up <code>+${currentProfit.toFixed(1)}%</code>!

💰 Entry: <code>$${position.entryPrice.toFixed(8)}</code>
📈 Current: <code>$${position.currentPrice.toFixed(8)}</code>

<b>💡 Suggestion:</b> 
Consider taking ${currentProfit >= 50 ? 'full' : 'partial'} profits!

━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    const keyboard = [
        [
            { text: '💵 Sell 25%', callback_data: `sell_${position.id}_25` },
            { text: '💰 Sell 50%', callback_data: `sell_${position.id}_50` }
        ],
        [
            { text: '🤑 Sell 100%', callback_data: `sell_${position.id}_100` },
            { text: '⏳ Hold', callback_data: 'menu' }
        ]
    ];

    return sendMessage(message, keyboard, 'HTML', userId);
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
    handleStartWithReferral,
    handlePositions,
    handlePnL,
    handleHelp,
    handleWallet,
    handleDeposit,
    handleCreateEvmWallet,
    handleToggleMode,
    handleBuy,
    executeConfirmedBuy,
    handleToken,
    handleSell,
    handleSettings,
    handleReferral,
    handleLeaderboard,
    handleCopyTrading,
    handleAlerts,
    handleWatchlist,
    handlePortfolio,
    handleDCA,
    handleGas,
    handleTools,
    // Onboarding functions
    showOnboardingWelcome,
    showOnboardingWallet,
    showOnboardingTrading,
    showOnboardingFeatures,
    showOnboardingComplete,
    skipOnboarding,
    handleOnboarding,
    // Admin functions
    isAdmin,
    handleAdmin,
    handleAdminUsers,
    handleAdminStats,
    handleBroadcastPrompt,
    handleBroadcast,
    // Auto-trade functions
    handleAutoTradeSettings,
    handleAutoTradeToggle,
    handleSetAutoTradeAmount,
    notifySignalToUser,
    notifyProfitAlert,
    // Withdraw functions
    handleWithdraw,
    handleWithdrawPrompt,
    // Trade history
    handleTradeHistory
};

/**
 * Handle price alerts menu
 */
export async function handleAlerts(userId) {
    const { getUserAlerts } = await import('../services/userTools.js');
    const alerts = getUserAlerts(userId);

    let alertsList = '';
    if (alerts.length === 0) {
        alertsList = '<i>No active alerts</i>';
    } else {
        alertsList = alerts.map((a, i) =>
            `${i + 1}. ${a.tokenName} ${a.condition === 'above' ? '📈' : '📉'} $${a.targetPrice} ${a.active ? '🟢' : '⚪'}`
        ).join('\n');
    }

    const message = `
${BOT_NAME} <b>🔔 Price Alerts</b>
━━━━━━━━━━━━━━━━━━━━━

📋 <b>Your Alerts (${alerts.length})</b>
${alertsList}

━━━━━━━━━━━━━━━━━━━━━

<i>To add: /alert TOKEN ABOVE/BELOW PRICE</i>
Example: <code>/alert BTC above 50000</code>
    `.trim();

    const keyboard = [
        [
            { text: '➕ Add Alert', callback_data: 'alert_add' },
            { text: '🗑️ Clear All', callback_data: 'alert_clear' }
        ],
        [{ text: '◀️ Back', callback_data: 'tools' }]
    ];

    return sendMessage(message, keyboard);
}

/**
 * Handle watchlist menu
 */
export async function handleWatchlist(userId) {
    const { getWatchlist } = await import('../services/userTools.js');
    const watchlist = getWatchlist(userId);

    let tokensList = '';
    if (watchlist.length === 0) {
        tokensList = '<i>Watchlist empty</i>\n\nUse /token to scan and add tokens!';
    } else {
        tokensList = watchlist.map((t, i) =>
            `${i + 1}. <b>${t.symbol}</b> (${t.chain.toUpperCase()})`
        ).join('\n');
    }

    const message = `
${BOT_NAME} <b>⭐ Watchlist</b>
━━━━━━━━━━━━━━━━━━━━━

📋 <b>Saved Tokens (${watchlist.length}/20)</b>
${tokensList}

━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    const keyboard = [
        [
            { text: '🔍 Scan Token', callback_data: 'token_prompt' },
            { text: '🗑️ Clear All', callback_data: 'watchlist_clear' }
        ],
        [{ text: '◀️ Back', callback_data: 'tools' }]
    ];

    return sendMessage(message, keyboard);
}

/**
 * Handle portfolio view
 */
export async function handlePortfolio(userId) {
    const { getPortfolio } = await import('../services/userTools.js');
    const portfolio = getPortfolio(userId);

    let totalValue = 0;
    let holdingsList = '';

    if (portfolio.length === 0) {
        holdingsList = '<i>No holdings tracked</i>';
    } else {
        holdingsList = portfolio.map((h, i) => {
            const value = h.amount * h.avgPrice;
            totalValue += value;
            return `${i + 1}. <b>${h.symbol}</b>: ${h.amount.toFixed(4)} (~$${value.toFixed(2)})`;
        }).join('\n');
    }

    const message = `
${BOT_NAME} <b>📊 Portfolio</b>
━━━━━━━━━━━━━━━━━━━━━

💰 <b>Total Value:</b> <code>$${totalValue.toFixed(2)}</code>

📋 <b>Holdings</b>
${holdingsList}

━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    const keyboard = [
        [
            { text: '🔄 Refresh Prices', callback_data: 'portfolio_refresh' },
            { text: '📥 Export CSV', callback_data: 'portfolio_export' }
        ],
        [{ text: '◀️ Back', callback_data: 'tools' }]
    ];

    return sendMessage(message, keyboard);
}

/**
 * Handle DCA (Dollar Cost Averaging) menu
 */
export async function handleDCA(userId) {
    const { getDCAPlans } = await import('../services/userTools.js');
    const plans = getDCAPlans(userId);

    let plansList = '';
    if (plans.length === 0) {
        plansList = '<i>No DCA plans active</i>';
    } else {
        plansList = plans.map((p, i) =>
            `${i + 1}. ${p.tokenName} - $${p.amountUsd}/${p.interval} ${p.active ? '🟢' : '⏸️'}`
        ).join('\n');
    }

    const message = `
${BOT_NAME} <b>📅 DCA (Auto-Buy)</b>
━━━━━━━━━━━━━━━━━━━━━

<b>Dollar Cost Averaging</b>
Automatically buy tokens at regular intervals!

📋 <b>Your Plans</b>
${plansList}

━━━━━━━━━━━━━━━━━━━━━

<i>Example: Buy $10 of SOL daily</i>
    `.trim();

    const keyboard = [
        [
            { text: '➕ New DCA Plan', callback_data: 'dca_new' },
            { text: '⏸️ Pause All', callback_data: 'dca_pause' }
        ],
        [{ text: '◀️ Back', callback_data: 'tools' }]
    ];

    return sendMessage(message, keyboard);
}



/**
 * Handle tools menu (central hub for all user tools)
 */
export async function handleTools(userId) {
    const message = `
${BOT_NAME} <b>🛠️ Tools</b>
━━━━━━━━━━━━━━━━━━━━━

Quick access to all trading tools:

🔔 <b>Price Alerts</b> - Get notified at target prices
⭐ <b>Watchlist</b> - Track favorite tokens
📊 <b>Portfolio</b> - View all holdings
📅 <b>DCA</b> - Auto-buy on schedule
⛽ <b>Gas</b> - Check gas prices
📤 <b>Export</b> - Download trade history

━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    const keyboard = [
        [
            { text: '🔔 Alerts', callback_data: 'alerts' },
            { text: '⭐ Watchlist', callback_data: 'watchlist' }
        ],
        [
            { text: '📊 Portfolio', callback_data: 'portfolio' },
            { text: '📅 DCA', callback_data: 'dca' }
        ],
        [
            { text: '⛽ Gas', callback_data: 'gas' },
            { text: '📤 Export', callback_data: 'export_trades' }
        ],
        [{ text: '◀️ Back', callback_data: 'menu' }]
    ];

    return sendMessage(message, keyboard);
}
