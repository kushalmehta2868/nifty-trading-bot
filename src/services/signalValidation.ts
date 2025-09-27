import { logger } from '../utils/logger';
import { TradingSignal, IndexName, OptionType } from '../types';
import { performanceMonitor } from './performanceMonitor';

interface SignalOutcome {
  signalId: string;
  signal: TradingSignal;
  timestamp: Date;
  entryPrice: number;
  exitPrice?: number;
  exitTime?: Date;
  exitReason?: 'TARGET' | 'STOPLOSS' | 'TIMEOUT' | 'MANUAL';
  pnl?: number;
  pnlPercent?: number;
  duration?: number;
  isWin?: boolean;
  actualConfidence?: number;
}

export interface StrategyPerformance {
  strategyName: string;
  totalSignals: number;
  winningSignals: number;
  losingSignals: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  sharpeRatio: number;
  maxDrawdown: number;
  avgConfidence: number;
  confidenceAccuracy: number;
  lastUpdated: Date;
}

interface MarketRegimePerformance {
  regime: 'TRENDING_BULL' | 'TRENDING_BEAR' | 'CHOPPY' | 'VOLATILE';
  performance: StrategyPerformance;
  signalCount: number;
  bestStrategy: string;
}

class SignalValidationSystem {
  private signalHistory: Map<string, SignalOutcome> = new Map();
  private strategyPerformance: Map<string, StrategyPerformance> = new Map();
  private marketRegimePerformance: Map<string, MarketRegimePerformance> = new Map();

  private readonly MAX_HISTORY_SIZE = 1000;
  private confidenceCalibrationData: Array<{ predicted: number; actual: number }> = [];

  // 🚀 WEEK 1: Real-time accuracy tracking
  private realtimeMetrics = {
    last24h: { signals: 0, wins: 0, accuracy: 0 },
    last7d: { signals: 0, wins: 0, accuracy: 0 },
    last30d: { signals: 0, wins: 0, accuracy: 0 }
  };

  public initialize(): void {
    logger.info('🎯 Signal Validation System initializing...');

    // Load historical data if exists
    this.loadHistoricalData();

    // Start periodic analysis
    setInterval(() => {
      this.performPeriodicAnalysis();
    }, 300000); // Every 5 minutes

    // Calculate real-time metrics every minute
    setInterval(() => {
      this.updateRealtimeMetrics();
    }, 60000);

    logger.info('✅ Signal Validation System initialized');
  }

  // 🚀 WEEK 1: RECORD SIGNAL GENERATION
  public recordSignalGenerated(
    signal: TradingSignal,
    strategyName: string,
    marketRegime?: string
  ): string {
    const signalId = this.generateSignalId(signal);

    const outcome: SignalOutcome = {
      signalId,
      signal: { ...signal },
      timestamp: new Date(),
      entryPrice: signal.entryPrice,
      actualConfidence: signal.confidence
    };

    this.signalHistory.set(signalId, outcome);

    // Update strategy tracking
    this.initializeStrategyTracking(strategyName);

    logger.info(`🎯 Signal recorded: ${signalId} | Strategy: ${strategyName} | Confidence: ${signal.confidence.toFixed(1)}%`);

    return signalId;
  }

  // 🚀 WEEK 1: RECORD SIGNAL OUTCOME
  public recordSignalOutcome(
    signalId: string,
    exitPrice: number,
    exitReason: 'TARGET' | 'STOPLOSS' | 'TIMEOUT' | 'MANUAL',
    strategyName: string
  ): void {
    const outcome = this.signalHistory.get(signalId);
    if (!outcome) {
      logger.warn(`❌ Signal outcome recorded for unknown signal: ${signalId}`);
      return;
    }

    const exitTime = new Date();
    const duration = exitTime.getTime() - outcome.timestamp.getTime();
    const pnl = exitPrice - outcome.entryPrice;
    const pnlPercent = (pnl / outcome.entryPrice) * 100;
    const isWin = pnl > 0;

    // Update outcome
    outcome.exitPrice = exitPrice;
    outcome.exitTime = exitTime;
    outcome.exitReason = exitReason;
    outcome.pnl = pnl;
    outcome.pnlPercent = pnlPercent;
    outcome.duration = duration;
    outcome.isWin = isWin;

    // Update strategy performance
    this.updateStrategyPerformance(strategyName, outcome);

    // Update confidence calibration
    this.updateConfidenceCalibration(outcome);

    logger.info(`🎯 Signal outcome: ${signalId} | ${isWin ? 'WIN' : 'LOSS'} | P&L: ${pnlPercent.toFixed(1)}% | Duration: ${Math.round(duration/60000)}m`);

    // Trigger performance analysis
    this.analyzeSignalPerformance(outcome, strategyName);
  }

