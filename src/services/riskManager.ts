import { logger } from '../utils/logger';
import { TradingSignal, IndexName, GreeksData } from '../types';
import { config } from '../config/config';

export interface RiskLimits {
  dailyLossLimit: number;
  weeklyLossLimit: number;
  maxPositions: number;
  maxCorrelatedPositions: number;
  minCapitalRequired: number;
}

export interface RiskStatus {
  canTrade: boolean;
  reason?: string;
  dailyPnL: number;
  weeklyPnL: number;
  activePositions: number;
  riskScore: number;
}

export interface SlippageAdjustedPrices {
  entryPrice: number;
  target: number;
  stopLoss: number;
  slippageApplied: number;
}

export interface HistoricalStats {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  totalWinAmount: number;
  totalLossAmount: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  expectancy: number;
}

export interface KellyCalculation {
  kellyFraction: number;
  conservativeKelly: number;
  recommendedSize: number;
  confidence: number;
}

class PersonalRiskManager {
  private dailyPnL = 0;
  private weeklyPnL = 0;
  private activePositions = 0;
  private correlatedPositions: Map<string, number> = new Map();
  private lastResetDate = new Date().toDateString();
  private lastWeekReset = this.getWeekNumber();

  // 🚀 PHASE 1 ADDITION: Historical trade tracking for Kelly Criterion
  private tradeHistory: number[] = []; // Array of P&L values
  private strategyStats: Map<string, HistoricalStats> = new Map(); // Per-strategy statistics
  private readonly MAX_HISTORY_LENGTH = 200; // Keep last 200 trades for analysis

  private readonly riskLimits: RiskLimits = {
    dailyLossLimit: -5000, // ₹5K daily loss limit
    weeklyLossLimit: -15000, // ₹15K weekly loss limit
    maxPositions: 3, // Max 3 simultaneous positions
    maxCorrelatedPositions: 2, // Max 2 positions in same direction
    minCapitalRequired: 25000 // Minimum ₹25K capital required
  };

  public checkRiskLimits(signal: TradingSignal): RiskStatus {
    this.resetDailyCountersIfNeeded();
    this.resetWeeklyCountersIfNeeded();

    const riskStatus: RiskStatus = {
      canTrade: true,
      dailyPnL: this.dailyPnL,
      weeklyPnL: this.weeklyPnL,
      activePositions: this.activePositions,
      riskScore: this.calculateRiskScore()
    };

    // Check daily loss limit
    if (this.dailyPnL <= this.riskLimits.dailyLossLimit) {
      riskStatus.canTrade = false;
      riskStatus.reason = `Daily loss limit reached: ₹${Math.abs(this.dailyPnL)}`;
      return riskStatus;
    }

    // Check weekly loss limit
    if (this.weeklyPnL <= this.riskLimits.weeklyLossLimit) {
      riskStatus.canTrade = false;
      riskStatus.reason = `Weekly loss limit reached: ₹${Math.abs(this.weeklyPnL)}`;
      return riskStatus;
    }

    // Check maximum positions
    if (this.activePositions >= this.riskLimits.maxPositions) {
      riskStatus.canTrade = false;
      riskStatus.reason = `Maximum positions reached: ${this.activePositions}/${this.riskLimits.maxPositions}`;
      return riskStatus;
    }

    // Check correlation limits
    const correlationKey = this.getCorrelationKey(signal);
    const correlatedCount = this.correlatedPositions.get(correlationKey) || 0;

    if (correlatedCount >= this.riskLimits.maxCorrelatedPositions) {
      riskStatus.canTrade = false;
      riskStatus.reason = `Too many correlated positions: ${correlatedCount} ${correlationKey} positions`;
      return riskStatus;
    }

    // Check risk score
    if (riskStatus.riskScore > 80) {
      riskStatus.canTrade = false;
      riskStatus.reason = `Risk score too high: ${riskStatus.riskScore}/100`;
      return riskStatus;
    }

    logger.info(`✅ Risk Check Passed - Daily P&L: ₹${this.dailyPnL} | Weekly P&L: ₹${this.weeklyPnL} | Positions: ${this.activePositions}/${this.riskLimits.maxPositions}`);
    return riskStatus;
  }

