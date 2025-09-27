import { webSocketFeed } from './services/webSocketFeed';
import { strategy } from './services/strategy';
import { telegramBot } from './services/telegramBot';
import { orderService } from './services/orderService';
import { healthServer } from './services/healthServer';
import { healthMonitor } from './services/healthMonitor';
import { performanceMonitor } from './services/performanceMonitor';
import { logger } from './utils/logger';
import { dailyCleanup } from './utils/dailyCleanup';
import { startupReset } from './utils/startupReset';
import { isMarketOpen, getTimeUntilMarketOpen, formatTimeUntilMarketOpen, getMarketStatus } from './utils/marketHours';
import { TradingStats } from './types';

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
  private lastHealthCheck = Date.now();
  private consecutiveErrors = 0;
  private readonly MAX_CONSECUTIVE_ERRORS = 5;

  public async start(): Promise<void> {
    try {
      logger.info('🚀 WebSocket Trading Bot Starting...');

      // ✅ STEP 1: COMPLETE STARTUP RESET - Everything fresh
      await startupReset.performFullReset();
      
      // Reset all service states
      strategy.resetState();
      orderService.resetState();
      
      // Validate fresh start
      await startupReset.validateFreshStart();

      // Start health server first
      healthServer.start();

      // 📊 Initialize performance monitoring
      performanceMonitor.initialize();

      // Initialize daily cleanup manager
      dailyCleanup.initialize();

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

      // 5. Initialize Health Monitor
      await healthMonitor.initialize();

      // 6. Send startup notification with reset confirmation
      await telegramBot.sendStartupMessage();
      await telegramBot.sendMessage('🔄 FRESH START: All data cleared, positions reset, statistics zeroed. Bot is completely fresh and ready for trading!');

      this.isRunning = true;
      logger.info('✅ All services initialized successfully with comprehensive monitoring');

    } catch (error) {
      logger.error('❌ Failed to start trading bot:', (error as Error).message);

      try {
        await telegramBot.sendMessage(`🚨 BOT STARTUP FAILED\n\nError: ${(error as Error).message}\n\nBot will retry in 30 seconds...`);
      } catch (telegramError) {
        logger.error('Failed to send startup error notification:', telegramError);
      }

      // Retry startup after 30 seconds instead of exiting
      logger.info('🔄 Retrying bot startup in 30 seconds...');
      setTimeout(() => {
        this.start().catch(retryError => {
          logger.error('❌ Bot startup retry failed:', retryError);
          // Final attempt - if this fails, then exit
          process.exit(1);
        });
      }, 30000);
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

      // ✅ FRESH START: Reset state when market opens
      strategy.resetState();
      orderService.resetState();

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
    dailyCleanup.stop();

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
      try {
        if (this.isRunning && isMarketOpen()) {
          const uptime = Math.floor((Date.now() - this.startTime) / 1000);
          const uptimeMinutes = Math.floor(uptime / 60);
          const uptimeHours = Math.floor(uptimeMinutes / 60);
          const displayMinutes = uptimeMinutes % 60;

          // Get market status with error handling
          let marketInfo = 'NSE: UNKNOWN';
          try {
            const marketStatus = getMarketStatus();
            marketInfo = marketStatus.nse ? 'NSE: OPEN' : 'NSE: CLOSED';
          } catch (marketError) {
            logger.debug('Market status check failed:', (marketError as Error).message);
          }

          logger.info(`💚 BOT WORKING - Runtime: ${uptimeHours}h ${displayMinutes}m | ${marketInfo} | Signals: ${this.stats.signals} | Status: MONITORING ALL CONDITIONS`);

          // Show current market conditions with error handling
          try {
            const marketConditions = await strategy.getCurrentMarketConditions();
            logger.info(marketConditions);

            // Reset error counter on successful operations
            this.consecutiveErrors = 0;
          } catch (error) {
            logger.debug('📊 Current Market Conditions: Error retrieving data -', (error as Error).message);
            this.consecutiveErrors++;
          }
        } else if (this.isRunning && !isMarketOpen()) {
          logger.info(`💛 BOT WORKING - Market: CLOSED | Status: WAITING FOR MARKET OPEN`);
        }
      } catch (heartbeatError) {
        logger.error('⚠️ Heartbeat error (continuing operation):', (heartbeatError as Error).message);
        this.consecutiveErrors++;

        // If too many consecutive errors, attempt recovery
        if (this.consecutiveErrors >= this.MAX_CONSECUTIVE_ERRORS) {
          logger.error(`🚨 Too many consecutive errors (${this.consecutiveErrors}), attempting service recovery...`);
          await this.attemptServiceRecovery();
        }
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

  private async attemptServiceRecovery(): Promise<void> {
    try {
      logger.info('🔧 Attempting automatic service recovery...');

      // Notify about recovery attempt
      try {
        await telegramBot.sendMessage(`🔧 AUTOMATIC RECOVERY\n\nDetected ${this.consecutiveErrors} consecutive errors.\nAttempting to restart services...\n\nBot will continue operating.`);
      } catch (telegramError) {
        logger.error('Failed to send recovery notification:', telegramError);
      }

      // Reset error counter
      this.consecutiveErrors = 0;

      // Restart critical services
      if (this.isRunning && isMarketOpen()) {
        logger.info('🔄 Reinitializing WebSocket connection...');
        try {
          webSocketFeed.disconnect();
          await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
          await webSocketFeed.initialize();
          logger.info('✅ WebSocket reinitialized successfully');
        } catch (wsError) {
          logger.error('❌ WebSocket reinitialization failed:', (wsError as Error).message);
        }

        logger.info('🔄 Resetting strategy state...');
        try {
          strategy.resetState();
          await strategy.initialize();
          logger.info('✅ Strategy reinitialized successfully');
        } catch (strategyError) {
          logger.error('❌ Strategy reinitialization failed:', (strategyError as Error).message);
        }

        logger.info('✅ Service recovery completed');

        try {
          await telegramBot.sendMessage(`✅ RECOVERY SUCCESSFUL\n\nAll services have been restarted.\nBot is back to normal operation.`);
        } catch (telegramError) {
          logger.error('Failed to send recovery success notification:', telegramError);
        }
      }

    } catch (recoveryError) {
      logger.error('❌ Service recovery failed:', (recoveryError as Error).message);

      try {
        await telegramBot.sendMessage(`❌ RECOVERY FAILED\n\nAutomatic recovery failed: ${(recoveryError as Error).message}\n\nBot will continue attempting to operate.`);
      } catch (telegramError) {
        logger.error('Failed to send recovery failure notification:', telegramError);
      }
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

// Handle uncaught exceptions with recovery
process.on('uncaughtException', async (error: Error) => {
  logger.error('⚠️ UNCAUGHT EXCEPTION - Attempting recovery:', error.message);
  logger.error('Stack trace:', error.stack);

  try {
    // Attempt to notify via Telegram
    await telegramBot.sendMessage(`🚨 CRITICAL ERROR - Bot attempting recovery\n\nError: ${error.message}\n\nBot will try to continue...`);
  } catch (telegramError) {
    logger.error('Failed to send error notification:', telegramError);
  }

  // Try to continue instead of exiting
  logger.info('🔄 Continuing operation after exception...');
});

process.on('unhandledRejection', async (reason: any, promise: Promise<any>) => {
  logger.error('⚠️ UNHANDLED REJECTION - Attempting recovery:', reason);

  try {
    // Attempt to notify via Telegram
    await telegramBot.sendMessage(`🚨 PROMISE REJECTION - Bot continuing\n\nReason: ${String(reason)}\n\nBot operation continues...`);
  } catch (telegramError) {
    logger.error('Failed to send rejection notification:', telegramError);
  }

  // Continue operation instead of exiting
  logger.info('🔄 Continuing operation after promise rejection...');
});

export default bot;