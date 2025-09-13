import { angelAPI } from './angelAPI';
import { logger } from '../utils/logger';
import { greeksCalculator, GreeksCalculator } from '../utils/greeksCalculator';

export interface OptionChainData {
  strike: number;
  ce: {
    ltp: number;
    volume: number;
    oi: number;
    impliedVolatility: number;
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
  };
  pe: {
    ltp: number;
    volume: number;
    oi: number;
    impliedVolatility: number;
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
  };
}

export interface OptionsChainAnalysis {
  spotPrice: number;
  atmStrike: number;
  pcr: number; // Put-Call Ratio
  maxPain: number;
  totalCEOI: number;
  totalPEOI: number;
  supportLevels: number[];
  resistanceLevels: number[];
  liquidStrikes: number[];
  volatilitySkew: {
    atmIV: number;
    otmCallIV: number;
    otmPutIV: number;
    skewRatio: number;
  };
}

class OptionsChainAnalyzer {
  private chainCache = new Map<string, { data: OptionChainData[]; timestamp: number }>();
  private readonly CACHE_DURATION = 60000; // 1 minute cache

  // Fetch complete options chain for analysis
  public async getOptionsChain(
    indexName: 'NIFTY' | 'BANKNIFTY',
    spotPrice: number,
    expiry: string
  ): Promise<OptionChainData[]> {
    const cacheKey = `${indexName}-${expiry}`;
    const cached = this.chainCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
      logger.debug(`📦 Using cached options chain for ${indexName}`);
      return cached.data;
    }

