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
  public priceBuffers: PriceBuffers = {
    NIFTY: [],
    BANKNIFTY: []
  };


  public async initialize(): Promise<void> {
    logger.info('🎯 Trading strategy initializing...');

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

    // Calculate technical indicators (simplified - no volume or IV calculations)
    const rsi = this.calculateRSI(prices, config.strategy.rsiPeriod);
    const sma = this.calculateSMA(prices, 20); // Simple moving average instead of VWAP

    if (!this.isWithinTradingHours(indexName)) {
      const shouldLog = Date.now() % 30000 < 1000; // Log every 30 seconds
      if (shouldLog) {
        const currentTime = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
        const hours = '9:30 AM - 3:00 PM';
        logger.info(`⏰ ${indexName} - Outside trading hours (${currentTime}), signals disabled during ${hours}`);
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

      logger.info(`🔍 ${indexName} Signal Analysis - Current Values:`);
      logger.info(`   💰 Current Price: ${currentPrice} | SMA-20: ${sma.toFixed(2)}`);
      logger.info(`   📊 RSI: ${rsi.toFixed(2)} | Trigger Level: ${triggerLevel.toFixed(2)}`);
      logger.info(`   ⏰ Current Time: ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}`);

      logger.info(`📈 CE Conditions Status:`);
      logger.info(`   ✅ Price Breakout: ${ceConditions.price_breakout} (${currentPrice} > ${triggerLevel.toFixed(2)})`);
      logger.info(`   ✅ RSI Momentum: ${ceConditions.momentum} (RSI ${rsi.toFixed(2)} between 50-75)`);
      logger.info(`   ✅ Trend Up: ${ceConditions.trend_alignment} (Price ${currentPrice} > SMA ${sma.toFixed(2)})`);
      logger.info(`   ✅ Time Filter: ${ceConditions.time_filter}`);

      logger.info(`📉 PE Conditions Status:`);
      logger.info(`   ✅ Price Breakout: ${peConditions.price_breakout} (${currentPrice} > ${triggerLevel.toFixed(2)})`);
      logger.info(`   ✅ RSI Momentum: ${peConditions.momentum} (RSI ${rsi.toFixed(2)} between 45-70)`);
      logger.info(`   ✅ Trend Down: ${peConditions.trend_alignment} (Price ${currentPrice} < SMA ${sma.toFixed(2)})`);
      logger.info(`   ✅ Time Filter: ${peConditions.time_filter}`);

      const ceMet = Object.values(ceConditions).filter(c => c === true).length;
      const peMet = Object.values(peConditions).filter(c => c === true).length;

      logger.info(`🎯 Summary: CE (${ceMet}/4 conditions) | PE (${peMet}/4 conditions) | Need ALL 4 for signal`);
    }

    // Prioritize CE if both conditions are met (bullish bias)
    let optionType: OptionType;
    let direction: Direction;
    let entryConditions: any;
    let conditionLabel: string;

    if (allCeConditionsMet) {
      optionType = 'CE';
      direction = 'UP';
      entryConditions = ceConditions;
      conditionLabel = 'CE';
    } else if (allPeConditionsMet) {
      optionType = 'PE';
      direction = 'DOWN';
      entryConditions = peConditions;
      conditionLabel = 'PE';
    } else {
      return null; // No conditions met
    }

    const strike = this.calculateOptimalStrike(currentPrice, indexName, optionType);
    const optionSymbol = this.generateOptionSymbol(indexName, strike, optionType);

    // Simplified confidence calculation based on remaining conditions
    let confidence = 75; // Higher base confidence since we have fewer conditions
    
    if (optionType === 'CE') {
      confidence += Math.min(15, Math.max(0, (rsi - 50) / 1.67)); // CE RSI momentum (0-15 points)
      confidence += Math.min(10, Math.max(0, (currentPrice - sma) / currentPrice * 1000)); // Trend strength (0-10 points)
    } else {
      confidence += Math.min(15, Math.max(0, (rsi - 45) / 1.67)); // PE RSI momentum (0-15 points)
      confidence += Math.min(10, Math.max(0, (sma - currentPrice) / currentPrice * 1000)); // Trend strength (0-10 points)
    }

    logger.info(`🎯 ${conditionLabel} Entry Conditions Met for ${indexName}:`);
    logger.info(`   Price Breakout: ${entryConditions.price_breakout}`);
    logger.info(`   Momentum (RSI): ${entryConditions.momentum} (${rsi.toFixed(2)})`);
    logger.info(`   Trend Alignment: ${entryConditions.trend_alignment} (Price: ${currentPrice}, SMA: ${sma.toFixed(2)})`);
    logger.info(`   Time Filter: ${entryConditions.time_filter}`);

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

  private async executeSignal(signal: TradingSignal): Promise<void> {
    try {
      // Fetch real option price from Angel One API
      const realPrice = await this.getRealOptionPrice(signal);

      if (realPrice) {
        signal.entryPrice = realPrice;
        // Calculate realistic targets based on real price
        signal.target = parseFloat((realPrice * 1.15).toFixed(2)); // 15% target
        signal.stopLoss = parseFloat((realPrice * 0.85).toFixed(2)); // 15% stop loss

        logger.info(`✅ Real Option Price: ${signal.optionSymbol} = ₹${signal.entryPrice}`);
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

      // Generate expiry string (format: 29AUG24)
      const expiry = this.generateExpiryString();
      const strike = this.calculateStrike(signal.spotPrice, signal.indexName);

      // Get option token first
      const tokenResponse = await angelAPI.getOptionToken(
        signal.indexName,
        strike,
        signal.optionType,
        expiry
      );

      if (!tokenResponse) {
        logger.error(`CRITICAL: Could not get token for ${signal.optionSymbol}`);
        throw new Error('Option token lookup failed');
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

  private generateExpiryString(): string {
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

    for (let i = 1; i <= period; i++) {
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


  private generateOptionSymbol(indexName: IndexName, strike: number, optionType: OptionType): string {
    const expiryString = this.generateExpiryString();
    // NSE options
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
      let summary = '\n📊 Current Market Conditions:\n';

      // Add WebSocket connection status
      const wsStatus = webSocketFeed.getConnectionStatus();
      summary += `🔗 WebSocket: ${wsStatus.connected ? '✅ Connected' : '❌ Disconnected'} | Healthy: ${wsStatus.healthy}\n\n`;

      for (const indexName of ['NIFTY', 'BANKNIFTY'] as IndexName[]) {
        const buffer = this.priceBuffers[indexName];
        const currentPrice = webSocketFeed.getCurrentPrice(indexName);
        const priceHistory = webSocketFeed.getPriceHistory(indexName);

        logger.debug(`🔍 ${indexName} Debug: Buffer=${buffer.length}, CurrentPrice=${currentPrice}, History=${priceHistory.length}`);

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
    } catch (error) {
      logger.error('Error in getCurrentMarketConditions:', (error as Error).message);
      return '\n📊 Current Market Conditions: Error retrieving data\n';
    }
  }
}

export const strategy = new TradingStrategy();