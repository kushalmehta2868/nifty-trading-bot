require('dotenv').config();

module.exports = {
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID
  },

  indices: {
    NIFTY: {
      symbol: 'NIFTY',
      lotSize: 25,
      tickSize: 0.05,
      atmRange: 100,        // ±100 points for ATM selection
      minVolume: 10000,
      minOI: 50000
    },
    BANKNIFTY: {
      symbol: 'BANKNIFTY',
      lotSize: 15,
      tickSize: 0.05,
      atmRange: 200,        // ±200 points for ATM selection
      minVolume: 5000,      // Lower due to higher premium
      minOI: 25000
    }
  },

  trading: {
    hoursStart: process.env.TRADING_HOURS_START || '09:15',
    hoursEnd: process.env.TRADING_HOURS_END || '15:30',
    scanInterval: parseInt(process.env.SCAN_INTERVAL) || 5000,
    maxTradesPerDay: parseInt(process.env.MAX_TRADES_PER_DAY) || 10
  },

  strategy: {
    rsiPeriod: parseInt(process.env.RSI_PERIOD) || 14,
    emaFast: parseInt(process.env.EMA_FAST) || 9,
    emaSlow: parseInt(process.env.EMA_SLOW) || 21,
    volumeMultiplier: parseFloat(process.env.VOLUME_MULTIPLIER) || 1.8,
    atrPeriod: parseInt(process.env.ATR_PERIOD) || 14,
    minRiskReward: parseFloat(process.env.MIN_RISK_REWARD_RATIO) || 1.2,
    enabledIndices: ['NIFTY', 'BANKNIFTY'], // Both indices enabled
    maxTradesPerIndex: 5,  // Limit per index
    maxTradesPerDay: 10    // Total daily limit
  },

  api: {
    nseBase: process.env.NSE_API_BASE || 'https://www.nseindia.com/api',
    tradingViewWs: process.env.TRADING_VIEW_API
  }
};
