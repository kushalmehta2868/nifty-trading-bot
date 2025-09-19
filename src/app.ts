import { webSocketFeed } from './services/webSocketFeed';
import { strategy } from './services/strategy';
import { telegramBot } from './services/telegramBot';
import { orderService } from './services/orderService';
import { healthServer } from './services/healthServer';
import { healthMonitor } from './services/healthMonitor';
import { angelAPI } from './services/angelAPI';
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
  private memoryCheckInterval: NodeJS.Timeout | null = null;

  public async start(): Promise<void> {
    try {
      console.log('🚀 WebSocket Trading Bot Starting...'); // Direct console log for visibility

      // Check initial memory and force early GC
      if (global.gc) {
        global.gc();
        global.gc();
      }
      const initialMem = process.memoryUsage();
      console.log(`📊 Initial Memory: ${Math.round(initialMem.rss / 1024 / 1024)}MB RSS, Heap: ${Math.round(initialMem.heapUsed / 1024 / 1024)}MB`);

      if (initialMem.rss > 50 * 1024 * 1024) { // 50MB
        console.error(`🚨 STARTUP MEMORY TOO HIGH: ${Math.round(initialMem.rss / 1024 / 1024)}MB - shutting down`);
        process.exit(1);
      }

      logger.info('🚀 WebSocket Trading Bot Starting...');

      // ✅ STEP 1: Skip expensive startup reset in production to save memory
      if (process.env.NODE_ENV !== 'production') {
        await startupReset.performFullReset();
        await startupReset.validateFreshStart();
      }

      // Reset all service states
      strategy.resetState();
      orderService.resetState();

      // Check memory after reset
      const afterResetMem = process.memoryUsage();
      console.log(`📊 After Reset: ${Math.round(afterResetMem.rss / 1024 / 1024)}MB RSS`);

      // Skip health server in production to save memory
      if (process.env.NODE_ENV !== 'production') {
        healthServer.start();
      }

      // Skip daily cleanup manager in production to save memory
      if (process.env.NODE_ENV !== 'production') {
        dailyCleanup.initialize();
      }

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
      console.log('✅ WebSocket initialized');

      // Check memory after WebSocket
      const afterWSMem = process.memoryUsage();
      console.log(`📊 After WebSocket: ${Math.round(afterWSMem.rss / 1024 / 1024)}MB RSS`);

      // 2. Reduce wait time to save memory
      await new Promise(resolve => setTimeout(resolve, 5000)); // Reduced to 5 seconds

      // 3. Initialize strategy AFTER WebSocket has collected sufficient data
      await strategy.initialize();
      console.log('✅ Strategy initialized');

      // Check memory after strategy
      const afterStrategyMem = process.memoryUsage();
      console.log(`📊 After Strategy: ${Math.round(afterStrategyMem.rss / 1024 / 1024)}MB RSS`);

      // 4. Initialize other services
      await telegramBot.initialize();
      await orderService.initialize();

      // Check memory after services
      const afterServicesMem = process.memoryUsage();
      console.log(`📊 After Services: ${Math.round(afterServicesMem.rss / 1024 / 1024)}MB RSS`);

      // 5. Skip Health Monitor in production to save memory
      if (process.env.NODE_ENV !== 'production') {
        await healthMonitor.initialize();
      }

      // 6. Send startup notification
      await telegramBot.sendStartupMessage();
      if (process.env.NODE_ENV !== 'production') {
        await telegramBot.sendMessage('🔄 FRESH START: All data cleared, positions reset, statistics zeroed. Bot is completely fresh and ready for trading!');
      }

      this.isRunning = true;
      this.startMemoryMonitoring();

      // Final memory check
      const finalMem = process.memoryUsage();
      console.log(`📊 Final Startup Memory: ${Math.round(finalMem.rss / 1024 / 1024)}MB RSS`);

      if (finalMem.rss > 40 * 1024 * 1024) { // 40MB
        console.error(`🚨 STARTUP MEMORY LEAK DETECTED: ${Math.round(finalMem.rss / 1024 / 1024)}MB - performing emergency cleanup`);
        this.performEmergencyCleanup();
      }

      console.log('✅ All services initialized with memory monitoring');

    } catch (error) {
      console.error('❌ STARTUP FAILED:', (error as Error).message); // Direct console error
      logger.error('Failed to start trading bot:', (error as Error).message);
      console.error('Stack trace:', (error as Error).stack); // Full stack trace
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

    // Stop heartbeat and memory monitoring
    this.stopHeartbeat();
    this.stopMemoryMonitoring();

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

  // ✅ Ultra-aggressive memory monitoring for Render
  private startMemoryMonitoring(): void {
    this.memoryCheckInterval = setInterval(() => {
      this.checkMemoryUsage();
    }, 10000); // Check every 10 seconds (maximum aggression)

    console.log('🧠 Started maximum aggressive memory monitoring');
  }

  private checkMemoryUsage(): void {
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
    const rssMB = Math.round(memUsage.rss / 1024 / 1024);

    // Log memory usage only via console to avoid logger overhead
    console.log(`🧠 Memory: ${heapUsedMB}MB used / ${heapTotalMB}MB heap / ${rssMB}MB RSS`);

    // Ultra-aggressive cleanup at 25MB for Render free tier
    if (rssMB > 25) {
      logger.warn(`⚠️ HIGH MEMORY USAGE: ${rssMB}MB RSS - triggering cleanup`);
      this.performEmergencyCleanup();

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
        const afterGC = process.memoryUsage();
        const newRSS = Math.round(afterGC.rss / 1024 / 1024);
        logger.info(`🧹 Garbage collection: ${rssMB}MB → ${newRSS}MB RSS`);
      }
    }

    // Critical memory threshold (above 35MB - ultra-low for Render)
    if (rssMB > 35) {
      logger.error(`🚨 CRITICAL MEMORY USAGE: ${rssMB}MB - performing emergency cleanup!`);
      this.performEmergencyCleanup();

      // Force multiple aggressive GC cycles
      if (global.gc) {
        for (let i = 0; i < 5; i++) {
          global.gc();
          setTimeout(() => global.gc && global.gc(), 100); // Delayed GC
        }
      }

      // Emergency shutdown if still above critical threshold after cleanup
      setTimeout(() => {
        const afterCleanup = process.memoryUsage();
        const finalRSS = Math.round(afterCleanup.rss / 1024 / 1024);
        if (finalRSS > 40) {
          console.error(`🚨 EMERGENCY SHUTDOWN: Memory still at ${finalRSS}MB after cleanup`);
          process.exit(1);
        }
      }, 5000);
    }
  }

  private performEmergencyCleanup(): void {
    logger.warn('🚨 EMERGENCY CLEANUP: Ultra-aggressively clearing memory...');

    try {
      // Reset all service states to clear accumulated data
      strategy.resetState();
      orderService.resetState();

      // Clear WebSocket data buffers
      webSocketFeed.clearDataBuffers();

      // Clear caches in AngelAPI
      angelAPI.stopCacheCleanup();
      angelAPI.clearAllCaches();

      // Clear any global variables that might hold references
      if (global.gc) {
        global.gc();
      }

      // Clear internal stats to free memory
      this.stats = { signals: 0, successful: 0, avgConfidence: 0 };

      logger.info('✅ Ultra-aggressive emergency cleanup completed');
    } catch (error) {
      logger.error('❌ Emergency cleanup failed:', (error as Error).message);
    }
  }

  private stopMemoryMonitoring(): void {
    if (this.memoryCheckInterval) {
      clearInterval(this.memoryCheckInterval);
      this.memoryCheckInterval = null;
      logger.debug('🛑 Stopped memory monitoring');
    }
  }
}

// Start the bot
console.log('🔄 Initializing WebSocket Trading Bot...');
const bot = new WebSocketTradingBot();

// Handle startup
console.log('🚀 Starting bot initialization...');
bot.start().catch(error => {
  console.error('❌ Bot startup failed:', error.message);
  console.error('Stack:', error.stack);
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

// Handle uncaught exceptions - don't exit to prevent server restarts
process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught Exception (non-fatal):', error);
  // Don't exit - just log and continue running
});

process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  logger.error('Unhandled Rejection (non-fatal) at:', promise, 'reason:', reason);
  // Don't exit - just log and continue running
});

export default bot;