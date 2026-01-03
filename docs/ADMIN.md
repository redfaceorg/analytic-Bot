# RedFace Trading Bot - Admin Manual

Administrative guide for bot operators and developers.

---

## Admin Access

Admin access is determined by the `TELEGRAM_CHAT_ID` environment variable. Set this to your Telegram user ID:

```env
TELEGRAM_CHAT_ID=your_telegram_user_id
```

To find your Telegram ID:
1. Message @userinfobot on Telegram
2. It will reply with your user ID

---

## Admin Commands

### `/admin` - Dashboard
Shows system overview:
- Total registered users
- Today's new signups
- Total trades executed
- Active positions

### `/users` - User List
Lists all users with:
- Telegram ID
- Username
- Trading mode
- Wallet addresses

### `/broadcast <message>` - Broadcast
Sends a message to ALL users. Use carefully!

```
/broadcast 🎉 New feature: Copy Trading is now live!
```

---

## Monitoring

### Logs
Logs are written to console and can be captured:
```bash
npm start > bot.log 2>&1
```

### Error Alerts
Critical errors can be sent to admin via Telegram. Ensure `TELEGRAM_CHAT_ID` is set.

---

## Database Management

### Supabase Tables

| Table | Purpose |
|-------|---------|
| `users` | User accounts |
| `wallets` | Encrypted wallets |
| `trades` | Trade history |
| `positions` | Open positions |
| `dca_plans` | DCA schedules |
| `limit_orders` | Limit orders |
| `price_alerts` | Price alerts |
| `referral_earnings` | Referral commissions |

### Backup
Use Supabase dashboard or CLI for backups:
```bash
supabase db dump > backup.sql
```

---

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | ✅ | Bot token |
| `TELEGRAM_CHAT_ID` | ✅ | Admin user ID |
| `SUPABASE_URL` | ✅ | Database URL |
| `SUPABASE_ANON_KEY` | ✅ | Database key |
| `MODE` | ❌ | PAPER or LIVE |
| `ENABLE_LIVE_TRADING` | ❌ | Enable LIVE |
| `WALLET_ENCRYPTION_KEY` | ❌ | Encryption key |

### RPC Configuration

| Variable | Default |
|----------|---------|
| `BSC_RPC_URL` | https://bsc-dataseed.binance.org |
| `BASE_RPC_URL` | https://mainnet.base.org |
| `SOLANA_RPC_URL` | https://api.mainnet-beta.solana.com |
| `ETH_RPC_URL` | https://eth.llamarpc.com |

---

## Fee Collection

### Wallets
Fees are automatically transferred to:
- **EVM**: `0xb50ea4506b9a7d41c1bdb650bd0b00487fb6daf0`
- **Solana**: `ADPimQCm7wPRT3zp796Jin4SXSxYxTeibVxADf11PGEg`

To change, modify `FEE_WALLETS` in `src/services/feeService.js`.

### Fee Breakdown
- **0.5%** of trade proceeds
- **30%** to referrer (if applicable)
- **70%** to dev wallet

---

## Troubleshooting

### Bot Not Responding
1. Check `TELEGRAM_BOT_TOKEN` is valid
2. Ensure bot is not blocked
3. Check console for errors

### Trades Failing
1. Check RPC URLs are working
2. Verify user has sufficient balance
3. Check gas prices

### Database Errors
1. Verify Supabase credentials
2. Check table structure matches schema
3. Run migrations if needed

---

## Deployment

### Koyeb/Railway/Render
1. Push code to GitHub
2. Connect repo to platform
3. Set environment variables
4. Deploy

### Webhook Mode
Set `TELEGRAM_MODE=webhook` and configure:
```env
TELEGRAM_MODE=webhook
WEBHOOK_URL=https://your-domain.com
```

---

## Security Best Practices

1. **Never commit `.env`** - Keep secrets secure
2. **Rotate keys regularly** - Change encryption keys periodically
3. **Monitor transactions** - Watch for unusual activity
4. **Limit LIVE access** - Test thoroughly in PAPER mode
5. **Use dedicated wallets** - Don't mix bot funds with personal

---

## Support

For issues:
1. Check logs for errors
2. Review this documentation
3. Check Supabase dashboard for data issues
