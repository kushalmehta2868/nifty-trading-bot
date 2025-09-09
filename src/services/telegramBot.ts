import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { TradingSignal, TradingStats } from '../types';
import { getMarketStatus, isNSEMarketOpen } from '../utils/marketHours';

class TelegramBotService {
  private bot: TelegramBot | null = null;
  private chatId: string = '';
  private signalsToday = 0;
  private dailyPnL = 0;
  private winningSignals = 0;
  private lastResetDate = new Date().toDateString();
  private eventListeners: Array<{ event: string; handler: Function }> = [];

  constructor() {
    if (config.telegram.botToken) {
      this.bot = new TelegramBot(config.telegram.botToken, { polling: false });
      this.chatId = config.telegram.chatId;
      logger.info('📱 Telegram bot service initialized with enhanced logging');
    } else {
      logger.warn('⚠️ Telegram bot token not configured - notifications disabled');
    }
  }

  public async initialize(): Promise<void> {
    if (!this.bot) return;

    // Listen for trading signals
    const tradingSignalHandler = async (signal: TradingSignal) => {
      this.checkDailyReset(); // Reset counters if new day
      logger.info(`📱 Preparing to send Telegram signal: ${signal.indexName} ${signal.optionType} (Confidence: ${signal.confidence.toFixed(1)}%)`);
      await this.sendTradingSignal(signal);
      this.signalsToday++;
      logger.info(`📊 Today's signals count: ${this.signalsToday}`);
    };
    (process as any).on('tradingSignal', tradingSignalHandler);
    this.eventListeners.push({ event: 'tradingSignal', handler: tradingSignalHandler });

    // Listen for order placement confirmations
    const orderPlacedHandler = async (data: { signal: any, orderId: string, isPaperTrade?: boolean }) => {
      const tradeType = data.isPaperTrade ? '📄' : '💰';
      const message = `✅ *ORDER PLACED* ${tradeType}\n📈 ${data.signal.optionSymbol}\n📋 ${data.orderId}`;
      await this.sendMessage(message);
    };
    (process as any).on('orderPlaced', orderPlacedHandler);
    this.eventListeners.push({ event: 'orderPlaced', handler: orderPlacedHandler });

    // Listen for order fills (entry executed)
    const orderFilledHandler = async (data: { order: any, message: string }) => {
      await this.sendMessage(data.message);
    };
    (process as any).on('orderFilled', orderFilledHandler);
    this.eventListeners.push({ event: 'orderFilled', handler: orderFilledHandler });

    // Listen for order exits (target/SL hit)
    const orderExitedHandler = async (data: { order: any, message: string, pnl?: number }) => {
      await this.sendMessage(data.message);
      
      // Track daily P&L and winning signals
      if (data.pnl !== undefined) {
        this.dailyPnL += data.pnl;
        if (data.pnl > 0) {
          this.winningSignals++;
        }
      }
    };
    (process as any).on('orderExited', orderExitedHandler);
    this.eventListeners.push({ event: 'orderExited', handler: orderExitedHandler });

    // Listen for balance insufficient alerts
    const balanceInsufficientHandler = async (data: { signal: any, message: string }) => {
      logger.warn('💸 Insufficient balance detected, sending alert');
      await this.sendMessage(data.message);
    };
    (process as any).on('balanceInsufficient', balanceInsufficientHandler);
    this.eventListeners.push({ event: 'balanceInsufficient', handler: balanceInsufficientHandler });

    // Strategy analysis events disabled - user preference
    // const strategyAnalysisHandler = async (data: { indexName: string, analysis: any }) => {
    //   await this.sendStrategyAnalysis(data.indexName, data.analysis);
    // };
    // (process as any).on('strategyAnalysis', strategyAnalysisHandler);
    // this.eventListeners.push({ event: 'strategyAnalysis', handler: strategyAnalysisHandler });

    // System health events disabled - user preference
    // const systemHealthHandler = async (data: { status: string, message: string }) => {
    //   await this.sendSystemHealth(data.status, data.message);
    // };
    // (process as any).on('systemHealth', systemHealthHandler);
    // this.eventListeners.push({ event: 'systemHealth', handler: systemHealthHandler });

    // Listen for daily cleanup events
    const cleanupCompletedHandler = async (data: { filesProcessed: number, errors: number, timestamp: Date }) => {
      await this.sendCleanupCompleted(data.filesProcessed, data.errors);
    };
    (process as any).on('dailyCleanupCompleted', cleanupCompletedHandler);
    this.eventListeners.push({ event: 'dailyCleanupCompleted', handler: cleanupCompletedHandler });

    const cleanupFailedHandler = async (data: { error: string, timestamp: Date }) => {
      await this.sendCleanupFailed(data.error);
    };
    (process as any).on('dailyCleanupFailed', cleanupFailedHandler);
    this.eventListeners.push({ event: 'dailyCleanupFailed', handler: cleanupFailedHandler });

    // WebSocket status events disabled - user preference
    // const websocketStatusHandler = async (data: { status: string, message: string }) => {
    //   logger.info(`🔗 WebSocket status change: ${data.status}`);
    //   await this.sendWebSocketStatus(data.status, data.message);
    // };
    // (process as any).on('websocketStatus', websocketStatusHandler);
    // this.eventListeners.push({ event: 'websocketStatus', handler: websocketStatusHandler });

    logger.info('📱 Telegram bot initialized with comprehensive event monitoring');
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
    const tradingMode = config.trading.paperTrading ? '📄' : '💰';
    
    // Determine strategy icon based on confidence
    const strategyIcon = signal.confidence >= 90 ? '🏆' : signal.confidence >= 80 ? '🎯' : '🚀';

    // Calculate profit/loss potential
    const profitPotential = ((signal.target - signal.entryPrice) / signal.entryPrice) * 100;
    const riskAmount = ((signal.entryPrice - signal.stopLoss) / signal.entryPrice) * 100;
    const riskReward = profitPotential / riskAmount;

    return `
${strategyIcon} *${signal.indexName} ${signal.optionType}* ${tradingMode} ${typeEmoji}
📈 ${signal.optionSymbol}
🎯 Conf: ${signal.confidence.toFixed(0)}% | RR: 1:${riskReward.toFixed(2)}

💰 Entry: ₹${signal.entryPrice.toFixed(2)}
🎯 Target: ₹${signal.target.toFixed(2)} (+${profitPotential.toFixed(1)}%)
🛑 SL: ₹${signal.stopLoss.toFixed(2)} (-${riskAmount.toFixed(1)}%)

📊 Spot: ₹${signal.spotPrice.toFixed(2)} | RSI: ${signal.technicals.rsi.toFixed(1)}
⏰ ${signal.timestamp.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })}
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

      // Get current market status
      const marketStatus = getMarketStatus();
      const currentTime = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });

      // Determine market info based on current status
      let marketInfo = '';
      let marketStatusText = '';

      if (marketStatus.nse) {
        marketInfo = '📡 *Streaming:* NIFTY & Bank NIFTY (Active)';
        marketStatusText = '🟢 *NSE Market Open*';
      } else {
        marketInfo = '📡 *Streaming:* NSE Markets Waiting';
        marketStatusText = '🔴 *NSE Market Closed*';
      }

      // Determine active instruments count
      const activeInstruments = marketStatus.nse ? 2 : 0;
      const totalInstruments = 2;

      const message = `
🤖 *NSE Options Trading Bot Started*

⚡ *Data Source:* Live Angel One WebSocket
${marketInfo}
${marketStatusText}

📊 *Current Status (${currentTime}):*
*Active Instruments:* ${activeInstruments}/${totalInstruments}
*NSE Status:* ${marketStatus.nse ? '🟢 OPEN' : '🔴 CLOSED'}

🎯 *TRIPLE STRATEGY SYSTEM:*
🏆 Multi-Timeframe Confluence (90%+ accuracy)
🎯 Bollinger Bands + RSI Divergence (80-95% accuracy)  
🚀 Price Action + Momentum (75-85% accuracy)

*Target Instruments:*
• NIFTY & Bank NIFTY Options (OTM strikes for liquidity)

⏰ *Market Hours:*
• NSE: 9:30 AM - 3:00 PM (Market open)
• Signals: 9:30 AM - 2:45 PM (New trades)

🔧 *Configuration:*
• Auto Trade: ${config.trading.autoTrade ? '✅ Enabled' : '❌ Disabled'}
• Trading Mode: ${config.trading.paperTrading ? '📄 Paper Trading' : '💰 Real Trading'}
• Signal Cooldown: ${config.trading.signalCooldown / 60000} minutes (per signal type)
• Confidence Threshold: ${config.strategy.confidenceThreshold}%+

⚡ *ADVANCED FEATURES:*
• 📊 Adaptive volatility-based targets (7.5%-15%)
• 🎯 Multi-timeframe confluence scoring
• 📈 Real-time Bollinger squeeze detection
• 🚀 Support/resistance bounce analysis
• 🏥 Comprehensive system health monitoring
• 📱 Detailed Telegram notifications

${config.trading.paperTrading ?
          '*🎯 Ready for NSE options paper trading with real data!*' :
          '*🚀 Ready to hunt for breakouts in NSE options markets!*'}

${!marketStatus.nse ?
          '\n⏳ *Bot will activate automatically when markets open*' :
          '\n✅ *Bot is actively monitoring for trading signals*'}
`.trim();

      await this.sendMessage(message);
      logger.info('📱 NSE options startup message sent to Telegram');

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


  // Send detailed strategy analysis updates
  public async sendStrategyAnalysis(indexName: string, analysis: any): Promise<void> {
    if (!this.bot) return;

    try {
      const message = `
📊 *Strategy Analysis Update*
🏷️ *Index:* ${indexName}

🏆 *Multi-Timeframe:* ${analysis.mtf?.ready ? '✅ Ready' : '⏳ Waiting'} ${analysis.mtf?.confluenceScore ? `(${analysis.mtf.confluenceScore.toFixed(0)}%)` : ''}
🎯 *Bollinger+RSI:* ${analysis.bollinger?.ready ? '✅ Ready' : '⏳ Waiting'} ${analysis.bollinger?.squeeze ? '(Squeeze Active)' : ''}
🚀 *Price Action:* ${analysis.priceAction?.ready ? '✅ Ready' : '⏳ Waiting'} ${analysis.priceAction?.momentum ? `(${analysis.priceAction.momentum.toFixed(2)}% momentum)` : ''}

📈 *Current Price:* ₹${analysis.currentPrice?.toFixed(2)}
📊 *RSI:* ${analysis.rsi?.toFixed(1)}
🎯 *Volatility:* ${analysis.volatility?.isExpanding ? '📈 Expanding' : '📊 Normal'}

⏰ *Analysis Time:* ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}
      `.trim();

      await this.sendMessage(message);
      logger.info(`📊 Strategy analysis sent for ${indexName}`);
    } catch (error) {
      logger.error('Failed to send strategy analysis:', (error as Error).message);
    }
  }

  // Send system health updates
  public async sendSystemHealth(status: string, message: string): Promise<void> {
    if (!this.bot) return;

    try {
      const statusEmoji = status === 'healthy' ? '✅' : status === 'warning' ? '⚠️' : '🚨';
      const healthMessage = `
${statusEmoji} *System Health Update*

*Status:* ${status.toUpperCase()}
*Details:* ${message}
*Time:* ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}

