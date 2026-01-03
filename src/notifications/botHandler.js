/**
 * RedFace Trading Bot - Telegram Bot Handler
 * 
 * Listens for commands and responds with Maestro-style UI
 * Multi-user: Accepts all users
 */

import { logInfo, logError } from '../logging/logger.js';
import {
    isTelegramEnabled,
    handleStart,
    handlePositions,
    handlePnL,
    handleHelp,
    handleWallet,
    handleDeposit,
    handleCreateEvmWallet,
    handleCreateSolanaWallet,
    handleToggleMode,
    handleBuy,
    executeConfirmedBuy,
    setCurrentUser,
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
    handleOnboarding,
    skipOnboarding,
    // Admin functions
    handleAdmin,
    handleAdminUsers,
    handleAdminStats,
    handleBroadcastPrompt,
    handleBroadcast
} from './telegram.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

let lastUpdateId = 0;
let isPolling = false;

/**
 * Start polling for Telegram updates
 */
export async function startTelegramBot() {
    if (!isTelegramEnabled()) {
        logInfo('Telegram not configured, skipping bot startup');
        return;
    }

    logInfo('🤖 Starting RedFace Telegram Bot...');
    isPolling = true;

    // Send startup message
    await handleStart();

    // Start polling loop
    pollUpdates();
}

/**
 * Stop polling
 */
export function stopTelegramBot() {
    isPolling = false;
    logInfo('Telegram bot stopped');
}

/**
 * Poll for updates
 */
async function pollUpdates() {
    while (isPolling) {
        try {
            const updates = await getUpdates();

            for (const update of updates) {
                await handleUpdate(update);
                lastUpdateId = update.update_id + 1;
            }
        } catch (err) {
            logError('Telegram polling error', err);
        }

        // Wait before next poll
        await sleep(2000);
    }
}

/**
 * Get updates from Telegram
 */
