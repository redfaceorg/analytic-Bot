# RedFace Trading Bot - API Documentation

Complete reference for all Telegram bot commands and callback actions.

---

## User Commands

### `/start` or `/menu`
Displays the main dashboard with:
- Current mode (PAPER/LIVE)
- Bot status
- Daily P&L
- Quick action buttons

### `/wallet`
Shows wallet information:
- EVM wallet address (BSC/Base/Ethereum)
- Solana wallet address
- Current balances
- Create/import wallet options

### `/positions`
Lists all open positions with:
- Token name
- Entry price
- Current P&L
- Sell buttons

### `/pnl`
Shows profit/loss summary:
- Today's P&L
- Total trades
- Win rate
- Best/worst trade

### `/token <address>`
Analyzes a token:
- Price and changes (5m, 1h, 24h)
- Volume and liquidity
- Safety score
- Buy button

### `/referral`
Shows referral stats:
- Unique referral code
- Total referrals
- Total earnings
- Share button

### `/settings`
Bot settings menu:
- Toggle trading mode
- Set take profit/stop loss
- Auto-trade settings

### `/history`
Trade history:
- Past trades
- P&L per trade
- Total stats

### `/help`
Lists all available commands.

---

## Admin Commands

### `/admin`
Admin dashboard:
- Total users
- Today's signups
- Total trades
- System status

### `/users`
Lists all registered users with:
- Telegram ID
- Username
- Mode (PAPER/LIVE)
- Balance

### `/broadcast <message>`
Sends a message to all users.

---

## Callback Actions

### Main Menu
| Callback | Action |
|----------|--------|
| `menu` | Return to main menu |
| `status` | Show bot status |
| `refresh` | Refresh dashboard |
| `positions` | Show positions |
| `pnl` | Show P&L |
| `wallet` | Wallet menu |
| `deposit` | Deposit instructions |
| `settings` | Settings menu |
| `referral` | Referral info |
| `tools` | Tools menu |
| `gas` | Show gas prices |
| `toggle_mode` | Switch PAPER/LIVE |

### Trading
| Callback | Action |
|----------|--------|
| `buy_<amount>` | Confirm buy with amount |
| `sell_<positionId>` | Sell position |
| `confirm_buy` | Execute buy |
| `cancel_buy` | Cancel buy |

### Wallet
| Callback | Action |
|----------|--------|
| `create_evm` | Create EVM wallet |
| `create_solana` | Create Solana wallet |
| `wallet_toggle_mode` | Toggle mode |

### Tools
| Callback | Action |
|----------|--------|
| `alerts` | Price alerts |
| `watchlist` | Watchlist |
| `dca` | DCA plans |
| `copy_trade` | Copy trading |
| `history` | Trade history |

---

## Error Codes

| Code | Meaning |
|------|---------|
| `INSUFFICIENT_BALANCE` | Not enough funds |
| `LIVE_DISABLED` | LIVE trading not enabled |
| `NO_WALLET` | User has no wallet |
| `TRADE_FAILED` | Transaction failed |
| `RATE_LIMITED` | Too many requests |
