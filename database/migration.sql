-- ====================================
-- RedFace Trading Bot - Database Migration
-- Run this AFTER your existing tables
-- ====================================

-- Add new columns to existing users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS referrer_id UUID REFERENCES users(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;

-- Add new columns to existing trades table
ALTER TABLE trades ADD COLUMN IF NOT EXISTS token_address TEXT;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS amount_usd DECIMAL(18, 8);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS fee_amount DECIMAL(18, 8) DEFAULT 0;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS tx_hash TEXT;

-- Create new tables (these should work fine)

-- Price Alerts table
CREATE TABLE IF NOT EXISTS price_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token_address TEXT NOT NULL,
    token_name TEXT,
    chain TEXT NOT NULL,
    condition TEXT NOT NULL,
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

-- Portfolio table
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
    interval TEXT NOT NULL,
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
    order_type TEXT NOT NULL,
    target_price DECIMAL(24, 12) NOT NULL,
    amount DECIMAL(18, 8) NOT NULL,
    amount_usd DECIMAL(18, 8),
    status TEXT DEFAULT 'pending',
    tx_hash TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    filled_at TIMESTAMP WITH TIME ZONE
);

-- Referral earnings table
CREATE TABLE IF NOT EXISTS referral_earnings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
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
    tx_hash TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Copy trading table
CREATE TABLE IF NOT EXISTS copy_trading (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    follower_id UUID REFERENCES users(id) ON DELETE CASCADE,
    trader_id UUID REFERENCES users(id) ON DELETE CASCADE,
    copy_percent DECIMAL(5, 2) DEFAULT 10,
    max_per_trade DECIMAL(18, 8) DEFAULT 100,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(follower_id, trader_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);
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

-- Enable RLS on new tables
ALTER TABLE price_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio ENABLE ROW LEVEL SECURITY;
ALTER TABLE dca_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE limit_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE copy_trading ENABLE ROW LEVEL SECURITY;

-- Add policies for new tables
CREATE POLICY "Allow anon access" ON price_alerts FOR ALL USING (true);
CREATE POLICY "Allow anon access" ON watchlist FOR ALL USING (true);
CREATE POLICY "Allow anon access" ON portfolio FOR ALL USING (true);
CREATE POLICY "Allow anon access" ON dca_plans FOR ALL USING (true);
CREATE POLICY "Allow anon access" ON limit_orders FOR ALL USING (true);
CREATE POLICY "Allow anon access" ON referral_earnings FOR ALL USING (true);
CREATE POLICY "Allow anon access" ON fees FOR ALL USING (true);
CREATE POLICY "Allow anon access" ON copy_trading FOR ALL USING (true);
