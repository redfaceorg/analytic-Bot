/**
 * DEX Trading Bot - Main Configuration Module
 * 
 * Loads and validates all configuration from environment variables
 * and provides a unified config object for the entire application.
 */

import 'dotenv/config';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load chain definitions
const chainsPath = join(__dirname, 'chains.json');
const chains = JSON.parse(readFileSync(chainsPath, 'utf-8'));

/**
 * Validate required environment variables
 */
function validateEnv() {
  const mode = process.env.MODE || 'PAPER';

  if (!['READ_ONLY', 'PAPER', 'LIVE'].includes(mode)) {
    throw new Error(`Invalid MODE: ${mode}. Must be READ_ONLY, PAPER, or LIVE`);
  }

  if (mode === 'LIVE') {
    if (process.env.ENABLE_LIVE_TRADING !== 'true') {
      throw new Error('LIVE mode requires ENABLE_LIVE_TRADING=true');
    }
    // Note: Global private keys not required - bot uses per-user encrypted wallets from Supabase
  }

  return mode;
}

/**
 * Build configuration object from environment
 */
function buildConfig() {
  const mode = validateEnv();

  return {
    // Operation mode
    mode,

    // Enabled chains
    enabledChains: {
      bsc: process.env.ENABLE_BSC === 'true',
      base: process.env.ENABLE_BASE === 'true',
      solana: process.env.ENABLE_SOLANA === 'true'
    },

    // Chain configurations
    chains,

    // RPC overrides from environment
    rpc: {
      bsc: process.env.BSC_RPC || chains.bsc.rpcDefault,
      base: process.env.BASE_RPC || chains.base.rpcDefault,
      solana: process.env.SOLANA_RPC || chains.solana.rpcDefault
    },

    // Strategy settings
    strategy: {
      type: 'VOLUME_SPIKE',
      volumeMultiplier: 3,        // Signal when volume > 3x average
      minPriceChange: 2,          // Minimum 2% price increase
      candleInterval: '5m',       // 5-minute candles
      lookbackPeriods: 12         // 1 hour of 5m candles for average
    },

    // Take profit settings
    takeProfit: {
      multiplier: process.env.PROFIT_MULTIPLIER
        ? parseFloat(process.env.PROFIT_MULTIPLIER)
        : 5  // Default to 5x if not set (avoids interactive prompt)
    },

    // Risk management
    risk: {
      maxTradesPerDay: parseInt(process.env.MAX_TRADES_PER_DAY || '15', 10),
      riskPerTrade: parseFloat(process.env.RISK_PER_TRADE || '5'),
      maxDailyDrawdown: parseFloat(process.env.MAX_DAILY_DRAWDOWN || '15'),
      stopLossPercent: parseFloat(process.env.STOP_LOSS_PERCENT || '5'),
      maxHoldMinutes: parseInt(process.env.MAX_HOLD_MINUTES || '30', 10)
    },

    // Execution settings
    execution: {
      maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10),
      retryDelayMs: parseInt(process.env.RETRY_DELAY_MS || '2000', 10),
      slippageTolerance: parseFloat(process.env.SLIPPAGE_TOLERANCE || '5')
    },

    // Live trading flag (extra safety)
    enableLiveTrading: process.env.ENABLE_LIVE_TRADING === 'true'
  };
}

// Export singleton config
const config = buildConfig();

export default config;

/**
 * Get list of enabled chain IDs
 */
export function getEnabledChains() {
  return Object.entries(config.enabledChains)
    .filter(([_, enabled]) => enabled)
    .map(([chainId]) => chainId);
}

/**
 * Get chain config by ID
 */
export function getChainConfig(chainId) {
  return config.chains[chainId];
}

/**
 * Check if running in safe mode (no real trades)
 */
export function isSafeMode() {
  return config.mode !== 'LIVE' || !config.enableLiveTrading;
}

/**
 * Display current configuration (safe for logging)
 */
export function displayConfig() {
  return {
    mode: config.mode,
    enabledChains: config.enabledChains,
    strategy: config.strategy,
    risk: config.risk,
    profitMultiplier: config.takeProfit.multiplier,
    liveTrading: config.enableLiveTrading
  };
}
