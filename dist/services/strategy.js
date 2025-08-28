"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.strategy = void 0;
const webSocketFeed_1 = require("./webSocketFeed");
const angelAPI_1 = require("./angelAPI");
const config_1 = require("../config/config");
const logger_1 = require("../utils/logger");
const marketHours_1 = require("../utils/marketHours");
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
        // Skip if market is closed
        if (!(0, marketHours_1.isMarketOpen)()) {
            return;
        }
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
            this.executeSignal(signal).catch(error => {
                logger_1.logger.error('Failed to execute signal:', error.message);
            });
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
            const optionSymbol = this.generateOptionSymbol(indexName, strike, optionType);
            return {
                indexName,
                direction,
                spotPrice: currentPrice,
                optionType,
                optionSymbol,
                entryPrice: 0, // Will fetch real price in executeSignal
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
    async executeSignal(signal) {
        try {
            // Fetch real option price from Angel One API
            const realPrice = await this.getRealOptionPrice(signal);
            if (realPrice) {
                signal.entryPrice = realPrice;
                // Calculate realistic targets based on real price
                signal.target = parseFloat((realPrice * 1.15).toFixed(2)); // 15% target
                signal.stopLoss = parseFloat((realPrice * 0.85).toFixed(2)); // 15% stop loss
                logger_1.logger.info(`✅ Real Option Price: ${signal.optionSymbol} = ₹${signal.entryPrice}`);
            }
            else {
                logger_1.logger.error(`CRITICAL: Could not fetch real option price for ${signal.optionSymbol}`);
                throw new Error('Real option price required - cannot proceed with estimated prices');
            }
            logger_1.logger.info(`🚨 LIVE Signal: ${signal.indexName} ${signal.direction} - Confidence: ${signal.confidence.toFixed(0)}%`);
            logger_1.logger.info(`💰 Real Option Price: ${signal.optionSymbol} = ₹${signal.entryPrice}`);
            // Emit signal for telegram bot
            process.emit('tradingSignal', signal);
        }
        catch (error) {
            logger_1.logger.error('Error in executeSignal:', error.message);
        }
    }
    async getRealOptionPrice(signal) {
        try {
            logger_1.logger.info(`Fetching real option price for ${signal.optionSymbol}`);
            // Generate expiry string (format: 29AUG24)
            const expiry = this.generateExpiryString();
            const strike = this.calculateStrike(signal.spotPrice, signal.indexName);
            // Get option token first
            const tokenResponse = await angelAPI_1.angelAPI.getOptionToken(signal.indexName, strike, signal.optionType, expiry);
            if (!tokenResponse) {
                logger_1.logger.error(`CRITICAL: Could not get token for ${signal.optionSymbol}`);
                throw new Error('Option token lookup failed');
            }
            // Fetch real option price using token
            const optionPrice = await angelAPI_1.angelAPI.getOptionPrice(signal.optionSymbol, tokenResponse);
            if (optionPrice && optionPrice > 0) {
                logger_1.logger.info(`✅ Real option price fetched: ${signal.optionSymbol} = ₹${optionPrice}`);
                return optionPrice;
            }
            logger_1.logger.error(`CRITICAL: Invalid option price received for ${signal.optionSymbol}`);
            throw new Error('Invalid option price from API');
        }
        catch (error) {
            logger_1.logger.error(`CRITICAL: Failed to fetch real option price for ${signal.optionSymbol}:`, error.message);
            throw error;
        }
    }
    generateExpiryString() {
        // Weekly options expire on Tuesdays
        const today = new Date();
        const nextTuesday = new Date(today);
        // Find next Tuesday (Tuesday = 2)
        const daysUntilTuesday = (2 - today.getDay() + 7) % 7;
        // If today is Tuesday and market is still open, use next Tuesday
        const adjustedDays = daysUntilTuesday === 0 ? 7 : daysUntilTuesday;
        nextTuesday.setDate(today.getDate() + adjustedDays);
        const day = nextTuesday.getDate().toString().padStart(2, '0');
        const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
        const month = months[nextTuesday.getMonth()];
        const year = nextTuesday.getFullYear().toString().slice(-2);
        return `${day}${month}${year}`;
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
    generateOptionSymbol(indexName, strike, optionType) {
        // Use the same expiry logic as generateExpiryString()
        const expiryString = this.generateExpiryString();
        return `${indexName}${expiryString}${strike}${optionType}`;
    }
    isInCooldown(indexName) {
        const lastTime = this.lastSignalTime[indexName];
        return lastTime ? (Date.now() - lastTime) < config_1.config.trading.signalCooldown : false;
    }
}
exports.strategy = new TradingStrategy();
//# sourceMappingURL=strategy.js.map