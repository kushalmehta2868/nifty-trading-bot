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
        this.lastSignalTime = {}; // Changed to track per signal type
        this.priceBuffers = {
            NIFTY: [],
            BANKNIFTY: []
        };
    }
    async initialize() {
        logger_1.logger.info('🎯 Trading strategy initializing...');
        // Subscribe to real-time price updates
        webSocketFeed_1.webSocketFeed.addSubscriber((indexName, priceUpdate) => {
            logger_1.logger.info(`📊 Strategy received price update: ${indexName} = ₹${priceUpdate.price}`);
            this.processTick(indexName, priceUpdate).catch(error => {
                logger_1.logger.error(`Error processing tick for ${indexName}:`, error.message);
            });
        });
        // ✅ Better data checking with retry logic
        const checkData = async (attempt = 1) => {
            logger_1.logger.info(`🔍 Checking WebSocket data (attempt ${attempt})...`);
            let hasData = false;
            for (const indexName of ['NIFTY', 'BANKNIFTY']) {
                const currentPrice = webSocketFeed_1.webSocketFeed.getCurrentPrice(indexName);
                const priceHistory = webSocketFeed_1.webSocketFeed.getPriceHistory(indexName);
                const wsStatus = webSocketFeed_1.webSocketFeed.getConnectionStatus();
                logger_1.logger.info(`  ${indexName}: Price=${currentPrice}, History Length=${priceHistory.length}`);
                if (currentPrice > 0)
                    hasData = true;
            }
            const wsStatus = webSocketFeed_1.webSocketFeed.getConnectionStatus();
            logger_1.logger.info(`📡 WebSocket Status: Connected=${wsStatus.connected}, Healthy=${wsStatus.healthy}`);
            if (!hasData && attempt < 3) {
                logger_1.logger.warn(`⚠️ No data received yet, retrying in 5 seconds (attempt ${attempt}/3)...`);
                setTimeout(() => checkData(attempt + 1), 5000);
            }
            else if (hasData) {
                logger_1.logger.info('✅ WebSocket data is flowing to strategy');
            }
            else {
                logger_1.logger.error('❌ No WebSocket data after 3 attempts - check connection and tokens');
            }
        };
        // Start checking after 5 seconds
        setTimeout(() => checkData(), 5000);
        logger_1.logger.info('🎯 Trading strategy initialized with enhanced monitoring');
    }
    async processTick(indexName, priceUpdate) {
        // Skip if market is closed
        if (!(0, marketHours_1.isMarketOpen)()) {
            const shouldLog = Date.now() % 30000 < 1000; // Log every 30 seconds
            if (shouldLog) {
                logger_1.logger.info(`🔒 ${indexName} - Market closed, skipping analysis`);
            }
            return;
        }
        // No cooldown check here - will be checked per signal type in analyzeSignal
        // Update price buffer - volume data removed as it's unreliable for indices
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
            const shouldLog = Date.now() % 30000 < 1000; // Log every 30 seconds
            if (shouldLog) {
                logger_1.logger.info(`📊 ${indexName} - Insufficient data: ${buffer.length}/${config_1.config.strategy.emaPeriod} required for analysis`);
            }
            return;
        }
        // Analyze for signals
        const signal = await this.analyzeSignal(indexName, priceUpdate.price, buffer);
        if (signal && signal.confidence >= config_1.config.strategy.confidenceThreshold) {
            const signalKey = `${indexName}_${signal.optionType}`;
            // Check cooldown for this specific signal type
            if (this.isSignalInCooldown(signalKey)) {
                const cooldownRemaining = Math.ceil((config_1.config.trading.signalCooldown - (Date.now() - (this.lastSignalTime[signalKey] || 0))) / 1000);
                logger_1.logger.info(`⏳ ${indexName} ${signal.optionType} - Signal cooldown active, ${cooldownRemaining}s remaining`);
                return;
            }
            this.executeSignal(signal).catch(error => {
                logger_1.logger.error('Failed to execute signal:', error.message);
            });
            this.lastSignalTime[signalKey] = Date.now();
        }
        else if (signal && signal.confidence < config_1.config.strategy.confidenceThreshold) {
            logger_1.logger.info(`⚠️ ${indexName} - Signal generated but confidence too low: ${signal.confidence.toFixed(1)}% < ${config_1.config.strategy.confidenceThreshold}%`);
        }
    }
    async analyzeSignal(indexName, currentPrice, priceBuffer) {
        const prices = priceBuffer.map(item => item.price);
        // Calculate technical indicators (simplified - no volume or IV calculations)
        const rsi = this.calculateRSI(prices, config_1.config.strategy.rsiPeriod);
        const sma = this.calculateSMA(prices, 20); // Simple moving average instead of VWAP
        if (!this.isWithinTradingHours(indexName)) {
            const shouldLog = Date.now() % 30000 < 1000; // Log every 30 seconds
            if (shouldLog) {
                const currentTime = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
                const hours = '9:30 AM - 3:00 PM';
                logger_1.logger.info(`⏰ ${indexName} - Outside trading hours (${currentTime}), signals disabled during ${hours}`);
            }
            return null;
        }
        // Simplified CE Entry Conditions (4 conditions instead of 6)
        const ceConditions = {
            price_breakout: currentPrice > this.getTriggerLevel(currentPrice, indexName),
            momentum: rsi > 50 && rsi < 75,
            trend_alignment: currentPrice > sma,
            time_filter: this.isWithinTradingHours(indexName)
        };
        // Simplified PE Entry Conditions (4 conditions instead of 6)
        const peConditions = {
            price_breakout: currentPrice > this.getTriggerLevel(currentPrice, indexName),
            momentum: rsi > 45 && rsi < 70,
            trend_alignment: currentPrice < sma,
            time_filter: this.isWithinTradingHours(indexName)
        };
        // Check which conditions are met
        const allCeConditionsMet = Object.values(ceConditions).every(condition => condition === true);
        const allPeConditionsMet = Object.values(peConditions).every(condition => condition === true);
        // Log detailed condition analysis every 10 seconds with current values
        const shouldLogDetails = Date.now() % 10000 < 1000; // Log roughly every 10 seconds
        if (shouldLogDetails || allCeConditionsMet || allPeConditionsMet) {
            const triggerLevel = this.getTriggerLevel(currentPrice, indexName);
            logger_1.logger.info(`🔍 ${indexName} Signal Analysis - Current Values:`);
            logger_1.logger.info(`   💰 Current Price: ${currentPrice} | SMA-20: ${sma.toFixed(2)}`);
            logger_1.logger.info(`   📊 RSI: ${rsi.toFixed(2)} | Trigger Level: ${triggerLevel.toFixed(2)}`);
            logger_1.logger.info(`   ⏰ Current Time: ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
            logger_1.logger.info(`📈 CE Conditions Status:`);
            logger_1.logger.info(`   ✅ Price Breakout: ${ceConditions.price_breakout} (${currentPrice} > ${triggerLevel.toFixed(2)})`);
            logger_1.logger.info(`   ✅ RSI Momentum: ${ceConditions.momentum} (RSI ${rsi.toFixed(2)} between 50-75)`);
            logger_1.logger.info(`   ✅ Trend Up: ${ceConditions.trend_alignment} (Price ${currentPrice} > SMA ${sma.toFixed(2)})`);
            logger_1.logger.info(`   ✅ Time Filter: ${ceConditions.time_filter}`);
            logger_1.logger.info(`📉 PE Conditions Status:`);
            logger_1.logger.info(`   ✅ Price Breakout: ${peConditions.price_breakout} (${currentPrice} > ${triggerLevel.toFixed(2)})`);
            logger_1.logger.info(`   ✅ RSI Momentum: ${peConditions.momentum} (RSI ${rsi.toFixed(2)} between 45-70)`);
            logger_1.logger.info(`   ✅ Trend Down: ${peConditions.trend_alignment} (Price ${currentPrice} < SMA ${sma.toFixed(2)})`);
            logger_1.logger.info(`   ✅ Time Filter: ${peConditions.time_filter}`);
            const ceMet = Object.values(ceConditions).filter(c => c === true).length;
            const peMet = Object.values(peConditions).filter(c => c === true).length;
            logger_1.logger.info(`🎯 Summary: CE (${ceMet}/4 conditions) | PE (${peMet}/4 conditions) | Need ALL 4 for signal`);
        }
        // Prioritize CE if both conditions are met (bullish bias)
        let optionType;
        let direction;
        let entryConditions;
        let conditionLabel;
        if (allCeConditionsMet) {
            optionType = 'CE';
            direction = 'UP';
            entryConditions = ceConditions;
            conditionLabel = 'CE';
        }
        else if (allPeConditionsMet) {
            optionType = 'PE';
            direction = 'DOWN';
            entryConditions = peConditions;
            conditionLabel = 'PE';
        }
        else {
            return null; // No conditions met
        }
        const strike = this.calculateOptimalStrike(currentPrice, indexName, optionType);
        const optionSymbol = this.generateOptionSymbol(indexName, strike, optionType);
        // Simplified confidence calculation based on remaining conditions
        let confidence = 75; // Higher base confidence since we have fewer conditions
        if (optionType === 'CE') {
            confidence += Math.min(15, Math.max(0, (rsi - 50) / 1.67)); // CE RSI momentum (0-15 points)
            confidence += Math.min(10, Math.max(0, (currentPrice - sma) / currentPrice * 1000)); // Trend strength (0-10 points)
        }
        else {
            confidence += Math.min(15, Math.max(0, (rsi - 45) / 1.67)); // PE RSI momentum (0-15 points)
            confidence += Math.min(10, Math.max(0, (sma - currentPrice) / currentPrice * 1000)); // Trend strength (0-10 points)
        }
        logger_1.logger.info(`🎯 ${conditionLabel} Entry Conditions Met for ${indexName}:`);
        logger_1.logger.info(`   Price Breakout: ${entryConditions.price_breakout}`);
        logger_1.logger.info(`   Momentum (RSI): ${entryConditions.momentum} (${rsi.toFixed(2)})`);
        logger_1.logger.info(`   Trend Alignment: ${entryConditions.trend_alignment} (Price: ${currentPrice}, SMA: ${sma.toFixed(2)})`);
        logger_1.logger.info(`   Time Filter: ${entryConditions.time_filter}`);
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
                ema: 0, // Not used
                rsi: parseFloat(rsi.toFixed(2)),
                priceChange: 0, // Calculate if needed
                vwap: parseFloat(sma.toFixed(2)) // Using SMA as trend indicator
            }
        };
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
        // NSE weekly options logic
        const today = new Date();
        const nextTuesday = new Date(today);
        const daysUntilTuesday = (2 - today.getDay() + 7) % 7;
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
        switch (indexName) {
            case 'BANKNIFTY':
                return Math.round(spotPrice / 100) * 100;
            case 'NIFTY':
                return Math.round(spotPrice / 50) * 50;
            default:
                return Math.round(spotPrice / 50) * 50;
        }
    }
    // New optimized strike calculation for better liquidity
    calculateOptimalStrike(spotPrice, indexName, optionType) {
        let baseStrike;
        let strikeInterval;
        switch (indexName) {
            case 'BANKNIFTY':
                baseStrike = Math.round(spotPrice / 100) * 100;
                strikeInterval = 100;
                break;
            case 'NIFTY':
                baseStrike = Math.round(spotPrice / 50) * 50;
                strikeInterval = 50;
                break;
            default:
                baseStrike = Math.round(spotPrice / 50) * 50;
                strikeInterval = 50;
        }
        // For better liquidity, choose strikes that are slightly out-of-the-money (OTM)
        // This typically has higher volume and better bid-ask spreads
        if (optionType === 'CE') {
            // For CE options, go 1-2 strikes above ATM for better liquidity
            return baseStrike + strikeInterval;
        }
        else {
            // For PE options, go 1-2 strikes below ATM for better liquidity
            return baseStrike - strikeInterval;
        }
    }
    // Simple Moving Average calculation
    calculateSMA(prices, period) {
        if (prices.length < period) {
            // If not enough data, use all available prices
            period = prices.length;
        }
        const recentPrices = prices.slice(-period);
        const sum = recentPrices.reduce((acc, price) => acc + price, 0);
        return sum / period;
    }
    generateOptionSymbol(indexName, strike, optionType) {
        const expiryString = this.generateExpiryString();
        // NSE options
        return `${indexName}${expiryString}${strike}${optionType}`;
    }
    isSignalInCooldown(signalKey) {
        const lastTime = this.lastSignalTime[signalKey];
        return lastTime ? (Date.now() - lastTime) < config_1.config.trading.signalCooldown : false;
    }
    getTriggerLevel(currentPrice, indexName) {
        // Get recent price data for better trigger calculation
        const priceHistory = webSocketFeed_1.webSocketFeed.getPriceHistory(indexName);
        if (priceHistory.length < 10) {
            return currentPrice * 1.001; // 0.1% above current price as default
        }
        // Calculate recent high and low (last 20 data points)
        const recentPrices = priceHistory.slice(-20);
        const recentHigh = Math.max(...recentPrices);
        const recentLow = Math.min(...recentPrices);
        // Trigger level as breakout above recent resistance
        // Use 0.2% above recent high as breakout trigger
        return recentHigh * 1.002;
    }
    isWithinTradingHours(indexName) {
        const now = new Date();
        const istTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
        const currentTime = istTime.getHours() * 100 + istTime.getMinutes();
        if (!indexName) {
            return (0, marketHours_1.isMarketOpen)(); // General check
        }
        // NSE trading hours: 9:30 AM to 3:00 PM (for signals)
        const startTime = 930; // 9:30 AM
        const endTime = 1500; // 3:00 PM
        const isOpen = currentTime >= startTime && currentTime <= endTime;
        // Log NSE hours for debugging
        if (!isOpen) {
            logger_1.logger.debug(`NSE ${indexName} outside hours: ${currentTime} (need 930-1500)`);
        }
        return isOpen;
    }
    async getCurrentMarketConditions() {
        try {
            let summary = '\n📊 Current Market Conditions:\n';
            // Add WebSocket connection status
            const wsStatus = webSocketFeed_1.webSocketFeed.getConnectionStatus();
            summary += `🔗 WebSocket: ${wsStatus.connected ? '✅ Connected' : '❌ Disconnected'} | Healthy: ${wsStatus.healthy}\n\n`;
            for (const indexName of ['NIFTY', 'BANKNIFTY']) {
                const buffer = this.priceBuffers[indexName];
                const currentPrice = webSocketFeed_1.webSocketFeed.getCurrentPrice(indexName);
                const priceHistory = webSocketFeed_1.webSocketFeed.getPriceHistory(indexName);
                logger_1.logger.debug(`🔍 ${indexName} Debug: Buffer=${buffer.length}, CurrentPrice=${currentPrice}, History=${priceHistory.length}`);
                if (buffer.length === 0 || currentPrice === 0) {
                    summary += `  ${indexName}: No data available (Buffer: ${buffer.length}, Price: ${currentPrice})\n`;
                    continue;
                }
                const prices = buffer.map(item => item.price);
                if (prices.length < 5) {
                    summary += `  ${indexName}: Insufficient data (${prices.length} points)\n`;
                    continue;
                }
                const rsi = this.calculateRSI(prices, Math.min(14, prices.length - 1));
                const sma = this.calculateSMA(prices, 20);
                const triggerLevel = this.getTriggerLevel(currentPrice, indexName);
                const ceConditions = {
                    price_breakout: currentPrice > triggerLevel,
                    momentum: rsi > 50 && rsi < 75,
                    trend_alignment: currentPrice > sma,
                    time_filter: this.isWithinTradingHours()
                };
                const peConditions = {
                    price_breakout: currentPrice > triggerLevel,
                    momentum: rsi > 45 && rsi < 70,
                    trend_alignment: currentPrice < sma,
                    time_filter: this.isWithinTradingHours()
                };
                const ceMet = Object.values(ceConditions).filter(c => c === true).length;
                const peMet = Object.values(peConditions).filter(c => c === true).length;
                summary += `  ${indexName}: ₹${currentPrice} | RSI: ${rsi.toFixed(1)} | SMA: ${sma.toFixed(1)} | CE: ${ceMet}/4 | PE: ${peMet}/4\n`;
            }
            return summary;
        }
        catch (error) {
            logger_1.logger.error('Error in getCurrentMarketConditions:', error.message);
            return '\n📊 Current Market Conditions: Error retrieving data\n';
        }
    }
}
exports.strategy = new TradingStrategy();
//# sourceMappingURL=strategy.js.map