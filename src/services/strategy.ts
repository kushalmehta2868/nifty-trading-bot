import { config } from '../config/config';
import {
  IndexName,
  OptionType,
  PriceUpdate,
  TradingSignal
} from '../types';
import { logger } from '../utils/logger';
import { isMarketOpen } from '../utils/marketHours';
import { angelAPI } from './angelAPI';
import { webSocketFeed } from './webSocketFeed';

interface PriceBufferItem {
  price: number;
  timestamp: Date;
}

interface PriceBuffers {
  NIFTY: PriceBufferItem[];
  BANKNIFTY: PriceBufferItem[];
}

class TradingStrategy {
  private lastSignalTime: { [key: string]: number } = {}; // Track per signal type
  private activePositions: { [key: string]: boolean } = {}; // Track active positions per index
  private cleanupInterval: NodeJS.Timeout | null = null;
  private positionLoggingInterval: NodeJS.Timeout | null = null;
  private eventHandlers: Map<string, Function> = new Map(); // Track event handlers for cleanup
  public priceBuffers: PriceBuffers = {
    NIFTY: [],
    BANKNIFTY: []
  };

  // Index-specific momentum thresholds based on volatility characteristics
  private getMomentumThreshold(indexName: IndexName): number {
    switch (indexName) {
      case 'NIFTY':
        return 0.015; // 0.015% - Relaxed for better signal frequency
      case 'BANKNIFTY':
        return 0.025; // 0.025% - Relaxed for better signal frequency
      default:
        return 0.015; // Default fallback
    }
  }


