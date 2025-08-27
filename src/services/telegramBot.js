const TelegramBot = require('node-telegram-bot-api');
const config = require('../config/config');
const logger = require('../utils/logger');

class TelegramService {
  constructor() {
    this.bot = new TelegramBot(config.telegram.token, { polling: false });
    this.chatId = config.telegram.chatId;
  }

  async sendTradingSignal(signal) {
    const message = this.formatTradingSignal(signal);

    try {
      await this.bot.sendMessage(this.chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Taken', callback_data: `taken_${signal.symbol}` },
              { text: '❌ Skip', callback_data: `skip_${signal.symbol}` }
            ]
          ]
        }
      });

      logger.info(`Trading signal sent: ${signal.symbol}`);
    } catch (error) {
      logger.error('Error sending telegram message:', error.message);
    }
  }

  formatTradingSignal(signal) {
    const emoji = signal.type === 'PE' ? '🔻' : '🔺';
    const indexEmoji = signal.index === 'BANKNIFTY' ? '🏦' : '📊';

    return `
🎯 *${emoji} ${indexEmoji} ${signal.index} SIGNAL*

*Symbol:* \`${signal.symbol}\`
*Direction:* *${signal.direction}*
*Strike:* ${signal.strike}
*Lot Size:* ${signal.lotSize}

📊 *Entry Details:*
*Trigger:* Above ₹${signal.triggerLevel}
*Entry:* ₹${signal.entry}
*Target:* ₹${signal.target}
*Stop Loss:* ₹${signal.stopLoss}

📈 *Risk Management:*
*Risk-Reward:* ${signal.riskReward}
*Confidence:* ${signal.confidence}%
*Potential Profit:* ₹${((parseFloat(signal.target) - parseFloat(signal.entry)) * signal.lotSize).toFixed(0)}

💹 *Market Data:*
*${signal.index} Spot:* ${signal.spotPrice}
*Delta:* ${signal.greeks.delta}

⏰ *Time:* ${signal.timestamp.toLocaleTimeString('en-IN')}
  `.trim();
  }

  async sendMarketUpdate(message) {
    try {
      await this.bot.sendMessage(this.chatId, message, {
        parse_mode: 'Markdown'
      });
    } catch (error) {
      logger.error('Error sending market update:', error.message);
    }
  }

  async sendDailySummary(summary) {
    const message = `
📊 *DAILY TRADING SUMMARY*

*Total Signals:* ${summary.totalSignals}
📊 *NIFTY Signals:* ${summary.niftySignals}
🏦 *Bank NIFTY Signals:* ${summary.bankNiftySignals}

*Successful Trades:* ${summary.successfulTrades}
*Win Rate:* ${summary.winRate}%
*Total P&L:* ₹${summary.totalPnL}

*Best Performer:* ${summary.bestTrade}
*Market Trend:*
${summary.marketTrend}

_Happy Trading! 🚀_
  `.trim();

    try {
      await this.bot.sendMessage(this.chatId, message, {
        parse_mode: 'Markdown'
      });
    } catch (error) {
      logger.error('Error sending daily summary:', error.message);
    }
  }

  setupCallbacks() {
    this.bot.on('callback_query', (callbackQuery) => {
      const message = callbackQuery.message;
      const data = callbackQuery.data;

      if (data.startsWith('taken_')) {
        this.bot.answerCallbackQuery(callbackQuery.id, {
          text: 'Trade marked as taken! Good luck! 🍀'
        });
      } else if (data.startsWith('skip_')) {
        this.bot.answerCallbackQuery(callbackQuery.id, {
          text: 'Trade skipped. Wait for next signal! ⏳'
        });
      }
    });
  }
}

module.exports = new TelegramService();
