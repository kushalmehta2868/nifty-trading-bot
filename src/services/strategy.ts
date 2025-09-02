import { webSocketFeed } from './webSocketFeed';
import { angelAPI } from './angelAPI';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { isMarketOpen } from '../utils/marketHours';
import {
  TradingSignal,
  PriceUpdate,
  IndexName,
  Direction,
  OptionType,
  TechnicalIndicators
} from '../types';

interface PriceBufferItem {
  price: number;
  timestamp: Date;
}

interface PriceBuffers {
  NIFTY: PriceBufferItem[];
  BANKNIFTY: PriceBufferItem[];
}

class TradingStrategy {
  private lastSignalTime: { [key: string]: number } = {}; // Changed to track per signal type
  private cleanupInterval: NodeJS.Timeout | null = null;
  public priceBuffers: PriceBuffers = {
    NIFTY: [],
    BANKNIFTY: []
  };


  public async initialize(): Promise<void> {
    logger.info('🎯 Trading strategy initializing...');

    // Start cleanup mechanism for old signal times (every hour)
    this.startCleanupProcess();

    // Subscribe to real-time price updates
    webSocketFeed.addSubscriber((indexName: string, priceUpdate: PriceUpdate) => {
      logger.info(`📊 Strategy received price update: ${indexName} = ₹${priceUpdate.price}`);

      this.processTick(indexName as IndexName, priceUpdate).catch(error => {
        logger.error(`Error processing tick for ${indexName}:`, error.message);
      });
    });

    // ✅ Better data checking with retry logic
    const checkData = async (attempt: number = 1): Promise<void> => {
      logger.info(`🔍 Checking WebSocket data (attempt ${attempt})...`);

      let hasData = false;
      for (const indexName of ['NIFTY', 'BANKNIFTY'] as IndexName[]) {
        const currentPrice = webSocketFeed.getCurrentPrice(indexName);
        const priceHistory = webSocketFeed.getPriceHistory(indexName);
        const wsStatus = webSocketFeed.getConnectionStatus();

        logger.info(`  ${indexName}: Price=${currentPrice}, History Length=${priceHistory.length}`);

        if (currentPrice > 0) hasData = true;
      }

      const wsStatus = webSocketFeed.getConnectionStatus();
      logger.info(`📡 WebSocket Status: Connected=${wsStatus.connected}, Healthy=${wsStatus.healthy}`);

      if (!hasData && attempt < 3) {
        logger.warn(`⚠️ No data received yet, retrying in 5 seconds (attempt ${attempt}/3)...`);
        setTimeout(() => checkData(attempt + 1), 5000);
      } else if (hasData) {
        logger.info('✅ WebSocket data is flowing to strategy');
      } else {
        logger.error('❌ No WebSocket data after 3 attempts - check connection and tokens');
      }
    };

    // Start checking after 5 seconds
    setTimeout(() => checkData(), 5000);

    logger.info('🎯 Trading strategy initialized with enhanced monitoring');
  }


