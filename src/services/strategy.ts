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
  volume?: number;
  timestamp: Date;
}

interface PriceBuffers {
  NIFTY: PriceBufferItem[];
  BANKNIFTY: PriceBufferItem[];
  GOLD: PriceBufferItem[];
  SILVER: PriceBufferItem[];
}

class TradingStrategy {
  private lastSignalTime: { [key in IndexName]?: number } = {};
  public priceBuffers: PriceBuffers = {
    NIFTY: [],
    BANKNIFTY: [],
    GOLD: [],
    SILVER: []
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
      for (const indexName of ['NIFTY', 'BANKNIFTY', 'GOLD', 'SILVER'] as IndexName[]) {
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

    // Skip if in cooldown
    if (this.isInCooldown(indexName)) {
      const cooldownRemaining = Math.ceil((config.trading.signalCooldown - (Date.now() - (this.lastSignalTime[indexName] || 0))) / 1000);
      const shouldLog = Date.now() % 30000 < 1000; // Log every 30 seconds
      if (shouldLog) {
        logger.info(`⏳ ${indexName} - Signal cooldown active, ${cooldownRemaining}s remaining`);
      }
      return;
    }

    // Update price buffer with real volume data
    const buffer = this.priceBuffers[indexName];

    // Get real volume data from WebSocket or fetch from API if not available
    let realVolume = 0;
    try {
      const priceData = webSocketFeed.getPriceData(indexName);
      realVolume = priceData.currentVolume || 0;

      // If WebSocket volume is not available, fetch from API
      if (realVolume === 0) {
        const volumeData = await angelAPI.getVolumeData(indexName);
        realVolume = volumeData?.volume || 0;
      }
    } catch (error) {
      logger.error(`Failed to get real volume for ${indexName}:`, (error as Error).message);
    }

    buffer.push({
      price: priceUpdate.price,
      volume: realVolume,
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
      this.executeSignal(signal).catch(error => {
        logger.error('Failed to execute signal:', error.message);
      });
      this.lastSignalTime[indexName] = Date.now();
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
    const volumes = priceBuffer.map(item => item.volume || 0);

    // Calculate technical indicators
    const rsi = this.calculateRSI(prices, config.strategy.rsiPeriod);
    const vwap = this.calculateVWAP(prices, volumes);
    const currentVolume = volumes[volumes.length - 1];
    const avgVolume = this.calculateAverageVolume(volumes);
    const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 1;
    const ivRank = await this.calculateRealIVRank(indexName, currentPrice);

    if (!this.isWithinTradingHours(indexName)) {
      const shouldLog = Date.now() % 30000 < 1000; // Log every 30 seconds
      if (shouldLog) {
        const currentTime = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
        const hours = (indexName === 'GOLD' || indexName === 'SILVER') ?
          '9:00 AM - 11:30 PM' : '10:15 AM - 2:45 PM';
        logger.info(`⏰ ${indexName} - Outside trading hours (${currentTime}), signals disabled during ${hours}`);
      }
      return null;
    }

    // CE Entry Conditions
    const ceConditions = {
      price_breakout: currentPrice > this.getTriggerLevel(currentPrice, indexName),
      volume_surge: volumeRatio > 1.8,
      momentum: rsi > 50 && rsi < 75,
      trend_alignment: currentPrice > vwap,
      volatility: ivRank > 25,
      time_filter: this.isWithinTradingHours(indexName)
    };

    // PE Entry Conditions
    const peConditions = {
      price_breakout: currentPrice > this.getTriggerLevel(currentPrice, indexName),
      volume_surge: volumeRatio > 1.8,
      momentum: rsi > 45 && rsi < 70,
      trend_alignment: currentPrice < vwap,
      volatility: ivRank > 30,
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
      logger.info(`   💰 Current Price: ${currentPrice} | VWAP: ${vwap.toFixed(2)}`);
      logger.info(`   📊 RSI: ${rsi.toFixed(2)} | Volume Ratio: ${volumeRatio.toFixed(2)}x`);
      logger.info(`   🎯 Trigger Level: ${triggerLevel.toFixed(2)} | IV Rank: ${ivRank.toFixed(2)}`);
      logger.info(`   ⏰ Current Time: ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}`);

      logger.info(`📈 CE Conditions Status:`);
      logger.info(`   ✅ Price Breakout: ${ceConditions.price_breakout} (${currentPrice} > ${triggerLevel.toFixed(2)})`);
      logger.info(`   ✅ Volume Surge: ${ceConditions.volume_surge} (${volumeRatio.toFixed(2)}x > 1.8x)`);
      logger.info(`   ✅ RSI Momentum: ${ceConditions.momentum} (RSI ${rsi.toFixed(2)} between 50-75)`);
      logger.info(`   ✅ Trend Up: ${ceConditions.trend_alignment} (Price ${currentPrice} > VWAP ${vwap.toFixed(2)})`);
      logger.info(`   ✅ IV Rank: ${ceConditions.volatility} (IV ${ivRank.toFixed(2)} > 25)`);
      logger.info(`   ✅ Time Filter: ${ceConditions.time_filter}`);

      logger.info(`📉 PE Conditions Status:`);
      logger.info(`   ✅ Price Breakout: ${peConditions.price_breakout} (${currentPrice} > ${triggerLevel.toFixed(2)})`);
      logger.info(`   ✅ Volume Surge: ${peConditions.volume_surge} (${volumeRatio.toFixed(2)}x > 1.8x)`);
      logger.info(`   ✅ RSI Momentum: ${peConditions.momentum} (RSI ${rsi.toFixed(2)} between 45-70)`);
      logger.info(`   ✅ Trend Down: ${peConditions.trend_alignment} (Price ${currentPrice} < VWAP ${vwap.toFixed(2)})`);
      logger.info(`   ✅ IV Rank: ${peConditions.volatility} (IV ${ivRank.toFixed(2)} > 30)`);
      logger.info(`   ✅ Time Filter: ${peConditions.time_filter}`);

      const ceMet = Object.values(ceConditions).filter(c => c === true).length;
      const peMet = Object.values(peConditions).filter(c => c === true).length;

      logger.info(`🎯 Summary: CE (${ceMet}/6 conditions) | PE (${peMet}/6 conditions) | Need ALL 6 for signal`);
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

    const strike = this.calculateStrike(currentPrice, indexName);
    const optionSymbol = this.generateOptionSymbol(indexName, strike, optionType);

    // Calculate confidence based on how well conditions are met
    let confidence = 70; // Base confidence
    confidence += Math.min(15, (volumeRatio - 1.8) * 10); // Volume surge strength

    if (optionType === 'CE') {
      confidence += Math.min(10, Math.max(0, (rsi - 50) / 2.5)); // CE RSI momentum
      confidence += Math.min(5, Math.max(0, ivRank - 25) / 2); // CE IV rank
    } else {
      confidence += Math.min(10, Math.max(0, (rsi - 45) / 2.5)); // PE RSI momentum  
      confidence += Math.min(5, Math.max(0, ivRank - 30) / 2); // PE IV rank
    }

    logger.info(`🎯 ${conditionLabel} Entry Conditions Met for ${indexName}:`);
    logger.info(`   Price Breakout: ${entryConditions.price_breakout}`);
    logger.info(`   Volume Surge: ${entryConditions.volume_surge} (${volumeRatio.toFixed(2)}x)`);
    logger.info(`   Momentum (RSI): ${entryConditions.momentum} (${rsi.toFixed(2)})`);
    logger.info(`   Trend Alignment: ${entryConditions.trend_alignment} (Price: ${currentPrice}, VWAP: ${vwap.toFixed(2)})`);
    logger.info(`   Volatility (IV): ${entryConditions.volatility} (${ivRank.toFixed(2)})`);
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
        ema: 0, // Not used in new strategy
        rsi: parseFloat(rsi.toFixed(2)),
        priceChange: 0, // Calculate if needed
        vwap: parseFloat(vwap.toFixed(2)),
        currentVolume,
        avgVolume,
        volumeRatio: parseFloat(volumeRatio.toFixed(2)),
        ivRank: parseFloat(ivRank.toFixed(2))
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

  private generateExpiryString(indexName?: IndexName): string {
    if (indexName === 'GOLD' || indexName === 'SILVER') {
      // MCX options expire on different days (usually last Tuesday of month)
      const today = new Date();
      const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
      const lastTuesday = new Date(nextMonth.getFullYear(), nextMonth.getMonth(), 0);

      // Find last Tuesday of current month
      while (lastTuesday.getDay() !== 2) {
        lastTuesday.setDate(lastTuesday.getDate() - 1);
      }

      if (lastTuesday < today) {
        // Move to next month's last Tuesday
        const nextMonthEnd = new Date(today.getFullYear(), today.getMonth() + 2, 0);
        while (nextMonthEnd.getDay() !== 2) {
          nextMonthEnd.setDate(nextMonthEnd.getDate() - 1);
        }
        lastTuesday.setTime(nextMonthEnd.getTime());
      }

      const day = lastTuesday.getDate().toString().padStart(2, '0');
      const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      const month = months[lastTuesday.getMonth()];
      const year = lastTuesday.getFullYear().toString().slice(-2);

      return `${day}${month}${year}`;
    } else {
      // Existing logic for NSE weekly options
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
      case 'GOLD':
        return Math.round(spotPrice / 100) * 100; // Round to nearest 100
      case 'SILVER':
        return Math.round(spotPrice / 1000) * 1000; // Round to nearest 1000
      default:
        return Math.round(spotPrice / 50) * 50;
    }
  }


  private generateOptionSymbol(indexName: IndexName, strike: number, optionType: OptionType): string {
    const expiryString = this.generateExpiryString(indexName);

    if (indexName === 'GOLD' || indexName === 'SILVER') {
      // MCX options have different naming convention
      return `${indexName}${expiryString}${strike}${optionType}`;
    } else {
      // NSE options
      return `${indexName}${expiryString}${strike}${optionType}`;
    }
  }

  private isInCooldown(indexName: IndexName): boolean {
    const lastTime = this.lastSignalTime[indexName];
    return lastTime ? (Date.now() - lastTime) < config.trading.signalCooldown : false;
  }

  private calculateVWAP(prices: number[], volumes: number[]): number {
    if (prices.length !== volumes.length || prices.length === 0) {
      return prices[prices.length - 1] || 0;
    }

    let totalPriceVolume = 0;
    let totalVolume = 0;

    for (let i = 0; i < prices.length; i++) {
      totalPriceVolume += prices[i] * volumes[i];
      totalVolume += volumes[i];
    }

    return totalVolume > 0 ? totalPriceVolume / totalVolume : prices[prices.length - 1];
  }

  private calculateAverageVolume(volumes: number[]): number {
    if (volumes.length === 0) return 1;
    const sum = volumes.reduce((acc, vol) => acc + vol, 0);
    return sum / volumes.length;
  }

  private async calculateRealIVRank(indexName: IndexName, currentPrice: number): Promise<number> {
    try {
      // Calculate ATM strike price
      const strike = this.calculateStrike(currentPrice, indexName);

      // Get IV data from Angel API for both CE and PE
      const ceGreeks = await angelAPI.getOptionGreeks('NFO', indexName, strike.toString(), 'CE');
      const peGreeks = await angelAPI.getOptionGreeks('NFO', indexName, strike.toString(), 'PE');

      let ivSum = 0;
      let ivCount = 0;

      // Extract IV from CE
      if (ceGreeks?.data?.iv) {
        ivSum += parseFloat(ceGreeks.data.iv);
        ivCount++;
      }

      // Extract IV from PE
      if (peGreeks?.data?.iv) {
        ivSum += parseFloat(peGreeks.data.iv);
        ivCount++;
      }

      if (ivCount > 0) {
        const currentIV = ivSum / ivCount;

        // For IV rank, we need historical IV data (simplified approach)
        // In real implementation, you'd compare against 252-day IV range
        // For now, using a simple approximation based on current IV levels
        let ivRank = 50; // Default middle value

        if (currentIV > 25) ivRank = 80; // High IV
        else if (currentIV > 20) ivRank = 60;
        else if (currentIV > 15) ivRank = 40;
        else ivRank = 20; // Low IV

        logger.debug(`IV Rank for ${indexName}: ${ivRank} (Current IV: ${currentIV.toFixed(2)}%)`);
        return ivRank;
      }

      // Fallback if no IV data available
      logger.warn(`No IV data available for ${indexName}, using fallback`);
      return 50; // Default middle value

    } catch (error) {
      logger.error(`Failed to calculate real IV rank for ${indexName}:`, (error as Error).message);
      return 50; // Fallback value
    }
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
      // General check - return true if any market is open
      return isMarketOpen();
    }

    if (indexName === 'GOLD' || indexName === 'SILVER') {
      // MCX trading hours: 9:00 AM to 11:30 PM
      const startTime = 900;  // 9:00 AM
      const endTime = 2330;   // 11:30 PM
      return currentTime >= startTime && currentTime <= endTime;
    } else {
      // NSE trading hours: 10:15 AM to 2:45 PM (for signals)
      const startTime = 1015; // 10:15 AM
      const endTime = 1445;   // 2:45 PM
      return currentTime >= startTime && currentTime <= endTime;
    }
  }

  public async getCurrentMarketConditions(): Promise<string> {
    try {
      let summary = '\n📊 Current Market Conditions:\n';

      // 🔥 Add WebSocket connection status
      const wsStatus = webSocketFeed.getConnectionStatus();
      summary += `🔗 WebSocket: ${wsStatus.connected ? '✅ Connected' : '❌ Disconnected'} | Healthy: ${wsStatus.healthy}\n\n`;

      for (const indexName of ['NIFTY', 'BANKNIFTY', 'GOLD', 'SILVER'] as IndexName[]) {
        const buffer = this.priceBuffers[indexName];
        const currentPrice = webSocketFeed.getCurrentPrice(indexName);
        const priceHistory = webSocketFeed.getPriceHistory(indexName);

        // 🔥 Enhanced logging
        logger.debug(`🔍 ${indexName} Debug: Buffer=${buffer.length}, CurrentPrice=${currentPrice}, History=${priceHistory.length}`);

        if (buffer.length === 0 || currentPrice === 0) {
          summary += `  ${indexName}: No data available (Buffer: ${buffer.length}, Price: ${currentPrice})\n`;
          continue;
        }

        const prices = buffer.map(item => item.price);
        const volumes = buffer.map(item => item.volume || 0);

        if (prices.length < 5) {
          summary += `  ${indexName}: Insufficient data (${prices.length} points)\n`;
          continue;
        }

        const rsi = this.calculateRSI(prices, Math.min(14, prices.length - 1));
        const vwap = this.calculateVWAP(prices, volumes);
        const currentVolume = volumes[volumes.length - 1];
        const avgVolume = this.calculateAverageVolume(volumes);
        const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 1;
        const triggerLevel = this.getTriggerLevel(currentPrice, indexName);
        const ivRank = await this.calculateRealIVRank(indexName, currentPrice);

        const ceConditions = {
          price_breakout: currentPrice > triggerLevel,
          volume_surge: volumeRatio > 1.8,
          momentum: rsi > 50 && rsi < 75,
          trend_alignment: currentPrice > vwap,
          volatility: ivRank > 25,
          time_filter: this.isWithinTradingHours()
        };

        const peConditions = {
          price_breakout: currentPrice > triggerLevel,
          volume_surge: volumeRatio > 1.8,
          momentum: rsi > 45 && rsi < 70,
          trend_alignment: currentPrice < vwap,
          volatility: ivRank > 30,
          time_filter: this.isWithinTradingHours()
        };

        const ceMet = Object.values(ceConditions).filter(c => c === true).length;
        const peMet = Object.values(peConditions).filter(c => c === true).length;

        summary += `  ${indexName}: ₹${currentPrice} | RSI: ${rsi.toFixed(1)} | Vol: ${volumeRatio.toFixed(1)}x | CE: ${ceMet}/6 | PE: ${peMet}/6\n`;
      }

      return summary;
    } catch (error) {
      logger.error('Error in getCurrentMarketConditions:', (error as Error).message);
      return '\n📊 Current Market Conditions: Error retrieving data\n';
    }
  }
}

export const strategy = new TradingStrategy();