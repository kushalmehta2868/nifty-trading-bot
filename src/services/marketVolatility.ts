import { logger } from '../utils/logger';
import { angelAPI } from './angelAPI';

export interface VolatilityData {
  vix: number;
  regime: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
  positionSizeMultiplier: number;
  shouldTrade: boolean;
}

// 🚀 PHASE 2 ADDITION: Enhanced market regime with ML classification
export interface MarketRegime {
  primary: 'TRENDING_BULL' | 'TRENDING_BEAR' | 'CHOPPY' | 'VOLATILE';
  secondary?: 'BREAKOUT' | 'CONSOLIDATION' | 'REVERSAL';
  confidence: number;
  characteristics: string[];
  optimalStrategies: string[];
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface RegimeFeatures {
  volatility: number;
  momentum: number;
  trendStrength: number;
  volumeRatio: number;
  priceRange: number;
  rsiDivergence: number;
  macdSignal: number;
}

class MarketVolatilityManager {
  private vixCache: { value: number; timestamp: number } | null = null;
  private readonly VIX_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  // 🚀 PHASE 2 ADDITION: Market regime tracking
  private regimeHistory: MarketRegime[] = [];
  private readonly MAX_REGIME_HISTORY = 100;
  private priceHistory: number[] = [];
  private volumeHistory: number[] = [];

  // Method to clear invalid cache
  public clearVIXCache(): void {
    this.vixCache = null;
    logger.info('🔄 VIX cache cleared - will fetch fresh data');
  }

  // Method to manually set VIX for testing
  public setTestVIX(vixValue: number): void {
    if (vixValue >= 5 && vixValue <= 100) {
      this.vixCache = { value: vixValue, timestamp: Date.now() };
      logger.info(`🧪 Test VIX set to: ${vixValue}`);
    } else {
      logger.error(`❌ Invalid test VIX value: ${vixValue} (must be 5-100)`);
    }
  }

  public async getCurrentVolatility(): Promise<VolatilityData> {
    try {
      const vix = await this.getVIXLevel();
      const regime = this.determineVolatilityRegime(vix);
      const positionSizeMultiplier = this.getPositionSizeMultiplier(regime);
      const shouldTrade = this.shouldTradeInCurrentVolatility(regime);

      logger.info(`📊 VIX: ${vix.toFixed(2)} | Regime: ${regime} | Position Multiplier: ${positionSizeMultiplier}x | Trade: ${shouldTrade ? '✅' : '❌'}`);

      return {
        vix,
        regime,
        positionSizeMultiplier,
        shouldTrade
      };
    } catch (error) {
      logger.error('Failed to get volatility data:', (error as Error).message);

      // Fallback to conservative settings
      return {
        vix: 25, // Assume medium volatility
        regime: 'MEDIUM',
        positionSizeMultiplier: 0.8,
        shouldTrade: true
      };
    }
  }

  private async getVIXLevel(): Promise<number> {
    const now = Date.now();

    // Use cached VIX if available and fresh
    if (this.vixCache && (now - this.vixCache.timestamp) < this.VIX_CACHE_DURATION) {
      return this.vixCache.value;
    }

    try {
      // Try to get VIX from Angel API (India VIX token)
      const vixToken = '26000'; // India VIX token
      const vixResponse = await angelAPI.getQuote('NSE', 'INDIA VIX', vixToken);

      if (vixResponse?.ltp) {
        const vixValue = parseFloat(vixResponse.ltp);

        // Validate VIX value - should be between 5 and 100
        if (vixValue >= 5 && vixValue <= 100) {
          this.vixCache = { value: vixValue, timestamp: now };
          logger.debug(`✅ Valid VIX fetched: ${vixValue}`);
          return vixValue;
        } else {
          logger.warn(`❌ Invalid VIX value received: ${vixValue} (expected 5-100), using estimation`);
        }
      }
    } catch (error) {
      logger.warn('Direct VIX fetch failed, using estimation:', (error as Error).message);
    }

    // Fallback: Use a reasonable default VIX value
    const defaultVIX = this.getDefaultVIXValue();
    this.vixCache = { value: defaultVIX, timestamp: now };
    logger.info(`📊 Using default VIX: ${defaultVIX} (API fetch failed)`);
    return defaultVIX;
  }

  private async estimateVIXFromNiftyMovements(): Promise<number> {
    try {
      // Get NIFTY price movements over last few data points to estimate volatility
      const niftyPrices = await this.getRecentNiftyPrices();

      if (niftyPrices.length < 10) {
        return 20; // Default medium volatility
      }

      // Calculate realized volatility
      const returns = [];
      for (let i = 1; i < niftyPrices.length; i++) {
        const return_ = Math.log(niftyPrices[i] / niftyPrices[i - 1]);
        returns.push(return_);
      }

      const meanReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
      const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length;
      const volatility = Math.sqrt(variance * 252 * 100); // Annualized vol in %

      // Map realized vol to VIX-like levels
      return Math.max(8, Math.min(80, volatility));
    } catch (error) {
      logger.warn('VIX estimation failed, using default');
      return 20;
    }
  }

