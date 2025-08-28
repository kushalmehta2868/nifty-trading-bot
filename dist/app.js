"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const webSocketFeed_1 = require("./services/webSocketFeed");
const strategy_1 = require("./services/strategy");
const telegramBot_1 = require("./services/telegramBot");
const orderService_1 = require("./services/orderService");
const healthServer_1 = require("./services/healthServer");
const logger_1 = require("./utils/logger");
const config_1 = require("./config/config");
const marketHours_1 = require("./utils/marketHours");
class WebSocketTradingBot {
    constructor() {
        this.isRunning = false;
        this.startTime = Date.now();
        this.stats = {
            signals: 0,
            successful: 0,
            avgConfidence: 0
        };
        this.dailySummaryTimeout = null;
        this.marketOpenTimeout = null;
    }
    async start() {
        try {
            logger_1.logger.info('🚀 WebSocket Trading Bot Starting...');
            logger_1.logger.info(`Data Source: ${config_1.config.trading.useMockData ? 'Mock' : 'Live'} WebSocket`);
            // Start health server first (for Render keep-alive)
            healthServer_1.healthServer.start();
            // Check market hours
            if (!(0, marketHours_1.isMarketOpen)()) {
                const timeUntilOpen = (0, marketHours_1.formatTimeUntilMarketOpen)();
                logger_1.logger.info(`📅 Market is closed - ${timeUntilOpen}`);
                await telegramBot_1.telegramBot.initialize();
                await telegramBot_1.telegramBot.sendMessage(`🕒 Bot started but market is closed\n${timeUntilOpen}\n\nBot will activate when market opens.`);
                this.scheduleMarketOpen();
                return;
            }
            // Initialize all services
            await webSocketFeed_1.webSocketFeed.initialize();
            await strategy_1.strategy.initialize();
            await telegramBot_1.telegramBot.initialize();
            await orderService_1.orderService.initialize();
            // Track signals for stats
            process.on('tradingSignal', (signal) => {
                this.stats.signals++;
                this.stats.avgConfidence = this.stats.avgConfidence ?
                    (this.stats.avgConfidence * (this.stats.signals - 1) + signal.confidence) / this.stats.signals :
                    signal.confidence;
            });
            // Send startup notification
            await telegramBot_1.telegramBot.sendStartupMessage();
            // Schedule daily summary
            this.scheduleDailySummary();
            // Schedule market close check
            this.scheduleMarketClose();
            this.isRunning = true;
            logger_1.logger.info('✅ WebSocket Trading Bot Running - Monitoring Live Market');
            logger_1.logger.info('🎯 Waiting for breakout signals...');
        }
        catch (error) {
            logger_1.logger.error('Failed to start WebSocket trading bot:', error.message);
            process.exit(1);
        }
    }
    scheduleDailySummary() {
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(now.getDate() + 1);
        tomorrow.setHours(17, 0, 0, 0); // 5 PM daily summary
        const timeUntilSummary = tomorrow.getTime() - now.getTime();
        this.dailySummaryTimeout = setTimeout(async () => {
            // Send trading summary
            await telegramBot_1.telegramBot.sendDailySummary(this.stats);
            // Send balance summary
            const balanceSummary = await orderService_1.orderService.getDailyBalanceSummary();
            await telegramBot_1.telegramBot.sendMessage(balanceSummary);
            // Reset daily stats
            this.stats = { signals: 0, successful: 0, avgConfidence: 0 };
            orderService_1.orderService.resetDailyStats();
            // Schedule next day
            this.scheduleDailySummary();
        }, timeUntilSummary);
    }
    scheduleMarketOpen() {
        const timeUntilOpen = (0, marketHours_1.getTimeUntilMarketOpen)();
        logger_1.logger.info(`⏰ Scheduling bot activation in ${Math.floor(timeUntilOpen / (1000 * 60 * 60))}h ${Math.floor((timeUntilOpen % (1000 * 60 * 60)) / (1000 * 60))}m`);
        this.marketOpenTimeout = setTimeout(async () => {
            logger_1.logger.info('🔔 Market opening - Activating trading bot');
            await telegramBot_1.telegramBot.sendMessage('🔔 Market is now open - Bot is activating!');
            // Initialize trading services
            await webSocketFeed_1.webSocketFeed.initialize();
            await strategy_1.strategy.initialize();
            await orderService_1.orderService.initialize();
            this.isRunning = true;
            this.scheduleMarketClose();
            logger_1.logger.info('✅ Trading bot activated for market hours');
        }, timeUntilOpen);
    }
    scheduleMarketClose() {
        // Check every hour if market is still open
        const checkMarketStatus = () => {
            if (!(0, marketHours_1.isMarketOpen)() && this.isRunning) {
                logger_1.logger.info('🔔 Market closed - Deactivating trading bot');
                telegramBot_1.telegramBot.sendMessage('🔔 Market closed - Bot deactivated until next trading session');
                // Disconnect trading services but keep bot running
                webSocketFeed_1.webSocketFeed.disconnect();
                this.isRunning = false;
                // Schedule next market open
                this.scheduleMarketOpen();
            }
            else if ((0, marketHours_1.isMarketOpen)()) {
                // Schedule next check in 1 hour
                setTimeout(checkMarketStatus, 60 * 60 * 1000);
            }
        };
        // Initial check in 1 hour
        setTimeout(checkMarketStatus, 60 * 60 * 1000);
    }
    async stop() {
        logger_1.logger.info('🛑 WebSocket Trading Bot Stopping...');
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
        // Disconnect services
        webSocketFeed_1.webSocketFeed.disconnect();
        orderService_1.orderService.stopMonitoring();
        healthServer_1.healthServer.stop();
        const uptime = Math.floor((Date.now() - this.startTime) / 1000);
        logger_1.logger.info(`Bot ran for ${uptime} seconds`);
        logger_1.logger.info(`Generated ${this.stats.signals} signals today`);
        logger_1.logger.info('✅ WebSocket Trading Bot Stopped');
    }
    getStats() {
        return { ...this.stats };
    }
    isActive() {
        return this.isRunning;
    }
}
// Start the bot
const bot = new WebSocketTradingBot();
// Handle startup
bot.start().catch(error => {
    logger_1.logger.error('Bot startup failed:', error);
    process.exit(1);
});
// Graceful shutdown
process.on('SIGINT', async () => {
    logger_1.logger.info('Received SIGINT, shutting down gracefully...');
    await bot.stop();
    process.exit(0);
});
process.on('SIGTERM', async () => {
    logger_1.logger.info('Received SIGTERM, shutting down gracefully...');
    await bot.stop();
    process.exit(0);
});
// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    logger_1.logger.error('Uncaught Exception:', error);
    process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
    logger_1.logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});
exports.default = bot;
//# sourceMappingURL=app.js.map