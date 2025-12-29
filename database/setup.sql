-- RedFace Trading Bot - Supabase Database Schema
-- Run this SQL in Supabase SQL Editor to create required tables

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    telegram_id TEXT UNIQUE NOT NULL,
    username TEXT,
    referrer_id UUID REFERENCES users(id),
    referral_code TEXT UNIQUE,
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
    token_address TEXT,
    pair_address TEXT,
    action TEXT NOT NULL, -- 'BUY' or 'SELL'
    entry_price DECIMAL(24, 12),
    exit_price DECIMAL(24, 12),
    amount DECIMAL(18, 8),
    amount_usd DECIMAL(18, 8),
    pnl DECIMAL(18, 8) DEFAULT 0,
    pnl_percent DECIMAL(8, 4) DEFAULT 0,
    fee_amount DECIMAL(18, 8) DEFAULT 0,
    tx_hash TEXT,
    status TEXT DEFAULT 'OPEN', -- 'OPEN' or 'CLOSED'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    closed_at TIMESTAMP WITH TIME ZONE
);

-- Signals table
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

-- ============ NEW TABLES ============

-- Price Alerts table
CREATE TABLE IF NOT EXISTS price_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token_address TEXT NOT NULL,
    token_name TEXT,
    chain TEXT NOT NULL,
    condition TEXT NOT NULL, -- 'above' or 'below'
    target_price DECIMAL(24, 12) NOT NULL,
    current_price DECIMAL(24, 12),
    active BOOLEAN DEFAULT true,
    triggered_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Watchlist table
CREATE TABLE IF NOT EXISTS watchlist (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token_address TEXT NOT NULL,
    token_name TEXT,
    token_symbol TEXT,
    chain TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, token_address)
);

-- Portfolio holdings table
CREATE TABLE IF NOT EXISTS portfolio (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token_address TEXT NOT NULL,
    token_name TEXT,
    token_symbol TEXT,
    chain TEXT NOT NULL,
    amount DECIMAL(24, 12) DEFAULT 0,
    avg_price DECIMAL(24, 12) DEFAULT 0,
    total_invested DECIMAL(18, 8) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, token_address)
);

-- DCA Plans table
CREATE TABLE IF NOT EXISTS dca_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token_address TEXT NOT NULL,
    token_name TEXT,
    chain TEXT NOT NULL,
    amount_usd DECIMAL(18, 8) NOT NULL,
    interval TEXT NOT NULL, -- 'daily', 'weekly', 'monthly'
    active BOOLEAN DEFAULT true,
    next_buy TIMESTAMP WITH TIME ZONE,
    total_invested DECIMAL(18, 8) DEFAULT 0,
    total_buys INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Limit Orders table
CREATE TABLE IF NOT EXISTS limit_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token_address TEXT NOT NULL,
    token_name TEXT,
    chain TEXT NOT NULL,
    order_type TEXT NOT NULL, -- 'buy' or 'sell'
    target_price DECIMAL(24, 12) NOT NULL,
    amount DECIMAL(18, 8) NOT NULL,
    amount_usd DECIMAL(18, 8),
    status TEXT DEFAULT 'pending', -- 'pending', 'filled', 'cancelled'
    tx_hash TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    filled_at TIMESTAMP WITH TIME ZONE
);

-- Referral earnings table
CREATE TABLE IF NOT EXISTS referral_earnings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE, -- the referrer
    referred_user_id UUID REFERENCES users(id),
    trade_id UUID REFERENCES trades(id),
    commission_amount DECIMAL(18, 8) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Fee tracking table
CREATE TABLE IF NOT EXISTS fees (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trade_id UUID REFERENCES trades(id),
    user_id UUID REFERENCES users(id),
    fee_amount DECIMAL(18, 8) NOT NULL,
    referrer_amount DECIMAL(18, 8) DEFAULT 0,
    net_amount DECIMAL(18, 8) NOT NULL,
    chain TEXT NOT NULL,
    tx_hash TEXT, -- fee transfer tx if applicable
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Copy trading follows table
CREATE TABLE IF NOT EXISTS copy_trading (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    follower_id UUID REFERENCES users(id) ON DELETE CASCADE,
    trader_id UUID REFERENCES users(id) ON DELETE CASCADE,
    copy_percent DECIMAL(5, 2) DEFAULT 10, -- copy 10% of trade size
    max_per_trade DECIMAL(18, 8) DEFAULT 100, -- max $100 per copied trade
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(follower_id, trader_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);
CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_user_id ON trades(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_signals_created_at ON signals(created_at);
CREATE INDEX IF NOT EXISTS idx_price_alerts_user_id ON price_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_price_alerts_active ON price_alerts(active);
CREATE INDEX IF NOT EXISTS idx_watchlist_user_id ON watchlist(user_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_user_id ON portfolio(user_id);
CREATE INDEX IF NOT EXISTS idx_dca_plans_user_id ON dca_plans(user_id);
CREATE INDEX IF NOT EXISTS idx_dca_plans_next_buy ON dca_plans(next_buy);
CREATE INDEX IF NOT EXISTS idx_limit_orders_user_id ON limit_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_limit_orders_status ON limit_orders(status);
CREATE INDEX IF NOT EXISTS idx_copy_trading_follower ON copy_trading(follower_id);
CREATE INDEX IF NOT EXISTS idx_copy_trading_trader ON copy_trading(trader_id);

-- Enable Row Level Security
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio ENABLE ROW LEVEL SECURITY;
ALTER TABLE dca_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE limit_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE copy_trading ENABLE ROW LEVEL SECURITY;

-- Policy: Allow anon key to access all data (for bot usage)
CREATE POLICY "Allow anon access" ON users FOR ALL USING (true);
CREATE POLICY "Allow anon access" ON wallets FOR ALL USING (true);
CREATE POLICY "Allow anon access" ON trades FOR ALL USING (true);
CREATE POLICY "Allow anon access" ON signals FOR ALL USING (true);
CREATE POLICY "Allow anon access" ON price_alerts FOR ALL USING (true);
CREATE POLICY "Allow anon access" ON watchlist FOR ALL USING (true);
CREATE POLICY "Allow anon access" ON portfolio FOR ALL USING (true);
CREATE POLICY "Allow anon access" ON dca_plans FOR ALL USING (true);
CREATE POLICY "Allow anon access" ON limit_orders FOR ALL USING (true);
CREATE POLICY "Allow anon access" ON referral_earnings FOR ALL USING (true);
CREATE POLICY "Allow anon access" ON fees FOR ALL USING (true);
CREATE POLICY "Allow anon access" ON copy_trading FOR ALL USING (true);