    try {
      logger.info(`📊 Fetching options chain for ${indexName} expiry ${expiry}`);

      const chain: OptionChainData[] = [];
      const strikeInterval = indexName === 'BANKNIFTY' ? 500 : 50;
      const atmStrike = Math.round(spotPrice / strikeInterval) * strikeInterval;

      // Get strikes around ATM (±10 strikes = ±20 total)
      const strikesToFetch: number[] = [];
      for (let i = -10; i <= 10; i++) {
        strikesToFetch.push(atmStrike + (i * strikeInterval));
      }

      logger.info(`🎯 Fetching data for ${strikesToFetch.length} strikes around ATM ${atmStrike}`);

      // Fetch data for each strike (both CE and PE)
      for (const strike of strikesToFetch) {
        try {
          const chainData = await this.getStrikeData(indexName, strike, expiry, spotPrice);
          if (chainData) {
            chain.push(chainData);
          }
        } catch (error) {
          logger.debug(`Failed to fetch data for strike ${strike}: ${(error as Error).message}`);
        }
      }

      // Cache the result
      this.chainCache.set(cacheKey, {
        data: chain,
        timestamp: Date.now()
      });

      logger.info(`✅ Options chain fetched: ${chain.length} strikes with complete data`);
      return chain;

    } catch (error) {
      logger.error(`❌ Failed to fetch options chain for ${indexName}:`, (error as Error).message);
      return [];
    }
  }

  // Get comprehensive data for a specific strike
  private async getStrikeData(
    indexName: 'NIFTY' | 'BANKNIFTY',
    strike: number,
    expiry: string,
    spotPrice: number
  ): Promise<OptionChainData | null> {
    try {
      // Fetch CE and PE data in parallel
      const [ceData, peData] = await Promise.all([
        this.getOptionData(indexName, strike, 'CE', expiry, spotPrice),
        this.getOptionData(indexName, strike, 'PE', expiry, spotPrice)
      ]);

      if (!ceData || !peData) {
        return null;
      }

      return {
        strike,
        ce: ceData,
        pe: peData
      };

    } catch (error) {
      logger.debug(`Failed to get strike data for ${strike}: ${(error as Error).message}`);
      return null;
    }
  }

  // Get option data including Greeks calculation
  private async getOptionData(
    indexName: 'NIFTY' | 'BANKNIFTY',
    strike: number,
    optionType: 'CE' | 'PE',
    expiry: string,
    spotPrice: number
  ): Promise<{
    ltp: number;
    volume: number;
    oi: number;
    impliedVolatility: number;
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
  } | null> {
    try {
      // Get option token
      const token = await angelAPI.getOptionToken(indexName, strike, optionType, expiry);
      if (!token) {
        return null;
      }

      // Generate option symbol
      const symbol = `${indexName}${expiry}${strike}${optionType}`;

      // Fetch LTP and other data
      const ltpResponse = await angelAPI.getLTP('NFO', symbol, token);
      if (!ltpResponse?.data) {
        return null;
      }

      const ltp = parseFloat(ltpResponse.data.ltp || '0');
      if (ltp <= 0) {
        return null;
      }

      // Calculate days to expiry
      const daysToExpiry = this.calculateDaysToExpiry(expiry);

      // Calculate Greeks and IV
      const analysis = greeksCalculator.analyzeNiftyBankNiftyOption(
        indexName,
        spotPrice,
        strike,
        optionType,
        daysToExpiry,
        ltp
      );

      // Mock volume and OI data (Angel One doesn't provide this in LTP call)
      // In production, you'd fetch this from a separate API call
      const volume = Math.floor(Math.random() * 10000); // Placeholder
      const oi = Math.floor(Math.random() * 50000); // Placeholder

      return {
        ltp,
        volume,
        oi,
        impliedVolatility: analysis.impliedVolatility,
        delta: analysis.greeks.delta,
        gamma: analysis.greeks.gamma,
        theta: analysis.greeks.theta,
        vega: analysis.greeks.vega
      };

    } catch (error) {
      logger.debug(`Failed to get option data for ${indexName} ${strike} ${optionType}: ${(error as Error).message}`);
      return null;
    }
  }

  // Comprehensive options chain analysis
  public analyzeOptionsChain(
    indexName: 'NIFTY' | 'BANKNIFTY',
    chainData: OptionChainData[],
    spotPrice: number
  ): OptionsChainAnalysis {
    const strikeInterval = indexName === 'BANKNIFTY' ? 500 : 50;
    const atmStrike = Math.round(spotPrice / strikeInterval) * strikeInterval;

    // Calculate Put-Call Ratio (PCR)
    const totalCEOI = chainData.reduce((sum, data) => sum + data.ce.oi, 0);
    const totalPEOI = chainData.reduce((sum, data) => sum + data.pe.oi, 0);
    const pcr = totalCEOI > 0 ? totalPEOI / totalCEOI : 0;

    // Calculate Max Pain (strike with maximum combined OI loss)
    const maxPain = this.calculateMaxPain(chainData, spotPrice);

    // Identify support and resistance levels
    const { supportLevels, resistanceLevels } = this.identifySupportResistance(chainData);

    // Find liquid strikes (high volume)
    const liquidStrikes = chainData
      .filter(data => data.ce.volume > 1000 || data.pe.volume > 1000)
      .map(data => data.strike)
      .sort((a, b) => a - b);

    // Calculate volatility skew
    const volatilitySkew = this.calculateVolatilitySkew(chainData, atmStrike);

    return {
      spotPrice,
      atmStrike,
      pcr,
      maxPain,
      totalCEOI,
      totalPEOI,
      supportLevels,
      resistanceLevels,
      liquidStrikes,
      volatilitySkew
    };
  }

  // Calculate Max Pain level
  private calculateMaxPain(chainData: OptionChainData[], spotPrice: number): number {
    let maxPain = spotPrice;
    let maxLoss = 0;

    // Test each strike as potential expiry price
    for (const testData of chainData) {
      const testPrice = testData.strike;
      let totalLoss = 0;

      // Calculate loss for all option writers at this expiry price
      for (const data of chainData) {
        // CE writers lose if spot > strike
        if (testPrice > data.strike) {
          totalLoss += (testPrice - data.strike) * data.ce.oi;
        }

        // PE writers lose if spot < strike
        if (testPrice < data.strike) {
          totalLoss += (data.strike - testPrice) * data.pe.oi;
        }
      }

      if (totalLoss > maxLoss) {
        maxLoss = totalLoss;
        maxPain = testPrice;
      }
    }

    return maxPain;
  }

  // Identify support and resistance levels based on OI
  private identifySupportResistance(chainData: OptionChainData[]): {
    supportLevels: number[];
    resistanceLevels: number[];
  } {
    // Sort by OI to find significant levels
    const sortedByPEOI = [...chainData].sort((a, b) => b.pe.oi - a.pe.oi);
    const sortedByCEOI = [...chainData].sort((a, b) => b.ce.oi - a.ce.oi);

    // Top 3 PE OI levels are potential support
    const supportLevels = sortedByPEOI.slice(0, 3).map(data => data.strike);

    // Top 3 CE OI levels are potential resistance
    const resistanceLevels = sortedByCEOI.slice(0, 3).map(data => data.strike);

    return {
      supportLevels: supportLevels.sort((a, b) => a - b),
      resistanceLevels: resistanceLevels.sort((a, b) => a - b)
    };
  }

  // Calculate volatility skew
  private calculateVolatilitySkew(chainData: OptionChainData[], atmStrike: number): {
    atmIV: number;
    otmCallIV: number;
    otmPutIV: number;
    skewRatio: number;
  } {
    // Find ATM option
    const atmData = chainData.find(data => data.strike === atmStrike);
    const atmIV = atmData ? (atmData.ce.impliedVolatility + atmData.pe.impliedVolatility) / 2 : 0;

    // Find OTM call (above ATM)
    const otmCallData = chainData
      .filter(data => data.strike > atmStrike)
      .sort((a, b) => a.strike - b.strike)[1]; // 2nd strike above ATM

    // Find OTM put (below ATM)
    const otmPutData = chainData
      .filter(data => data.strike < atmStrike)
      .sort((a, b) => b.strike - a.strike)[1]; // 2nd strike below ATM

    const otmCallIV = otmCallData?.ce.impliedVolatility || 0;
    const otmPutIV = otmPutData?.pe.impliedVolatility || 0;

    // Skew ratio (OTM Put IV / OTM Call IV)
    const skewRatio = otmCallIV > 0 ? otmPutIV / otmCallIV : 1;

    return {
      atmIV,
      otmCallIV,
      otmPutIV,
      skewRatio
    };
  }

  // Helper: Calculate days to expiry
  private calculateDaysToExpiry(expiry: string): number {
    try {
      const day = parseInt(expiry.substring(0, 2));
      const monthStr = expiry.substring(2, 5);
      const year = 2000 + parseInt(expiry.substring(5, 7));

      const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
                     'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      const month = months.indexOf(monthStr);

      const expiryDate = new Date(year, month, day);
      const today = new Date();
      const diffTime = expiryDate.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      return Math.max(0, diffDays);
    } catch (error) {
      return 7; // Default assumption
    }
  }

  // Get trading recommendations based on chain analysis
  public getTradingRecommendations(
    analysis: OptionsChainAnalysis,
    indexName: 'NIFTY' | 'BANKNIFTY'
  ): {
    sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    confidence: number;
    recommendations: string[];
    keyLevels: {
      strongSupport: number;
      strongResistance: number;
      maxPain: number;
    };
  } {
    const recommendations: string[] = [];
    let sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    let confidence = 50;

    // PCR Analysis
    if (analysis.pcr > 1.5) {
      recommendations.push(`High PCR (${analysis.pcr.toFixed(2)}) suggests oversold conditions`);
      sentiment = 'BULLISH';
      confidence += 15;
    } else if (analysis.pcr < 0.8) {
      recommendations.push(`Low PCR (${analysis.pcr.toFixed(2)}) suggests overbought conditions`);
      sentiment = 'BEARISH';
      confidence += 15;
    }

    // Max Pain vs Spot Analysis
    const maxPainDistance = ((analysis.maxPain - analysis.spotPrice) / analysis.spotPrice) * 100;
    if (Math.abs(maxPainDistance) > 2) {
      if (maxPainDistance > 0) {
        recommendations.push(`Max Pain at ${analysis.maxPain} suggests upward pressure`);
      } else {
        recommendations.push(`Max Pain at ${analysis.maxPain} suggests downward pressure`);
      }
      confidence += 10;
    }

    // Volatility Skew Analysis
    if (analysis.volatilitySkew.skewRatio > 1.2) {
      recommendations.push('High put skew indicates fear - potential buying opportunity');
      if (sentiment === 'NEUTRAL') sentiment = 'BULLISH';
      confidence += 10;
    } else if (analysis.volatilitySkew.skewRatio < 0.8) {
      recommendations.push('Low put skew indicates complacency - potential selling opportunity');
      if (sentiment === 'NEUTRAL') sentiment = 'BEARISH';
      confidence += 10;
    }

    // Support/Resistance levels
    const strongSupport = Math.min(...analysis.supportLevels);
    const strongResistance = Math.max(...analysis.resistanceLevels);

    recommendations.push(`Key support at ${strongSupport}, resistance at ${strongResistance}`);

    return {
      sentiment,
      confidence: Math.min(100, confidence),
      recommendations,
      keyLevels: {
        strongSupport,
        strongResistance,
        maxPain: analysis.maxPain
      }
    };
  }

  // Clear cache for fresh data
  public clearCache(): void {
    this.chainCache.clear();
    logger.info('🧹 Options chain cache cleared');
  }
}

export const optionsChainAnalyzer = new OptionsChainAnalyzer();