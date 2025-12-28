FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy source code
COPY . .

# Create logs and data directories
RUN mkdir -p logs data

# Set all required environment variables
ENV NODE_ENV=production
ENV MODE=PAPER
ENV ENABLE_BSC=true
ENV ENABLE_BASE=true
ENV ENABLE_SOLANA=true
ENV PROFIT_MULTIPLIER=5
ENV MAX_TRADES_PER_DAY=15
ENV RISK_PER_TRADE=5
ENV MAX_DAILY_DRAWDOWN=15
ENV STOP_LOSS_PERCENT=5
ENV MAX_HOLD_MINUTES=30
ENV ENABLE_LIVE_TRADING=false

# Expose health check port
ENV PORT=8000
EXPOSE 8000

# Run the bot
CMD ["node", "src/index.js"]
