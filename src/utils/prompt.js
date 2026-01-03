/**
 * DEX Trading Bot - User Prompt Module
 * 
 * Handles interactive prompts for user configuration
 * Prompts for profit multiplier at startup
 */

import { createInterface } from 'readline';
import { logInfo } from '../logging/logger.js';

/**
 * Create readline interface for user input
 */
function createPrompt() {
    return createInterface({
        input: process.stdin,
        output: process.stdout
    });
}

/**
 * Ask user a question and return answer
 */
function ask(rl, question) {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(answer.trim());
        });
    });
}

/**
 * Display welcome banner
 */
export function displayBanner() {
    console.log('');
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║                                                        ║');
    console.log('║       🤖 DEX TRADING BOT - DEGEN EDITION 🤖            ║');
    console.log('║                                                        ║');
    console.log('║       Multi-Chain | Volume Spike Strategy              ║');
    console.log('║       BSC • Base • Solana                              ║');
    console.log('║                                                        ║');
    console.log('╚════════════════════════════════════════════════════════╝');
    console.log('');
}

/**
 * Prompt user for profit multiplier
 * @returns {Promise<number>} Selected multiplier
 */
export async function promptProfitMultiplier() {
    // Skip prompt in non-interactive (headless/Docker) mode
    if (!process.stdin.isTTY) {
        const defaultMultiplier = 5;
        console.log(`[Non-interactive mode] Using default profit multiplier: ${defaultMultiplier}x`);
        return defaultMultiplier;
    }

    const rl = createPrompt();

    console.log('');
    console.log('┌────────────────────────────────────────────────────────┐');
    console.log('│  🎯 SET YOUR PROFIT TARGET MULTIPLIER                  │');
    console.log('├────────────────────────────────────────────────────────┤');
    console.log('│                                                        │');
    console.log('│   [1]  2x   (100% profit)   - Conservative             │');
    console.log('│   [2]  5x   (400% profit)   - Moderate                 │');
    console.log('│   [3]  10x  (900% profit)   - Aggressive               │');
    console.log('│   [4]  15x  (1400% profit)  - Full Degen               │');
    console.log('│   [5]  Custom multiplier                               │');
    console.log('│                                                        │');
    console.log('└────────────────────────────────────────────────────────┘');
    console.log('');

    const choice = await ask(rl, '  Enter your choice [1-5]: ');

    let multiplier;

    switch (choice) {
        case '1':
            multiplier = 2;
            break;
        case '2':
            multiplier = 5;
            break;
        case '3':
            multiplier = 10;
            break;
        case '4':
            multiplier = 15;
            break;
        case '5':
            const custom = await ask(rl, '  Enter custom multiplier (e.g., 3.5): ');
            multiplier = parseFloat(custom);

            if (isNaN(multiplier) || multiplier < 1.1) {
                console.log('  ⚠️  Invalid value, using default 2x');
                multiplier = 2;
            }
            break;
        default:
            console.log('  ⚠️  Invalid choice, using default 2x');
            multiplier = 2;
    }

    rl.close();

    console.log('');
    console.log(`  ✅ Take Profit set to ${multiplier}x (${((multiplier - 1) * 100).toFixed(0)}% profit)`);
    console.log('');

    logInfo(`Profit multiplier set to ${multiplier}x`);

    return multiplier;
}

/**
 * Prompt user for token watchlist
 * @returns {Promise<Array<{chainId: string, pairAddress: string}>>}
 */
export async function promptWatchlist() {
    const rl = createPrompt();

    console.log('');
    console.log('┌────────────────────────────────────────────────────────┐');
    console.log('│  📋 ADD TOKENS TO WATCHLIST                            │');
    console.log('├────────────────────────────────────────────────────────┤');
    console.log('│                                                        │');
    console.log('│   Enter pair addresses to monitor (comma-separated)    │');
    console.log('│   Or press ENTER to use auto-discovery                 │');
    console.log('│                                                        │');
    console.log('│   Format: chain:address                                │');
    console.log('│   Example: bsc:0x123...,base:0x456...                  │');
    console.log('│                                                        │');
    console.log('└────────────────────────────────────────────────────────┘');
    console.log('');

    const input = await ask(rl, '  Pairs (or ENTER for auto): ');
    rl.close();

    if (!input) {
        console.log('  ℹ️  Using auto-discovery mode');
        return [];
    }

    const pairs = input.split(',').map(p => {
        const [chain, address] = p.trim().split(':');
        return { chainId: chain?.toLowerCase(), pairAddress: address };
    }).filter(p => p.chainId && p.pairAddress);

    console.log(`  ✅ Added ${pairs.length} pairs to watchlist`);

    return pairs;
}

/**
 * Confirm settings before starting
 */
export async function confirmStart(config) {
    const rl = createPrompt();

    console.log('');
    console.log('┌────────────────────────────────────────────────────────┐');
    console.log('│  📋 CURRENT CONFIGURATION                              │');
    console.log('├────────────────────────────────────────────────────────┤');
    console.log(`│   Mode:           ${config.mode.padEnd(36)}│`);
    console.log(`│   Chains:         ${Object.entries(config.enabledChains).filter(([, v]) => v).map(([k]) => k.toUpperCase()).join(', ').padEnd(36)}│`);
    console.log(`│   Take Profit:    ${(config.takeProfit.multiplier + 'x').padEnd(36)}│`);
    console.log(`│   Stop Loss:      ${(config.risk.stopLossPercent + '%').padEnd(36)}│`);
    console.log(`│   Max Trades/Day: ${String(config.risk.maxTradesPerDay).padEnd(36)}│`);
    console.log(`│   Risk Per Trade: ${(config.risk.riskPerTrade + '%').padEnd(36)}│`);
    console.log('└────────────────────────────────────────────────────────┘');
    console.log('');

    if (config.mode === 'LIVE' && config.enableLiveTrading) {
        console.log('  ⚠️  WARNING: LIVE TRADING IS ENABLED!');
        console.log('  ⚠️  Real funds will be used!');
        console.log('');
    }

    const answer = await ask(rl, '  Start bot? [Y/n]: ');
    rl.close();

    return answer.toLowerCase() !== 'n';
}

/**
 * Display kill switch instructions
 */
export function displayKillSwitch() {
    console.log('');
    console.log('  ╔══════════════════════════════════════════════════════╗');
    console.log('  ║  🛑 KILL SWITCH: Press Ctrl+C to stop bot safely     ║');
    console.log('  ╚══════════════════════════════════════════════════════╝');
    console.log('');
}

export default {
    displayBanner,
    promptProfitMultiplier,
    promptWatchlist,
    confirmStart,
    displayKillSwitch
};
