/**
 * RedFace Trading Bot - Telegram Bot Handler
 * 
 * Listens for commands and responds with Maestro-style UI
 */

import { logInfo, logError } from '../logging/logger.js';
import {
    isTelegramEnabled,
    handleStart,
    handlePositions,
    handlePnL,
    handleHelp
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
 * Handle incoming update
 */
async function handleUpdate(update) {
    // Handle message
    if (update.message) {
        const message = update.message;
        const chatId = message.chat.id.toString();

        // Only respond to authorized chat
        if (chatId !== CHAT_ID) {
            logInfo(`Unauthorized message from chat ${chatId}`);
            return;
        }

        const text = message.text || '';

        // Handle commands
        if (text.startsWith('/')) {
            await handleCommand(text.toLowerCase());
        }
    }

    // Handle callback queries (button clicks)
    if (update.callback_query) {
        const query = update.callback_query;
        const chatId = query.message?.chat.id.toString();

        if (chatId !== CHAT_ID) return;

        await handleCallback(query);
    }
}

/**
 * Handle text commands
 */
async function handleCommand(command) {
    logInfo(`Telegram command: ${command}`);

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
        case '/help':
            await handleHelp();
            break;
        default:
            await handleHelp();
    }
}

/**
 * Handle callback queries (inline button clicks)
 */
async function handleCallback(query) {
    const action = query.data;
    logInfo(`Telegram callback: ${action}`);

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
            await handleHelp(); // For now, show help for settings
            break;
        case 'signals':
            await handleStart(); // Show status with signals
            break;
        default:
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
