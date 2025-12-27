/**
 * DEX Trading Bot - Main Entry Point
 * 
 * Autonomous multi-chain trading bot
 * Chains: BSC, Base, Solana
 * Strategy: Volume Spike Scalping
 * 
 * Usage:
 *   npm start         - Start in PAPER mode (default)
 *   npm run readonly  - Read-only mode (signals only)
 */

import config from './config/index.js';
import { displayBanner, promptProfitMultiplier, confirmStart, displayKillSwitch } from './utils/prompt.js';
import { start, stop, getStatus } from './automation/scheduler.js';
import { logInfo, logError } from './logging/logger.js';

// Update config with profit multiplier
let userConfig = { ...config };

/**
 * Main function
 */
async function main() {
    // Check if running in CI/cloud mode (non-interactive)
    const isNonInteractive = process.env.CI || process.env.FLY_APP_NAME || !process.stdin.isTTY;

    // Display welcome banner
    displayBanner();

    // Check if profit multiplier is set
    if (!config.takeProfit.multiplier) {
        if (isNonInteractive) {
            // Default to 5x in non-interactive mode
            config.takeProfit.multiplier = 5;
            console.log('  ✅ Using default profit multiplier: 5x (non-interactive mode)');
        } else {
            const multiplier = await promptProfitMultiplier();
            config.takeProfit.multiplier = multiplier;
        }
    } else {
        console.log(`  ✅ Using profit multiplier from env: ${config.takeProfit.multiplier}x`);
    }

    // Skip confirmation in non-interactive mode
    if (!isNonInteractive) {
        const confirmed = await confirmStart(config);
        if (!confirmed) {
            console.log('  👋 Bot cancelled by user');
            process.exit(0);
        }
    } else {
        console.log('  ✅ Auto-starting in non-interactive mode...');
    }

    // Display kill switch info
    displayKillSwitch();

    // Start the bot
    try {
        await start();

        // Display initial status
        setTimeout(() => {
            const status = getStatus();
            logInfo(`Status: ${status.openPositions} positions, ${status.watchlistSize} tokens watched`);
        }, 5000);

    } catch (err) {
        logError('Failed to start bot', err);
        process.exit(1);
    }
}

/**
 * Handle graceful shutdown
 */
function handleShutdown(signal) {
    console.log('');
    logInfo(`Received ${signal}, shutting down gracefully...`);

    stop();

    // Wait a bit for cleanup
    setTimeout(() => {
        console.log('  👋 Goodbye!');
        process.exit(0);
    }, 1000);
}

// Register shutdown handlers
process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

// Handle uncaught errors
process.on('uncaughtException', (err) => {
    logError('Uncaught exception', err);
    stop();
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    logError('Unhandled rejection', reason);
});

// Run!
main().catch(err => {
    logError('Fatal error', err);
    process.exit(1);
});
