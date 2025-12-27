# DEX Trading Bot 🤖

Autonomous multi-chain DEX trading bot with paper trading mode.

## Features

- **Multi-Chain**: BSC, Base, Solana
- **Volume Spike Strategy**: Detects unusual volume bursts
- **Risk Management**: Stop-loss, take-profit, daily limits
- **Paper Trading**: Test without real funds
- **Configurable X Profit**: 2x, 5x, 10x, 15x, or custom

## Quick Start

```bash
# Install dependencies
npm install

# Copy and configure environment
copy .env.example .env

# Run in paper trading mode
npm start

# Run read-only (signals only, no trades)
npm run readonly
```

## Configuration

Edit `.env` file:

```env
# Mode: READ_ONLY | PAPER | LIVE
MODE=PAPER

# Enabled chains
ENABLE_BSC=true
ENABLE_BASE=true
ENABLE_SOLANA=true

# Risk settings
MAX_TRADES_PER_DAY=15
RISK_PER_TRADE=5
MAX_DAILY_DRAWDOWN=15
STOP_LOSS_PERCENT=5

# Profit target (prompted at startup if not set)
PROFIT_MULTIPLIER=
```

## Modes

| Mode | Description |
|------|-------------|
| `READ_ONLY` | Fetch data and detect signals, NO trades |
| `PAPER` | Simulated trading with fake balance |
| `LIVE` | Real trading (disabled by default) |

## Strategy: Volume Spike

**Entry**:
- 5m volume > 3x average hourly volume
- Price change > 2% (positive)

**Exit**:
- Take profit: Xx entry price (configurable)
- Stop loss: -5% from entry
- Time limit: 30 minutes max hold

## Kill Switch

Press `Ctrl+C` to stop the bot safely.

## ⚠️ Warnings

- **NEVER commit `.env` with private keys**
- **Start with paper trading**
- **Use a dedicated hot wallet with limited funds**
- **Live trading is disabled by default**

## License

MIT - Personal use only.
