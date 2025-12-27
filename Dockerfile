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

# Set default environment
ENV NODE_ENV=production
ENV MODE=PAPER

# Run the bot
CMD ["node", "src/index.js"]