  // 🚀 WEEK 1: REAL-TIME ACCURACY CALCULATION
  private updateRealtimeMetrics(): void {
    const now = Date.now();
    const signals = Array.from(this.signalHistory.values());

    // Calculate metrics for different time periods
    [
      { key: 'last24h', hours: 24 },
      { key: 'last7d', hours: 24 * 7 },
      { key: 'last30d', hours: 24 * 30 }
    ].forEach(period => {
      const cutoff = now - (period.hours * 60 * 60 * 1000);
      const recentSignals = signals.filter(s =>
        s.timestamp.getTime() > cutoff && s.isWin !== undefined
      );

      const wins = recentSignals.filter(s => s.isWin === true).length;
      const total = recentSignals.length;
      const accuracy = total > 0 ? (wins / total) * 100 : 0;

      (this.realtimeMetrics as any)[period.key] = {
        signals: total,
        wins,
        accuracy
      };
    });

    // Log real-time performance
    logger.info(`📊 Real-time accuracy: 24h=${this.realtimeMetrics.last24h.accuracy.toFixed(1)}% (${this.realtimeMetrics.last24h.signals} signals) | 7d=${this.realtimeMetrics.last7d.accuracy.toFixed(1)}%`);
  }

  // 🚀 WEEK 1: STRATEGY PERFORMANCE TRACKING
  private updateStrategyPerformance(strategyName: string, outcome: SignalOutcome): void {
    let perf = this.strategyPerformance.get(strategyName);

    if (!perf) {
      perf = {
        strategyName,
        totalSignals: 0,
        winningSignals: 0,
        losingSignals: 0,
        winRate: 0,
        avgWin: 0,
        avgLoss: 0,
        profitFactor: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        avgConfidence: 0,
        confidenceAccuracy: 0,
        lastUpdated: new Date()
      };
    }

    // Update counters
    perf.totalSignals++;
    if (outcome.isWin) {
      perf.winningSignals++;
    } else {
      perf.losingSignals++;
    }

    // Calculate metrics
    const allOutcomes = Array.from(this.signalHistory.values())
      .filter(o => o.pnl !== undefined);

    const strategyOutcomes = allOutcomes; // You could filter by strategy if you track it
    const wins = strategyOutcomes.filter(o => o.isWin === true);
    const losses = strategyOutcomes.filter(o => o.isWin === false);

    perf.winRate = perf.totalSignals > 0 ? (perf.winningSignals / perf.totalSignals) * 100 : 0;
    perf.avgWin = wins.length > 0 ? wins.reduce((sum, o) => sum + (o.pnlPercent || 0), 0) / wins.length : 0;
    perf.avgLoss = losses.length > 0 ? Math.abs(losses.reduce((sum, o) => sum + (o.pnlPercent || 0), 0) / losses.length) : 0;
    perf.profitFactor = perf.avgLoss > 0 ? (perf.avgWin * wins.length) / (perf.avgLoss * losses.length) : 0;

    // Calculate Sharpe ratio (simplified)
    if (strategyOutcomes.length > 0) {
      const returns = strategyOutcomes.map(o => o.pnlPercent || 0);
      const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
      const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
      const stdDev = Math.sqrt(variance);
      perf.sharpeRatio = stdDev > 0 ? avgReturn / stdDev : 0;
    }

    // Calculate confidence accuracy
    const confidenceData = strategyOutcomes
      .filter(o => o.actualConfidence !== undefined)
      .map(o => ({
        predicted: o.actualConfidence!,
        actual: o.isWin ? 100 : 0
      }));

    if (confidenceData.length > 0) {
      const avgPredicted = confidenceData.reduce((sum, d) => sum + d.predicted, 0) / confidenceData.length;
      const avgActual = confidenceData.reduce((sum, d) => sum + d.actual, 0) / confidenceData.length;
      perf.confidenceAccuracy = Math.abs(avgPredicted - avgActual);
    }

    perf.lastUpdated = new Date();
    this.strategyPerformance.set(strategyName, perf);
  }

