import { logger } from '../utils/logger';
import { TradingSignal, IndexName } from '../types';
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

class PersonalRiskManager {
  private dailyPnL = 0;
  private weeklyPnL = 0;
  private activePositions = 0;
  private correlatedPositions: Map<string, number> = new Map();
  private lastResetDate = new Date().toDateString();
  private lastWeekReset = this.getWeekNumber();

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

  public calculateOptimalPositionSize(
    signal: TradingSignal,
    volatilityMultiplier: number,
    availableCapital: number
  ): number {
    const basePositionSize = 15000; // Base ₹15K position

    // Apply volatility adjustment
    let adjustedSize = basePositionSize * volatilityMultiplier;

    // Apply risk score adjustment
    const riskScore = this.calculateRiskScore();
    const riskAdjustment = Math.max(0.5, 1 - (riskScore / 200)); // Reduce size if high risk
    adjustedSize *= riskAdjustment;

    // Ensure we don't exceed 20% of available capital per position
    const maxSizeByCapital = availableCapital * 0.2;
    adjustedSize = Math.min(adjustedSize, maxSizeByCapital);

    // Ensure minimum viable position
    adjustedSize = Math.max(adjustedSize, 5000);

    logger.info(`📊 Position Sizing: Base=₹${basePositionSize} | Vol Adj=${volatilityMultiplier}x | Risk Adj=${riskAdjustment.toFixed(2)}x | Final=₹${adjustedSize.toFixed(0)}`);

    return Math.round(adjustedSize);
  }

  public recordTrade(pnl: number, signal: TradingSignal): void {
    this.dailyPnL += pnl;
    this.weeklyPnL += pnl;

    const correlationKey = this.getCorrelationKey(signal);

    if (pnl !== 0) { // Trade completed
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
    logger.info('🔄 Risk manager state reset');
  }
}

export const riskManager = new PersonalRiskManager();