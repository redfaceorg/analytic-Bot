# RedFace Trading Bot 🤖

A powerful multi-chain DEX trading bot with Telegram integration, paper trading mode, and real-time trading via user-managed wallets.

## ✨ Features

### Trading
- **Multi-Chain Support**: BSC, Base, Solana, Ethereum Mainnet
- **Paper & LIVE Trading**: Test strategies without real funds
- **Per-User Wallets**: Each user controls their own encrypted wallet
- **DCA Plans**: Automated dollar-cost averaging
- **Limit Orders**: Buy/sell when price hits target
- **Copy Trading**: Follow successful traders

### Analytics
- **Token Scanner**: Safety analysis with scam detection
- **Price Alerts**: Get notified when price hits target
- **PnL Cards**: Shareable trade result cards
- **Gas Prices**: Real-time gas for all chains
- **Leaderboard**: Top traders ranking

### Revenue
- **0.5% Trading Fee**: Collected on LIVE trades
- **30% Referral Commission**: Referrers earn from referee trades
- **Automated Fee Transfer**: Fees sent to development wallet

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
```bash
copy .env.example .env
```

Edit `.env` with your values:
```env
# Telegram Bot
TELEGRAM_BOT_TOKEN=your_bot_token_here

# Supabase Database
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_anon_key

# Mode: PAPER (default) or LIVE
MODE=PAPER
ENABLE_LIVE_TRADING=false
```

### 3. Start the Bot
```bash
npm start
```

---

## 📱 Telegram Commands

| Command | Description |
|---------|-------------|
| `/start` | Main menu / dashboard |
| `/wallet` | View & manage wallets |
| `/positions` | View open positions |
| `/pnl` | View profit/loss summary |
| `/token <address>` | Analyze a token |
| `/referral` | View referral stats |
| `/settings` | Bot settings |
| `/help` | Command list |

### Admin Commands
| Command | Description |
|---------|-------------|
| `/admin` | Admin dashboard |
| `/users` | View all users |
| `/broadcast <msg>` | Send message to all users |

---

## 🔧 Trading Modes

| Mode | Description |
|------|-------------|
| `PAPER` | Simulated trading with fake balance |
| `LIVE` | Real trading using per-user wallets |

### Switching Modes
Users can switch modes via:
- Dashboard button (`📝 PAPER Mode` / `🔴 LIVE Mode`)
- Settings menu

---

## 💰 Fee Structure

| Component | Percent | Recipient |
|-----------|---------|-----------|
| Trading Fee | 0.5% | Collected from proceeds |
| Referral Commission | 30% of fee | Referrer |
| Net Fee | 70% of fee | Development wallet |

---

## 🔗 Supported Chains

| Chain | DEX | Native Token |
|-------|-----|--------------|
| BSC | PancakeSwap | BNB |
| Base | Aerodrome | ETH |
| Solana | Jupiter | SOL |
| Ethereum | Uniswap V2 | ETH |

---

## 🛡️ Security

- **Encrypted Wallets**: User private keys encrypted with AES-256
- **Row Level Security**: Supabase RLS enabled
- **No Shared Keys**: Each user has their own wallet
- **Paper Mode Default**: LIVE trading disabled by default

---

## 📊 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | ✅ | Bot token from @BotFather |
| `SUPABASE_URL` | ✅ | Supabase project URL |
| `SUPABASE_ANON_KEY` | ✅ | Supabase anon key |
| `MODE` | ❌ | PAPER or LIVE (default: PAPER) |
| `ENABLE_LIVE_TRADING` | ❌ | Enable LIVE mode (default: false) |
| `WALLET_ENCRYPTION_KEY` | ❌ | Key for wallet encryption |
| `BSC_RPC_URL` | ❌ | Custom BSC RPC |
| `BASE_RPC_URL` | ❌ | Custom Base RPC |
| `SOLANA_RPC_URL` | ❌ | Custom Solana RPC |

---

## ⚠️ Disclaimer

- This bot is for educational purposes only
- Trading cryptocurrency involves significant risk
- Never invest more than you can afford to lose
- Always start with paper trading to test strategies

---

## 📄 License

MIT License - Personal use only.
