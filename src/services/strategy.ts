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
}

class TradingStrategy {
  private lastSignalTime: { [key in IndexName]?: number } = {};
  private priceBuffers: PriceBuffers = {
    NIFTY: [],
    BANKNIFTY: []
  };

  public async initialize(): Promise<void> {
    // Subscribe to real-time price updates
    webSocketFeed.addSubscriber((indexName: string, priceUpdate: PriceUpdate) => {
      this.processTick(indexName as IndexName, priceUpdate).catch(error => {
        logger.error(`Error processing tick for ${indexName}:`, error.message);
      });
    });

    logger.info('🎯 Trading strategy initialized');
  }

  private async processTick(indexName: IndexName, priceUpdate: PriceUpdate): Promise<void> {
    // Skip if market is closed
    if (!isMarketOpen()) {
      return;
    }

    // Skip if in cooldown
    if (this.isInCooldown(indexName)) {
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
      return;
    }

    // Analyze for signals
    const signal = await this.analyzeSignal(indexName, priceUpdate.price, buffer);

    if (signal && signal.confidence >= config.strategy.confidenceThreshold) {
      this.executeSignal(signal).catch(error => {
        logger.error('Failed to execute signal:', error.message);
      });
      this.lastSignalTime[indexName] = Date.now();
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

    // Check time filter (10:15 to 14:45)
    if (!this.isWithinTradingHours()) {
      return null;
    }

    // CE Entry Conditions
    const ceConditions = {
      price_breakout: currentPrice > this.getTriggerLevel(currentPrice, indexName),
      volume_surge: volumeRatio > 1.8,
      momentum: rsi > 50 && rsi < 75,
      trend_alignment: currentPrice > vwap,
      volatility: ivRank > 25,
      time_filter: this.isWithinTradingHours()
    };

    // PE Entry Conditions
    const peConditions = {
      price_breakout: currentPrice > this.getTriggerLevel(currentPrice, indexName),
      volume_surge: volumeRatio > 1.8,
      momentum: rsi > 45 && rsi < 70,
      trend_alignment: currentPrice < vwap,
      volatility: ivRank > 30,
      time_filter: this.isWithinTradingHours()
    };

    // Check which conditions are met
    const allCeConditionsMet = Object.values(ceConditions).every(condition => condition === true);
    const allPeConditionsMet = Object.values(peConditions).every(condition => condition === true);

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

  private generateExpiryString(): string {
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
    const roundTo = indexName === 'BANKNIFTY' ? 100 : 50;
    return Math.round(spotPrice / roundTo) * roundTo;
  }


  private generateOptionSymbol(indexName: IndexName, strike: number, optionType: OptionType): string {
    // Use the same expiry logic as generateExpiryString()
    const expiryString = this.generateExpiryString();
    return `${indexName}${expiryString}${strike}${optionType}`;
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

  private isWithinTradingHours(): boolean {
    const now = new Date();
    const istTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Kolkata"}));
    const currentTime = istTime.getHours() * 100 + istTime.getMinutes();
    
    // Trading hours: 10:15 AM to 14:45 (2:45 PM)
    const startTime = 1015; // 10:15 AM
    const endTime = 1445;   // 2:45 PM
    
    return currentTime >= startTime && currentTime <= endTime;
  }
}

export const strategy = new TradingStrategy();