  public adjustPricesForSlippage(
    signal: TradingSignal,
    slippagePercent: number
  ): SlippageAdjustedPrices {
    const direction = signal.direction;

    // For options buying, we always pay slippage on entry
    const entrySlippage = slippagePercent;
    const exitSlippage = slippagePercent;

    const adjustedEntryPrice = signal.entryPrice * (1 + entrySlippage);

    // Adjust target down for exit slippage (we'll receive less)
    const adjustedTarget = signal.target * (1 - exitSlippage);

    // Adjust stop loss down for exit slippage (we'll receive less)
    const adjustedStopLoss = signal.stopLoss * (1 - exitSlippage);

    const result: SlippageAdjustedPrices = {
      entryPrice: adjustedEntryPrice,
      target: Math.max(adjustedTarget, adjustedEntryPrice * 1.1), // Ensure minimum 10% profit target
      stopLoss: Math.min(adjustedStopLoss, adjustedEntryPrice * 0.7), // Ensure maximum 30% loss
      slippageApplied: slippagePercent
    };

    logger.info(`🔧 Slippage Adjustment (${(slippagePercent * 100).toFixed(2)}%):
      Entry: ₹${signal.entryPrice.toFixed(2)} → ₹${result.entryPrice.toFixed(2)}
      Target: ₹${signal.target.toFixed(2)} → ₹${result.target.toFixed(2)}
      StopLoss: ₹${signal.stopLoss.toFixed(2)} → ₹${result.stopLoss.toFixed(2)}`);

    return result;
  }

  // 🚀 PHASE 1 OPTIMIZATION: Kelly Criterion-based position sizing with Greeks enhancement
  public calculateOptimalPositionSize(
    signal: TradingSignal,
    volatilityMultiplier: number,
    availableCapital: number,
    greeksData?: GreeksData | null
  ): number {
    // Get historical statistics for Kelly calculation
    const stats = this.getHistoricalStats(signal.indexName);
    const kellyResult = this.calculateKellySize(signal, stats, availableCapital, greeksData);

    // Apply volatility and risk adjustments to Kelly size
    let adjustedSize = kellyResult.recommendedSize * volatilityMultiplier;

    const riskScore = this.calculateRiskScore();
    const riskAdjustment = Math.max(0.5, 1 - (riskScore / 200));
    adjustedSize *= riskAdjustment;

    // 🚀 PHASE 2 ENHANCEMENT: Greeks-based adjustments
    if (greeksData) {
      const greeksAdjustment = this.calculateGreeksAdjustment(greeksData, signal);
      adjustedSize *= greeksAdjustment;
      logger.info(`📊 Greeks Adjustment: ${(greeksAdjustment * 100).toFixed(1)}% based on Delta=${greeksData.delta.toFixed(3)}, Theta=${greeksData.theta.toFixed(2)}`);
    }

    // Conservative caps: 15% max capital per position (reduced from 20%)
    const maxSizeByCapital = availableCapital * 0.15;
    adjustedSize = Math.min(adjustedSize, maxSizeByCapital);

    // Ensure minimum viable position
    adjustedSize = Math.max(adjustedSize, 5000);

    logger.info(`📊 Kelly Position Sizing: Kelly=${kellyResult.kellyFraction.toFixed(3)} | Conservative=${kellyResult.conservativeKelly.toFixed(3)} | Confidence=${kellyResult.confidence.toFixed(1)}%`);
    logger.info(`📊 Final Size: Kelly=₹${kellyResult.recommendedSize.toFixed(0)} | Vol Adj=${volatilityMultiplier}x | Risk Adj=${riskAdjustment.toFixed(2)}x | Final=₹${adjustedSize.toFixed(0)}`);

    return Math.round(adjustedSize);
  }

