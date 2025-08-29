import { webSocketFeed } from './services/webSocketFeed';
import { strategy } from './services/strategy';
import { telegramBot } from './services/telegramBot';
import { orderService } from './services/orderService';
import { healthServer } from './services/healthServer';
import { logger } from './utils/logger';
import { config } from './config/config';
import { isMarketOpen, getTimeUntilMarketOpen, formatTimeUntilMarketOpen, getMarketStatus } from './utils/marketHours';
import { TradingSignal, TradingStats } from './types';

class WebSocketTradingBot {
  private isRunning = false;
  private startTime = Date.now();
  private stats: TradingStats = {
    signals: 0,
    successful: 0,
    avgConfidence: 0
  };
  private dailySummaryTimeout: NodeJS.Timeout | null = null;
  private marketOpenTimeout: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  public async start(): Promise<void> {
    try {
      logger.info('🚀 WebSocket Trading Bot Starting...');

      // Start health server first
      healthServer.start();

      // Check market hours
      if (!isMarketOpen()) {
        const timeUntilOpen = formatTimeUntilMarketOpen();
        logger.info(`📅 Market is closed - ${timeUntilOpen}`);
        await telegramBot.initialize();
        await telegramBot.sendMessage(`🕒 Bot started but market is closed\n${timeUntilOpen}\n\nBot will activate when market opens.`);
        this.scheduleMarketOpen();
        return;
      }

      // ✅ CORRECT INITIALIZATION ORDER:

      // 1. Initialize WebSocket FIRST
      await webSocketFeed.initialize();
      logger.info('✅ WebSocket initialized');

      // 2. Wait for WebSocket to actually connect
      await new Promise(resolve => setTimeout(resolve, 3000));

      // 3. Initialize strategy AFTER WebSocket is ready
      await strategy.initialize();
      logger.info('✅ Strategy initialized');

      // 4. Initialize other services
      await telegramBot.initialize();
      await orderService.initialize();

      // 5. Send startup notification
      await telegramBot.sendStartupMessage();

      this.isRunning = true;
      logger.info('✅ All services initialized successfully');

    } catch (error) {
      logger.error('Failed to start trading bot:', (error as Error).message);
      process.exit(1);
    }
  }


  private scheduleDailySummary(): void {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    tomorrow.setHours(17, 0, 0, 0); // 5 PM daily summary

    const timeUntilSummary = tomorrow.getTime() - now.getTime();

    this.dailySummaryTimeout = setTimeout(async () => {
      // Send trading summary
      await telegramBot.sendDailySummary(this.stats);

      // Send balance summary
      const balanceSummary = await orderService.getDailyBalanceSummary();
      await telegramBot.sendMessage(balanceSummary);

      // Reset daily stats
      this.stats = { signals: 0, successful: 0, avgConfidence: 0 };
      orderService.resetDailyStats();

      // Schedule next day
      this.scheduleDailySummary();
    }, timeUntilSummary);
  }

  private scheduleMarketOpen(): void {
    const timeUntilOpen = getTimeUntilMarketOpen();

    logger.info(`⏰ Scheduling bot activation in ${Math.floor(timeUntilOpen / (1000 * 60 * 60))}h ${Math.floor((timeUntilOpen % (1000 * 60 * 60)) / (1000 * 60))}m`);

    this.marketOpenTimeout = setTimeout(async () => {
      logger.info('🔔 Market opening - Activating trading bot');
      await telegramBot.sendMessage('🔔 Market is now open - Bot is activating!');

      // Initialize trading services
      await webSocketFeed.initialize();
      await strategy.initialize();
      await orderService.initialize();

      this.isRunning = true;
      this.scheduleMarketClose();
      this.startHeartbeat();

      logger.info('✅ Trading bot activated for market hours');
    }, timeUntilOpen);
  }

  private scheduleMarketClose(): void {
    // Check every hour if market is still open
    const checkMarketStatus = () => {
      if (!isMarketOpen() && this.isRunning) {
        logger.info('🔔 Market closed - Deactivating trading bot');
        telegramBot.sendMessage('🔔 Market closed - Bot deactivated until next trading session');

        // Disconnect trading services but keep bot running
        webSocketFeed.disconnect();
        this.isRunning = false;
        this.stopHeartbeat();

        // Schedule next market open
        this.scheduleMarketOpen();
      } else if (isMarketOpen()) {
        // Schedule next check in 1 hour
        setTimeout(checkMarketStatus, 60 * 60 * 1000);
      }
    };

    // Initial check in 1 hour
    setTimeout(checkMarketStatus, 60 * 60 * 1000);
  }

  public async stop(): Promise<void> {
    logger.info('🛑 WebSocket Trading Bot Stopping...');
    this.isRunning = false;

    // Clear scheduled timeouts
    if (this.dailySummaryTimeout) {
      clearTimeout(this.dailySummaryTimeout);
      this.dailySummaryTimeout = null;
    }

    if (this.marketOpenTimeout) {
      clearTimeout(this.marketOpenTimeout);
      this.marketOpenTimeout = null;
    }

    // Stop heartbeat
    this.stopHeartbeat();

    // Disconnect services
    webSocketFeed.disconnect();
    orderService.stopMonitoring();
    healthServer.stop();

    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    logger.info(`Bot ran for ${uptime} seconds`);
    logger.info(`Generated ${this.stats.signals} signals today`);

    logger.info('✅ WebSocket Trading Bot Stopped');
  }

  public getStats(): TradingStats {
    return { ...this.stats };
  }

  public isActive(): boolean {
    return this.isRunning;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(async () => {
      if (this.isRunning && isMarketOpen()) {
        const uptime = Math.floor((Date.now() - this.startTime) / 1000);
        const uptimeMinutes = Math.floor(uptime / 60);
        const uptimeHours = Math.floor(uptimeMinutes / 60);
        const displayMinutes = uptimeMinutes % 60;

        // Get market status
        const marketStatus = getMarketStatus();
        let marketInfo = '';
        if (marketStatus.nse) {
          marketInfo = 'NSE: OPEN';
        } else {
          marketInfo = 'NSE: CLOSED';
        }

        logger.info(`💚 BOT WORKING - Runtime: ${uptimeHours}h ${displayMinutes}m | ${marketInfo} | Signals: ${this.stats.signals} | Status: MONITORING ALL CONDITIONS`);

        // Show current market conditions
        try {
          const marketConditions = await strategy.getCurrentMarketConditions();
          logger.info(marketConditions);
        } catch (error) {
          logger.info('📊 Current Market Conditions: Error retrieving data');
        }
      } else if (this.isRunning && !isMarketOpen()) {
        logger.info(`💛 BOT WORKING - Market: CLOSED | Status: WAITING FOR MARKET OPEN`);
      }
    }, 10000); // Every 10 seconds
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
      logger.debug('⏰ Heartbeat logger stopped');
    }
  }
}

// Start the bot
const bot = new WebSocketTradingBot();

// Handle startup
bot.start().catch(error => {
  logger.error('Bot startup failed:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  await bot.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  await bot.stop();
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

export default bot;