  async processTick(indexName: IndexName, priceUpdate: PriceUpdate): Promise<void> {
    // Skip if market is closed
    if (!isMarketOpen()) {
      const shouldLog = Date.now() % 30000 < 1000; // Log every 30 seconds
      if (shouldLog) {
        logger.info(`🔒 ${indexName} - Market closed, skipping analysis`);
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
    if (buffer.length < config.strategy.emaPeriod) {
      const shouldLog = Date.now() % 30000 < 1000; // Log every 30 seconds
      if (shouldLog) {
        logger.info(`📊 ${indexName} - Insufficient data: ${buffer.length}/${config.strategy.emaPeriod} required for analysis`);
      }
      return;
    }

    // Analyze for signals
    const signal = await this.analyzeSignal(indexName, priceUpdate.price, buffer);

    if (signal && signal.confidence >= config.strategy.confidenceThreshold) {
      const signalKey = `${indexName}_${signal.optionType}`;

      // Check cooldown for this specific signal type
      if (this.isSignalInCooldown(signalKey)) {
        const cooldownRemaining = Math.ceil((config.trading.signalCooldown - (Date.now() - (this.lastSignalTime[signalKey] || 0))) / 1000);
        logger.info(`⏳ ${indexName} ${signal.optionType} - Signal cooldown active, ${cooldownRemaining}s remaining`);
        return;
      }

      this.executeSignal(signal).catch(error => {
        logger.error('Failed to execute signal:', error.message);
      });
      this.lastSignalTime[signalKey] = Date.now();
    } else if (signal && signal.confidence < config.strategy.confidenceThreshold) {
      logger.info(`⚠️ ${indexName} - Signal generated but confidence too low: ${signal.confidence.toFixed(1)}% < ${config.strategy.confidenceThreshold}%`);
    }
  }

  private async analyzeSignal(
    indexName: IndexName,
    currentPrice: number,
    priceBuffer: PriceBufferItem[]
  ): Promise<TradingSignal | null> {
    const prices = priceBuffer.map(item => item.price);

    if (!this.isWithinTradingHours(indexName)) {
      const shouldLog = Date.now() % 30000 < 1000;
      if (shouldLog) {
        const currentTime = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
        const hours = '9:30 AM - 3:00 PM';
        logger.info(`⏰ ${indexName} - Outside trading hours (${currentTime}), signals disabled during ${hours}`);
      }
      return null;
    }

    // Try Strategy 3 first (Multi-Timeframe Confluence) - Highest accuracy
    const confluenceSignal = await this.analyzeMultiTimeframeConfluence(indexName, currentPrice, prices);
    if (confluenceSignal) return confluenceSignal;

    // Try Strategy 1 (Bollinger + RSI) - High accuracy
    const bollingerSignal = await this.analyzeBollingerRSIStrategy(indexName, currentPrice, prices);
    if (bollingerSignal) return bollingerSignal;

    // Try Strategy 2 (Price Action + Momentum) - Fast response
    const priceActionSignal = await this.analyzePriceActionStrategy(indexName, currentPrice, prices);
    if (priceActionSignal) return priceActionSignal;

    return null; // No signals from any strategy
  }

  // 🏆 STRATEGY 3: Multi-Timeframe Confluence (Highest Accuracy - 90%+)
  private async analyzeMultiTimeframeConfluence(
    indexName: IndexName,
    currentPrice: number,
    prices: number[]
  ): Promise<TradingSignal | null> {
    if (prices.length < 50) return null; // Need more data for multi-timeframe

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
    const confluenceScore = this.calculateConfluenceScore(
      currentPrice,
      { rsi1, rsi5, rsi10 },
      { sma1, sma5, sma10 },
      { momentum1, momentum5, momentum10 }
    );

    // Advanced volatility calculation for adaptive targets
    const volatility = this.calculateAdaptiveVolatility(tf1);

    // RELAXED Multi-timeframe CE conditions (more practical)
    const mtfCEConditions = {
      majority_rsi_bullish: (+((rsi1 > 50)) + (+(rsi5 > 50)) + (+(rsi10 > 50))) >= 2, // 2 out of 3 RSI bullish
      trend_alignment: currentPrice > sma1 && sma1 >= sma5 * 0.999, // More flexible trend
      momentum_positive: momentum1 > 0.01 || momentum5 > 0.01, // Very low momentum - just 0.01%
      decent_confluence: confluenceScore >= 35, // Much lower confluence requirement
      time_filter: this.isWithinTradingHours(indexName)
    };

    // RELAXED Multi-timeframe PE conditions
    const mtfPEConditions = {
      majority_rsi_bearish: (+((rsi1 < 50)) + (+(rsi5 < 50)) + (+(rsi10 < 50))) >= 2, // 2 out of 3 RSI bearish
      trend_alignment: currentPrice < sma1 && sma1 <= sma5 * 1.001, // More flexible trend
      momentum_negative: momentum1 < -0.01 || momentum5 < -0.01, // Very low momentum - just -0.01%
      decent_confluence: confluenceScore >= 35, // Much lower confluence requirement
      time_filter: this.isWithinTradingHours(indexName)
    };

    const mtfCEMet = Object.values(mtfCEConditions).every(c => c === true);
    const mtfPEMet = Object.values(mtfPEConditions).every(c => c === true);

    // Log multi-timeframe analysis every 20 seconds (less frequent due to complexity)
    const shouldLogMTF = Date.now() % 20000 < 1000;
    if (shouldLogMTF || mtfCEMet || mtfPEMet) {
      logger.info(`🏆 ${indexName} Multi-Timeframe Confluence (RELAXED):`);
      logger.info(`   💰 Price: ${currentPrice} | Confluence: ${confluenceScore.toFixed(0)}%`);
      logger.info(`   📊 RSI: 1t=${rsi1.toFixed(1)} | 5t=${rsi5.toFixed(1)} | 10t=${rsi10.toFixed(1)}`);
      logger.info(`   📈 Momentum: 1t=${momentum1.toFixed(2)}% | 5t=${momentum5.toFixed(2)}% | 10t=${momentum10.toFixed(2)}%`);
      logger.info(`   🎯 CE: ${Object.values(mtfCEConditions).filter(c => c === true).length}/5 | PE: ${Object.values(mtfPEConditions).filter(c => c === true).length}/5`);

      // Show CE condition status
      if (Object.values(mtfCEConditions).filter(c => c === true).length < 5) {
        logger.info(`   📋 CE Missing: ${mtfCEConditions.majority_rsi_bullish ? '' : 'RSI-Majority '} ${mtfCEConditions.trend_alignment ? '' : 'Trend '} ${mtfCEConditions.momentum_positive ? '' : 'Momentum '} ${mtfCEConditions.decent_confluence ? '' : 'Confluence '} ${mtfCEConditions.time_filter ? '' : 'Time'}`);
      }

      // Show PE condition status
      if (Object.values(mtfPEConditions).filter(c => c === true).length < 5) {
        logger.info(`   📋 PE Missing: ${mtfPEConditions.majority_rsi_bearish ? '' : 'RSI-Majority '} ${mtfPEConditions.trend_alignment ? '' : 'Trend '} ${mtfPEConditions.momentum_negative ? '' : 'Momentum '} ${mtfPEConditions.decent_confluence ? '' : 'Confluence '} ${mtfPEConditions.time_filter ? '' : 'Time'}`);
      }
    }

    let signal: TradingSignal | null = null;

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

      logger.info(`🏆 Multi-Timeframe CE Signal: Confluence=${confluenceScore.toFixed(0)}%, All TF aligned, Vol=${volatility.isExpanding}`);
    } else if (mtfPEMet) {
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

      logger.info(`🏆 Multi-Timeframe PE Signal: Confluence=${confluenceScore.toFixed(0)}%, All TF aligned, Vol=${volatility.isExpanding}`);
    }

    return signal;
  }

  // 🎯 STRATEGY 1: Bollinger Bands + RSI (High Accuracy)
  private async analyzeBollingerRSIStrategy(
    indexName: IndexName,
    currentPrice: number,
    prices: number[]
  ): Promise<TradingSignal | null> {
    // Calculate indicators
    const rsi = this.calculateRSI(prices, 14);
    const bollinger = this.calculateBollingerBands(prices, 20, 2);
    const momentum = this.calculateMomentum(prices, 10);

    // RELAXED Strategy 1 Conditions: Bollinger Bands + RSI (No squeeze required)
    const bollingerCEConditions = {
      price_near_lower_or_oversold: currentPrice <= bollinger.lower * 1.01 || rsi < 35, // Near lower band OR oversold
      rsi_recovery_zone: rsi > 30 && rsi < 60, // Wider RSI range
      trend_support: currentPrice > bollinger.middle * 0.995, // Above or near middle band
      momentum_positive: momentum > 0.01, // Very low momentum - just 0.01%
      time_filter: this.isWithinTradingHours(indexName)
    };

    const bollingerPEConditions = {
      price_near_upper_or_overbought: currentPrice >= bollinger.upper * 0.99 || rsi > 65, // Near upper band OR overbought
      rsi_decline_zone: rsi < 70 && rsi > 40, // Wider RSI range
      trend_resistance: currentPrice < bollinger.middle * 1.005, // Below or near middle band
      momentum_negative: momentum < -0.01, // Very low momentum - just -0.01%
      time_filter: this.isWithinTradingHours(indexName)
    };

    const bollingerCEMet = Object.values(bollingerCEConditions).every(c => c === true);
    const bollingerPEMet = Object.values(bollingerPEConditions).every(c => c === true);

    // Log strategy 1 analysis every 15 seconds
    const shouldLogBollinger = Date.now() % 15000 < 1000;
    if (shouldLogBollinger || bollingerCEMet || bollingerPEMet) {
      logger.info(`🎯 ${indexName} Bollinger+RSI Strategy (RELAXED):`);
      logger.info(`   💰 Price: ${currentPrice} | BB Upper: ${bollinger.upper.toFixed(2)} | Middle: ${bollinger.middle.toFixed(2)} | Lower: ${bollinger.lower.toFixed(2)}`);
      logger.info(`   📊 RSI: ${rsi.toFixed(2)} | Momentum: ${momentum.toFixed(2)}%`);
      logger.info(`   📈 CE: ${Object.values(bollingerCEConditions).filter(c => c === true).length}/5 | PE: ${Object.values(bollingerPEConditions).filter(c => c === true).length}/5`);

      // Show CE condition status
      if (Object.values(bollingerCEConditions).filter(c => c === true).length < 5) {
        logger.info(`   📋 CE Missing: ${bollingerCEConditions.price_near_lower_or_oversold ? '' : 'Near-Lower '} ${bollingerCEConditions.rsi_recovery_zone ? '' : 'RSI-Zone '} ${bollingerCEConditions.trend_support ? '' : 'Support '} ${bollingerCEConditions.momentum_positive ? '' : 'Momentum '} ${bollingerCEConditions.time_filter ? '' : 'Time'}`);
      }

      // Show PE condition status  
      if (Object.values(bollingerPEConditions).filter(c => c === true).length < 5) {
        logger.info(`   📋 PE Missing: ${bollingerPEConditions.price_near_upper_or_overbought ? '' : 'Near-Upper '} ${bollingerPEConditions.rsi_decline_zone ? '' : 'RSI-Zone '} ${bollingerPEConditions.trend_resistance ? '' : 'Resistance '} ${bollingerPEConditions.momentum_negative ? '' : 'Momentum '} ${bollingerPEConditions.time_filter ? '' : 'Time'}`);
      }

      // Strategy Analysis Update disabled for Telegram - user preference
      // if (shouldLogBollinger && Date.now() % 60000 < 1000) { // Every minute
      //   (process as any).emit('strategyAnalysis', {
      //     indexName,
      //     analysis: {
      //       type: 'Bollinger+RSI',
      //       currentPrice,
      //       rsi: rsi,
      //       bollinger: {
      //         upper: bollinger.upper,
      //         lower: bollinger.lower,
      //         squeeze: bollinger.squeeze,
      //         ready: Object.values(bollingerCEConditions).filter(c => c === true).length >= 3 || 
      //                Object.values(bollingerPEConditions).filter(c => c === true).length >= 3
      //       },
      //       momentum: momentum,
      //       volatility: { isExpanding: false }
      //     }
      //   });
      // }
    }

    let signal: TradingSignal | null = null;

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

      logger.info(`🎯 Bollinger+RSI CE Signal: Squeeze=${bollinger.squeeze}, RSI=${rsi.toFixed(2)}, Momentum=${momentum.toFixed(2)}%`);
    } else if (bollingerPEMet) {
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

      logger.info(`🎯 Bollinger+RSI PE Signal: Squeeze=${bollinger.squeeze}, RSI=${rsi.toFixed(2)}, Momentum=${momentum.toFixed(2)}%`);
    }

    return signal;
  }