  // Calculate Kelly Criterion fraction and position size with Greeks enhancement
  private calculateKellySize(
    signal: TradingSignal,
    stats: HistoricalStats,
    availableCapital: number,
    greeksData?: GreeksData | null
  ): KellyCalculation {
    // If insufficient history, use conservative defaults
    if (stats.totalTrades < 20) {
      const defaultSize = Math.min(12000, availableCapital * 0.12); // 12% of capital
      return {
        kellyFraction: 0.12,
        conservativeKelly: 0.12,
        recommendedSize: defaultSize,
        confidence: 50 // Low confidence due to insufficient data
      };
    }

    // Kelly Criterion: f = (bp - q) / b
    // where:
    // f = fraction of capital to bet
    // b = odds received (avg win / avg loss)
    // p = probability of winning
    // q = probability of losing (1 - p)

    // 🚀 PHASE 2 ENHANCEMENT: Use Delta for improved win probability estimation
    let winProbability = stats.winRate / 100;

    if (greeksData && greeksData.confidence > 60) {
      // Delta can be used as a proxy for probability of finishing ITM
      // Adjust based on option type and current delta value
      const deltaBasedProbability = Math.abs(greeksData.delta);

      // Blend historical win rate with delta-based probability
      const blendWeight = greeksData.confidence / 100 * 0.3; // 30% max weight for delta
      winProbability = (1 - blendWeight) * winProbability + blendWeight * deltaBasedProbability;

      logger.info(`📊 Enhanced Kelly: Historical Win Rate=${(stats.winRate).toFixed(1)}% | Delta-based=${(deltaBasedProbability * 100).toFixed(1)}% | Final=${(winProbability * 100).toFixed(1)}%`);
    }

    const lossProbability = 1 - winProbability;
    const oddsRatio = stats.avgWin / Math.abs(stats.avgLoss);

    let kellyFraction = (winProbability * oddsRatio - lossProbability) / oddsRatio;

    // Kelly Criterion protection: Never bet if Kelly is negative
    if (kellyFraction <= 0) {
      kellyFraction = 0.02; // Minimum 2% if fundamentally unprofitable
      logger.warn(`⚠️ Negative Kelly fraction detected! Using minimum 2% allocation.`);
    }

    // Conservative approach: Use quarter-Kelly to reduce volatility
    const conservativeKelly = Math.min(kellyFraction * 0.25, 0.15); // Max 15% of capital

    // Add confidence bonus based on strategy-specific win rates and consistency
    const confidence = this.calculateConfidence(stats, signal);
    const confidenceAdjustment = Math.max(0.5, confidence / 100);

    const recommendedSize = availableCapital * conservativeKelly * confidenceAdjustment;

    return {
      kellyFraction,
      conservativeKelly,
      recommendedSize: Math.round(recommendedSize),
      confidence
    };
  }

  // Calculate confidence score based on historical performance
  private calculateConfidence(stats: HistoricalStats, signal: TradingSignal): number {
    let confidence = 50; // Base confidence

    // Win rate bonus (0-25 points)
    if (stats.winRate > 70) confidence += 25;
    else if (stats.winRate > 60) confidence += 15;
    else if (stats.winRate > 50) confidence += 5;

    // Profit factor bonus (0-15 points)
    if (stats.profitFactor > 2.0) confidence += 15;
    else if (stats.profitFactor > 1.5) confidence += 10;
    else if (stats.profitFactor > 1.2) confidence += 5;

    // Expectancy bonus (0-10 points)
    if (stats.expectancy > 0.15) confidence += 10;
    else if (stats.expectancy > 0.05) confidence += 5;

    // Strategy-specific confidence (add signal confidence weighting)
    confidence += (signal.confidence - 60) * 0.2; // Scale signal confidence

    return Math.min(100, Math.max(20, confidence));
  }

  // 🚀 PHASE 2 ADDITION: Greeks-based position size adjustment
  private calculateGreeksAdjustment(greeksData: GreeksData, signal: TradingSignal): number {
    let adjustment = 1.0; // Base multiplier

    // Delta adjustment: Higher Delta = higher position size (up to 20% increase)
    const deltaAdjustment = 1 + (Math.abs(greeksData.delta) - 0.5) * 0.4; // Range: 0.8x to 1.2x
    adjustment *= Math.max(0.8, Math.min(1.2, deltaAdjustment));

    // Theta adjustment: Higher time decay = lower position size (protect against time decay)
    if (Math.abs(greeksData.theta) > 10) {
      const thetaAdjustment = 1 - (Math.abs(greeksData.theta) / 100); // Reduce size for high theta
      adjustment *= Math.max(0.7, thetaAdjustment);
    }

    // Gamma adjustment: High gamma near ATM = slight increase (captures more delta change)
    if (greeksData.gamma > 0.01) {
      adjustment *= 1.05; // 5% increase for high gamma
    }

    // Vega adjustment: High vega + high IV = reduce size (volatility risk)
    if (greeksData.vega > 50 && greeksData.impliedVolatility > 25) {
      adjustment *= 0.9; // 10% reduction for high vol risk
    }

    return Math.max(0.5, Math.min(1.3, adjustment)); // Cap between 50% and 130%
  }

