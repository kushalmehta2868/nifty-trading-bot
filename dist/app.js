"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const webSocketFeed_1 = require("./services/webSocketFeed");
const strategy_1 = require("./services/strategy");
const telegramBot_1 = require("./services/telegramBot");
const orderService_1 = require("./services/orderService");
const logger_1 = require("./utils/logger");
const config_1 = require("./config/config");
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
    }
    async start() {
        try {
            logger_1.logger.info('🚀 WebSocket Trading Bot Starting...');
            logger_1.logger.info(`Data Source: ${config_1.config.trading.useMockData ? 'Mock' : 'Live'} WebSocket`);
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
        this.dailySummaryTimeout = setTimeout(() => {
            telegramBot_1.telegramBot.sendDailySummary(this.stats);
            // Reset daily stats
            this.stats = { signals: 0, successful: 0, avgConfidence: 0 };
            orderService_1.orderService.resetDailyStats();
            // Schedule next day
            this.scheduleDailySummary();
        }, timeUntilSummary);
    }
    async stop() {
        logger_1.logger.info('🛑 WebSocket Trading Bot Stopping...');
        this.isRunning = false;
        // Clear scheduled timeouts
        if (this.dailySummaryTimeout) {
            clearTimeout(this.dailySummaryTimeout);
            this.dailySummaryTimeout = null;
        }
        // Disconnect services
        webSocketFeed_1.webSocketFeed.disconnect();
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