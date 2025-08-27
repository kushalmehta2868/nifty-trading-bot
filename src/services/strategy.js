const indicatorsService = require('./indicators');
const marketDataService = require('./marketData');
const logger = require('../utils/logger');
const config = require('../config/config');

class TradingStrategy {
  constructor() {
    this.activeSignals = new Map();
    this.dailyTrades = 0;
    this.lastSignalTime = new Map();
  }

  async analyzeMarket() {
    const allSignals = [];

    for (const indexName of config.strategy.enabledIndices) {
      try {
        const signals = await this.analyzeIndex(indexName);
        allSignals.push(...signals);
      } catch (error) {
        logger.error(`Error analyzing ${indexName}:`, error.message);
      }
    }

    return allSignals;
  }

  async analyzeIndex(indexName) {
    const indexConfig = config.indices[indexName];

    // Get market data based on index
    let spotPrice, optionChain;

    if (indexName === 'NIFTY') {
      spotPrice = await marketDataService.fetchNiftySpotPrice();
      optionChain = await marketDataService.fetchOptionChain();
    } else if (indexName === 'BANKNIFTY') {
      spotPrice = await marketDataService.fetchBankNiftySpotPrice();
      optionChain = await marketDataService.fetchBankNiftyOptionChain();
    }

    if (!spotPrice || !optionChain.length) {
      return [];
    }

    // Get historical data
    const historicalData = await marketDataService.fetch5MinuteData(indexName, 1);
    const indicators = indicatorsService.getIndicators(historicalData, config.strategy);
    const currentIndicators = this.getCurrentIndicators(indicators);

    return await this.scanForSignals(
      spotPrice,
      optionChain,
      currentIndicators,
      historicalData,
      indexName,
      indexConfig
    );
  }

  async scanForSignals(spotPrice, optionChain, indicators, historicalData, indexName, indexConfig) {
    const signals = [];
    const currentTime = new Date();

    // Check daily trade limit for this index
    const dailyCount = this.dailyTrades.get(indexName) || 0;
    if (dailyCount >= config.strategy.maxTradesPerIndex) {
      return signals;
    }

    // Filter ATM options based on index-specific range
    const atmOptions = optionChain.filter(option =>
      Math.abs(option.strike - spotPrice.price) <= indexConfig.atmRange &&
      option.volume > indexConfig.minVolume &&
      option.oi > indexConfig.minOI
    );

    for (const option of atmOptions) {
      const signal = this.checkEntryConditions(
        option,
        spotPrice,
        indicators,
        historicalData,
        indexName,
        indexConfig
      );

      if (signal) {
        const signalKey = `${indexName}_${option.type}_${option.strike}`;
        const lastSignal = this.lastSignalTime.get(signalKey);

        if (!lastSignal || (currentTime - lastSignal) > 300000) {
          signals.push(signal);
          this.lastSignalTime.set(signalKey, currentTime);

          // Update daily trade count
          this.dailyTrades.set(indexName, dailyCount + 1);
        }
      }
    }

    return signals;
  }

