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

    // Listen for order placement confirmations
    (process as any).on('orderPlaced', async (data: { signal: any, orderId: string, isPaperTrade?: boolean }) => {
      const tradeType = data.isPaperTrade ? '📄 Paper' : '💰 Real';
      const message = `✅ *ORDER PLACED* ${tradeType}\n📋 *Order ID:* ${data.orderId}\n📈 *Symbol:* ${data.signal.optionSymbol}\n⏰ *Time:* ${new Date().toLocaleTimeString()}`;
      await this.sendMessage(message);
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
    const tradingMode = config.trading.paperTrading ? '📄 PAPER' : '💰 REAL';
    const orderType = config.trading.paperTrading ? 'PAPER ORDER PLACED' : 'BRACKET ORDER PLACED';
    const exitText = config.trading.paperTrading ?
      '📄 *Paper Exit:* Monitored by real market prices' :
      '🤖 *Auto Exit:* Angel One will execute SELL orders automatically at Target/SL';

    return `
${directionEmoji} *${orderType}* ${tradingMode}
${typeEmoji} *${signal.optionSymbol}*

🎯 *TRADING SETUP:*
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
${exitText}
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

      // Import the market status functions
      const { getMarketStatus, isNSEMarketOpen, isMCXMarketOpen } = require('../utils/marketHours');

      // Get current market status
      const marketStatus = getMarketStatus();
      const currentTime = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });

      // Determine market info based on current status
      let marketInfo = '';
      let marketStatusText = '';

      if (marketStatus.nse && marketStatus.mcx) {
        marketInfo = '📡 *Streaming:* NIFTY, Bank NIFTY, GOLD & SILVER';
        marketStatusText = '🟢 *All Markets Open* (NSE + MCX)';
      } else if (marketStatus.nse && !marketStatus.mcx) {
        marketInfo = '📡 *Streaming:* NIFTY & Bank NIFTY (Active), GOLD & SILVER (Waiting)';
        marketStatusText = '🟡 *NSE Open, MCX Closed*';
      } else if (!marketStatus.nse && marketStatus.mcx) {
        marketInfo = '📡 *Streaming:* GOLD & SILVER (Active), NIFTY & Bank NIFTY (Waiting)';
        marketStatusText = '🟡 *MCX Open, NSE Closed*';
      } else {
        marketInfo = '📡 *Streaming:* All Markets Waiting';
        marketStatusText = '🔴 *All Markets Closed*';
      }

      // Determine active instruments count
      const activeInstruments = (marketStatus.nse ? 2 : 0) + (marketStatus.mcx ? 2 : 0);
      const totalInstruments = 4;

      const message = `
🤖 *Multi-Market Trading Bot Started*

⚡ *Data Source:* Live Angel One WebSocket
${marketInfo}
${marketStatusText}

📊 *Current Status (${currentTime}):*
*Active Instruments:* ${activeInstruments}/${totalInstruments}
*NSE Status:* ${marketStatus.nse ? '🟢 OPEN' : '🔴 CLOSED'}
*MCX Status:* ${marketStatus.mcx ? '🟢 OPEN' : '🔴 CLOSED'}

🎯 *Strategy:* Multi-Market Breakout Trading
*Target Instruments:*
• NIFTY & Bank NIFTY (NSE Options)
• GOLD & SILVER (MCX Options)

⏰ *Market Hours:*
• NSE: 9:15 AM - 3:30 PM
• MCX: 9:00 AM - 11:30 PM

🔧 *Configuration:*
• Auto Trade: ${config.trading.autoTrade ? '✅ Enabled' : '❌ Disabled'}
• Trading Mode: ${config.trading.paperTrading ? '📄 Paper Trading' : '💰 Real Trading'}
• Signal Cooldown: ${config.trading.signalCooldown / 60000} minutes
• Confidence Threshold: ${config.strategy.confidenceThreshold}%+

⚡ *Technical Analysis:*
• EMA${config.strategy.emaPeriod} + RSI${config.strategy.rsiPeriod} Breakouts
• Real-time tick processing
• Volume surge detection
• IV rank analysis

${config.trading.paperTrading ?
          '*🎯 Ready for multi-market paper trading with real data!*' :
          '*🚀 Ready to hunt for breakouts across NSE & MCX markets!*'}

${!marketStatus.any ?
          '\n⏳ *Bot will activate automatically when markets open*' :
          '\n✅ *Bot is actively monitoring for trading signals*'}
`.trim();

      await this.sendMessage(message);
      logger.info('📱 Multi-market startup message sent to Telegram');

    } catch (error) {
      logger.error('Failed to send startup message:', (error as Error).message);

      // Enhanced error handling
      if ((error as Error).message.includes('401 Unauthorized')) {
        logger.error('❌ Invalid Telegram bot token. Please check TELEGRAM_BOT_TOKEN in .env');
      } else if ((error as Error).message.includes('400 Bad Request') &&
        (error as Error).message.includes('chat not found')) {
        logger.error('❌ Invalid chat ID or bot not added to chat.');
        logger.error('🔧 To fix this:');
        logger.error(' 1. Start a chat with your bot on Telegram');
        logger.error(' 2. Send any message to the bot');
        logger.error(' 3. Get your chat ID from https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates');
        logger.error(' 4. Update TELEGRAM_CHAT_ID in your .env file');
      } else if ((error as Error).message.includes('403 Forbidden')) {
        logger.error('❌ Bot blocked by user or insufficient permissions');
      } else {
        logger.error('❌ Unexpected Telegram API error - check network connection');
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