  // 🚀 WEEK 1: CONFIDENCE CALIBRATION
  private updateConfidenceCalibration(outcome: SignalOutcome): void {
    if (outcome.actualConfidence !== undefined && outcome.isWin !== undefined) {
      this.confidenceCalibrationData.push({
        predicted: outcome.actualConfidence,
        actual: outcome.isWin ? 100 : 0
      });

      // Keep only recent data
      if (this.confidenceCalibrationData.length > 500) {
        this.confidenceCalibrationData.shift();
      }
    }
  }

  // 🚀 WEEK 1: SIGNAL PERFORMANCE ANALYSIS
  private analyzeSignalPerformance(outcome: SignalOutcome, strategyName: string): void {
    const signal = outcome.signal;

    // Analyze by time of day
    const hour = signal.timestamp.getHours();
    const timeSlot = this.getTimeSlot(hour);

    // Analyze by market conditions
    const volatility = this.classifyVolatility(signal);

    // Analyze by confidence level
    const confidenceRange = this.getConfidenceRange(signal.confidence);

    logger.info(`📊 Signal Analysis: ${strategyName} | Time: ${timeSlot} | Vol: ${volatility} | Conf: ${confidenceRange} | Result: ${outcome.isWin ? 'WIN' : 'LOSS'}`);

    // Check for concerning patterns
    this.checkForAlerts(outcome, strategyName);
  }

  private checkForAlerts(outcome: SignalOutcome, strategyName: string): void {
    const recentOutcomes = Array.from(this.signalHistory.values())
      .filter(o => o.pnl !== undefined)
      .slice(-10); // Last 10 signals

    const recentLosses = recentOutcomes.filter(o => o.isWin === false).length;

    // Alert on consecutive losses
    if (recentLosses >= 5) {
      logger.warn(`🚨 ALERT: ${strategyName} has ${recentLosses} losses in last 10 signals`);

      // Emit alert event
      (process as any).emit('signalAlert', {
        type: 'CONSECUTIVE_LOSSES',
        strategy: strategyName,
        count: recentLosses,
        message: `High loss rate detected: ${recentLosses}/10 recent signals`
      });
    }

    // Alert on poor confidence calibration
    const perf = this.strategyPerformance.get(strategyName);
    if (perf && perf.confidenceAccuracy > 30) {
      logger.warn(`🚨 ALERT: ${strategyName} confidence calibration poor: ${perf.confidenceAccuracy.toFixed(1)}% error`);
    }
  }

  // 🚀 WEEK 1: PERFORMANCE ANALYSIS
  private performPeriodicAnalysis(): void {
    logger.info('📊 Performing periodic signal analysis...');

    // Calculate overall metrics
    const allOutcomes = Array.from(this.signalHistory.values())
      .filter(o => o.pnl !== undefined);

    if (allOutcomes.length === 0) return;

    const wins = allOutcomes.filter(o => o.isWin === true);
    const losses = allOutcomes.filter(o => o.isWin === false);

    const overallWinRate = (wins.length / allOutcomes.length) * 100;
    const avgWin = wins.length > 0 ? wins.reduce((sum, o) => sum + (o.pnlPercent || 0), 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((sum, o) => sum + (o.pnlPercent || 0), 0) / losses.length) : 0;
    const profitFactor = avgLoss > 0 ? (avgWin * wins.length) / (avgLoss * losses.length) : 0;

    logger.info(`📊 Overall Performance: Win Rate=${overallWinRate.toFixed(1)}% | Avg Win=${avgWin.toFixed(1)}% | Avg Loss=${avgLoss.toFixed(1)}% | PF=${profitFactor.toFixed(2)}`);

    // Strategy comparison
    this.compareStrategies();

    // Time-based analysis
    this.analyzeTimeBasedPerformance();
  }