  checkEntryConditions(option, niftySpot, indicators, historicalData) {
    const { rsi, emaFast, emaSlow, atr, vwap, volumeAvg } = indicators;
    const currentVolume = historicalData[historicalData.length - 1].volume;

    // Calculate trigger level based on your observed pattern
    const triggerLevel = option.price + (atr * 0.15);

    // Entry conditions based on your trade analysis
    const baseConditions = {
      volumeConfirmation: currentVolume > (volumeAvg * config.strategy.volumeMultiplier),
      momentumFilter: rsi > 45 && rsi < 75,
      liquidityCheck: option.volume > 10000,
      deltaRange: Math.abs(option.delta) >= 0.25 && Math.abs(option.delta) <= 0.45,
      timeFilter: this.isValidTradingTime()
    };

    // PUT Option Conditions (Bearish setup)
    if (option.type === 'PE') {
      const putConditions = {
        ...baseConditions,
        priceBreakout: option.price > triggerLevel,
        trendAlignment: niftySpot.price < vwap,
        bearishMomentum: emaFast < emaSlow || rsi > 60,
        volatilityExpansion: option.iv > 15
      };

      if (Object.values(putConditions).every(Boolean)) {
        return this.createSignal(option, niftySpot, atr, 'PUT', triggerLevel);
      }
    }

    // CALL Option Conditions (Bullish setup)
    if (option.type === 'CE') {
      const callConditions = {
        ...baseConditions,
        priceBreakout: option.price > triggerLevel,
        trendAlignment: niftySpot.price > vwap,
        bullishMomentum: emaFast > emaSlow || rsi < 65,
        volatilityExpansion: option.iv > 15
      };

      if (Object.values(callConditions).every(Boolean)) {
        return this.createSignal(option, niftySpot, atr, 'CALL', triggerLevel);
      }
    }

    return null;
  }


  createSignal(option, spotPrice, atr, direction, triggerLevel, indexName, indexConfig) {
    const entry = option.price + 0.35;
    const stopLoss = entry - (atr * 0.75);
    const target = entry + (atr * 1.2);

    // Index-specific adjustments
    let multiplier = 1;
    if (indexName === 'BANKNIFTY') {
      multiplier = 1.5; // Bank NIFTY moves faster, adjust targets
    }

    const adjustedTarget = entry + (atr * 1.2 * multiplier);
    const riskReward = (adjustedTarget - entry) / (entry - stopLoss);

    if (riskReward < config.strategy.minRiskReward) {
      return null;
    }

    return {
      index: indexName,
      symbol: `${indexName}${this.getExpiryString()}${option.strike}${option.type}`,
      direction: direction,
      type: option.type,
      strike: option.strike,
      lotSize: indexConfig.lotSize,
      triggerLevel: triggerLevel.toFixed(2),
      entry: entry.toFixed(2),
      target: adjustedTarget.toFixed(2),
      stopLoss: stopLoss.toFixed(2),
      riskReward: riskReward.toFixed(2),
      spotPrice: spotPrice.price.toFixed(2),
      timestamp: new Date(),
      confidence: this.calculateConfidence(option),
      greeks: {
        delta: option.delta?.toFixed(4),
        theta: option.theta?.toFixed(4),
        vega: option.vega?.toFixed(4),
        gamma: option.gamma?.toFixed(4)
      }
    };
  }

  getExpiryString() {
    const now = new Date();
    const day = now.getDate().toString().padStart(2, '0');
    const month = now.toLocaleString('en', { month: 'short' }).toUpperCase();
    const year = now.getFullYear().toString().slice(-2);
    return `${day}${month}${year}`;
  }

  calculateConfidence(option) {
    let score = 0;

    // Volume score (0-25 points)
    if (option.volume > 50000) score += 25;
    else if (option.volume > 25000) score += 15;
    else if (option.volume > 10000) score += 10;

    // Open Interest score (0-25 points)
    if (option.oi > 100000) score += 25;
    else if (option.oi > 50000) score += 15;
    else if (option.oi > 25000) score += 10;

    // Delta score (0-25 points)
    const absDelta = Math.abs(option.delta);
    if (absDelta >= 0.35 && absDelta <= 0.45) score += 25;
    else if (absDelta >= 0.25 && absDelta <= 0.35) score += 15;

    // IV score (0-25 points)
    if (option.iv > 20 && option.iv < 35) score += 25;
    else if (option.iv > 15 && option.iv < 40) score += 15;

    return Math.min(score, 100);
  }

  isValidTradingTime() {
    const now = new Date();
    const currentTime = now.getHours() * 100 + now.getMinutes();
    const startTime = 1015; // 10:15 AM
    const endTime = 1445;   // 2:45 PM

    return currentTime >= startTime && currentTime <= endTime;
  }
}

module.exports = new TradingStrategy();
