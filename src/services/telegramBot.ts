import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { TradingSignal, TradingStats } from '../types';

class TelegramBotService {
  private bot: TelegramBot | null = null;
  private chatId: string = '';
  private signalsToday = 0;

  constructor() {
    if (config.telegram.botToken) {
      this.bot = new TelegramBot(config.telegram.botToken, { polling: false });
      this.chatId = config.telegram.chatId;
    } else {
      logger.warn('Telegram bot token not configured');
    }
  }

  public async initialize(): Promise<void> {
    if (!this.bot) return;

    // Listen for trading signals
    (process as any).on('tradingSignal', async (signal: TradingSignal) => {
      await this.sendTradingSignal(signal);
      this.signalsToday++;
    });

    // Listen for order fills (entry executed)
    (process as any).on('orderFilled', async (data: { order: any, message: string }) => {
      await this.sendMessage(data.message);
    });

    // Listen for order exits (target/SL hit)
    (process as any).on('orderExited', async (data: { order: any, message: string }) => {
      await this.sendMessage(data.message);
    });

    // Listen for balance insufficient alerts
    (process as any).on('balanceInsufficient', async (data: { signal: any, message: string }) => {
      await this.sendMessage(data.message);
    });

    logger.info('📱 Telegram bot initialized with order monitoring and balance alerts');
  }

  public async sendMessage(message: string, options?: any): Promise<void> {
    if (!this.bot) {
      logger.warn('Telegram bot not configured, skipping message');
      return;
    }

    try {
      await this.bot.sendMessage(this.chatId, message, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        ...options
      });

      logger.info('📱 Message sent to Telegram');
    } catch (error) {
      logger.error('Failed to send Telegram message:', (error as Error).message);
    }
  }

  public async sendTradingSignal(signal: TradingSignal): Promise<void> {
    if (!this.bot) {
      logger.warn('Telegram bot not configured, skipping signal');
      return;
    }

    try {
      const message = this.formatTradingSignal(signal);
      await this.sendMessage(message);

      logger.info('📱 Trading signal sent to Telegram');
    } catch (error) {
      logger.error('Failed to send Telegram message:', (error as Error).message);
    }
  }

  private formatTradingSignal(signal: TradingSignal): string {
    const directionEmoji = signal.direction === 'UP' ? '🚀' : '🔻';
    const typeEmoji = signal.optionType === 'CE' ? '📈' : '📉';

    return `
${directionEmoji} *BRACKET ORDER PLACED*
${typeEmoji} *${signal.optionSymbol}*

🎯 *AUTOMATIC TRADING:*
*Entry:* ₹${signal.entryPrice} (MARKET BUY)
*Target:* ₹${signal.target} (Auto SELL)
*Stop Loss:* ₹${signal.stopLoss} (Auto SELL)
*Qty:* ${config.indices[signal.indexName].lotSize} lots

📊 *Market Data:*
*${signal.indexName}:* ${signal.spotPrice}
*EMA${config.strategy.emaPeriod}:* ${signal.technicals.ema}
*RSI:* ${signal.technicals.rsi}
*Change:* ${signal.technicals.priceChange.toFixed(2)}%
*Confidence:* ${signal.confidence.toFixed(0)}%

⚡ *Source:* Live Angel One WebSocket
⏰ *Time:* ${signal.timestamp.toLocaleTimeString()}
🤖 *Auto Exit:* Angel One will execute SELL orders automatically at Target/SL
        `.trim();
  }

  public async sendStartupMessage(): Promise<void> {
    if (!this.bot) {
      logger.warn('Telegram bot not configured, skipping startup message');
      return;
    }

    try {
      // First verify bot and chat
      const botInfo = await this.bot.getMe();
      logger.info(`📱 Telegram bot verified: @${botInfo.username}`);

      const message = `
🤖 *WebSocket Trading Bot Started*

⚡ *Data Source:* Live Angel One WebSocket
📡 *Streaming:* NIFTY & Bank NIFTY  
🎯 *Strategy:* EMA${config.strategy.emaPeriod} + RSI${config.strategy.rsiPeriod} Breakouts
⚡ *Speed:* Real-time tick processing
🎚️ *Confidence:* ${config.strategy.confidenceThreshold}%+ signals only
💰 *Prices:* Real option premiums from Angel One

*Configuration:*
• Auto Trade: ${config.trading.autoTrade ? 'Enabled' : 'Disabled'}
• Signal Cooldown: ${config.trading.signalCooldown / 60000} minutes
• Breakout Threshold: ${config.strategy.breakoutThreshold}%

*Ready to hunt for real breakouts with live data! 🎯*
            `.trim();

      await this.sendMessage(message);
      logger.info('📱 Startup message sent to Telegram');

    } catch (error) {
      logger.error('Failed to send startup message:', (error as Error).message);

      if ((error as Error).message.includes('401 Unauthorized')) {
        logger.error('❌ Invalid Telegram bot token. Please check TELEGRAM_BOT_TOKEN in .env');
      } else if ((error as Error).message.includes('400 Bad Request') &&
        (error as Error).message.includes('chat not found')) {
        logger.error('❌ Invalid chat ID or bot not added to chat.');
        logger.error('🔧 To fix this:');
        logger.error('   1. Start a chat with your bot on Telegram');
        logger.error('   2. Send any message to the bot');
        logger.error('   3. Get your chat ID from https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates');
        logger.error('   4. Update TELEGRAM_CHAT_ID in your .env file');
      } else if ((error as Error).message.includes('403 Forbidden')) {
        logger.error('❌ Bot blocked by user or insufficient permissions');
      }
    }
  }

  public async sendDailySummary(stats: TradingStats): Promise<void> {
    if (!this.bot) return;

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
    } catch (error) {
      logger.error('Failed to send daily summary:', (error as Error).message);
    }
  }
}

export const telegramBot = new TelegramBotService();