  private async getRecentNiftyPrices(): Promise<number[]> {
    // This would need to be implemented based on your price storage
    // For now, return empty array to trigger default
    return [];
  }

  private getDefaultVIXValue(): number {
    // Get current time to simulate market conditions
    const now = new Date();
    const hour = now.getHours();

    // Use time-based VIX simulation for more realistic values
    if (hour >= 9 && hour <= 15) {
      // Market hours: slightly higher volatility
      return 18 + Math.random() * 8; // 18-26 range
    } else {
      // After market: medium volatility
      return 15 + Math.random() * 6; // 15-21 range
    }
  }

  private determineVolatilityRegime(vix: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME' {
    if (vix < 15) return 'LOW';
    if (vix < 25) return 'MEDIUM';
    if (vix < 35) return 'HIGH';
    return 'EXTREME';
  }

  private getPositionSizeMultiplier(regime: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME'): number {
    switch (regime) {
      case 'LOW': return 1.2; // Increase size in low vol
      case 'MEDIUM': return 1.0; // Normal size
      case 'HIGH': return 0.7; // Reduce size in high vol
      case 'EXTREME': return 0.3; // Minimal size in extreme vol
    }
  }

  private shouldTradeInCurrentVolatility(regime: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME'): boolean {
    // Don't trade in extreme volatility
    return regime !== 'EXTREME';
  }

  public getSlippageAdjustment(regime: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME'): number {
    switch (regime) {
      case 'LOW': return 0.001; // 0.1% slippage in low vol
      case 'MEDIUM': return 0.002; // 0.2% slippage in medium vol
      case 'HIGH': return 0.005; // 0.5% slippage in high vol
      case 'EXTREME': return 0.01; // 1% slippage in extreme vol
    }
  }

  // 🚀 PHASE 2 ADDITION: Enhanced market regime detection with ML approach
  public async getMarketRegime(
    prices: number[],
    volumes: number[],
    indexName: 'NIFTY' | 'BANKNIFTY'
  ): Promise<MarketRegime> {
    try {
      // Update historical data
      this.updateMarketData(prices, volumes);

      // Extract features for ML classification
      const features = this.extractRegimeFeatures(prices, volumes);

      // Classify regime using ensemble approach
      const regime = this.classifyMarketRegime(features);

      // Add to history
      this.regimeHistory.push(regime);
      if (this.regimeHistory.length > this.MAX_REGIME_HISTORY) {
        this.regimeHistory.shift();
      }

      logger.info(`📊 Market Regime for ${indexName}: ${regime.primary} (${regime.confidence.toFixed(1)}% confidence) | Risk: ${regime.riskLevel}`);
      logger.info(`📊 Regime Characteristics: ${regime.characteristics.join(', ')}`);
      logger.info(`📊 Optimal Strategies: ${regime.optimalStrategies.join(', ')}`);

      return regime;

    } catch (error) {
      logger.error('Market regime detection failed:', (error as Error).message);

      // Fallback to simple regime
      return {
        primary: 'CHOPPY',
        confidence: 50,
        characteristics: ['Unknown market conditions'],
        optimalStrategies: ['Multi-Timeframe'],
        riskLevel: 'MEDIUM'
      };
    }
  }

  // Extract features for regime classification
  private extractRegimeFeatures(prices: number[], volumes: number[]): RegimeFeatures {
    if (prices.length < 20) {
      // Insufficient data - return neutral features
      return {
        volatility: 0.15,
        momentum: 0,
        trendStrength: 0.5,
        volumeRatio: 1,
        priceRange: 0.02,
        rsiDivergence: 0,
        macdSignal: 0
      };
    }

    // Calculate features
    const returns = this.calculateReturns(prices);
    const volatility = this.calculateVolatility(returns);
    const momentum = this.calculateMomentum(prices);
    const trendStrength = this.calculateTrendStrength(prices);
    const volumeRatio = this.calculateVolumeRatio(volumes);
    const priceRange = this.calculatePriceRange(prices);
    const rsiDivergence = this.calculateRSIDivergence(prices);
    const macdSignal = this.calculateMACDSignal(prices);

    return {
      volatility,
      momentum,
      trendStrength,
      volumeRatio,
      priceRange,
      rsiDivergence,
      macdSignal
    };
  }

