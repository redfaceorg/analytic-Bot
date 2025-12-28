/**
 * RedFace Trading Bot - Wallet Manager
 * 
 * Handles wallet creation, import, and balance checking
 * Supports EVM chains (BSC, Base) and Solana
 */

import { ethers } from 'ethers';
import { logInfo, logError } from '../logging/logger.js';
import config from '../config/index.js';

// In-memory wallet storage (for current session)
// In production, these should come from encrypted env vars
let wallets = {
    evm: null,      // { address, privateKey }
    solana: null    // { publicKey, secretKey }
};

// RPC endpoints
const RPC_URLS = {
    bsc: process.env.BSC_RPC || 'https://bsc-dataseed.binance.org',
    base: process.env.BASE_RPC || 'https://mainnet.base.org'
};

/**
 * Check if EVM wallet is configured
 */
export function hasEvmWallet() {
    return !!(wallets.evm?.privateKey || process.env.EVM_PRIVATE_KEY);
}

/**
 * Check if Solana wallet is configured
 */
export function hasSolanaWallet() {
    return !!(wallets.solana?.secretKey || process.env.SOLANA_PRIVATE_KEY);
}

/**
 * Create a new EVM wallet
 */
export function createEvmWallet() {
    try {
        const wallet = ethers.Wallet.createRandom();

        wallets.evm = {
            address: wallet.address,
            privateKey: wallet.privateKey,
            mnemonic: wallet.mnemonic?.phrase
        };

        logInfo(`Created new EVM wallet: ${wallet.address}`);

        return {
            success: true,
            address: wallet.address,
            privateKey: wallet.privateKey,
            mnemonic: wallet.mnemonic?.phrase
        };
    } catch (err) {
        logError('Failed to create EVM wallet', err);
        return { success: false, error: err.message };
    }
}

/**
 * Import EVM wallet from private key
 */
export function importEvmWallet(privateKey) {
    try {
        // Add 0x prefix if missing
        if (!privateKey.startsWith('0x')) {
            privateKey = '0x' + privateKey;
        }

        const wallet = new ethers.Wallet(privateKey);

        wallets.evm = {
            address: wallet.address,
            privateKey: wallet.privateKey
        };

        logInfo(`Imported EVM wallet: ${wallet.address}`);

        return {
            success: true,
            address: wallet.address
        };
    } catch (err) {
        logError('Failed to import EVM wallet', err);
        return { success: false, error: 'Invalid private key' };
    }
}

/**
 * Get EVM wallet address
 */
export function getEvmAddress() {
    if (wallets.evm?.address) {
        return wallets.evm.address;
    }

    if (process.env.EVM_PRIVATE_KEY) {
        try {
            const wallet = new ethers.Wallet(process.env.EVM_PRIVATE_KEY);
            return wallet.address;
        } catch {
            return null;
        }
    }

    return null;
}

/**
 * Get EVM wallet balance
 */
export async function getEvmBalance(chain = 'bsc') {
    const address = getEvmAddress();
    if (!address) {
        return { native: 0, usd: 0 };
    }

    try {
        const provider = new ethers.JsonRpcProvider(RPC_URLS[chain]);
        const balance = await provider.getBalance(address);
        const balanceEth = parseFloat(ethers.formatEther(balance));

        // Get price (simplified - in production use price feed)
        const nativeSymbol = chain === 'bsc' ? 'BNB' : 'ETH';
        const priceUsd = chain === 'bsc' ? 300 : 2400; // Approximate

        return {
            native: balanceEth,
            symbol: nativeSymbol,
            usd: balanceEth * priceUsd
        };
    } catch (err) {
        logError(`Failed to get ${chain} balance`, err);
        return { native: 0, usd: 0 };
    }
}

/**
 * Create Solana wallet (placeholder - requires @solana/web3.js)
 */
