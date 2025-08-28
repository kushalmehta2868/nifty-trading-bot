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
        logger_1.logger.info('📱 Telegram bot initialized');
    }
    async sendTradingSignal(signal) {
        if (!this.bot) {
            logger_1.logger.warn('Telegram bot not configured, skipping signal');
            return;
        }
        try {
            const message = this.formatTradingSignal(signal);
            await this.bot.sendMessage(this.chatId, message, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            });
            logger_1.logger.info('📱 Trading signal sent to Telegram');
        }
        catch (error) {
            logger_1.logger.error('Failed to send Telegram message:', error.message);
        }
    }
    formatTradingSignal(signal) {
        const directionEmoji = signal.direction === 'UP' ? '🚀' : '🔻';
        const typeEmoji = signal.optionType === 'CE' ? '📈' : '📉';
        const sourceEmoji = signal.timestamp ? '⚡' : '🎭';
        return `
${directionEmoji} *New Setup: ${signal.direction === 'UP' ? 'BUY' : 'SELL'}*
${typeEmoji} *${signal.optionSymbol}*
*Trigger:* Above ₹${signal.entryPrice}

🎯 *POSITION ENTERED:*
*${signal.optionSymbol}*
*Entry:* ₹${signal.entryPrice}
*Tgt:* ₹${signal.target}, *SL:* ₹${signal.stopLoss}

📊 *Market Data:*
*${signal.indexName}:* ${signal.spotPrice}
*EMA${config_1.config.strategy.emaPeriod}:* ${signal.technicals.ema}
*RSI:* ${signal.technicals.rsi}
*Change:* ${signal.technicals.priceChange.toFixed(2)}%
*Confidence:* ${signal.confidence.toFixed(0)}%

${sourceEmoji} *Source:* ${config_1.config.trading.useMockData ? 'Mock' : 'Live'} WebSocket
⏰ *Time:* ${signal.timestamp.toLocaleTimeString()}
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

${config_1.config.trading.useMockData ? '🎭' : '⚡'} *Data Source:* ${config_1.config.trading.useMockData ? 'Mock' : 'Live'} WebSocket
📡 *Streaming:* NIFTY & Bank NIFTY  
🎯 *Strategy:* EMA${config_1.config.strategy.emaPeriod} + RSI${config_1.config.strategy.rsiPeriod} Breakouts
⚡ *Speed:* Real-time tick processing
🎚️ *Confidence:* ${config_1.config.strategy.confidenceThreshold}%+ signals only

*Configuration:*
• Auto Trade: ${config_1.config.trading.autoTrade ? 'Enabled' : 'Disabled'}
• Signal Cooldown: ${config_1.config.trading.signalCooldown / 60000} minutes
• Breakout Threshold: ${config_1.config.strategy.breakoutThreshold}%

*Ready to hunt for breakouts like Aug 26! 🎯*
            `.trim();
            await this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });
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
            await this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });
        }
        catch (error) {
            logger_1.logger.error('Failed to send daily summary:', error.message);
        }
    }
}
exports.telegramBot = new TelegramBotService();
//# sourceMappingURL=telegramBot.js.map