  // Ensemble ML classification approach
  private classifyMarketRegime(features: RegimeFeatures): MarketRegime {
    // Decision tree approach for interpretability
    const classificationScores = {
      TRENDING_BULL: 0,
      TRENDING_BEAR: 0,
      CHOPPY: 0,
      VOLATILE: 0
    };

    // Rule 1: Strong trend detection
    if (Math.abs(features.momentum) > 0.02 && features.trendStrength > 0.7) {
      if (features.momentum > 0) {
        classificationScores.TRENDING_BULL += 40;
      } else {
        classificationScores.TRENDING_BEAR += 40;
      }
    }

    // Rule 2: High volatility detection
    if (features.volatility > 0.25) {
      classificationScores.VOLATILE += 35;
    }

    // Rule 3: Range-bound/choppy detection
    if (features.priceRange < 0.015 && Math.abs(features.momentum) < 0.01) {
      classificationScores.CHOPPY += 30;
    }

    // Rule 4: Volume confirmation
    if (features.volumeRatio > 1.2) {
      // High volume confirms trend
      if (features.momentum > 0.01) {
        classificationScores.TRENDING_BULL += 15;
      } else if (features.momentum < -0.01) {
        classificationScores.TRENDING_BEAR += 15;
      }
    }

    // Rule 5: Technical indicator confirmation
    if (Math.abs(features.macdSignal) > 0.5) {
      if (features.macdSignal > 0 && features.momentum > 0) {
        classificationScores.TRENDING_BULL += 10;
      } else if (features.macdSignal < 0 && features.momentum < 0) {
        classificationScores.TRENDING_BEAR += 10;
      }
    }

    // Rule 6: RSI divergence
    if (Math.abs(features.rsiDivergence) > 0.3) {
      classificationScores.VOLATILE += 15;
    }

    // Find highest scoring regime
    const regimes = Object.keys(classificationScores) as Array<keyof typeof classificationScores>;
    const topRegime = regimes.reduce((a, b) =>
      classificationScores[a] > classificationScores[b] ? a : b
    );

    const confidence = Math.min(95, Math.max(50, classificationScores[topRegime]));

    // Determine characteristics and strategies
    const { characteristics, optimalStrategies, riskLevel } = this.getRegimeProperties(topRegime, features);

    return {
      primary: topRegime,
      confidence,
      characteristics,
      optimalStrategies,
      riskLevel
    };
  }

  // Get regime-specific properties
  private getRegimeProperties(regime: string, features: RegimeFeatures): {
    characteristics: string[];
    optimalStrategies: string[];
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  } {
    switch (regime) {
      case 'TRENDING_BULL':
        return {
          characteristics: [
            'Strong upward momentum',
            'Sustained buying pressure',
            `Trend strength: ${(features.trendStrength * 100).toFixed(0)}%`,
            'Volume confirmation'
          ],
          optimalStrategies: ['Price Action', 'Multi-Timeframe'],
          riskLevel: features.volatility > 0.2 ? 'MEDIUM' : 'LOW'
        };

      case 'TRENDING_BEAR':
        return {
          characteristics: [
            'Strong downward momentum',
            'Sustained selling pressure',
            `Trend strength: ${(features.trendStrength * 100).toFixed(0)}%`,
            'Volume confirmation'
          ],
          optimalStrategies: ['Price Action', 'Multi-Timeframe'],
          riskLevel: features.volatility > 0.2 ? 'MEDIUM' : 'LOW'
        };

      case 'CHOPPY':
        return {
          characteristics: [
            'Range-bound trading',
            'Low directional bias',
            'Mean reversion likely',
            `Price range: ${(features.priceRange * 100).toFixed(1)}%`
          ],
          optimalStrategies: ['Bollinger+RSI', 'Multi-Timeframe'],
          riskLevel: 'LOW'
        };

      case 'VOLATILE':
        return {
          characteristics: [
            'High volatility environment',
            'Unpredictable price swings',
            `Volatility: ${(features.volatility * 100).toFixed(1)}%`,
            'Risk management critical'
          ],
          optimalStrategies: ['Multi-Timeframe'],
          riskLevel: 'HIGH'
        };

      default:
        return {
          characteristics: ['Unknown market state'],
          optimalStrategies: ['Multi-Timeframe'],
          riskLevel: 'MEDIUM'
        };
    }
  }

  // Helper methods for feature calculation
  private updateMarketData(prices: number[], volumes: number[]): void {
    this.priceHistory = [...this.priceHistory, ...prices].slice(-200); // Keep last 200 prices
    this.volumeHistory = [...this.volumeHistory, ...volumes].slice(-200);
  }

  private calculateReturns(prices: number[]): number[] {
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }
    return returns;
  }

  private calculateVolatility(returns: number[]): number {
    if (returns.length < 2) return 0.15;

    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    return Math.sqrt(variance * 252); // Annualized volatility
  }