export async function createSolanaWallet() {
    try {
        // Dynamic import for Solana
        const { Keypair } = await import('@solana/web3.js');
        const bs58 = await import('bs58');

        const keypair = Keypair.generate();

        wallets.solana = {
            publicKey: keypair.publicKey.toBase58(),
            secretKey: bs58.default.encode(keypair.secretKey)
        };

        logInfo(`Created new Solana wallet: ${keypair.publicKey.toBase58()}`);

        return {
            success: true,
            address: keypair.publicKey.toBase58(),
            privateKey: bs58.default.encode(keypair.secretKey)
        };
    } catch (err) {
        logError('Failed to create Solana wallet', err);
        return { success: false, error: 'Solana wallet creation failed' };
    }
}

/**
 * Import Solana wallet
 */
export async function importSolanaWallet(secretKey) {
    try {
        const { Keypair } = await import('@solana/web3.js');
        const bs58 = await import('bs58');

        const keypair = Keypair.fromSecretKey(bs58.default.decode(secretKey));

        wallets.solana = {
            publicKey: keypair.publicKey.toBase58(),
            secretKey: secretKey
        };

        logInfo(`Imported Solana wallet: ${keypair.publicKey.toBase58()}`);

        return {
            success: true,
            address: keypair.publicKey.toBase58()
        };
    } catch (err) {
        logError('Failed to import Solana wallet', err);
        return { success: false, error: 'Invalid Solana private key' };
    }
}

/**
 * Get Solana wallet address
 */
export function getSolanaAddress() {
    if (wallets.solana?.publicKey) {
        return wallets.solana.publicKey;
    }
    return null;
}

/**
 * Get Solana balance
 */
export async function getSolanaBalance() {
    const address = getSolanaAddress();
    if (!address) {
        return { native: 0, usd: 0 };
    }

    try {
        const { Connection, PublicKey, LAMPORTS_PER_SOL } = await import('@solana/web3.js');
        const connection = new Connection(process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com');
        const pubkey = new PublicKey(address);

        const balance = await connection.getBalance(pubkey);
        const balanceSol = balance / LAMPORTS_PER_SOL;
        const priceUsd = 100; // Approximate SOL price

        return {
            native: balanceSol,
            symbol: 'SOL',
            usd: balanceSol * priceUsd
        };
    } catch (err) {
        logError('Failed to get Solana balance', err);
        return { native: 0, usd: 0 };
    }
}

/**
 * Get all wallet balances
 */
export async function getAllBalances() {
    const [bsc, base, solana] = await Promise.all([
        getEvmBalance('bsc'),
        getEvmBalance('base'),
        getSolanaBalance()
    ]);

    return {
        bsc,
        base,
        solana,
        totalUsd: (bsc.usd || 0) + (base.usd || 0) + (solana.usd || 0)
    };
}

/**
 * Get wallet summary for display
 */
export function getWalletSummary() {
    const evmAddress = getEvmAddress();
    const solAddress = getSolanaAddress();

    return {
        hasEvm: !!evmAddress,
        hasSolana: !!solAddress,
        evmAddress: evmAddress ? `${evmAddress.slice(0, 6)}...${evmAddress.slice(-4)}` : null,
        evmAddressFull: evmAddress,
        solanaAddress: solAddress ? `${solAddress.slice(0, 4)}...${solAddress.slice(-4)}` : null,
        solanaAddressFull: solAddress
    };
}

/**
 * Export private key (for backup - handle with care!)
 */
export function exportEvmPrivateKey() {
    if (wallets.evm?.privateKey) {
        return wallets.evm.privateKey;
    }
    return process.env.EVM_PRIVATE_KEY || null;
}

/**
 * Clear wallets from memory
 */
export function clearWallets() {
    wallets = { evm: null, solana: null };
    logInfo('Wallets cleared from memory');
}

export default {
    hasEvmWallet,
    hasSolanaWallet,
    createEvmWallet,
    importEvmWallet,
    getEvmAddress,
    getEvmBalance,
    createSolanaWallet,
    importSolanaWallet,
    getSolanaAddress,
    getSolanaBalance,
    getAllBalances,
    getWalletSummary,
    exportEvmPrivateKey,
    clearWallets
};
