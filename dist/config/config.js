"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
exports.config = {
    angel: {
        clientId: process.env.ANGEL_CLIENT_ID || '',
        apiKey: process.env.ANGEL_API_KEY || '',
        apiSecret: process.env.ANGEL_API_SECRET || '',
        password: process.env.ANGEL_PASSWORD || '',
        totpSecret: process.env.ANGEL_TOTP_SECRET || ''
    },
    telegram: {
        botToken: process.env.TELEGRAM_BOT_TOKEN || '',
        chatId: process.env.TELEGRAM_CHAT_ID || ''
    },
    trading: {
        useWebSocket: process.env.USE_WEBSOCKET !== 'false', // Default to true
        useMockData: false, // Always use real data
        autoTrade: process.env.AUTO_TRADE === 'true',
        paperTrading: process.env.PAPER_TRADING === 'true', // Paper trading mode - simulated orders
        maxPositions: parseInt(process.env.MAX_POSITIONS || '3'),
        signalCooldown: parseInt(process.env.SIGNAL_COOLDOWN || '120000') // Reduced to 2 minutes for better opportunity capture
    },
    strategy: {
        emaPeriod: parseInt(process.env.EMA_PERIOD || '20'),
        rsiPeriod: parseInt(process.env.RSI_PERIOD || '14'),
        confidenceThreshold: parseInt(process.env.CONFIDENCE_THRESHOLD || '70'),
        breakoutThreshold: parseFloat(process.env.BREAKOUT_THRESHOLD || '0.3')
    },
    indices: {
        NIFTY: {
            name: 'NIFTY 50',
            token: '99926000', // ✅ Try this NSE NIFTY token
            lotSize: 75,
            basePrice: 24800,
            symbol: 'NIFTY 50'
        },
        BANKNIFTY: {
            name: 'NIFTY BANK',
            token: '99926009', // ✅ Try this NSE BANK NIFTY token
            lotSize: 35,
            basePrice: 55000,
            symbol: 'NIFTY BANK'
        },
    }
};
//# sourceMappingURL=config.js.map