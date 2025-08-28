"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.strategy = void 0;
const webSocketFeed_1 = require("./webSocketFeed");
const config_1 = require("../config/config");
const logger_1 = require("../utils/logger");
class TradingStrategy {
    constructor() {
        this.lastSignalTime = {};
        this.priceBuffers = {
            NIFTY: [],
            BANKNIFTY: []
        };
    }
    async initialize() {
        // Subscribe to real-time price updates
        webSocketFeed_1.webSocketFeed.addSubscriber((indexName, priceUpdate) => {
            this.processTick(indexName, priceUpdate);
        });
        logger_1.logger.info('🎯 Trading strategy initialized');
    }
    processTick(indexName, priceUpdate) {
        // Skip if in cooldown
        if (this.isInCooldown(indexName)) {
            return;
        }
        // Update price buffer
        const buffer = this.priceBuffers[indexName];
        buffer.push({
            price: priceUpdate.price,
            timestamp: priceUpdate.timestamp
        });
        // Keep only last 50 ticks for analysis
        if (buffer.length > 50) {
            buffer.shift();
        }
        // Need enough data for analysis
        if (buffer.length < config_1.config.strategy.emaPeriod) {
            return;
        }
        // Analyze for signals
        const signal = this.analyzeSignal(indexName, priceUpdate.price, buffer);
        if (signal && signal.confidence >= config_1.config.strategy.confidenceThreshold) {
            this.executeSignal(signal);
            this.lastSignalTime[indexName] = Date.now();
        }
    }
    analyzeSignal(indexName, currentPrice, priceBuffer) {
        const prices = priceBuffer.map(item => item.price);
        // Calculate technical indicators
        const ema = this.calculateEMA(prices, config_1.config.strategy.emaPeriod);
        const rsi = this.calculateRSI(prices, config_1.config.strategy.rsiPeriod);
        // Price movement analysis
        const recentPrices = prices.slice(-5);
        const priceChange = ((currentPrice - recentPrices[0]) / recentPrices[0]) * 100;
        let direction = null;
        let confidence = 0;
        // Bullish breakout (matching your Aug 26 CE trades)
        if (currentPrice > ema &&
            rsi > 45 && rsi < 70 &&
            priceChange > config_1.config.strategy.breakoutThreshold) {
            direction = 'UP';
            confidence = 65 + Math.min(20, rsi - 45) + Math.min(15, Math.abs(priceChange) * 2);
        }
        // Bearish breakout (matching your Aug 26 PE trades)
        if (currentPrice < ema &&
            rsi > 30 && rsi < 55 &&
            priceChange < -config_1.config.strategy.breakoutThreshold) {
            direction = 'DOWN';
            confidence = 65 + Math.min(20, 55 - rsi) + Math.min(15, Math.abs(priceChange) * 2);
        }
        if (direction && confidence >= config_1.config.strategy.confidenceThreshold) {
            const strike = this.calculateStrike(currentPrice, indexName);
            const optionType = direction === 'UP' ? 'CE' : 'PE';
            return {
                indexName,
                direction,
                spotPrice: currentPrice,
                optionType,
                optionSymbol: this.generateOptionSymbol(indexName, strike, optionType),
                entryPrice: this.estimateOptionPrice(currentPrice, strike, optionType),
                target: 0, // Will calculate in executeSignal
                stopLoss: 0, // Will calculate in executeSignal
                confidence: Math.min(95, confidence),
                timestamp: new Date(),
                technicals: {
                    ema: parseFloat(ema.toFixed(2)),
                    rsi: parseFloat(rsi.toFixed(2)),
                    priceChange: parseFloat(priceChange.toFixed(2))
                }
            };
        }
        return null;
    }
    executeSignal(signal) {
        // Calculate target and stop loss
        signal.target = parseFloat((signal.entryPrice + 6 + Math.random() * 2).toFixed(2));
        signal.stopLoss = parseFloat((signal.entryPrice - 5 + Math.random()).toFixed(2));
        logger_1.logger.info(`🚨 LIVE Signal: ${signal.indexName} ${signal.direction} - Confidence: ${signal.confidence.toFixed(0)}%`);
        // Emit signal for telegram bot
        process.emit('tradingSignal', signal);
    }
    calculateEMA(prices, period) {
        if (prices.length < period)
            return prices[prices.length - 1];
        const multiplier = 2 / (period + 1);
        let ema = prices[0];
        for (let i = 1; i < prices.length; i++) {
            ema = (prices[i] * multiplier) + (ema * (1 - multiplier));
        }
        return ema;
    }
    calculateRSI(prices, period) {
        if (prices.length < period + 1)
            return 50;
        let gains = 0;
        let losses = 0;
        for (let i = 1; i <= period; i++) {
            const change = prices[i] - prices[i - 1];
            if (change > 0)
                gains += change;
            else
                losses -= change;
        }
        const avgGain = gains / period;
        const avgLoss = losses / period;
        if (avgLoss === 0)
            return 100;
        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    }
    calculateStrike(spotPrice, indexName) {
        const roundTo = indexName === 'BANKNIFTY' ? 100 : 50;
        return Math.round(spotPrice / roundTo) * roundTo;
    }
    estimateOptionPrice(spotPrice, strike, optionType) {
        const distance = Math.abs(spotPrice - strike);
        const intrinsic = optionType === 'CE' ?
            Math.max(0, spotPrice - strike) :
            Math.max(0, strike - spotPrice);
        const timeValue = Math.max(10, 70 - (distance / 15));
        const volatilityPremium = 15 + Math.random() * 20;
        return parseFloat((intrinsic + timeValue + volatilityPremium).toFixed(2));
    }
    generateOptionSymbol(indexName, strike, optionType) {
        const today = new Date();
        const nextThursday = new Date(today);
        nextThursday.setDate(today.getDate() + (4 - today.getDay() + 7) % 7);
        const day = nextThursday.getDate().toString().padStart(2, '0');
        const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
        const month = months[nextThursday.getMonth()];
        const year = nextThursday.getFullYear().toString().slice(-2);
        return `${indexName}${day}${month}${year}${strike}${optionType}`;
    }
    isInCooldown(indexName) {
        const lastTime = this.lastSignalTime[indexName];
        return lastTime ? (Date.now() - lastTime) < config_1.config.trading.signalCooldown : false;
    }
}
exports.strategy = new TradingStrategy();
//# sourceMappingURL=strategy.js.map