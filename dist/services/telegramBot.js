"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.telegramBot = void 0;
const node_telegram_bot_api_1 = __importDefault(require("node-telegram-bot-api"));
const config_1 = require("../config/config");
const logger_1 = require("../utils/logger");
class TelegramBotService {
    constructor() {
        this.bot = null;
        this.chatId = '';
        this.signalsToday = 0;
        if (config_1.config.telegram.botToken) {
            this.bot = new node_telegram_bot_api_1.default(config_1.config.telegram.botToken, { polling: false });
            this.chatId = config_1.config.telegram.chatId;
        }
        else {
            logger_1.logger.warn('Telegram bot token not configured');
        }
    }
    async initialize() {
        if (!this.bot)
            return;
        // Listen for trading signals
        process.on('tradingSignal', async (signal) => {
            await this.sendTradingSignal(signal);
            this.signalsToday++;
        });
        // Listen for order placement confirmations
        process.on('orderPlaced', async (data) => {
            const tradeType = data.isPaperTrade ? '📄 Paper' : '💰 Real';
            const message = `✅ *ORDER PLACED* ${tradeType}\n📋 *Order ID:* ${data.orderId}\n📈 *Symbol:* ${data.signal.optionSymbol}\n⏰ *Time:* ${new Date().toLocaleTimeString()}`;
            await this.sendMessage(message);
        });
        // Listen for order fills (entry executed)
        process.on('orderFilled', async (data) => {
            await this.sendMessage(data.message);
        });
        // Listen for order exits (target/SL hit)
        process.on('orderExited', async (data) => {
            await this.sendMessage(data.message);
        });
        // Listen for balance insufficient alerts
        process.on('balanceInsufficient', async (data) => {
            await this.sendMessage(data.message);
        });
        logger_1.logger.info('📱 Telegram bot initialized with order monitoring and balance alerts');
    }
    async sendMessage(message, options) {
        if (!this.bot) {
            logger_1.logger.warn('Telegram bot not configured, skipping message');
            return;
        }
        try {
            await this.bot.sendMessage(this.chatId, message, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true,
                ...options
            });
            logger_1.logger.info('📱 Message sent to Telegram');
        }
        catch (error) {
            logger_1.logger.error('Failed to send Telegram message:', error.message);
        }
    }
    async sendTradingSignal(signal) {
        if (!this.bot) {
            logger_1.logger.warn('Telegram bot not configured, skipping signal');
            return;
        }
        try {
            const message = this.formatTradingSignal(signal);
            await this.sendMessage(message);
            logger_1.logger.info('📱 Trading signal sent to Telegram');
        }
        catch (error) {
            logger_1.logger.error('Failed to send Telegram message:', error.message);
        }
    }
    formatTradingSignal(signal) {
        const directionEmoji = signal.direction === 'UP' ? '🚀' : '🔻';
        const typeEmoji = signal.optionType === 'CE' ? '📈' : '📉';
        const tradingMode = config_1.config.trading.paperTrading ? '📄 PAPER' : '💰 REAL';
        const orderType = config_1.config.trading.paperTrading ? 'PAPER ORDER PLACED' : 'BRACKET ORDER PLACED';
        const exitText = config_1.config.trading.paperTrading ?
            '📄 *Paper Exit:* Monitored by real market prices' :
            '🤖 *Auto Exit:* Angel One will execute SELL orders automatically at Target/SL';
        return `
${directionEmoji} *${orderType}* ${tradingMode}
${typeEmoji} *${signal.optionSymbol}*

🎯 *TRADING SETUP:*
*Entry:* ₹${signal.entryPrice} (MARKET BUY)
*Target:* ₹${signal.target} (Auto SELL)
*Stop Loss:* ₹${signal.stopLoss} (Auto SELL)
*Qty:* ${config_1.config.indices[signal.indexName].lotSize} lots

📊 *Market Data:*
*${signal.indexName}:* ${signal.spotPrice}
*EMA${config_1.config.strategy.emaPeriod}:* ${signal.technicals.ema}
*RSI:* ${signal.technicals.rsi}
*Change:* ${signal.technicals.priceChange.toFixed(2)}%
*Confidence:* ${signal.confidence.toFixed(0)}%

⚡ *Source:* Live Angel One WebSocket
⏰ *Time:* ${signal.timestamp.toLocaleTimeString()}
${exitText}
        `.trim();
    }
    async sendStartupMessage() {
        if (!this.bot) {
            logger_1.logger.warn('Telegram bot not configured, skipping startup message');
            return;
        }
        try {
            // First verify bot and chat
            const botInfo = await this.bot.getMe();
            logger_1.logger.info(`📱 Telegram bot verified: @${botInfo.username}`);
            const message = `
🤖 *WebSocket Trading Bot Started*

⚡ *Data Source:* Live Angel One WebSocket
📡 *Streaming:* NIFTY & Bank NIFTY  
🎯 *Strategy:* EMA${config_1.config.strategy.emaPeriod} + RSI${config_1.config.strategy.rsiPeriod} Breakouts
⚡ *Speed:* Real-time tick processing
🎚️ *Confidence:* ${config_1.config.strategy.confidenceThreshold}%+ signals only
💰 *Prices:* Real option premiums from Angel One

*Configuration:*
• Auto Trade: ${config_1.config.trading.autoTrade ? 'Enabled' : 'Disabled'}
• Trading Mode: ${config_1.config.trading.paperTrading ? '📄 Paper Trading' : '💰 Real Trading'}
• Signal Cooldown: ${config_1.config.trading.signalCooldown / 60000} minutes
• Breakout Threshold: ${config_1.config.strategy.breakoutThreshold}%

${config_1.config.trading.paperTrading ?
                '*Ready for paper trading with real data! 📄*' :
                '*Ready to hunt for real breakouts with live data! 🎯*'}
            `.trim();
            await this.sendMessage(message);
            logger_1.logger.info('📱 Startup message sent to Telegram');
        }
        catch (error) {
            logger_1.logger.error('Failed to send startup message:', error.message);
            if (error.message.includes('401 Unauthorized')) {
                logger_1.logger.error('❌ Invalid Telegram bot token. Please check TELEGRAM_BOT_TOKEN in .env');
            }
            else if (error.message.includes('400 Bad Request') &&
                error.message.includes('chat not found')) {
                logger_1.logger.error('❌ Invalid chat ID or bot not added to chat.');
                logger_1.logger.error('🔧 To fix this:');
                logger_1.logger.error('   1. Start a chat with your bot on Telegram');
                logger_1.logger.error('   2. Send any message to the bot');
                logger_1.logger.error('   3. Get your chat ID from https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates');
                logger_1.logger.error('   4. Update TELEGRAM_CHAT_ID in your .env file');
            }
            else if (error.message.includes('403 Forbidden')) {
                logger_1.logger.error('❌ Bot blocked by user or insufficient permissions');
            }
        }
    }
    async sendDailySummary(stats) {
        if (!this.bot)
            return;
        try {
            const message = `
📊 *Daily Trading Summary*

*Signals Generated:* ${stats.signals}
*Successful Setups:* ${stats.successful || 0}
*Win Rate:* ${stats.winRate || 0}%
*Best Signal:* ${stats.bestSignal || 'N/A'}

*Performance:*
• Avg Confidence: ${stats.avgConfidence || 0}%
• Peak Signal Time: ${stats.peakTime || 'N/A'}

*Bot Uptime:* ${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m

*Tomorrow's target: Beat Aug 26 performance! 🚀*
            `.trim();
            await this.sendMessage(message);
        }
        catch (error) {
            logger_1.logger.error('Failed to send daily summary:', error.message);
        }
    }
}
exports.telegramBot = new TelegramBotService();
//# sourceMappingURL=telegramBot.js.map