  public recordTrade(pnl: number, signal: TradingSignal): void {
    this.dailyPnL += pnl;
    this.weeklyPnL += pnl;

    const correlationKey = this.getCorrelationKey(signal);

    if (pnl !== 0) { // Trade completed
      // 🚀 PHASE 1 ADDITION: Record trade in history for Kelly Criterion
      this.recordTradeInHistory(pnl, signal);

      this.activePositions = Math.max(0, this.activePositions - 1);

      const currentCount = this.correlatedPositions.get(correlationKey) || 0;
      this.correlatedPositions.set(correlationKey, Math.max(0, currentCount - 1));

      logger.info(`📈 Trade Completed: P&L=₹${pnl.toFixed(2)} | Daily Total=₹${this.dailyPnL.toFixed(2)} | Active Positions=${this.activePositions}`);
    } else { // Trade opened
      this.activePositions++;

      const currentCount = this.correlatedPositions.get(correlationKey) || 0;
      this.correlatedPositions.set(correlationKey, currentCount + 1);

      logger.info(`📊 Trade Opened: ${correlationKey} | Active Positions=${this.activePositions}`);
    }

    // Log risk warnings
    this.checkRiskWarnings();
  }

  // 🚀 PHASE 1 ADDITION: Record completed trades for Kelly Criterion analysis
  private recordTradeInHistory(pnl: number, signal: TradingSignal): void {
    // Add to general trade history
    this.tradeHistory.push(pnl);
    if (this.tradeHistory.length > this.MAX_HISTORY_LENGTH) {
      this.tradeHistory.shift(); // Remove oldest trade
    }

    // Update strategy-specific statistics
    const strategyKey = `${signal.indexName}_${signal.optionType}`;
    this.updateStrategyStats(strategyKey, pnl);

    logger.info(`📊 Trade recorded for Kelly analysis: ${strategyKey} P&L=₹${pnl.toFixed(2)} | History Length=${this.tradeHistory.length}`);
  }

  // Update strategy-specific statistics
  private updateStrategyStats(strategyKey: string, pnl: number): void {
    let stats = this.strategyStats.get(strategyKey);
    if (!stats) {
      stats = {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        totalWinAmount: 0,
        totalLossAmount: 0,
        winRate: 0,
        avgWin: 0,
        avgLoss: 0,
        profitFactor: 0,
        expectancy: 0
      };
    }

    stats.totalTrades++;
    if (pnl > 0) {
      stats.winningTrades++;
      stats.totalWinAmount += pnl;
    } else {
      stats.losingTrades++;
      stats.totalLossAmount += Math.abs(pnl);
    }

    // Recalculate derived metrics
    stats.winRate = (stats.winningTrades / stats.totalTrades) * 100;
    stats.avgWin = stats.winningTrades > 0 ? stats.totalWinAmount / stats.winningTrades : 0;
    stats.avgLoss = stats.losingTrades > 0 ? stats.totalLossAmount / stats.losingTrades : 1; // Avoid division by zero
    stats.profitFactor = stats.totalLossAmount > 0 ? stats.totalWinAmount / stats.totalLossAmount : stats.totalWinAmount;
    stats.expectancy = stats.totalTrades > 0 ?
      (stats.totalWinAmount - stats.totalLossAmount) / stats.totalTrades : 0;

    this.strategyStats.set(strategyKey, stats);
  }

  // Get historical statistics for Kelly Criterion calculation
  private getHistoricalStats(indexName: string): HistoricalStats {
    // Try to get strategy-specific stats first
    const strategies = ['CE', 'PE'];
    let bestStats: HistoricalStats | null = null;
    let maxTrades = 0;

    for (const strategy of strategies) {
      const strategyKey = `${indexName}_${strategy}`;
      const stats = this.strategyStats.get(strategyKey);
      if (stats && stats.totalTrades > maxTrades) {
        bestStats = stats;
        maxTrades = stats.totalTrades;
      }
    }

    if (bestStats && bestStats.totalTrades >= 10) {
      return bestStats;
    }

    // Fallback: Calculate overall statistics from trade history
    return this.calculateOverallStats();
  }

  // Calculate overall statistics from trade history
  private calculateOverallStats(): HistoricalStats {
    if (this.tradeHistory.length === 0) {
      return {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        totalWinAmount: 0,
        totalLossAmount: 0,
        winRate: 60, // Default assumption
        avgWin: 1000, // Default assumption
        avgLoss: 500, // Default assumption
        profitFactor: 2.0, // Default assumption
        expectancy: 300 // Default assumption
      };
    }

    const totalTrades = this.tradeHistory.length;
    const winningTrades = this.tradeHistory.filter(pnl => pnl > 0).length;
    const losingTrades = totalTrades - winningTrades;
    const totalWinAmount = this.tradeHistory.filter(pnl => pnl > 0).reduce((sum, pnl) => sum + pnl, 0);
    const totalLossAmount = this.tradeHistory.filter(pnl => pnl < 0).reduce((sum, pnl) => sum + Math.abs(pnl), 0);

    const winRate = (winningTrades / totalTrades) * 100;
    const avgWin = winningTrades > 0 ? totalWinAmount / winningTrades : 1000;
    const avgLoss = losingTrades > 0 ? totalLossAmount / losingTrades : 500;
    const profitFactor = totalLossAmount > 0 ? totalWinAmount / totalLossAmount : totalWinAmount;
    const expectancy = (totalWinAmount - totalLossAmount) / totalTrades;

    return {
      totalTrades,
      winningTrades,
      losingTrades,
      totalWinAmount,
      totalLossAmount,
      winRate,
      avgWin,
      avgLoss,
      profitFactor,
      expectancy
    };
  }