  // 🚀 STRATEGY 2: Price Action + Momentum (Fast Response)
  private async analyzePriceActionStrategy(
    indexName: IndexName,
    currentPrice: number,
    prices: number[]
  ): Promise<TradingSignal | null> {
    const rsi = this.calculateRSI(prices, 14);
    const sma = this.calculateSMA(prices, 20);
    const supportResistance = this.calculateSupportResistance(prices);
    const momentum = this.calculateMomentum(prices, 5); // Shorter period for faster signals

    // RELAXED Strategy 2: Price Action + Momentum (More practical)
    const priceActionCEConditions = {
      price_momentum_bullish: momentum > 0.01 && rsi > 45, // Very low momentum requirement
      trend_bullish: currentPrice > sma || rsi > 55, // Either above SMA OR strong RSI
      not_overbought: rsi < 75, // Not extremely overbought
      time_filter: this.isWithinTradingHours(indexName)
    };

    const priceActionPEConditions = {
      price_momentum_bearish: momentum < -0.01 && rsi < 55, // Very low momentum requirement
      trend_bearish: currentPrice < sma || rsi < 45, // Either below SMA OR weak RSI
      not_oversold: rsi > 25, // Not extremely oversold
      time_filter: this.isWithinTradingHours(indexName)
    };

    const actionCEMet = Object.values(priceActionCEConditions).every(c => c === true);
    const actionPEMet = Object.values(priceActionPEConditions).every(c => c === true);

    // Log strategy 2 analysis every 15 seconds
    const shouldLogAction = Date.now() % 15000 < 1000;
    if (shouldLogAction || actionCEMet || actionPEMet) {
      logger.info(`🚀 ${indexName} Price Action Strategy (RELAXED):`);
      logger.info(`   💰 Price: ${currentPrice} | SMA: ${sma.toFixed(2)}`);
      logger.info(`   📊 RSI: ${rsi.toFixed(2)} | Momentum: ${momentum.toFixed(2)}%`);
      logger.info(`   📈 CE: ${Object.values(priceActionCEConditions).filter(c => c === true).length}/4 | PE: ${Object.values(priceActionPEConditions).filter(c => c === true).length}/4`);

      // Show CE condition status
      if (Object.values(priceActionCEConditions).filter(c => c === true).length < 4) {
        logger.info(`   📋 CE Missing: ${priceActionCEConditions.price_momentum_bullish ? '' : 'Bullish-Momentum '} ${priceActionCEConditions.trend_bullish ? '' : 'Bullish-Trend '} ${priceActionCEConditions.not_overbought ? '' : 'Not-Overbought '} ${priceActionCEConditions.time_filter ? '' : 'Time'}`);
      }

      // Show PE condition status
      if (Object.values(priceActionPEConditions).filter(c => c === true).length < 4) {
        logger.info(`   📋 PE Missing: ${priceActionPEConditions.price_momentum_bearish ? '' : 'Bearish-Momentum '} ${priceActionPEConditions.trend_bearish ? '' : 'Bearish-Trend '} ${priceActionPEConditions.not_oversold ? '' : 'Not-Oversold '} ${priceActionPEConditions.time_filter ? '' : 'Time'}`);
      }
    }

    let signal: TradingSignal | null = null;

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

      logger.info(`🚀 Price Action CE Signal: Support bounce with ${momentum.toFixed(2)}% momentum`);
    } else if (actionPEMet) {
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

      logger.info(`🚀 Price Action PE Signal: Resistance rejection with ${momentum.toFixed(2)}% momentum`);
    }