async function getUpdates() {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${lastUpdateId}&timeout=10`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.ok) {
            return data.result || [];
        }
        return [];
    } catch (err) {
        return [];
    }
}

/**
 * Handle incoming update (multi-user: accepts all users)
 */
async function handleUpdate(update) {
    // Handle message
    if (update.message) {
        const message = update.message;
        const chatId = message.chat.id.toString();
        const username = message.from?.username || message.from?.first_name || 'Unknown';

        const text = message.text || '';

        // Handle commands
        if (text.startsWith('/')) {
            logInfo(`Command from ${username} (${chatId}): ${text}`);
            await handleCommand(text.toLowerCase(), chatId, username);
        }
    }

    // Handle callback queries (button clicks)
    if (update.callback_query) {
        const query = update.callback_query;
        const chatId = query.message?.chat.id.toString();
        const username = query.from?.username || query.from?.first_name || 'Unknown';

        logInfo(`Callback from ${username} (${chatId}): ${query.data}`);
        await handleCallback(query, chatId, username);
    }
}

/**
 * Handle text commands (multi-user)
 */
async function handleCommand(command, chatId, username) {
    // Set current user for response routing
    setCurrentUser(chatId);

    // Handle /token <address> command
    if (command.startsWith('/token ')) {
        const address = command.replace('/token ', '').trim();
        await handleToken(address);
        return;
    }

    switch (command) {
        case '/start':
        case '/menu':
            await handleStart();
            break;
        case '/status':
            await handleStart();
            break;
        case '/positions':
            await handlePositions();
            break;
        case '/pnl':
            await handlePnL();
            break;
        case '/wallet':
            await handleWallet();
            break;
        case '/settings':
            await handleSettings();
            break;
        case '/referral':
            await handleReferral(chatId);
            break;
        case '/leaderboard':
            await handleLeaderboard();
            break;
        case '/token':
            await handleToken(''); // Show usage
            break;
        case '/help':
            await handleHelp();
            break;
        // Admin commands
        case '/admin':
            await handleAdmin();
            break;
        case '/users':
            await handleAdminUsers();
            break;
        default:
            // Check for /broadcast <message>
            if (command.startsWith('/broadcast ')) {
                const msg = command.replace('/broadcast ', '').trim();
                await handleBroadcast(msg);
                return;
            }
            await handleHelp();
    }
}

/**
 * Handle callback queries (inline button clicks) - multi-user
 */
async function handleCallback(query, chatId, username) {
    const action = query.data;

    // Set current user for response routing
    setCurrentUser(chatId);

    // Answer callback to remove loading state
    await answerCallback(query.id);

    switch (action) {
        case 'menu':
        case 'status':
        case 'refresh':
            await handleStart();
            break;
        case 'positions':
        case 'positions_all':
            await handlePositions();
            break;
        case 'pnl':
            await handlePnL();
            break;
        case 'help':
            await handleHelp();
            break;
        case 'settings':
            await handleSettings();
            break;
        case 'signals':
            await handleStart();
            break;
        // Deposit callback
        case 'deposit':
            await handleDeposit();
            break;
        // New feature callbacks
        case 'token_prompt':
            await handleToken('');
            break;
        case 'referral':
            await handleReferral(chatId);
            break;
        case 'leaderboard':
        case 'lb_daily':
        case 'lb_weekly':
        case 'lb_all':
            await handleLeaderboard();
            break;
        // Copy trading callbacks
        case 'copy_trade':
        case 'copy_settings':
        case 'copy_following':
            await handleCopyTrading(chatId);
            break;
        // Tools callbacks
        case 'tools':
            await handleTools(chatId);
            break;
        case 'alerts':
        case 'alert_add':
        case 'alert_clear':
            await handleAlerts(chatId);
            break;
        case 'watchlist':
        case 'watchlist_clear':
            await handleWatchlist(chatId);
            break;
        case 'portfolio':
        case 'portfolio_refresh':
        case 'portfolio_export':
            await handlePortfolio(chatId);
            break;
        case 'dca':
        case 'dca_new':
        case 'dca_pause':
            await handleDCA(chatId);
            break;
        case 'gas':
        case 'gas_refresh':
            await handleGas();
            break;
        // Wallet callbacks
        case 'wallet':
        case 'wallet_balance':
            await handleWallet();
            break;
        case 'wallet_create_evm':
            await handleCreateEvmWallet();
            break;
        case 'wallet_create_sol':
            await handleCreateSolanaWallet();
            break;
        case 'wallet_toggle_mode':
            await handleToggleMode();
            break;
        case 'wallet_import':
            // Show import instructions
            await handleWallet();
            break;
        // Admin callbacks
        case 'admin':
            await handleAdmin();
            break;
        case 'admin_users':
            await handleAdminUsers();
            break;
        case 'admin_stats':
            await handleAdminStats();
            break;
        case 'admin_broadcast':
            await handleBroadcastPrompt();
            break;
        // Onboarding callbacks
        case 'onboarding_skip':
            await skipOnboarding();
            break;
        default:
            // Check for onboarding navigation callbacks (onboarding_next_2, etc.)
            if (action.startsWith('onboarding_next_')) {
                const step = parseInt(action.replace('onboarding_next_', ''));
                if (!isNaN(step) && step >= 1 && step <= 5) {
                    await handleOnboarding(step);
                    return;
                }
            }

            // Check for buy callbacks
            if (action.startsWith('buy_') && !action.startsWith('buy_custom')) {
                // Parse buy callback: buy_chain_amount_signalId
                const parts = action.split('_');
                if (parts.length >= 4) {
                    const chain = parts[1];
                    const amount = parts[2];
                    const signalId = parts.slice(3).join('_');
                    await handleBuy(chain, amount, signalId);
                    return;
                }
            }

            // Check for confirm buy
            if (action.startsWith('confirm_buy_')) {
                // Parse confirm buy: confirm_buy_chain_amount_signalId
                const parts = action.replace('confirm_buy_', '').split('_');
                if (parts.length >= 3) {
                    const chain = parts[0];
                    const amount = parts[1];
                    const signalId = parts.slice(2).join('_');
                    await executeConfirmedBuy(chain, amount, signalId);
                    return;
                }
            }

            // Check for sell callbacks (sell_positionIndex_percentage)
            if (action.startsWith('sell_')) {
                const parts = action.split('_');
                if (parts.length >= 3) {
                    const positionIndex = parts[1];
                    const percentage = parts[2];
                    await handleSell(positionIndex, percentage);
                    return;
                }
            }

            // Check for quickbuy from token scanner
            if (action.startsWith('quickbuy_')) {
                const parts = action.split('_');
                if (parts.length >= 4) {
                    const chain = parts[1];
                    const amount = parts[2];
                    const tokenAddress = parts[3];
                    // Use token address as signal data
                    const signalData = Buffer.from(JSON.stringify({
                        token: 'Token',
                        chain,
                        pair: tokenAddress,
                        price: 0
                    })).toString('base64');
                    await handleBuy(chain, amount, signalData);
                    return;
                }
            }

            await handleStart();
    }
}

/**
 * Answer callback query
 */
async function answerCallback(callbackId) {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`;

    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callback_query_id: callbackId })
        });
    } catch (err) {
        // Ignore errors
    }
}

/**
 * Sleep helper
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export default {
    startTelegramBot,
    stopTelegramBot
};