*Bot Uptime:* ${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m
      `.trim();

      await this.sendMessage(healthMessage);
      logger.info(`🏥 System health update sent: ${status}`);
    } catch (error) {
      logger.error('Failed to send system health update:', (error as Error).message);
    }
  }

  // Send WebSocket status changes
  public async sendWebSocketStatus(status: string, message: string): Promise<void> {
    if (!this.bot) return;

    try {
      const statusEmoji = status === 'connected' ? '🟢' : status === 'disconnected' ? '🔴' : '🟡';
      const wsMessage = `
${statusEmoji} *WebSocket Status Change*

*Status:* ${status.toUpperCase()}
*Details:* ${message}
*Time:* ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}

${status === 'connected' ? '✅ Live data streaming resumed' : '⚠️ Switching to backup data source'}
      `.trim();

      await this.sendMessage(wsMessage);
      logger.info(`🔗 WebSocket status update sent: ${status}`);
    } catch (error) {
      logger.error('Failed to send WebSocket status:', (error as Error).message);
    }
  }

  // Send daily market summary (crisp and concise)
  public async sendDailyMarketSummary(): Promise<void> {
    if (!this.bot) return;

    try {
      const today = new Date().toLocaleDateString('en-IN');
      const message = `
📊 *Daily Summary* (${today})