  private calculateMomentum(prices: number[]): number {
    if (prices.length < 10) return 0;

    const recent = prices.slice(-5);
    const previous = prices.slice(-10, -5);

    const recentAvg = recent.reduce((sum, p) => sum + p, 0) / recent.length;
    const previousAvg = previous.reduce((sum, p) => sum + p, 0) / previous.length;

    return (recentAvg - previousAvg) / previousAvg;
  }

  private calculateTrendStrength(prices: number[]): number {
    if (prices.length < 20) return 0.5;

    // Calculate using linear regression R-squared
    const n = Math.min(prices.length, 20);
    const recentPrices = prices.slice(-n);
    const xValues = Array.from({ length: n }, (_, i) => i);

    const xMean = (n - 1) / 2;
    const yMean = recentPrices.reduce((sum, p) => sum + p, 0) / n;

    let numerator = 0;
    let xVariance = 0;
    let yVariance = 0;

    for (let i = 0; i < n; i++) {
      const xDiff = xValues[i] - xMean;
      const yDiff = recentPrices[i] - yMean;
      numerator += xDiff * yDiff;
      xVariance += xDiff * xDiff;
      yVariance += yDiff * yDiff;
    }

    if (xVariance === 0 || yVariance === 0) return 0.5;

    const correlation = numerator / Math.sqrt(xVariance * yVariance);
    return Math.abs(correlation); // R-squared approximation
  }

  private calculateVolumeRatio(volumes: number[]): number {
    if (volumes.length < 10) return 1;

    const recent = volumes.slice(-5);
    const previous = volumes.slice(-10, -5);

    const recentAvg = recent.reduce((sum, v) => sum + v, 0) / recent.length;
    const previousAvg = previous.reduce((sum, v) => sum + v, 0) / previous.length;

    return previousAvg > 0 ? recentAvg / previousAvg : 1;
  }

  private calculatePriceRange(prices: number[]): number {
    if (prices.length < 20) return 0.02;

    const recentPrices = prices.slice(-20);
    const high = Math.max(...recentPrices);
    const low = Math.min(...recentPrices);
    const mid = (high + low) / 2;

    return mid > 0 ? (high - low) / mid : 0.02;
  }

  private calculateRSIDivergence(prices: number[]): number {
    // Simplified RSI divergence calculation
    if (prices.length < 14) return 0;

    const rsi = this.calculateRSI(prices, 14);
    const priceChange = (prices[prices.length - 1] - prices[prices.length - 5]) / prices[prices.length - 5];
    const rsiChange = rsi - 50; // Normalized around neutral

    // Divergence when price and RSI move in opposite directions
    return priceChange * rsiChange < 0 ? Math.abs(priceChange - rsiChange / 50) : 0;
  }

  private calculateMACDSignal(prices: number[]): number {
    // Simplified MACD calculation
    if (prices.length < 26) return 0;

    const ema12 = this.calculateEMA(prices, 12);
    const ema26 = this.calculateEMA(prices, 26);
    const macdLine = ema12 - ema26;

    return macdLine / ema26; // Normalized MACD
  }

  private calculateRSI(prices: number[], period: number): number {
    if (prices.length < period + 1) return 50;

    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
      const change = prices[prices.length - i] - prices[prices.length - i - 1];
      if (change > 0) gains += change;
      else losses += Math.abs(change);
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;

    if (avgLoss === 0) return 100;

    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  private calculateEMA(prices: number[], period: number): number {
    if (prices.length === 0) return 0;
    if (prices.length === 1) return prices[0];

    const multiplier = 2 / (period + 1);
    let ema = prices[0];

    for (let i = 1; i < prices.length; i++) {
      ema = (prices[i] * multiplier) + (ema * (1 - multiplier));
    }

    return ema;
  }

  // Get current regime from history
  public getCurrentRegime(): MarketRegime | null {
    return this.regimeHistory.length > 0 ? this.regimeHistory[this.regimeHistory.length - 1] : null;
  }

  // Get regime stability (how consistent recent regimes are)
  public getRegimeStability(): number {
    if (this.regimeHistory.length < 5) return 0.5;

    const recent = this.regimeHistory.slice(-5);
    const primaryRegimes = recent.map(r => r.primary);
    const mostCommon = this.getMostCommonElement(primaryRegimes);
    const consistency = primaryRegimes.filter(r => r === mostCommon).length / 5;

    return consistency;
  }

  private getMostCommonElement<T>(arr: T[]): T {
    const counts: { [key: string]: number } = {};
    arr.forEach(item => {
      const key = String(item);
      counts[key] = (counts[key] || 0) + 1;
    });

    let maxCount = 0;
    let mostCommon = arr[0];
    for (const [key, count] of Object.entries(counts)) {
      if (count > maxCount) {
        maxCount = count;
        mostCommon = arr.find(item => String(item) === key) || arr[0];
      }
    }

    return mostCommon;
  }
}

export const marketVolatility = new MarketVolatilityManager();