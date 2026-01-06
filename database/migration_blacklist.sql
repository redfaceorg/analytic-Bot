-- ====================================
-- RedFace Trading Bot - Blacklist Migration
-- Wallet blacklist for regulatory compliance
-- ====================================

-- Create wallet blacklist table
CREATE TABLE IF NOT EXISTS wallet_blacklist (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_address TEXT NOT NULL UNIQUE,
    reason TEXT DEFAULT 'Regulatory compliance',
    added_by TEXT DEFAULT 'system',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_wallet_blacklist_address ON wallet_blacklist(wallet_address);

-- Enable RLS
ALTER TABLE wallet_blacklist ENABLE ROW LEVEL SECURITY;

-- Allow access (adjust policy as needed for your security model)
CREATE POLICY "Allow anon access" ON wallet_blacklist FOR ALL USING (true);

-- Add terms_accepted field to users table for legal compliance
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMP WITH TIME ZONE;