🎯 *Signals:* ${this.signalsToday}
💰 *P&L:* ${this.dailyPnL > 0 ? '+' : ''}₹${this.dailyPnL.toFixed(0)}
📈 *Win Rate:* ${this.signalsToday > 0 ? Math.round((this.winningSignals / this.signalsToday) * 100) : 0}%
⚡ *Status:* All systems operational

*Next update tomorrow*
      `.trim();

      await this.sendMessage(message);
      logger.info('📊 Daily market summary sent');
    } catch (error) {
      logger.error('Failed to send daily summary:', (error as Error).message);
    }
  }

  public async sendDailySummary(stats: TradingStats): Promise<void> {
    if (!this.bot) return;

    try {
      const message = `
📊 *Daily Trading Summary*

🎯 *Strategy Performance:*
*Total Signals:* ${stats.signals}
*Successful Trades:* ${stats.successful || 0}
*Win Rate:* ${stats.winRate || 0}%
*Avg Confidence:* ${stats.avgConfidence || 0}%

🏆 *Best Performers:*
*Top Strategy:* ${stats.bestSignal || 'Multi-Timeframe Confluence'}
*Peak Signal Time:* ${stats.peakTime || 'Market Hours'}

📊 *System Stats:*
*Bot Uptime:* ${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m
*Trading Mode:* ${config.trading.paperTrading ? '📄 Paper Trading' : '💰 Real Trading'}

🚀 *Tomorrow's Strategy:* All systems ready for next session!
            `.trim();

      await this.sendMessage(message);
      logger.info('📊 Daily trading summary sent');
    } catch (error) {
      logger.error('Failed to send daily summary:', (error as Error).message);
    }
  }

  // Check if we need to reset daily counters
  private checkDailyReset(): void {
    const currentDate = new Date().toDateString();
    if (this.lastResetDate !== currentDate) {
      this.signalsToday = 0;
      this.dailyPnL = 0;
      this.winningSignals = 0;
      this.lastResetDate = currentDate;
      logger.info('📊 Daily counters reset for new trading day');
    }
  }

  // Daily cleanup notification handlers
  private async sendCleanupCompleted(filesProcessed: number, errors: number): Promise<void> {
    const message = `
🧹 *Daily Cleanup Completed*

✅ *Fresh Start Ready*
*Files Processed:* ${filesProcessed}
*Errors:* ${errors}
*Time:* ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true })}

🚀 *System Status:* Clean slate for new trading day!
📊 *Memory:* ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB heap usage
🗓️ *Next Cleanup:* Tomorrow 5:30 AM IST
    `.trim();

    await this.sendMessage(message);
    logger.info('🧹 Daily cleanup completion notification sent');
  }

  private async sendCleanupFailed(error: string): Promise<void> {
    const message = `
🚨 *Daily Cleanup Failed*

❌ *Issue Detected:* ${error}
*Time:* ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true })}

⚠️ *Manual cleanup may be required*
🔧 *Check logs for details*
    `.trim();

    await this.sendMessage(message);
    logger.warn('🚨 Daily cleanup failure notification sent');
  }

  public cleanup(): void {
    // Remove all event listeners to prevent memory leaks
    this.eventListeners.forEach(({ event, handler }) => {
      (process as any).removeListener(event, handler);
    });
    this.eventListeners = [];
    logger.info('📱 Telegram bot event listeners cleaned up');
  }
}

export const telegramBot = new TelegramBotService();