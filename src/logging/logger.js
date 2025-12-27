/**
 * DEX Trading Bot - Logger Module
 * 
 * Centralized logging with Winston
 * Logs to console and files with proper formatting
 */

import winston from 'winston';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const logsDir = join(__dirname, '../../logs');

// Ensure logs directory exists
try {
    mkdirSync(logsDir, { recursive: true });
} catch (err) {
    // Directory might already exist
}

// Custom format for console output
const consoleFormat = winston.format.combine(
    winston.format.timestamp({ format: 'HH:mm:ss' }),
    winston.format.colorize(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
        return `[${timestamp}] ${level}: ${message}${metaStr}`;
    })
);

// Format for file output (JSON for parsing)
const fileFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
);

// Create main logger
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    transports: [
        // Console output (colorized)
        new winston.transports.Console({
            format: consoleFormat
        }),
        // Combined log file
        new winston.transports.File({
            filename: join(logsDir, 'combined.log'),
            format: fileFormat,
            maxsize: 5242880, // 5MB
            maxFiles: 5
        }),
        // Error-only log file
        new winston.transports.File({
            filename: join(logsDir, 'error.log'),
            level: 'error',
            format: fileFormat,
            maxsize: 5242880,
            maxFiles: 5
        })
    ]
});

// Create trade-specific logger
const tradeLogger = winston.createLogger({
    level: 'info',
    transports: [
        new winston.transports.File({
            filename: join(logsDir, 'trades.log'),
            format: fileFormat,
            maxsize: 5242880,
            maxFiles: 10
        })
    ]
});

// Create signal-specific logger
const signalLogger = winston.createLogger({
    level: 'info',
    transports: [
        new winston.transports.File({
            filename: join(logsDir, 'signals.log'),
            format: fileFormat,
            maxsize: 5242880,
            maxFiles: 5
        })
    ]
});

/**
 * Log a trade event
 */
export function logTrade(data) {
    tradeLogger.info('TRADE', data);
    logger.info(`📊 TRADE: ${data.action} ${data.token} @ ${data.price}`, { chain: data.chain });
}

/**
 * Log a signal event
 */
export function logSignal(data) {
    signalLogger.info('SIGNAL', data);
    logger.info(`🎯 SIGNAL: ${data.type} on ${data.token}`, { chain: data.chain, strength: data.strength });
}

/**
 * Log info message
 */
export function logInfo(message, meta = {}) {
    logger.info(message, meta);
}

/**
 * Log warning message
 */
export function logWarn(message, meta = {}) {
    logger.warn(`⚠️ ${message}`, meta);
}

/**
 * Log error message
 */
export function logError(message, error = null, meta = {}) {
    const errorMeta = error ? { error: error.message, stack: error.stack, ...meta } : meta;
    logger.error(`❌ ${message}`, errorMeta);
}

/**
 * Log debug message
 */
export function logDebug(message, meta = {}) {
    logger.debug(message, meta);
}

/**
 * Log bot startup
 */
export function logStartup(config) {
    logger.info('🤖 ====================================');
    logger.info('🤖 DEX TRADING BOT STARTING');
    logger.info('🤖 ====================================');
    logger.info(`📌 Mode: ${config.mode}`);
    logger.info(`📌 Chains: ${Object.entries(config.enabledChains).filter(([, v]) => v).map(([k]) => k.toUpperCase()).join(', ')}`);
    logger.info(`📌 Strategy: ${config.strategy.type}`);
    logger.info(`📌 Take Profit: ${config.takeProfit.multiplier}x`);
    logger.info(`📌 Stop Loss: ${config.risk.stopLossPercent}%`);
    logger.info(`📌 Max Trades/Day: ${config.risk.maxTradesPerDay}`);
    logger.info('🤖 ====================================');
}

export default logger;