  private calculateRiskScore(): number {
    let score = 0;

    // Daily P&L component (0-40 points)
    const dailyLossPercent = Math.abs(this.dailyPnL) / Math.abs(this.riskLimits.dailyLossLimit);
    score += Math.min(40, dailyLossPercent * 40);

    // Weekly P&L component (0-30 points)
    const weeklyLossPercent = Math.abs(this.weeklyPnL) / Math.abs(this.riskLimits.weeklyLossLimit);
    score += Math.min(30, weeklyLossPercent * 30);

    // Position concentration component (0-30 points)
    const positionPercent = this.activePositions / this.riskLimits.maxPositions;
    score += Math.min(30, positionPercent * 30);

    return Math.round(score);
  }

  private getCorrelationKey(signal: TradingSignal): string {
    return `${signal.indexName}_${signal.direction}`;
  }

  private resetDailyCountersIfNeeded(): void {
    const currentDate = new Date().toDateString();
    if (currentDate !== this.lastResetDate) {
      logger.info(`🔄 Daily reset: Previous P&L = ₹${this.dailyPnL.toFixed(2)}`);
      this.dailyPnL = 0;
      this.activePositions = 0;
      this.correlatedPositions.clear();
      this.lastResetDate = currentDate;
    }
  }

  private resetWeeklyCountersIfNeeded(): void {
    const currentWeek = this.getWeekNumber();
    if (currentWeek !== this.lastWeekReset) {
      logger.info(`🔄 Weekly reset: Previous P&L = ₹${this.weeklyPnL.toFixed(2)}`);
      this.weeklyPnL = 0;
      this.lastWeekReset = currentWeek;
    }
  }

  private getWeekNumber(): number {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 1);
    const days = Math.floor((now.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
    return Math.ceil((days + start.getDay() + 1) / 7);
  }

  private checkRiskWarnings(): void {
    const riskScore = this.calculateRiskScore();

    if (riskScore > 60) {
      logger.warn(`⚠️ HIGH RISK WARNING: Risk score = ${riskScore}/100`);
    }

    if (this.dailyPnL < -3000) {
      logger.warn(`⚠️ DAILY LOSS WARNING: ₹${Math.abs(this.dailyPnL)} (${Math.abs(this.riskLimits.dailyLossLimit - this.dailyPnL)} from limit)`);
    }

    if (this.weeklyPnL < -10000) {
      logger.warn(`⚠️ WEEKLY LOSS WARNING: ₹${Math.abs(this.weeklyPnL)} (${Math.abs(this.riskLimits.weeklyLossLimit - this.weeklyPnL)} from limit)`);
    }
  }

  public getRiskStatus(): RiskStatus {
    return {
      canTrade: true,
      dailyPnL: this.dailyPnL,
      weeklyPnL: this.weeklyPnL,
      activePositions: this.activePositions,
      riskScore: this.calculateRiskScore()
    };
  }

  public resetState(): void {
    this.dailyPnL = 0;
    this.weeklyPnL = 0;
    this.activePositions = 0;
    this.correlatedPositions.clear();
    this.lastResetDate = new Date().toDateString();
    this.lastWeekReset = this.getWeekNumber();

    // 🚀 PHASE 1 ADDITION: Clear Kelly Criterion historical data
    this.tradeHistory = [];
    this.strategyStats.clear();

    logger.info('🔄 Risk manager state reset (including Kelly history)');
  }

  // 🚀 PHASE 1 ADDITION: Get Kelly statistics for monitoring
  public getKellyStatistics(): { [key: string]: HistoricalStats } {
    const result: { [key: string]: HistoricalStats } = {};
    this.strategyStats.forEach((stats, strategyKey) => {
      result[strategyKey] = { ...stats };
    });
    return result;
  }
}

export const riskManager = new PersonalRiskManager();