  private compareStrategies(): void {
    const strategies = Array.from(this.strategyPerformance.values())
      .sort((a, b) => b.winRate - a.winRate);

    logger.info('📊 Strategy Performance Ranking:');
    strategies.forEach((strategy, index) => {
      logger.info(`   ${index + 1}. ${strategy.strategyName}: ${strategy.winRate.toFixed(1)}% win rate (${strategy.totalSignals} signals)`);
    });
  }

  private analyzeTimeBasedPerformance(): void {
    const outcomes = Array.from(this.signalHistory.values())
      .filter(o => o.pnl !== undefined);

    const hourlyPerformance = new Map<number, { wins: number; total: number }>();

    outcomes.forEach(outcome => {
      const hour = outcome.timestamp.getHours();
      const current = hourlyPerformance.get(hour) || { wins: 0, total: 0 };
      current.total++;
      if (outcome.isWin) current.wins++;
      hourlyPerformance.set(hour, current);
    });

    logger.info('📊 Hourly Performance Analysis:');
    for (let hour = 9; hour <= 15; hour++) {
      const perf = hourlyPerformance.get(hour);
      if (perf && perf.total > 0) {
        const winRate = (perf.wins / perf.total) * 100;
        logger.info(`   ${hour}:00 - ${winRate.toFixed(1)}% (${perf.total} signals)`);
      }
    }
  }

  // Helper methods
  private generateSignalId(signal: TradingSignal): string {
    return `${signal.indexName}_${signal.optionType}_${signal.timestamp.getTime()}_${Math.random().toString(36).substr(2, 5)}`;
  }

  private initializeStrategyTracking(strategyName: string): void {
    if (!this.strategyPerformance.has(strategyName)) {
      this.strategyPerformance.set(strategyName, {
        strategyName,
        totalSignals: 0,
        winningSignals: 0,
        losingSignals: 0,
        winRate: 0,
        avgWin: 0,
        avgLoss: 0,
        profitFactor: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        avgConfidence: 0,
        confidenceAccuracy: 0,
        lastUpdated: new Date()
      });
    }
  }

  private getTimeSlot(hour: number): string {
    if (hour >= 9 && hour < 11) return 'MORNING';
    if (hour >= 11 && hour < 13) return 'MIDDAY';
    if (hour >= 13 && hour < 15) return 'AFTERNOON';
    return 'CLOSING';
  }

  private classifyVolatility(signal: TradingSignal): string {
    // Simplified volatility classification
    if (Math.abs(signal.technicals.priceChange) > 1) return 'HIGH';
    if (Math.abs(signal.technicals.priceChange) > 0.5) return 'MEDIUM';
    return 'LOW';
  }

  private getConfidenceRange(confidence: number): string {
    if (confidence >= 90) return 'VERY_HIGH';
    if (confidence >= 80) return 'HIGH';
    if (confidence >= 70) return 'MEDIUM';
    return 'LOW';
  }

  private loadHistoricalData(): void {
    // Implementation for loading historical signal data
    // This would typically load from a database or file
    logger.debug('📊 Loading historical signal data...');
  }

  // 🚀 WEEK 1: PUBLIC METHODS FOR MONITORING
  public getRealtimeMetrics() {
    return { ...this.realtimeMetrics };
  }

  public getStrategyPerformance(strategyName?: string) {
    if (strategyName) {
      return this.strategyPerformance.get(strategyName);
    }
    return Array.from(this.strategyPerformance.values());
  }

  public getSignalHistory(limit: number = 50) {
    return Array.from(this.signalHistory.values())
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  public getConfidenceCalibration() {
    // Calculate confidence calibration curve
    const bins = [0, 20, 40, 60, 70, 80, 90, 100];
    const calibration = bins.map(bin => {
      const binData = this.confidenceCalibrationData.filter(d =>
        d.predicted >= bin && d.predicted < bin + 10
      );

      const avgPredicted = binData.length > 0 ?
        binData.reduce((sum, d) => sum + d.predicted, 0) / binData.length : 0;
      const avgActual = binData.length > 0 ?
        binData.reduce((sum, d) => sum + d.actual, 0) / binData.length : 0;

      return {
        confidenceRange: `${bin}-${bin + 10}%`,
        predicted: avgPredicted,
        actual: avgActual,
        sampleSize: binData.length
      };
    });

    return calibration;
  }
}

export const signalValidation = new SignalValidationSystem();