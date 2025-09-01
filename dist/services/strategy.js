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
        if (!this.isWithinTradingHours(indexName)) {
            const shouldLog = Date.now() % 30000 < 1000;
            if (shouldLog) {
                const currentTime = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
                const hours = '9:30 AM - 3:00 PM';
                logger_1.logger.info(`⏰ ${indexName} - Outside trading hours (${currentTime}), signals disabled during ${hours}`);
            }
            return null;
        }
        // Try Strategy 3 first (Multi-Timeframe Confluence) - Highest accuracy
        const confluenceSignal = await this.analyzeMultiTimeframeConfluence(indexName, currentPrice, prices);
        if (confluenceSignal)
            return confluenceSignal;
        // Try Strategy 1 (Bollinger + RSI) - High accuracy
        const bollingerSignal = await this.analyzeBollingerRSIStrategy(indexName, currentPrice, prices);
        if (bollingerSignal)
            return bollingerSignal;
        // Try Strategy 2 (Price Action + Momentum) - Fast response
        const priceActionSignal = await this.analyzePriceActionStrategy(indexName, currentPrice, prices);
        if (priceActionSignal)
            return priceActionSignal;
        return null; // No signals from any strategy
    }
    // 🏆 STRATEGY 3: Multi-Timeframe Confluence (Highest Accuracy - 90%+)
    async analyzeMultiTimeframeConfluence(indexName, currentPrice, prices) {
        if (prices.length < 50)
            return null; // Need more data for multi-timeframe
        // Create multiple timeframes from single price array
        const tf1 = prices; // 1-tick (current)
        const tf5 = this.compressToTimeframe(prices, 5); // 5-tick
        const tf10 = this.compressToTimeframe(prices, 10); // 10-tick
        // Calculate indicators across timeframes
        const rsi1 = this.calculateRSI(tf1, 14);
        const rsi5 = this.calculateRSI(tf5, 14);
        const rsi10 = this.calculateRSI(tf10, 14);
        const sma1 = this.calculateSMA(tf1, 20);
        const sma5 = this.calculateSMA(tf5, 20);
        const sma10 = this.calculateSMA(tf10, 20);
        const momentum1 = this.calculateMomentum(tf1, 5);
        const momentum5 = this.calculateMomentum(tf5, 5);
        const momentum10 = this.calculateMomentum(tf10, 5);
        // Confluence scoring system
        const confluenceScore = this.calculateConfluenceScore(currentPrice, { rsi1, rsi5, rsi10 }, { sma1, sma5, sma10 }, { momentum1, momentum5, momentum10 });
        // Advanced volatility calculation for adaptive targets
        const volatility = this.calculateAdaptiveVolatility(tf1);
        // RELAXED Multi-timeframe CE conditions (more practical)
        const mtfCEConditions = {
            majority_rsi_bullish: (+((rsi1 > 50)) + (+(rsi5 > 50)) + (+(rsi10 > 50))) >= 2, // 2 out of 3 RSI bullish
            trend_alignment: currentPrice > sma1 && sma1 >= sma5 * 0.999, // More flexible trend
            momentum_positive: momentum1 > 0.1 || momentum5 > 0.05, // Either timeframe has momentum
            decent_confluence: confluenceScore >= 60, // Lowered from 80% to 60%
            time_filter: this.isWithinTradingHours(indexName)
        };
        // RELAXED Multi-timeframe PE conditions
        const mtfPEConditions = {
            majority_rsi_bearish: (+((rsi1 < 50)) + (+(rsi5 < 50)) + (+(rsi10 < 50))) >= 2, // 2 out of 3 RSI bearish
            trend_alignment: currentPrice < sma1 && sma1 <= sma5 * 1.001, // More flexible trend
            momentum_negative: momentum1 < -0.1 || momentum5 < -0.05, // Either timeframe has momentum
            decent_confluence: confluenceScore >= 60, // Lowered from 80% to 60%
            time_filter: this.isWithinTradingHours(indexName)
        };
        const mtfCEMet = Object.values(mtfCEConditions).every(c => c === true);
        const mtfPEMet = Object.values(mtfPEConditions).every(c => c === true);
        // Log multi-timeframe analysis every 20 seconds (less frequent due to complexity)
        const shouldLogMTF = Date.now() % 20000 < 1000;
        if (shouldLogMTF || mtfCEMet || mtfPEMet) {
            logger_1.logger.info(`🏆 ${indexName} Multi-Timeframe Confluence (RELAXED):`);
            logger_1.logger.info(`   💰 Price: ${currentPrice} | Confluence: ${confluenceScore.toFixed(0)}%`);
            logger_1.logger.info(`   📊 RSI: 1t=${rsi1.toFixed(1)} | 5t=${rsi5.toFixed(1)} | 10t=${rsi10.toFixed(1)}`);
            logger_1.logger.info(`   📈 Momentum: 1t=${momentum1.toFixed(2)}% | 5t=${momentum5.toFixed(2)}% | 10t=${momentum10.toFixed(2)}%`);
            logger_1.logger.info(`   🎯 CE: ${Object.values(mtfCEConditions).filter(c => c === true).length}/5 | PE: ${Object.values(mtfPEConditions).filter(c => c === true).length}/5`);
        }
        let signal = null;
        if (mtfCEMet) {
            const strike = this.calculateOptimalStrike(currentPrice, indexName, 'CE');
            const baseConfidence = 80; // Base for relaxed multi-timeframe
            const confluenceBonus = Math.min(15, (confluenceScore - 60) / 2);
            const trendBonus = mtfCEConditions.trend_alignment ? 5 : 0;
            signal = {
                indexName,
                direction: 'UP',
                spotPrice: currentPrice,
                optionType: 'CE',
                optionSymbol: this.generateOptionSymbol(indexName, strike, 'CE'),
                entryPrice: 0,
                target: 0,
                stopLoss: 0,
                confidence: Math.min(98, baseConfidence + confluenceBonus + trendBonus),
                timestamp: new Date(),
                technicals: {
                    ema: 0,
                    rsi: parseFloat(rsi1.toFixed(2)),
                    priceChange: parseFloat(momentum1.toFixed(2)),
                    vwap: parseFloat(sma1.toFixed(2))
                }
            };
            logger_1.logger.info(`🏆 Multi-Timeframe CE Signal: Confluence=${confluenceScore.toFixed(0)}%, All TF aligned, Vol=${volatility.isExpanding}`);
        }
        else if (mtfPEMet) {
            const strike = this.calculateOptimalStrike(currentPrice, indexName, 'PE');
            const baseConfidence = 80;
            const confluenceBonus = Math.min(15, (confluenceScore - 60) / 2);
            const trendBonus = mtfPEConditions.trend_alignment ? 5 : 0;
            signal = {
                indexName,
                direction: 'DOWN',
                spotPrice: currentPrice,
                optionType: 'PE',
                optionSymbol: this.generateOptionSymbol(indexName, strike, 'PE'),
                entryPrice: 0,
                target: 0,
                stopLoss: 0,
                confidence: Math.min(98, baseConfidence + confluenceBonus + trendBonus),
                timestamp: new Date(),
                technicals: {
                    ema: 0,
                    rsi: parseFloat(rsi1.toFixed(2)),
                    priceChange: parseFloat(momentum1.toFixed(2)),
                    vwap: parseFloat(sma1.toFixed(2))
                }
            };
            logger_1.logger.info(`🏆 Multi-Timeframe PE Signal: Confluence=${confluenceScore.toFixed(0)}%, All TF aligned, Vol=${volatility.isExpanding}`);
        }
        return signal;
    }
    // 🎯 STRATEGY 1: Bollinger Bands + RSI (High Accuracy)
    async analyzeBollingerRSIStrategy(indexName, currentPrice, prices) {
        // Calculate indicators
        const rsi = this.calculateRSI(prices, 14);
        const bollinger = this.calculateBollingerBands(prices, 20, 2);
        const momentum = this.calculateMomentum(prices, 10);
        // RELAXED Strategy 1 Conditions: Bollinger Bands + RSI (No squeeze required)
        const bollingerCEConditions = {
            price_near_lower_or_oversold: currentPrice <= bollinger.lower * 1.01 || rsi < 35, // Near lower band OR oversold
            rsi_recovery_zone: rsi > 30 && rsi < 60, // Wider RSI range
            trend_support: currentPrice > bollinger.middle * 0.995, // Above or near middle band
            momentum_positive: momentum > 0.05, // Lower momentum requirement
            time_filter: this.isWithinTradingHours(indexName)
        };
        const bollingerPEConditions = {
            price_near_upper_or_overbought: currentPrice >= bollinger.upper * 0.99 || rsi > 65, // Near upper band OR overbought
            rsi_decline_zone: rsi < 70 && rsi > 40, // Wider RSI range
            trend_resistance: currentPrice < bollinger.middle * 1.005, // Below or near middle band
            momentum_negative: momentum < -0.05, // Lower momentum requirement
            time_filter: this.isWithinTradingHours(indexName)
        };
        const bollingerCEMet = Object.values(bollingerCEConditions).every(c => c === true);
        const bollingerPEMet = Object.values(bollingerPEConditions).every(c => c === true);
        // Log strategy 1 analysis every 15 seconds
        const shouldLogBollinger = Date.now() % 15000 < 1000;
        if (shouldLogBollinger || bollingerCEMet || bollingerPEMet) {
            logger_1.logger.info(`🎯 ${indexName} Bollinger+RSI Strategy (RELAXED):`);
            logger_1.logger.info(`   💰 Price: ${currentPrice} | BB Upper: ${bollinger.upper.toFixed(2)} | Middle: ${bollinger.middle.toFixed(2)} | Lower: ${bollinger.lower.toFixed(2)}`);
            logger_1.logger.info(`   📊 RSI: ${rsi.toFixed(2)} | Momentum: ${momentum.toFixed(2)}%`);
            logger_1.logger.info(`   📈 CE: ${Object.values(bollingerCEConditions).filter(c => c === true).length}/5 | PE: ${Object.values(bollingerPEConditions).filter(c => c === true).length}/5`);
            // Emit detailed analysis for Telegram
            if (shouldLogBollinger && Date.now() % 60000 < 1000) { // Every minute
                process.emit('strategyAnalysis', {
                    indexName,
                    analysis: {
                        type: 'Bollinger+RSI',
                        currentPrice,
                        rsi: rsi,
                        bollinger: {
                            upper: bollinger.upper,
                            lower: bollinger.lower,
                            squeeze: bollinger.squeeze,
                            ready: Object.values(bollingerCEConditions).filter(c => c === true).length >= 3 ||
                                Object.values(bollingerPEConditions).filter(c => c === true).length >= 3
                        },
                        momentum: momentum,
                        volatility: { isExpanding: false }
                    }
                });
            }
        }
        let signal = null;
        if (bollingerCEMet) {
            const strike = this.calculateOptimalStrike(currentPrice, indexName, 'CE');
            const confidence = 80 + Math.min(15, Math.abs(momentum) * 5) + (bollinger.squeeze ? 5 : 0);
            signal = {
                indexName,
                direction: 'UP',
                spotPrice: currentPrice,
                optionType: 'CE',
                optionSymbol: this.generateOptionSymbol(indexName, strike, 'CE'),
                entryPrice: 0,
                target: 0,
                stopLoss: 0,
                confidence: Math.min(95, confidence),
                timestamp: new Date(),
                technicals: {
                    ema: 0,
                    rsi: parseFloat(rsi.toFixed(2)),
                    priceChange: parseFloat(momentum.toFixed(2)),
                    vwap: parseFloat(bollinger.middle.toFixed(2))
                }
            };
            logger_1.logger.info(`🎯 Bollinger+RSI CE Signal: Squeeze=${bollinger.squeeze}, RSI=${rsi.toFixed(2)}, Momentum=${momentum.toFixed(2)}%`);
        }
        else if (bollingerPEMet) {
            const strike = this.calculateOptimalStrike(currentPrice, indexName, 'PE');
            const confidence = 80 + Math.min(15, Math.abs(momentum) * 5) + (bollinger.squeeze ? 5 : 0);
            signal = {
                indexName,
                direction: 'DOWN',
                spotPrice: currentPrice,
                optionType: 'PE',
                optionSymbol: this.generateOptionSymbol(indexName, strike, 'PE'),
                entryPrice: 0,
                target: 0,
                stopLoss: 0,
                confidence: Math.min(95, confidence),
                timestamp: new Date(),
                technicals: {
                    ema: 0,
                    rsi: parseFloat(rsi.toFixed(2)),
                    priceChange: parseFloat(momentum.toFixed(2)),
                    vwap: parseFloat(bollinger.middle.toFixed(2))
                }
            };
            logger_1.logger.info(`🎯 Bollinger+RSI PE Signal: Squeeze=${bollinger.squeeze}, RSI=${rsi.toFixed(2)}, Momentum=${momentum.toFixed(2)}%`);
        }
        return signal;
    }
    // 🚀 STRATEGY 2: Price Action + Momentum (Fast Response)
    async analyzePriceActionStrategy(indexName, currentPrice, prices) {
        const rsi = this.calculateRSI(prices, 14);
        const sma = this.calculateSMA(prices, 20);
        const supportResistance = this.calculateSupportResistance(prices);
        const momentum = this.calculateMomentum(prices, 5); // Shorter period for faster signals
        // RELAXED Strategy 2: Price Action + Momentum (More practical)
        const priceActionCEConditions = {
            price_momentum_bullish: momentum > 0.1 && rsi > 45, // Basic bullish momentum + RSI
            trend_bullish: currentPrice > sma || rsi > 55, // Either above SMA OR strong RSI
            not_overbought: rsi < 75, // Not extremely overbought
            time_filter: this.isWithinTradingHours(indexName)
        };
        const priceActionPEConditions = {
            price_momentum_bearish: momentum < -0.1 && rsi < 55, // Basic bearish momentum + RSI
            trend_bearish: currentPrice < sma || rsi < 45, // Either below SMA OR weak RSI
            not_oversold: rsi > 25, // Not extremely oversold
            time_filter: this.isWithinTradingHours(indexName)
        };
        const actionCEMet = Object.values(priceActionCEConditions).every(c => c === true);
        const actionPEMet = Object.values(priceActionPEConditions).every(c => c === true);
        // Log strategy 2 analysis every 15 seconds
        const shouldLogAction = Date.now() % 15000 < 1000;
        if (shouldLogAction || actionCEMet || actionPEMet) {
            logger_1.logger.info(`🚀 ${indexName} Price Action Strategy (RELAXED):`);
            logger_1.logger.info(`   💰 Price: ${currentPrice} | SMA: ${sma.toFixed(2)}`);
            logger_1.logger.info(`   📊 RSI: ${rsi.toFixed(2)} | Momentum: ${momentum.toFixed(2)}%`);
            logger_1.logger.info(`   📈 CE: ${Object.values(priceActionCEConditions).filter(c => c === true).length}/4 | PE: ${Object.values(priceActionPEConditions).filter(c => c === true).length}/4`);
        }
        let signal = null;
        if (actionCEMet) {
            const strike = this.calculateOptimalStrike(currentPrice, indexName, 'CE');
            const confidence = 78 + Math.min(15, Math.abs(momentum) * 3) + (supportResistance.nearSupport ? 7 : 0);
            signal = {
                indexName,
                direction: 'UP',
                spotPrice: currentPrice,
                optionType: 'CE',
                optionSymbol: this.generateOptionSymbol(indexName, strike, 'CE'),
                entryPrice: 0,
                target: 0,
                stopLoss: 0,
                confidence: Math.min(95, confidence),
                timestamp: new Date(),
                technicals: {
                    ema: 0,
                    rsi: parseFloat(rsi.toFixed(2)),
                    priceChange: parseFloat(momentum.toFixed(2)),
                    vwap: parseFloat(sma.toFixed(2))
                }
            };
            logger_1.logger.info(`🚀 Price Action CE Signal: Support bounce with ${momentum.toFixed(2)}% momentum`);
        }
        else if (actionPEMet) {
            const strike = this.calculateOptimalStrike(currentPrice, indexName, 'PE');
            const confidence = 78 + Math.min(15, Math.abs(momentum) * 3) + (supportResistance.nearResistance ? 7 : 0);
            signal = {
                indexName,
                direction: 'DOWN',
                spotPrice: currentPrice,
                optionType: 'PE',
                optionSymbol: this.generateOptionSymbol(indexName, strike, 'PE'),
                entryPrice: 0,
                target: 0,
                stopLoss: 0,
                confidence: Math.min(95, confidence),
                timestamp: new Date(),
                technicals: {
                    ema: 0,
                    rsi: parseFloat(rsi.toFixed(2)),
                    priceChange: parseFloat(momentum.toFixed(2)),
                    vwap: parseFloat(sma.toFixed(2))
                }
            };
            logger_1.logger.info(`🚀 Price Action PE Signal: Resistance rejection with ${momentum.toFixed(2)}% momentum`);
        }
        return signal;
    }
    async executeSignal(signal) {
        try {
            // Fetch real option price from Angel One API
            const realPrice = await this.getRealOptionPrice(signal);
            if (realPrice) {
                signal.entryPrice = realPrice;
                // 🚀 ADAPTIVE VOLATILITY-BASED TARGETS 
                const prices = this.priceBuffers[signal.indexName].map(item => item.price);
                const volatility = this.calculateAdaptiveVolatility(prices);
                // Use adaptive targets based on current market volatility
                signal.target = parseFloat((realPrice * volatility.adaptive_target).toFixed(2));
                signal.stopLoss = parseFloat((realPrice * volatility.adaptive_sl).toFixed(2));
                // Calculate expected profit potential
                const profitPotential = ((signal.target - realPrice) / realPrice) * 100;
                const riskAmount = ((realPrice - signal.stopLoss) / realPrice) * 100;
                const riskReward = profitPotential / riskAmount;
                logger_1.logger.info(`✅ Real Option Price: ${signal.optionSymbol} = ₹${signal.entryPrice}`);
                logger_1.logger.info(`🎯 Adaptive Targets: Target=₹${signal.target} (+${profitPotential.toFixed(1)}%) | SL=₹${signal.stopLoss} (-${riskAmount.toFixed(1)}%)`);
                logger_1.logger.info(`📊 Risk:Reward = 1:${riskReward.toFixed(2)} | Volatility Expanding: ${volatility.isExpanding}`);
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
    // Bollinger Bands calculation - excellent for volatility-based entries
    calculateBollingerBands(prices, period = 20, stdDev = 2) {
        const sma = this.calculateSMA(prices, period);
        const recentPrices = prices.slice(-Math.min(period, prices.length));
        // Calculate standard deviation
        const variance = recentPrices.reduce((acc, price) => acc + Math.pow(price - sma, 2), 0) / recentPrices.length;
        const standardDev = Math.sqrt(variance);
        const upper = sma + (stdDev * standardDev);
        const lower = sma - (stdDev * standardDev);
        const bandwidth = ((upper - lower) / sma) * 100;
        // Squeeze detection: bandwidth < 10% indicates low volatility (breakout likely)
        const squeeze = bandwidth < 10;
        return {
            upper,
            middle: sma,
            lower,
            squeeze,
            bandwidth
        };
    }
    // Price momentum calculation - rate of change
    calculateMomentum(prices, period = 10) {
        if (prices.length < period + 1)
            return 0;
        const currentPrice = prices[prices.length - 1];
        const pastPrice = prices[prices.length - 1 - period];
        return ((currentPrice - pastPrice) / pastPrice) * 100;
    }
    // Support/Resistance levels from recent price action
    calculateSupportResistance(prices, period = 20) {
        const recentPrices = prices.slice(-Math.min(period, prices.length));
        const resistance = Math.max(...recentPrices);
        const support = Math.min(...recentPrices);
        const currentPrice = prices[prices.length - 1];
        // Within 0.3% of resistance/support
        const resistanceThreshold = resistance * 0.997;
        const supportThreshold = support * 1.003;
        return {
            resistance,
            support,
            nearResistance: currentPrice >= resistanceThreshold,
            nearSupport: currentPrice <= supportThreshold
        };
    }
    // Compress price array to different timeframes
    compressToTimeframe(prices, compression) {
        const compressed = [];
        for (let i = compression - 1; i < prices.length; i += compression) {
            // Use the last price in each compression window
            compressed.push(prices[i]);
        }
        return compressed.length > 0 ? compressed : [prices[prices.length - 1]];
    }
    // Advanced confluence scoring system
    calculateConfluenceScore(currentPrice, rsiData, smaData, momentumData) {
        let score = 0;
        // RSI confluence (0-30 points)
        const rsiAlignment = this.checkAlignment([rsiData.rsi1, rsiData.rsi5, rsiData.rsi10]);
        score += rsiAlignment * 30;
        // Trend confluence (0-25 points) 
        const trendAlignment = this.checkTrendAlignment(currentPrice, smaData.sma1, smaData.sma5, smaData.sma10);
        score += trendAlignment * 25;
        // Momentum confluence (0-25 points)
        const momAlignment = this.checkAlignment([momentumData.momentum1, momentumData.momentum5, momentumData.momentum10]);
        score += momAlignment * 25;
        // Price position relative to moving averages (0-20 points)
        const priceScore = this.calculatePricePositionScore(currentPrice, smaData);
        score += priceScore * 20;
        return Math.min(100, score);
    }
    // Check alignment between multiple values (0-1 score)
    checkAlignment(values) {
        const directions = values.map(v => v > 50 ? 1 : -1); // For RSI-like values
        const allSame = directions.every(d => d === directions[0]);
        return allSame ? 1 : 0;
    }
    // Check trend alignment across timeframes
    checkTrendAlignment(price, sma1, sma5, sma10) {
        // All ascending (bullish) or all descending (bearish)
        const bullish = price > sma1 && sma1 > sma5 && sma5 > sma10;
        const bearish = price < sma1 && sma1 < sma5 && sma5 < sma10;
        return (bullish || bearish) ? 1 : 0;
    }
    // Calculate price position score relative to moving averages
    calculatePricePositionScore(price, smaData) {
        const deviations = [
            Math.abs(price - smaData.sma1) / smaData.sma1,
            Math.abs(smaData.sma1 - smaData.sma5) / smaData.sma5,
            Math.abs(smaData.sma5 - smaData.sma10) / smaData.sma10
        ];
        // Higher score for smaller deviations (more aligned)
        const avgDeviation = deviations.reduce((a, b) => a + b, 0) / deviations.length;
        return Math.max(0, 1 - (avgDeviation * 100)); // Convert to 0-1 scale
    }
    // Adaptive volatility calculation for better targets
    calculateAdaptiveVolatility(prices) {
        const period = Math.min(20, prices.length);
        const recentPrices = prices.slice(-period);
        // Calculate True Range for each period
        const trueRanges = [];
        for (let i = 1; i < recentPrices.length; i++) {
            const high = recentPrices[i];
            const low = recentPrices[i];
            const prevClose = recentPrices[i - 1];
            const tr1 = Math.abs(high - low);
            const tr2 = Math.abs(high - prevClose);
            const tr3 = Math.abs(low - prevClose);
            trueRanges.push(Math.max(tr1, tr2, tr3));
        }
        const avgTrueRange = trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length;
        const currentPrice = prices[prices.length - 1];
        const currentVol = avgTrueRange / currentPrice;
        // Compare with longer period for expansion detection
        const longerPrices = prices.slice(-Math.min(40, prices.length));
        const longerVolatility = this.calculateBasicVolatility(longerPrices);
        const isExpanding = currentVol > longerVolatility * 1.2;
        // Adaptive targets based on current volatility
        const volMultiplier = Math.max(1.5, Math.min(3.0, currentVol * 100));
        const adaptiveTarget = 1 + (volMultiplier * 0.05); // 7.5% to 15% target
        const adaptiveSL = 1 - (volMultiplier * 0.03); // 4.5% to 9% stop loss
        return {
            current: currentVol,
            average: longerVolatility,
            isExpanding,
            adaptive_target: adaptiveTarget,
            adaptive_sl: adaptiveSL
        };
    }
    // Basic volatility calculation helper
    calculateBasicVolatility(prices) {
        if (prices.length < 2)
            return 0;
        const returns = [];
        for (let i = 1; i < prices.length; i++) {
            returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
        }
        const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance = returns.reduce((acc, ret) => acc + Math.pow(ret - mean, 2), 0) / returns.length;
        return Math.sqrt(variance);
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
            let summary = '\n📊 Current Market Conditions (Triple Strategy System):\n';
            // Add WebSocket connection status
            const wsStatus = webSocketFeed_1.webSocketFeed.getConnectionStatus();
            summary += `🔗 WebSocket: ${wsStatus.connected ? '✅ Connected' : '❌ Disconnected'} | Healthy: ${wsStatus.healthy}\n\n`;
            for (const indexName of ['NIFTY', 'BANKNIFTY']) {
                const buffer = this.priceBuffers[indexName];
                const currentPrice = webSocketFeed_1.webSocketFeed.getCurrentPrice(indexName);
                if (buffer.length === 0 || currentPrice === 0) {
                    summary += `  ${indexName}: No data available\n`;
                    continue;
                }
                const prices = buffer.map(item => item.price);
                if (prices.length < 20) {
                    summary += `  ${indexName}: Insufficient data (${prices.length}/50 points needed)\n`;
                    continue;
                }
                // Calculate indicators for all strategies
                const rsi = this.calculateRSI(prices, 14);
                const bollinger = this.calculateBollingerBands(prices, 20, 2);
                const momentum = this.calculateMomentum(prices, 10);
                const supportResistance = this.calculateSupportResistance(prices);
                const volatility = this.calculateAdaptiveVolatility(prices);
                // Multi-timeframe readiness (if enough data)
                let mtfReady = 0;
                if (prices.length >= 50) {
                    const tf5 = this.compressToTimeframe(prices, 5);
                    const tf10 = this.compressToTimeframe(prices, 10);
                    const rsi5 = this.calculateRSI(tf5, 14);
                    const rsi10 = this.calculateRSI(tf10, 14);
                    const confluenceScore = this.calculateConfluenceScore(currentPrice, { rsi1: rsi, rsi5, rsi10 }, { sma1: this.calculateSMA(prices, 20), sma5: this.calculateSMA(tf5, 20), sma10: this.calculateSMA(tf10, 20) }, { momentum1: momentum, momentum5: this.calculateMomentum(tf5, 5), momentum10: this.calculateMomentum(tf10, 5) });
                    mtfReady = confluenceScore >= 80 ? 1 : 0;
                }
                // Strategy readiness scores
                const s1Ready = Object.values({
                    squeeze: bollinger.squeeze,
                    rsiReady: (rsi > 30 && rsi < 50) || (rsi > 50 && rsi < 70),
                    nearBands: (currentPrice <= bollinger.lower * 1.005) || (currentPrice >= bollinger.upper * 0.995)
                }).filter(c => c === true).length;
                const s2Ready = Object.values({
                    nearLevels: supportResistance.nearSupport || supportResistance.nearResistance,
                    strongMomentum: Math.abs(momentum) > 0.2,
                    rsiZone: rsi > 30 && rsi < 70
                }).filter(c => c === true).length;
                summary += `  ${indexName}: ₹${currentPrice} | Vol: ${volatility.isExpanding ? '📈 Expanding' : '📊 Normal'}\n`;
                summary += `    🏆 Multi-TF: ${mtfReady}/1 ready ${prices.length >= 50 ? `(Confluence ready)` : '(Need 50+ ticks)'}\n`;
                summary += `    🎯 Bollinger+RSI: ${s1Ready}/3 ready (Squeeze: ${bollinger.squeeze}, RSI: ${rsi.toFixed(1)})\n`;
                summary += `    🚀 Price Action: ${s2Ready}/3 ready (Mom: ${momentum.toFixed(2)}%, S/R: ${supportResistance.nearSupport || supportResistance.nearResistance})\n`;
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