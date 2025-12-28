-- RedFace Trading Bot - Supabase Database Schema
-- Run this SQL in Supabase SQL Editor to create required tables

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    telegram_id TEXT UNIQUE NOT NULL,
    username TEXT,
    settings JSONB DEFAULT '{"mode": "PAPER", "take_profit": 5, "stop_loss": 5, "max_trades_per_day": 15}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Wallets table
CREATE TABLE IF NOT EXISTS wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    chain TEXT NOT NULL, -- 'evm' or 'solana'
    address TEXT NOT NULL,
    encrypted_key TEXT, -- Encrypted private key
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, chain)
);

-- Trades table
CREATE TABLE IF NOT EXISTS trades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    chain TEXT NOT NULL,
    token TEXT NOT NULL,
    pair_address TEXT,
    action TEXT NOT NULL, -- 'BUY' or 'SELL'
    entry_price DECIMAL(24, 12),
    exit_price DECIMAL(24, 12),
    amount DECIMAL(18, 8),
    pnl DECIMAL(18, 8) DEFAULT 0,
    pnl_percent DECIMAL(8, 4) DEFAULT 0,
    status TEXT DEFAULT 'OPEN', -- 'OPEN' or 'CLOSED'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    closed_at TIMESTAMP WITH TIME ZONE
);

-- Signals table (optional - for tracking all signals)
CREATE TABLE IF NOT EXISTS signals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    chain TEXT NOT NULL,
    token TEXT NOT NULL,
    pair_address TEXT,
    entry_price DECIMAL(24, 12),
    volume_ratio DECIMAL(8, 2),
    price_change DECIMAL(8, 4),
    strength INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_user_id ON trades(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_signals_created_at ON signals(created_at);

-- Enable Row Level Security (optional but recommended)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;

-- Policy: Allow anon key to access all data (for bot usage)
CREATE POLICY "Allow anon access" ON users FOR ALL USING (true);
CREATE POLICY "Allow anon access" ON wallets FOR ALL USING (true);
CREATE POLICY "Allow anon access" ON trades FOR ALL USING (true);
CREATE POLICY "Allow anon access" ON signals FOR ALL USING (true);
