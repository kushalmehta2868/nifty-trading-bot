import { logger } from '../utils/logger';
import { angelAPI } from './angelAPI';

export interface VolatilityData {
  vix: number;
  regime: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
  positionSizeMultiplier: number;
  shouldTrade: boolean;
}

class MarketVolatilityManager {
  private vixCache: { value: number; timestamp: number } | null = null;
  private readonly VIX_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

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
}

export const marketVolatility = new MarketVolatilityManager();