const cron = require('node-cron');
const express = require('express');
const app = express();
const tradingStrategy = require('./services/strategy');
const telegramBot = require('./services/telegramBot');
const logger = require('./utils/logger');
const config = require('./config/config');

class TradingBot {
  constructor() {
    this.app = express();
    this.isRunning = false;
    this.dailyStats = {
      totalSignals: 0,
      sentSignals: 0,
      niftySignals: 0,
      bankNiftySignals: 0,
      startTime: new Date()
    };
  }

  async start() {
    logger.info('Starting Trading Bot...');

    // Setup Telegram callbacks
    telegramBot.setupCallbacks();

    // Setup web server for health checks
    this.setupWebServer();

    // Schedule market scanning during trading hours
    this.scheduleMarketScanning();

    // Schedule daily summary
    this.scheduleDailySummary();

    // Send startup message
    await telegramBot.sendMarketUpdate('🤖 *Trading Bot Started*\n\n📊 NIFTY Scanner: ✅\n🏦 Bank NIFTY Scanner: ✅\n\nScanning for opportunities...');

    logger.info('Trading Bot is now active for NIFTY & Bank NIFTY!');
  }

  setupWebServer() {
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        uptime: process.uptime(),
        dailyStats: this.dailyStats,
        enabledIndices: config.strategy.enabledIndices,
        timestamp: new Date()
      });
    });

    this.app.get('/stats', (req, res) => {
      res.json({
        ...this.dailyStats,
        breakdown: {
          nifty: this.dailyStats.niftySignals,
          bankNifty: this.dailyStats.bankNiftySignals
        }
      });
    });

    const port = process.env.PORT || 3000;
    this.app.listen(port, () => {
      logger.info(`Web server running on port ${port}`);
    });
  }

  scheduleMarketScanning() {
    // Run every 2 seconds during trading hours (Monday to Friday, 9:15 AM to 3:30 PM IST)
    cron.schedule('*/2 * * * * *', async () => {
      if (!this.isValidTradingTime() || this.dailyStats.sentSignals >= config.trading.maxTradesPerDay) {
        return;
      }
      try {
        // Analyze both NIFTY and Bank NIFTY
        const signals = await tradingStrategy.analyzeMarket();

        for (const signal of signals) {
          if (signal.confidence >= 70) { // Only send high confidence signals
            await telegramBot.sendTradingSignal(signal);

            // Update stats by index
            this.dailyStats.totalSignals++;
            this.dailyStats.sentSignals++;

            if (signal.index === 'NIFTY') {
              this.dailyStats.niftySignals++;
            } else if (signal.index === 'BANKNIFTY') {
              this.dailyStats.bankNiftySignals++;
            }

            // Add delay between signals to avoid spam
            await this.delay(3000); // Increased to 3 seconds for multiple indices
          }
        }

        // Log scanning activity (optional)
        if (signals.length > 0) {
          logger.info(`Scanned: ${signals.length} signals found, confidence threshold: 70%`);
        }

      } catch (error) {
        logger.error('Error in market scanning:', error.message);
      }
    });
  }

  scheduleDailySummary() {
    // Send daily summary at 4:00 PM IST
    cron.schedule('0 16 * * 1-5', async () => {
      const summary = {
        totalSignals: this.dailyStats.totalSignals,
        niftySignals: this.dailyStats.niftySignals,
        bankNiftySignals: this.dailyStats.bankNiftySignals,
        successfulTrades: 'N/A (Manual tracking needed)',
        winRate: 'N/A',
        totalPnL: 'N/A',
        bestTrade: 'N/A',
        marketTrend: await this.getMarketTrend()
      };

      await telegramBot.sendDailySummary(summary);

      // Reset daily stats
      this.dailyStats = {
        totalSignals: 0,
        sentSignals: 0,
        niftySignals: 0,
        bankNiftySignals: 0,
        startTime: new Date()
      };
    });
  }

  isValidTradingTime() {
    const now = new Date();
    const day = now.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday

    // Only Monday to Friday
    if (day === 0 || day === 6) return false;

    const currentTime = now.getHours() * 100 + now.getMinutes();
    const startTime = 915;  // 9:15 AM
    const endTime = 1530;   // 3:30 PM

    return currentTime >= startTime && currentTime <= endTime;
  }

  async getMarketTrend() {
    // Enhanced trend analysis for both indices
    try {
      const marketDataService = require('./services/marketData');
      const niftyData = await marketDataService.fetchNiftySpotPrice();
      const bankNiftyData = await marketDataService.fetchBankNiftySpotPrice();

      let trend = '';

      if (niftyData) {
        const niftyTrend = niftyData.pChange > 0.5 ? '📈' : niftyData.pChange < -0.5 ? '📉' : '↔️';
        trend += `NIFTY: ${niftyTrend} ${niftyData.pChange.toFixed(2)}%`;
      }

      if (bankNiftyData) {
        const bankTrend = bankNiftyData.pChange > 0.5 ? '📈' : bankNiftyData.pChange < -0.5 ? '📉' : '↔️';
        trend += `\nBank NIFTY: ${bankTrend} ${bankNiftyData.pChange.toFixed(2)}%`;
      }

      return trend || 'Data unavailable';
    } catch {
      return 'Unknown';
    }
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Ping endpoint
app.get('/ping', (req, res) => {
  res.json({
    status: 'alive',
    timestamp: new Date(),
    uptime: process.uptime()
  });
});

// Self-ping every 10 minutes (prevent sleep)
setInterval(() => {
  if (process.env.NODE_ENV === 'production') {
    fetch(`${process.env.RENDER_URL}/ping`)
      .catch(err => console.log('Ping failed:', err.message));
  }
}, 10 * 60 * 1000);

// Start the bot
const bot = new TradingBot();
bot.start().catch(error => {
  logger.error('Failed to start trading bot:', error.message);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('Shutting down trading bot...');
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error.message);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