  public async initialize(): Promise<void> {
    logger.info('🎯 Trading strategy initializing...');

    // Listen for order placement confirmations (position already locked during signal processing)
    const orderPlacedHandler = (data: any) => {
      const indexName = data.signal.indexName;
      // Position already locked during signal processing - just log confirmation
      logger.info(`✅ ORDER PLACED CONFIRMED: ${indexName} - position remains locked`);
      this.logActivePositionsStatus('ORDER_PLACED_CONFIRMED');
    };
    (process as any).on('orderPlaced', orderPlacedHandler);
    this.eventHandlers.set('orderPlaced', orderPlacedHandler);

    const orderExitedHandler = (data: any) => {
      const indexName = data.order.signal.indexName;
      this.activePositions[indexName] = false;
      logger.info(`🔓 POSITION UNLOCKED: ${indexName} - allowing new signals`);
      this.logActivePositionsStatus('ORDER_EXITED');
    };
    (process as any).on('orderExited', orderExitedHandler);
    this.eventHandlers.set('orderExited', orderExitedHandler);

    // Listen for order cancellations to unlock positions
    const orderCancelledHandler = (data: any) => {
      const indexName = data.order.signal.indexName;
      this.activePositions[indexName] = false;
      logger.info(`🔓 POSITION UNLOCKED after cancellation: ${indexName} - allowing new signals`);
      this.logActivePositionsStatus('ORDER_CANCELLED');
    };
    (process as any).on('orderCancelled', orderCancelledHandler);
    this.eventHandlers.set('orderCancelled', orderCancelledHandler);

    // Listen for order rejections/failures to unlock positions
    const orderRejectedHandler = (data: any) => {
      const indexName = data.signal.indexName;
      this.activePositions[indexName] = false;
      logger.info(`🔓 POSITION UNLOCKED after rejection: ${indexName} - allowing new signals`);
      logger.error(`💥 Order rejected: ${data.reason}`);
      this.logActivePositionsStatus('ORDER_REJECTED');
    };
    (process as any).on('orderRejected', orderRejectedHandler);
    this.eventHandlers.set('orderRejected', orderRejectedHandler);

    const orderFailedHandler = (data: any) => {
      const indexName = data.signal.indexName;
      this.activePositions[indexName] = false;
      logger.info(`🔓 POSITION UNLOCKED after failure: ${indexName} - allowing new signals`);
      logger.error(`💥 Order failed: ${data.reason}`);
      this.logActivePositionsStatus('ORDER_FAILED');
    };
    (process as any).on('orderFailed', orderFailedHandler);
    this.eventHandlers.set('orderFailed', orderFailedHandler);

    const signalExecutionFailedHandler = (data: any) => {
      const indexName = data.signal.indexName;
      this.activePositions[indexName] = false;
      logger.info(`🔓 POSITION UNLOCKED after signal execution failure: ${indexName} - allowing new signals`);
      logger.error(`💥 Signal execution failed: ${data.reason}`);
      this.logActivePositionsStatus('SIGNAL_EXECUTION_FAILED');
    };
    (process as any).on('signalExecutionFailed', signalExecutionFailedHandler);
    this.eventHandlers.set('signalExecutionFailed', signalExecutionFailedHandler);

    // Start cleanup mechanism for old signal times (every hour)
    this.startCleanupProcess();

    // Start periodic position status logging (every 30 seconds)
    this.startPositionStatusLogging();

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
    if (!buffer) {
      logger.error(`Price buffer not initialized for ${indexName}`);
      return;
    }

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
      // ✅ CRITICAL FIX: Multi-layer duplicate prevention
      const signalKey = indexName; // Use index name for tracking

      // Check 1: Active position blocking (most important)
      if (this.activePositions[indexName]) {
        logger.info(`🔒 ${indexName} - Position already active, blocking ${signal.optionType} signal`);
        this.logActivePositionsStatus('SIGNAL_BLOCKED');
        return;
      }

      // Check 2: Recent signal cooldown (prevents rapid-fire signals)
      if (this.isSignalInCooldown(signalKey)) {
        const cooldownRemaining = Math.ceil((config.trading.signalCooldown - (Date.now() - (this.lastSignalTime[signalKey] || 0))) / 1000);
        logger.info(`⏳ ${indexName} - Signal cooldown active, ${cooldownRemaining}s remaining`);
        return;
      }

      // ✅ RACE CONDITION FIX: Lock position IMMEDIATELY to prevent duplicate signals
      this.activePositions[indexName] = true;
      logger.info(`🔒 IMMEDIATE LOCK: ${indexName} - blocking subsequent signals during processing`);
      this.logActivePositionsStatus('SIGNAL_PROCESSING');

      // ✅ CRITICAL: Set cooldown BEFORE executing signal to prevent race conditions
      this.lastSignalTime[signalKey] = Date.now();

      this.executeSignal(signal).catch(error => {
        logger.error('Failed to execute signal:', error.message);
        // Reset cooldown and unlock position on failure to allow retry
        delete this.lastSignalTime[signalKey];
        this.activePositions[indexName] = false;
        logger.info(`🔓 UNLOCKED after signal execution failure: ${indexName}`);
        this.logActivePositionsStatus('SIGNAL_EXECUTION_FAILED');
      });
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
        const hours = '9:30 AM - 2:45 PM';
        logger.info(`⏰ ${indexName} - Outside signal hours (${currentTime}), new trades disabled after 2:45 PM - active during ${hours}`);
      }
      return null;
    }

    // Try Strategy 3 first (Multi-Timeframe Confluence) - Highest accuracy
    const confluenceSignal = await this.analyzeMultiTimeframeConfluence(indexName, currentPrice, prices, priceBuffer);
    if (confluenceSignal) return confluenceSignal;

    // Try Strategy 1 (Bollinger + RSI) - High accuracy
    const bollingerSignal = await this.analyzeBollingerRSIStrategy(indexName, currentPrice, prices, priceBuffer);
    if (bollingerSignal) return bollingerSignal;

    // Try Strategy 2 (Price Action + Momentum) - Fast response
    const priceActionSignal = await this.analyzePriceActionStrategy(indexName, currentPrice, prices, priceBuffer);
    if (priceActionSignal) return priceActionSignal;

    return null; // No signals from any strategy
  }

  // 🏆 STRATEGY 3: Multi-Timeframe Confluence (Highest Accuracy - 90%+)
  private async analyzeMultiTimeframeConfluence(
    indexName: IndexName,
    currentPrice: number,
    prices: number[],
    priceBuffer: PriceBufferItem[]
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

    // ✅ NEW: VWAP analysis
    const vwapData = this.calculateVWAP(priceBuffer, 20);

    // ✅ OPTIMIZED Multi-timeframe CE conditions (balanced quality vs frequency + VWAP)
    const mtfCEConditions = {
      rsi_bullish: (+((rsi1 > 52)) + (+(rsi5 > 52)) + (+(rsi10 > 52))) >= 2, // Relaxed RSI requirement
      trend_alignment: currentPrice > sma1 && sma1 >= sma5, // Less strict - only 2 timeframes
      momentum_strong: momentum1 > this.getMomentumThreshold(indexName) || momentum5 > this.getMomentumThreshold(indexName), // OR instead of AND
      confluence_good: confluenceScore >= 60, // Lower confluence requirement
      vwap_bullish: currentPrice > vwapData.vwap && (vwapData.vwapTrend === 'BULLISH' || vwapData.priceVsVwap > 0.05), // Price above VWAP with bullish bias
      time_filter: this.isWithinTradingHours(indexName)
    };

    // ✅ OPTIMIZED Multi-timeframe PE conditions (balanced quality vs frequency + VWAP)
    const mtfPEConditions = {
      rsi_bearish: (+((rsi1 < 48)) + (+(rsi5 < 48)) + (+(rsi10 < 48))) >= 2, // Relaxed RSI requirement
      trend_alignment: currentPrice < sma1 && sma1 <= sma5, // Less strict - only 2 timeframes
      momentum_strong: momentum1 < -this.getMomentumThreshold(indexName) || momentum5 < -this.getMomentumThreshold(indexName), // OR instead of AND
      confluence_good: confluenceScore >= 60, // Lower confluence requirement
      vwap_bearish: currentPrice < vwapData.vwap && (vwapData.vwapTrend === 'BEARISH' || vwapData.priceVsVwap < -0.05), // Price below VWAP with bearish bias
      time_filter: this.isWithinTradingHours(indexName)
    };

    // ✅ SCORING SYSTEM: Require 5/6 conditions (including VWAP)
    const mtfCEScore = Object.values(mtfCEConditions).filter(c => c === true).length;
    const mtfPEScore = Object.values(mtfPEConditions).filter(c => c === true).length;
    
    const mtfCEMet = mtfCEScore >= 5; // 5 out of 6 conditions (higher bar with VWAP)
    const mtfPEMet = mtfPEScore >= 5; // 5 out of 6 conditions (higher bar with VWAP)

    // Log multi-timeframe analysis every 20 seconds (less frequent due to complexity)
    const shouldLogMTF = Date.now() % 20000 < 1000;
    if (shouldLogMTF || mtfCEMet || mtfPEMet) {
      logger.info(`🏆 ${indexName} Multi-Timeframe Confluence (OPTIMIZED + VWAP):`);
      logger.info(`   💰 Price: ${currentPrice} | VWAP: ${vwapData.vwap} (${vwapData.priceVsVwap > 0 ? '+' : ''}${vwapData.priceVsVwap.toFixed(2)}%) | Trend: ${vwapData.vwapTrend}`);
      logger.info(`   📊 RSI: 1t=${rsi1.toFixed(1)} | 5t=${rsi5.toFixed(1)} | 10t=${rsi10.toFixed(1)} | Confluence: ${confluenceScore.toFixed(0)}%`);
      logger.info(`   📈 Momentum: 1t=${momentum1.toFixed(2)}% | 5t=${momentum5.toFixed(2)}% | 10t=${momentum10.toFixed(2)}%`);
      logger.info(`   🎯 CE: ${mtfCEScore}/6 (need 5+) | PE: ${mtfPEScore}/6 (need 5+)`);

      // Show CE condition status
      if (mtfCEScore < 5) {
        logger.info(`   📋 CE Missing: ${mtfCEConditions.rsi_bullish ? '' : 'RSI-Bullish '} ${mtfCEConditions.trend_alignment ? '' : 'Trend-Aligned '} ${mtfCEConditions.momentum_strong ? '' : 'Momentum '} ${mtfCEConditions.confluence_good ? '' : 'Confluence '} ${mtfCEConditions.vwap_bullish ? '' : 'VWAP-Bullish '} ${mtfCEConditions.time_filter ? '' : 'Time'}`);
      }

      // Show PE condition status
      if (mtfPEScore < 5) {
        logger.info(`   📋 PE Missing: ${mtfPEConditions.rsi_bearish ? '' : 'RSI-Bearish '} ${mtfPEConditions.trend_alignment ? '' : 'Trend-Aligned '} ${mtfPEConditions.momentum_strong ? '' : 'Momentum '} ${mtfPEConditions.confluence_good ? '' : 'Confluence '} ${mtfPEConditions.vwap_bearish ? '' : 'VWAP-Bearish '} ${mtfPEConditions.time_filter ? '' : 'Time'}`);
      }
    }

    let signal: TradingSignal | null = null;

    if (mtfCEMet) {
      // ✅ Use new premium-based strike selection
      const expiry = this.generateExpiryString(indexName);
      const { strike, estimatedPremium } = await this.calculateOptimalStrike(currentPrice, indexName, 'CE', expiry);
      const baseConfidence = 80; // Base for relaxed multi-timeframe
      const confluenceBonus = Math.min(15, (confluenceScore - 60) / 2);
      const trendBonus = mtfCEConditions.trend_alignment ? 5 : 0;

      signal = {
        indexName,
        direction: 'UP',
        spotPrice: currentPrice,
        optionType: 'CE',
        optionSymbol: this.generateOptionSymbol(indexName, strike, 'CE'),
        entryPrice: 0, // Will be set by real API call
        target: 0,
        stopLoss: 0,
        confidence: Math.min(98, baseConfidence + confluenceBonus + trendBonus),
        timestamp: new Date(),
        technicals: {
          ema: 0,
          rsi: parseFloat(rsi1.toFixed(2)),
          priceChange: parseFloat(momentum1.toFixed(2)),
          vwap: parseFloat(vwapData.vwap.toFixed(2))
        }
      };

      logger.info(`🏆 Multi-Timeframe CE Signal: Strike=${strike}, Est Premium=₹${estimatedPremium.toFixed(2)}, Confluence=${confluenceScore.toFixed(0)}%`);
    } else if (mtfPEMet) {
      // ✅ Use new premium-based strike selection
      const expiry = this.generateExpiryString(indexName);
      const { strike, estimatedPremium } = await this.calculateOptimalStrike(currentPrice, indexName, 'PE', expiry);
      const baseConfidence = 80;
      const confluenceBonus = Math.min(15, (confluenceScore - 60) / 2);
      const trendBonus = mtfPEConditions.trend_alignment ? 5 : 0;

      signal = {
        indexName,
        direction: 'DOWN',
        spotPrice: currentPrice,
        optionType: 'PE',
        optionSymbol: this.generateOptionSymbol(indexName, strike, 'PE'),
        entryPrice: 0, // Will be set by real API call
        target: 0,
        stopLoss: 0,
        confidence: Math.min(98, baseConfidence + confluenceBonus + trendBonus),
        timestamp: new Date(),
        technicals: {
          ema: 0,
          rsi: parseFloat(rsi1.toFixed(2)),
          priceChange: parseFloat(momentum1.toFixed(2)),
          vwap: parseFloat(vwapData.vwap.toFixed(2))
        }
      };

      logger.info(`🏆 Multi-Timeframe PE Signal: Strike=${strike}, Est Premium=₹${estimatedPremium.toFixed(2)}, Confluence=${confluenceScore.toFixed(0)}%`);
    }

    return signal;
  }

  // 🎯 STRATEGY 1: Bollinger Bands + RSI (High Accuracy)
  private async analyzeBollingerRSIStrategy(
    indexName: IndexName,
    currentPrice: number,
    prices: number[],
    priceBuffer: PriceBufferItem[]
  ): Promise<TradingSignal | null> {
    // Calculate indicators
    const rsi = this.calculateRSI(prices, 14);
    const bollinger = this.calculateBollingerBands(prices, 20, 2);
    const momentum = this.calculateMomentum(prices, 10);
    const volatility = this.calculateAdaptiveVolatility(prices);
    
    // ✅ VWAP analysis for bollinger strategy
    const vwapData = this.calculateVWAP(priceBuffer, 20);

    // ✅ OPTIMIZED Strategy 1 Conditions: Bollinger Bands + RSI + VWAP (Balanced approach)
    const bollingerCEConditions = {
      price_near_lower: currentPrice <= bollinger.lower * 1.01 || rsi < 40, // OR condition for flexibility
      rsi_recovery_zone: rsi > 28 && rsi < 55, // Wider RSI range
      trend_or_squeeze: currentPrice > bollinger.middle || bollinger.squeeze, // OR condition
      momentum_decent: momentum > this.getMomentumThreshold(indexName) * 0.75, // Reduced threshold
      volatility_favorable: bollinger.squeeze || volatility.isExpanding || bollinger.bandwidth > 8, // More options
      vwap_supportive: currentPrice > vwapData.vwap * 0.998 || vwapData.vwapTrend === 'BULLISH' || vwapData.priceVsVwap > -0.1, // Flexible VWAP condition
      time_filter: this.isWithinTradingHours(indexName)
    };

    const bollingerPEConditions = {
      price_near_upper: currentPrice >= bollinger.upper * 0.99 || rsi > 60, // OR condition for flexibility
      rsi_decline_zone: rsi < 72 && rsi > 45, // Wider RSI range
      trend_or_squeeze: currentPrice < bollinger.middle || bollinger.squeeze, // OR condition
      momentum_decent: momentum < -this.getMomentumThreshold(indexName) * 0.75, // Reduced threshold
      volatility_favorable: bollinger.squeeze || volatility.isExpanding || bollinger.bandwidth > 8, // More options
      vwap_resistive: currentPrice < vwapData.vwap * 1.002 || vwapData.vwapTrend === 'BEARISH' || vwapData.priceVsVwap < 0.1, // Flexible VWAP condition
      time_filter: this.isWithinTradingHours(indexName)
    };

    // ✅ SCORING SYSTEM: Require 5/7 conditions (including VWAP)
    const bollingerCEScore = Object.values(bollingerCEConditions).filter(c => c === true).length;
    const bollingerPEScore = Object.values(bollingerPEConditions).filter(c => c === true).length;
    
    const bollingerCEMet = bollingerCEScore >= 5; // 5 out of 7 conditions
    const bollingerPEMet = bollingerPEScore >= 5; // 5 out of 7 conditions

    // Log strategy 1 analysis every 15 seconds
    const shouldLogBollinger = Date.now() % 15000 < 1000;
    if (shouldLogBollinger || bollingerCEMet || bollingerPEMet) {
      logger.info(`🎯 ${indexName} Bollinger+RSI Strategy (OPTIMIZED + VWAP):`);
      logger.info(`   💰 Price: ${currentPrice} | VWAP: ${vwapData.vwap} (${vwapData.priceVsVwap > 0 ? '+' : ''}${vwapData.priceVsVwap.toFixed(2)}%) | Trend: ${vwapData.vwapTrend}`);
      logger.info(`   📊 BB: Upper=${bollinger.upper.toFixed(2)} | Middle=${bollinger.middle.toFixed(2)} | Lower=${bollinger.lower.toFixed(2)} | Squeeze=${bollinger.squeeze}`);
      logger.info(`   📈 RSI: ${rsi.toFixed(2)} | Momentum: ${momentum.toFixed(2)}% | CE: ${bollingerCEScore}/7 (need 5+) | PE: ${bollingerPEScore}/7 (need 5+)`);

      // Show CE condition status
      if (bollingerCEScore < 5) {
        logger.info(`   📋 CE Missing: ${bollingerCEConditions.price_near_lower ? '' : 'Near-Lower '} ${bollingerCEConditions.rsi_recovery_zone ? '' : 'RSI-Zone '} ${bollingerCEConditions.trend_or_squeeze ? '' : 'Trend/Squeeze '} ${bollingerCEConditions.momentum_decent ? '' : 'Momentum '} ${bollingerCEConditions.volatility_favorable ? '' : 'Volatility '} ${bollingerCEConditions.vwap_supportive ? '' : 'VWAP-Support '} ${bollingerCEConditions.time_filter ? '' : 'Time'}`);
      }

      // Show PE condition status  
      if (bollingerPEScore < 5) {
        logger.info(`   📋 PE Missing: ${bollingerPEConditions.price_near_upper ? '' : 'Near-Upper '} ${bollingerPEConditions.rsi_decline_zone ? '' : 'RSI-Zone '} ${bollingerPEConditions.trend_or_squeeze ? '' : 'Trend/Squeeze '} ${bollingerPEConditions.momentum_decent ? '' : 'Momentum '} ${bollingerPEConditions.volatility_favorable ? '' : 'Volatility '} ${bollingerPEConditions.vwap_resistive ? '' : 'VWAP-Resist '} ${bollingerPEConditions.time_filter ? '' : 'Time'}`);
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
      // ✅ Use new premium-based strike selection
      const expiry = this.generateExpiryString(indexName);
      const { strike, estimatedPremium } = await this.calculateOptimalStrike(currentPrice, indexName, 'CE', expiry);
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
          vwap: parseFloat(vwapData.vwap.toFixed(2))
        }
      };

      logger.info(`🎯 Bollinger+RSI CE Signal: Strike=${strike}, Est Premium=₹${estimatedPremium.toFixed(2)}, Squeeze=${bollinger.squeeze}`);
    } else if (bollingerPEMet) {
      // ✅ Use new premium-based strike selection
      const expiry = this.generateExpiryString(indexName);
      const { strike, estimatedPremium } = await this.calculateOptimalStrike(currentPrice, indexName, 'PE', expiry);
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
          vwap: parseFloat(vwapData.vwap.toFixed(2))
        }
      };

      logger.info(`🎯 Bollinger+RSI PE Signal: Strike=${strike}, Est Premium=₹${estimatedPremium.toFixed(2)}, Squeeze=${bollinger.squeeze}`);
    }

    return signal;
  }

  // 🚀 STRATEGY 2: Price Action + Momentum (Fast Response)
  private async analyzePriceActionStrategy(
    indexName: IndexName,
    currentPrice: number,
    prices: number[],
    priceBuffer: PriceBufferItem[]
  ): Promise<TradingSignal | null> {
    const rsi = this.calculateRSI(prices, 14);
    const sma = this.calculateSMA(prices, 20);
    const supportResistance = this.calculateSupportResistance(prices);
    const momentum = this.calculateMomentum(prices, 5); // Shorter period for faster signals
    
    // ✅ VWAP analysis for price action strategy
    const vwapData = this.calculateVWAP(priceBuffer, 20);

    // ✅ OPTIMIZED Strategy 2: Price Action + Momentum + VWAP (Balanced approach)
    const priceActionCEConditions = {
      momentum_positive: momentum > this.getMomentumThreshold(indexName) * 0.8 || rsi > 52, // OR condition with lower threshold
      trend_favorable: currentPrice > sma || rsi > 50, // OR condition for flexibility
      support_or_momentum: supportResistance.nearSupport || momentum > this.getMomentumThreshold(indexName), // OR condition
      rsi_reasonable: rsi > 25 && rsi < 75, // Wider range
      price_action_decent: Math.abs(momentum) > this.getMomentumThreshold(indexName) * 0.5, // Any decent movement
      vwap_aligned: currentPrice > vwapData.vwap || vwapData.vwapTrend !== 'BEARISH' || vwapData.priceVsVwap > -0.15, // Flexible VWAP alignment
      time_filter: this.isWithinTradingHours(indexName)
    };

    const priceActionPEConditions = {
      momentum_negative: momentum < -this.getMomentumThreshold(indexName) * 0.8 || rsi < 48, // OR condition with lower threshold
      trend_favorable: currentPrice < sma || rsi < 50, // OR condition for flexibility
      resistance_or_momentum: supportResistance.nearResistance || momentum < -this.getMomentumThreshold(indexName), // OR condition
      rsi_reasonable: rsi > 25 && rsi < 75, // Wider range
      price_action_decent: Math.abs(momentum) > this.getMomentumThreshold(indexName) * 0.5, // Any decent movement
      vwap_aligned: currentPrice < vwapData.vwap || vwapData.vwapTrend !== 'BULLISH' || vwapData.priceVsVwap < 0.15, // Flexible VWAP alignment
      time_filter: this.isWithinTradingHours(indexName)
    };

    // ✅ SCORING SYSTEM: Require 5/7 conditions (including VWAP)
    const priceActionCEScore = Object.values(priceActionCEConditions).filter(c => c === true).length;
    const priceActionPEScore = Object.values(priceActionPEConditions).filter(c => c === true).length;
    
    const actionCEMet = priceActionCEScore >= 5; // 5 out of 7 conditions
    const actionPEMet = priceActionPEScore >= 5; // 5 out of 7 conditions

    // Log strategy 2 analysis every 15 seconds
    const shouldLogAction = Date.now() % 15000 < 1000;
    if (shouldLogAction || actionCEMet || actionPEMet) {
      logger.info(`🚀 ${indexName} Price Action Strategy (OPTIMIZED + VWAP):`);
      logger.info(`   💰 Price: ${currentPrice} | SMA: ${sma.toFixed(2)} | VWAP: ${vwapData.vwap} (${vwapData.priceVsVwap > 0 ? '+' : ''}${vwapData.priceVsVwap.toFixed(2)}%)`);
      logger.info(`   📊 RSI: ${rsi.toFixed(2)} | Momentum: ${momentum.toFixed(2)}% | VWAP Trend: ${vwapData.vwapTrend} | S/R: ${supportResistance.nearSupport ? 'Support' : ''} ${supportResistance.nearResistance ? 'Resistance' : ''}`);
      logger.info(`   📈 CE: ${priceActionCEScore}/7 (need 5+) | PE: ${priceActionPEScore}/7 (need 5+)`);

      // Show CE condition status
      if (priceActionCEScore < 5) {
        logger.info(`   📋 CE Missing: ${priceActionCEConditions.momentum_positive ? '' : 'Momentum+ '} ${priceActionCEConditions.trend_favorable ? '' : 'Trend '} ${priceActionCEConditions.support_or_momentum ? '' : 'Support/Mom '} ${priceActionCEConditions.rsi_reasonable ? '' : 'RSI-Range '} ${priceActionCEConditions.price_action_decent ? '' : 'Price-Action '} ${priceActionCEConditions.vwap_aligned ? '' : 'VWAP-Aligned '} ${priceActionCEConditions.time_filter ? '' : 'Time'}`);
      }

      // Show PE condition status
      if (priceActionPEScore < 5) {
        logger.info(`   📋 PE Missing: ${priceActionPEConditions.momentum_negative ? '' : 'Momentum- '} ${priceActionPEConditions.trend_favorable ? '' : 'Trend '} ${priceActionPEConditions.resistance_or_momentum ? '' : 'Resist/Mom '} ${priceActionPEConditions.rsi_reasonable ? '' : 'RSI-Range '} ${priceActionPEConditions.price_action_decent ? '' : 'Price-Action '} ${priceActionPEConditions.vwap_aligned ? '' : 'VWAP-Aligned '} ${priceActionPEConditions.time_filter ? '' : 'Time'}`);
      }
    }

    let signal: TradingSignal | null = null;

    if (actionCEMet) {
      // ✅ Use new premium-based strike selection
      const expiry = this.generateExpiryString(indexName);
      const { strike, estimatedPremium } = await this.calculateOptimalStrike(currentPrice, indexName, 'CE', expiry);
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
          vwap: parseFloat(vwapData.vwap.toFixed(2))
        }
      };

      logger.info(`🚀 Price Action CE Signal: Strike=${strike}, Est Premium=₹${estimatedPremium.toFixed(2)}, Support bounce`);
    } else if (actionPEMet) {
      // ✅ Use new premium-based strike selection
      const expiry = this.generateExpiryString(indexName);
      const { strike, estimatedPremium } = await this.calculateOptimalStrike(currentPrice, indexName, 'PE', expiry);
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
          vwap: parseFloat(vwapData.vwap.toFixed(2))
        }
      };

      logger.info(`🚀 Price Action PE Signal: Strike=${strike}, Est Premium=₹${estimatedPremium.toFixed(2)}, Resistance rejection`);
    }

    return signal;
  }

  private async executeSignal(signal: TradingSignal): Promise<void> {
    try {
      // Fetch real option price from Angel One API
      const realPrice = await this.getRealOptionPrice(signal);

      if (realPrice) {
        // ✅ FINAL VALIDATION: Check if actual premium exceeds ₹15,000 limit
        const lotSize = config.indices[signal.indexName].lotSize;
        const actualPositionValue = realPrice * lotSize;
        const maxPositionValue = 15000;

        if (actualPositionValue > maxPositionValue) {
          logger.error(`❌ POSITION SIZE LIMIT EXCEEDED:`);
          logger.error(`   Option: ${signal.optionSymbol}`);
          logger.error(`   Real Premium: ₹${realPrice.toFixed(2)}`);
          logger.error(`   Position Value: ₹${actualPositionValue.toFixed(0)} (Limit: ₹${maxPositionValue})`);
          logger.error(`   📋 Signal REJECTED due to premium being too expensive`);
          throw new Error(`Position value ₹${actualPositionValue.toFixed(0)} exceeds ₹15,000 limit`);
        }

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
        logger.info(`💰 Position Value: ₹${actualPositionValue.toFixed(0)} (within ₹${maxPositionValue} limit)`);
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

      // ✅ CRITICAL FIX: Emit signal execution failure to unlock position
      (process as any).emit('signalExecutionFailed', { signal, reason: (error as Error).message });
    }
  }

  private async getRealOptionPrice(signal: TradingSignal): Promise<number | null> {
    try {
      logger.info(`Fetching real option price for ${signal.optionSymbol}`);

      // Generate expiry string with index-specific logic
      const expiry = this.generateExpiryString(signal.indexName);

      // ✅ Extract strike from the already generated option symbol instead of recalculating
      const strike = this.extractStrikeFromSymbol(signal.optionSymbol, signal.indexName);

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
      // Expiry: Last day of the month
      const currentMonth = today.getMonth();
      const currentYear = today.getFullYear();

      // Get last day of current month
      let lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0);

      // If last day of month is today or has passed, move to next month
      if (lastDayOfMonth <= today) {
        const nextMonth = currentMonth + 1;
        const nextYear = nextMonth > 11 ? currentYear + 1 : currentYear;
        const adjustedMonth = nextMonth > 11 ? 0 : nextMonth;

        lastDayOfMonth = new Date(nextYear, adjustedMonth + 1, 0);
      }

      const day = lastDayOfMonth.getDate().toString().padStart(2, '0');
      const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      const month = months[lastDayOfMonth.getMonth()];
      const year = lastDayOfMonth.getFullYear().toString().slice(-2);

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
        return Math.round(spotPrice / 500) * 500;
      case 'NIFTY':
        return Math.round(spotPrice / 50) * 50;
      default:
        return Math.round(spotPrice / 50) * 50;
    }
  }

  // ✅ NEW: Premium-based strike selection with 15k position limit
  private async calculateOptimalStrike(
    spotPrice: number,
    indexName: IndexName,
    optionType: OptionType,
    expiry: string
  ): Promise<{ strike: number; estimatedPremium: number }> {
    const maxPositionValue = 15000; // ₹15,000 maximum position value
    const lotSize = config.indices[indexName].lotSize;
    const maxPremiumPerUnit = maxPositionValue / lotSize; // Max premium per option unit

    let baseStrike: number;
    let strikeInterval: number;

    switch (indexName) {
      case 'BANKNIFTY':
        baseStrike = Math.round(spotPrice / 500) * 500;
        strikeInterval = 500;
        break;
      case 'NIFTY':
        baseStrike = Math.round(spotPrice / 50) * 50;
        strikeInterval = 50;
        break;
      default:
        baseStrike = Math.round(spotPrice / 50) * 50;
        strikeInterval = 50;
    }

    // Calculate days to expiry for premium estimation
    const daysToExpiry = this.calculateDaysToExpiry(expiry);

    // Start with 1 strike OTM and move further if premium is too high
    let strike: number;
    let strikesAway = 1;
    let estimatedPremium = 0;
    const maxStrikesToTry = 8; // Don't go too far OTM

    do {
      if (optionType === 'CE') {
        strike = baseStrike + (strikeInterval * strikesAway);
      } else {
        strike = baseStrike - (strikeInterval * strikesAway);
      }

      // Estimate premium based on distance from spot and time value
      estimatedPremium = this.estimateOptionPremium(
        spotPrice,
        strike,
        optionType,
        daysToExpiry,
        indexName
      );

      const positionValue = estimatedPremium * lotSize;

      logger.info(`${indexName} ${optionType} Strike ${strike}: Est Premium ₹${estimatedPremium.toFixed(2)}, Position Value ₹${positionValue.toFixed(0)} (${strikesAway} strikes OTM)`);

      if (positionValue <= maxPositionValue) {
        logger.info(`✅ Selected strike ${strike} with estimated position value ₹${positionValue.toFixed(0)} (within ₹15,000 limit)`);
        return { strike, estimatedPremium };
      }

      strikesAway++;
    } while (strikesAway <= maxStrikesToTry);

    // If all strikes are too expensive, return the farthest one with warning
    logger.warn(`⚠️ All strikes expensive for ${indexName} ${optionType}! Using ${strike} (₹${(estimatedPremium * lotSize).toFixed(0)} position)`);
    return { strike, estimatedPremium };
  }

  // Helper method to calculate days to expiry
  private calculateDaysToExpiry(expiry: string): number {
    try {
      // Parse expiry format like "30SEP25"
      const day = parseInt(expiry.substring(0, 2));
      const monthStr = expiry.substring(2, 5);
      const year = 2000 + parseInt(expiry.substring(5, 7));

      const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      const month = months.indexOf(monthStr);

      const expiryDate = new Date(year, month, day);
      const today = new Date();

      const diffTime = expiryDate.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      return Math.max(0, diffDays);
    } catch (error) {
      logger.warn(`Could not parse expiry ${expiry}, assuming 7 days`);
      return 7; // Default assumption
    }
  }

  // Rough option premium estimation based on intrinsic + time value
  private estimateOptionPremium(
    spotPrice: number,
    strike: number,
    optionType: OptionType,
    daysToExpiry: number,
    indexName: IndexName
  ): number {
    // Intrinsic value
    let intrinsicValue = 0;
    if (optionType === 'CE' && spotPrice > strike) {
      intrinsicValue = spotPrice - strike;
    } else if (optionType === 'PE' && spotPrice < strike) {
      intrinsicValue = strike - spotPrice;
    }

    // Time value estimation (rough approximation)
    // Higher volatility for BANKNIFTY, more time value for longer expiry
    const volatilityFactor = indexName === 'BANKNIFTY' ? 0.25 : 0.20; // 25% vs 20% annualized
    const timeValueBase = Math.sqrt(daysToExpiry / 365) * volatilityFactor * spotPrice * 0.1; // Rough approximation

    // Distance penalty - options further away have less time value per rupee
    const distanceFromSpot = Math.abs(spotPrice - strike) / spotPrice;
    const distancePenalty = Math.exp(-distanceFromSpot * 3); // Exponential decay

    const timeValue = timeValueBase * distancePenalty;

    // Total premium (never less than intrinsic value)
    const totalPremium = Math.max(intrinsicValue + timeValue, intrinsicValue);

    // Minimum premium for very OTM options (market makers need some profit)
    const minimumPremium = indexName === 'BANKNIFTY' ? 20 : 10; // Minimum ₹20 for BankNifty, ₹10 for Nifty

    return Math.max(totalPremium, minimumPremium);
  }

  // Helper method to extract strike price from option symbol
  private extractStrikeFromSymbol(optionSymbol: string, indexName: IndexName): number {
    try {
      // Format: NIFTY03SEP25024700CE or BANKNIFTY26SEP2552500PE
      // Remove index name and expiry to get strike+type
      const indexNameLength = indexName.length;
      const expiryLength = 7; // Format: 03SEP25
      const typeLength = 2; // CE or PE

      const symbolWithoutIndex = optionSymbol.substring(indexNameLength);
      const symbolWithoutExpiry = symbolWithoutIndex.substring(expiryLength);
      const strikeWithType = symbolWithoutExpiry.substring(0, symbolWithoutExpiry.length - typeLength);

      return parseInt(strikeWithType);
    } catch (error) {
      logger.error(`Failed to extract strike from ${optionSymbol}, using fallback calculation`);
      // Fallback to ATM calculation
      const baseStrike = indexName === 'BANKNIFTY' ?
        Math.round(25000 / 500) * 500 :
        Math.round(25000 / 50) * 50;
      return baseStrike;
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
      const prevPrice = prices[i - 1];
      if (prevPrice !== 0) {
        returns.push((prices[i] - prevPrice) / prevPrice);
      }
    }

    if (returns.length === 0) return 0;
    
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((acc, ret) => acc + Math.pow(ret - mean, 2), 0) / returns.length;

    return Math.sqrt(variance);
  }

  // ✅ NEW: VWAP calculation using price buffer data
  private calculateVWAP(priceBuffer: PriceBufferItem[], period: number = 20): {
    vwap: number;
    priceVsVwap: number;
    vwapTrend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  } {
    if (priceBuffer.length < Math.min(period, 10)) {
      // Fallback to simple average if insufficient data
      const prices = priceBuffer.map(item => item.price);
      if (prices.length === 0) {
        return {
          vwap: 0,
          priceVsVwap: 0,
          vwapTrend: 'NEUTRAL'
        };
      }
      const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
      return {
        vwap: avgPrice,
        priceVsVwap: 0,
        vwapTrend: 'NEUTRAL'
      };
    }

    // Use recent data up to the specified period
    const recentData = priceBuffer.slice(-Math.min(period, priceBuffer.length));
    
    // Since we don't have actual volume data for indices, we'll use a proxy:
    // Higher price movement = higher implied volume (more trading interest)
    let totalPriceVolume = 0;
    let totalVolume = 0;

    for (let i = 0; i < recentData.length; i++) {
      const price = recentData[i].price;
      
      // Calculate implied volume based on price movement and time
      let impliedVolume = 1; // Base volume
      
      if (i > 0) {
        const priceChange = Math.abs(price - recentData[i - 1].price);
        const priceChangePercent = priceChange / recentData[i - 1].price;
        // Higher price movement = higher implied volume
        impliedVolume = 1 + (priceChangePercent * 1000); // Scale factor
      }
      
      totalPriceVolume += price * impliedVolume;
      totalVolume += impliedVolume;
    }

    const vwap = totalVolume > 0 ? totalPriceVolume / totalVolume : recentData[recentData.length - 1].price;
    const currentPrice = recentData[recentData.length - 1].price;
    const priceVsVwap = vwap > 0 ? ((currentPrice - vwap) / vwap) * 100 : 0; // Percentage difference, avoid division by zero

    // Determine VWAP trend based on price vs VWAP and recent VWAP slope
    let vwapTrend: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    
    if (recentData.length >= 5) {
      const earlyVwap = this.calculateSimpleVWAP(recentData.slice(0, Math.floor(recentData.length / 2)));
      const lateVwap = this.calculateSimpleVWAP(recentData.slice(Math.floor(recentData.length / 2)));
      
      const vwapSlope = earlyVwap > 0 ? ((lateVwap - earlyVwap) / earlyVwap) * 100 : 0;
      
      if (currentPrice > vwap && vwapSlope > 0.02) {
        vwapTrend = 'BULLISH';
      } else if (currentPrice < vwap && vwapSlope < -0.02) {
        vwapTrend = 'BEARISH';
      }
    }

    return {
      vwap: parseFloat(vwap.toFixed(2)),
      priceVsVwap: parseFloat(priceVsVwap.toFixed(3)),
      vwapTrend
    };
  }

  // Helper method for simple VWAP calculation
  private calculateSimpleVWAP(data: PriceBufferItem[]): number {
    if (data.length === 0) return 0;
    
    let totalPriceVolume = 0;
    let totalVolume = 0;

    for (let i = 0; i < data.length; i++) {
      const price = data[i].price;
      let impliedVolume = 1;
      
      if (i > 0) {
        const priceChange = Math.abs(price - data[i - 1].price);
        const priceChangePercent = priceChange / data[i - 1].price;
        impliedVolume = 1 + (priceChangePercent * 1000);
      }
      
      totalPriceVolume += price * impliedVolume;
      totalVolume += impliedVolume;
    }

    return totalVolume > 0 ? totalPriceVolume / totalVolume : data[data.length - 1].price;
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

    // NSE trading hours: 9:30 AM to 2:45 PM (for new signals only)
    const startTime = 930;  // 9:30 AM
    const endTime = 1445;   // 2:45 PM (15 minutes before market close)
    const isOpen = currentTime >= startTime && currentTime <= endTime;

    // Log NSE hours for debugging
    if (!isOpen) {
      logger.debug(`NSE ${indexName} outside signal hours: ${currentTime} (need 930-1445)`);
    }

    return isOpen;
  }


  public async getCurrentMarketConditions(): Promise<string> {
    try {
      let summary = '\n📊 Current Market Conditions (Triple Strategy System):\n';

      // Add WebSocket connection status
      const wsStatus = webSocketFeed.getConnectionStatus();
      summary += `🔗 WebSocket: ${wsStatus.connected ? '✅ Connected' : '❌ Disconnected'} | Healthy: ${wsStatus.healthy}\n`;

      // Add position and cooldown status
      const positions = this.getPositionStatus();
      const cooldowns = this.getSignalCooldowns();
      summary += `🔒 Active Positions: ${Object.keys(positions).filter(k => positions[k]).join(', ') || 'None'}\n`;
      summary += `⏳ Signal Cooldowns: ${Object.keys(cooldowns).map(k => `${k}(${cooldowns[k]}s)`).join(', ') || 'None'}\n\n`;

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
          strongMomentum: Math.abs(momentum) > this.getMomentumThreshold(indexName),
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

  private startPositionStatusLogging(): void {
    // Log position status every 30 seconds for monitoring
    this.positionLoggingInterval = setInterval(() => {
      this.logActivePositionsStatus('PERIODIC_STATUS');
    }, 30 * 1000); // Every 30 seconds

    logger.info('📊 Position status logging started (every 30 seconds)');
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

  public getPositionStatus(): { [key: string]: boolean } {
    return { ...this.activePositions };
  }

  private logActivePositionsStatus(event: string): void {
    const timestamp = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
    const lockedPositions = Object.keys(this.activePositions).filter(k => this.activePositions[k]);
    const unlockedPositions = Object.keys(this.activePositions).filter(k => !this.activePositions[k]);

    logger.info(`📊 ACTIVE POSITIONS STATUS [${event}] @ ${timestamp}:`);
    logger.info(`   🔒 LOCKED: ${lockedPositions.length > 0 ? lockedPositions.join(', ') : 'None'}`);
    logger.info(`   🔓 UNLOCKED: ${unlockedPositions.length > 0 ? unlockedPositions.join(', ') : 'None'}`);

    // Enhanced logging for debugging
    const allIndices = ['NIFTY', 'BANKNIFTY'];
    logger.info(`   📋 DETAILED STATUS:`);
    allIndices.forEach(index => {
      const status = this.activePositions[index] ? '🔒 LOCKED' : '🔓 UNLOCKED';
      logger.info(`      ${index}: ${status}`);
    });
  }

  public getSignalCooldowns(): { [key: string]: number } {
    const now = Date.now();
    const cooldowns: { [key: string]: number } = {};

    Object.keys(this.lastSignalTime).forEach(key => {
      const remaining = Math.max(0, config.trading.signalCooldown - (now - this.lastSignalTime[key]));
      if (remaining > 0) {
        cooldowns[key] = Math.ceil(remaining / 1000); // Convert to seconds
      }
    });

    return cooldowns;
  }

  public resetPositions(): void {
    const lockedPositions = Object.keys(this.activePositions).filter(k => this.activePositions[k]);

    if (lockedPositions.length > 0) {
      logger.warn(`🔧 Manually resetting ${lockedPositions.length} locked positions: ${lockedPositions.join(', ')}`);

      lockedPositions.forEach(indexName => {
        this.activePositions[indexName] = false;
        logger.info(`🔓 Force unlocked: ${indexName}`);
      });

      this.logActivePositionsStatus('MANUAL_RESET');
    } else {
      logger.info(`✅ No locked positions to reset`);
      this.logActivePositionsStatus('MANUAL_RESET_NO_CHANGE');
    }
  }

  public resetCooldowns(): void {
    const activeCooldowns = Object.keys(this.getSignalCooldowns());

    if (activeCooldowns.length > 0) {
      logger.warn(`🔧 Manually resetting ${activeCooldowns.length} active cooldowns: ${activeCooldowns.join(', ')}`);
      this.lastSignalTime = {};
      logger.info(`✅ All cooldowns cleared`);
    } else {
      logger.info(`✅ No active cooldowns to reset`);
    }
  }

  public logPositionStatusNow(): void {
    this.logActivePositionsStatus('MANUAL_CHECK');
  }

  public stop(): void {
    // Clean up event listeners
    this.eventHandlers.forEach((handler, event) => {
      (process as any).removeListener(event, handler);
      logger.debug(`🧹 Removed event listener: ${event}`);
    });
    this.eventHandlers.clear();
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      logger.info('🧹 Strategy cleanup process stopped');
    }

    if (this.positionLoggingInterval) {
      clearInterval(this.positionLoggingInterval);
      this.positionLoggingInterval = null;
      logger.info('📊 Position status logging stopped');
    }
    
    logger.info('✅ Strategy stopped and cleaned up');
  }
}

export const strategy = new TradingStrategy();