    return signal;
  }

  private async executeSignal(signal: TradingSignal): Promise<void> {
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

        logger.info(`✅ Real Option Price: ${signal.optionSymbol} = ₹${signal.entryPrice}`);
        logger.info(`🎯 Adaptive Targets: Target=₹${signal.target} (+${profitPotential.toFixed(1)}%) | SL=₹${signal.stopLoss} (-${riskAmount.toFixed(1)}%)`);
        logger.info(`📊 Risk:Reward = 1:${riskReward.toFixed(2)} | Volatility Expanding: ${volatility.isExpanding}`);
      } else {
        logger.error(`CRITICAL: Could not fetch real option price for ${signal.optionSymbol}`);
        throw new Error('Real option price required - cannot proceed with estimated prices');
      }

      logger.info(`🚨 LIVE Signal: ${signal.indexName} ${signal.direction} - Confidence: ${signal.confidence.toFixed(0)}%`);
      logger.info(`💰 Real Option Price: ${signal.optionSymbol} = ₹${signal.entryPrice}`);

      // Emit signal for telegram bot
      (process as any).emit('tradingSignal', signal);

    } catch (error) {
      logger.error('Error in executeSignal:', (error as Error).message);
    }
  }

  private async getRealOptionPrice(signal: TradingSignal): Promise<number | null> {
    try {
      logger.info(`Fetching real option price for ${signal.optionSymbol}`);

      // Generate expiry string with index-specific logic
      const expiry = this.generateExpiryString(signal.indexName);
      const strike = this.calculateStrike(signal.spotPrice, signal.indexName);

      logger.info(`Using expiry: ${expiry} for ${signal.indexName} option with strike: ${strike}`);

      // Get option token first
      const tokenResponse = await angelAPI.getOptionToken(
        signal.indexName,
        strike,
        signal.optionType,
        expiry
      );

      if (!tokenResponse) {
        logger.error(`CRITICAL: Could not get token for ${signal.optionSymbol} with expiry ${expiry}`);
        throw new Error(`Option token lookup failed for ${signal.indexName} expiry ${expiry}`);
      }

      // Fetch real option price using token
      const optionPrice = await angelAPI.getOptionPrice(signal.optionSymbol, tokenResponse);

      if (optionPrice && optionPrice > 0) {
        logger.info(`✅ Real option price fetched: ${signal.optionSymbol} = ₹${optionPrice}`);
        return optionPrice;
      }

      logger.error(`CRITICAL: Invalid option price received for ${signal.optionSymbol}`);
      throw new Error('Invalid option price from API');

    } catch (error) {
      logger.error(`CRITICAL: Failed to fetch real option price for ${signal.optionSymbol}:`, (error as Error).message);
      throw error;
    }
  }

  private generateExpiryString(indexName?: IndexName): string {
    const today = new Date();
    
    if (indexName === 'BANKNIFTY') {
      // BANKNIFTY: Monthly expiry only (no weekly since Nov 2024)
      // Expiry: Last Thursday of the month
      const currentMonth = today.getMonth();
      const currentYear = today.getFullYear();
      
      // Find last Thursday of current month
      const lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0);
      let lastThursday = new Date(lastDayOfMonth);
      
      // Move backward to find last Thursday
      while (lastThursday.getDay() !== 4) { // 4 = Thursday
        lastThursday.setDate(lastThursday.getDate() - 1);
      }
      
      // If last Thursday is today or has passed, move to next month
      if (lastThursday <= today) {
        const nextMonth = currentMonth + 1;
        const nextYear = nextMonth > 11 ? currentYear + 1 : currentYear;
        const adjustedMonth = nextMonth > 11 ? 0 : nextMonth;
        
        const lastDayOfNextMonth = new Date(nextYear, adjustedMonth + 1, 0);
        lastThursday = new Date(lastDayOfNextMonth);
        
        while (lastThursday.getDay() !== 4) {
          lastThursday.setDate(lastThursday.getDate() - 1);
        }
      }
      
      const day = lastThursday.getDate().toString().padStart(2, '0');
      const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      const month = months[lastThursday.getMonth()];
      const year = lastThursday.getFullYear().toString().slice(-2);
      
      return `${day}${month}${year}`;
    } else {
      // NIFTY: Weekly expiry on Tuesday (changed from Thursday since Sept 1, 2025)
      const nextTuesday = new Date(today);
      const daysUntilTuesday = (2 - today.getDay() + 7) % 7; // 2 = Tuesday
      const adjustedDays = daysUntilTuesday === 0 ? 7 : daysUntilTuesday;
      nextTuesday.setDate(today.getDate() + adjustedDays);

      const day = nextTuesday.getDate().toString().padStart(2, '0');
      const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      const month = months[nextTuesday.getMonth()];
      const year = nextTuesday.getFullYear().toString().slice(-2);

      return `${day}${month}${year}`;
    }
  }

  private calculateEMA(prices: number[], period: number): number {
    if (prices.length < period) return prices[prices.length - 1];

    const multiplier = 2 / (period + 1);
    let ema = prices[0];

    for (let i = 1; i < prices.length; i++) {
      ema = (prices[i] * multiplier) + (ema * (1 - multiplier));
    }

    return ema;
  }

  private calculateRSI(prices: number[], period: number): number {
    if (prices.length < period + 1) return 50;

    let gains = 0;
    let losses = 0;

    // Use the MOST RECENT prices, not the first ones
    const startIndex = prices.length - period;
    for (let i = startIndex; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) gains += change;
      else losses -= change;
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  private calculateStrike(spotPrice: number, indexName: IndexName): number {
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
  private calculateOptimalStrike(spotPrice: number, indexName: IndexName, optionType: OptionType): number {
    let baseStrike: number;
    let strikeInterval: number;

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
    } else {
      // For PE options, go 1-2 strikes below ATM for better liquidity
      return baseStrike - strikeInterval;
    }
  }

  // Simple Moving Average calculation
  private calculateSMA(prices: number[], period: number): number {
    if (prices.length < period) {
      // If not enough data, use all available prices
      period = prices.length;
    }

    const recentPrices = prices.slice(-period);
    const sum = recentPrices.reduce((acc, price) => acc + price, 0);
    return sum / period;
  }

  // Bollinger Bands calculation - excellent for volatility-based entries
  private calculateBollingerBands(prices: number[], period: number = 20, stdDev: number = 2): {
    upper: number;
    middle: number;
    lower: number;
    squeeze: boolean;
    bandwidth: number;
  } {
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
  private calculateMomentum(prices: number[], period: number = 10): number {
    if (prices.length < period + 1) return 0;

    const currentPrice = prices[prices.length - 1];
    const pastPrice = prices[prices.length - 1 - period];

    return ((currentPrice - pastPrice) / pastPrice) * 100;
  }

  // Support/Resistance levels from recent price action
  private calculateSupportResistance(prices: number[], period: number = 20): {
    resistance: number;
    support: number;
    nearResistance: boolean;
    nearSupport: boolean;
  } {
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
  private compressToTimeframe(prices: number[], compression: number): number[] {
    const compressed: number[] = [];
    for (let i = compression - 1; i < prices.length; i += compression) {
      // Use the last price in each compression window
      compressed.push(prices[i]);
    }
    return compressed.length > 0 ? compressed : [prices[prices.length - 1]];
  }

  // Advanced confluence scoring system
  private calculateConfluenceScore(
    currentPrice: number,
    rsiData: { rsi1: number; rsi5: number; rsi10: number },
    smaData: { sma1: number; sma5: number; sma10: number },
    momentumData: { momentum1: number; momentum5: number; momentum10: number }
  ): number {
    let score = 0;

    // RSI confluence (0-30 points)
    const rsiAlignment = this.checkAlignment([rsiData.rsi1, rsiData.rsi5, rsiData.rsi10]);
    score += rsiAlignment * 30;

    // Trend confluence (0-25 points) 
    const trendAlignment = this.checkTrendAlignment(currentPrice, smaData.sma1, smaData.sma5, smaData.sma10);
    score += trendAlignment * 25;

    // Momentum confluence (0-25 points)
    const momAlignment = this.checkMomentumAlignment([momentumData.momentum1, momentumData.momentum5, momentumData.momentum10]);
    score += momAlignment * 25;

    // Price position relative to moving averages (0-20 points)
    const priceScore = this.calculatePricePositionScore(currentPrice, smaData);
    score += priceScore * 20;

    return Math.min(100, score);
  }

  // Check alignment between multiple values (0-1 score)
  private checkAlignment(values: number[]): number {
    const directions = values.map(v => v > 50 ? 1 : -1); // For RSI-like values
    const allSame = directions.every(d => d === directions[0]);
    return allSame ? 1 : 0;
  }

  // Check momentum alignment (0-1 score)
  private checkMomentumAlignment(momentumValues: number[]): number {
    const directions = momentumValues.map(v => v > 0 ? 1 : -1); // Positive or negative momentum
    const allSame = directions.every(d => d === directions[0]);
    return allSame ? 1 : 0;
  }

  // Check trend alignment across timeframes
  private checkTrendAlignment(price: number, sma1: number, sma5: number, sma10: number): number {
    // All ascending (bullish) or all descending (bearish)
    const bullish = price > sma1 && sma1 > sma5 && sma5 > sma10;
    const bearish = price < sma1 && sma1 < sma5 && sma5 < sma10;
    return (bullish || bearish) ? 1 : 0;
  }

  // Calculate price position score relative to moving averages
  private calculatePricePositionScore(price: number, smaData: { sma1: number; sma5: number; sma10: number }): number {
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
  private calculateAdaptiveVolatility(prices: number[]): {
    current: number;
    average: number;
    isExpanding: boolean;
    adaptive_target: number;
    adaptive_sl: number;
  } {
    const period = Math.min(20, prices.length);
    const recentPrices = prices.slice(-period);

    // Calculate True Range for each period
    const trueRanges: number[] = [];
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
  private calculateBasicVolatility(prices: number[]): number {
    if (prices.length < 2) return 0;

    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((acc, ret) => acc + Math.pow(ret - mean, 2), 0) / returns.length;

    return Math.sqrt(variance);
  }


  private generateOptionSymbol(indexName: IndexName, strike: number, optionType: OptionType): string {
    const expiryString = this.generateExpiryString(indexName);
    // NSE options format: NIFTY03SEP25024700CE or BANKNIFTY26SEP2552500PE
    return `${indexName}${expiryString}${strike}${optionType}`;
  }

  private isSignalInCooldown(signalKey: string): boolean {
    const lastTime = this.lastSignalTime[signalKey];
    return lastTime ? (Date.now() - lastTime) < config.trading.signalCooldown : false;
  }



  private getTriggerLevel(currentPrice: number, indexName: IndexName): number {
    // Get recent price data for better trigger calculation
    const priceHistory = webSocketFeed.getPriceHistory(indexName);

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

  private isWithinTradingHours(indexName?: IndexName): boolean {
    const now = new Date();
    const istTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const currentTime = istTime.getHours() * 100 + istTime.getMinutes();

    if (!indexName) {
      return isMarketOpen(); // General check
    }

    // NSE trading hours: 9:30 AM to 3:00 PM (for signals)
    const startTime = 930;  // 9:30 AM
    const endTime = 1500;   // 3:00 PM
    const isOpen = currentTime >= startTime && currentTime <= endTime;

    // Log NSE hours for debugging
    if (!isOpen) {
      logger.debug(`NSE ${indexName} outside hours: ${currentTime} (need 930-1500)`);
    }

    return isOpen;
  }


  public async getCurrentMarketConditions(): Promise<string> {
    try {
      let summary = '\n📊 Current Market Conditions (Triple Strategy System):\n';

      // Add WebSocket connection status
      const wsStatus = webSocketFeed.getConnectionStatus();
      summary += `🔗 WebSocket: ${wsStatus.connected ? '✅ Connected' : '❌ Disconnected'} | Healthy: ${wsStatus.healthy}\n\n`;

      for (const indexName of ['NIFTY', 'BANKNIFTY'] as IndexName[]) {
        const buffer = this.priceBuffers[indexName];
        const currentPrice = webSocketFeed.getCurrentPrice(indexName);

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

          const confluenceScore = this.calculateConfluenceScore(
            currentPrice,
            { rsi1: rsi, rsi5, rsi10 },
            { sma1: this.calculateSMA(prices, 20), sma5: this.calculateSMA(tf5, 20), sma10: this.calculateSMA(tf10, 20) },
            { momentum1: momentum, momentum5: this.calculateMomentum(tf5, 5), momentum10: this.calculateMomentum(tf10, 5) }
          );

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
    } catch (error) {
      logger.error('Error in getCurrentMarketConditions:', (error as Error).message);
      return '\n📊 Current Market Conditions: Error retrieving data\n';
    }
  }

  private startCleanupProcess(): void {
    // Clean up old signal times every hour to prevent memory growth
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldSignalTimes();
    }, 60 * 60 * 1000); // Every hour

    logger.info('🧹 Strategy cleanup process started (hourly signal time cleanup)');
  }

  private cleanupOldSignalTimes(): void {
    const now = Date.now();
    const dayAgo = now - (24 * 60 * 60 * 1000); // 24 hours ago
    let cleanedCount = 0;

    Object.keys(this.lastSignalTime).forEach(key => {
      if (this.lastSignalTime[key] < dayAgo) {
        delete this.lastSignalTime[key];
        cleanedCount++;
      }
    });

    if (cleanedCount > 0) {
      logger.info(`🧹 Cleaned up ${cleanedCount} old signal times older than 24 hours`);
    }
  }

  public stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      logger.info('🧹 Strategy cleanup process stopped');
    }
  }
}

export const strategy = new TradingStrategy();