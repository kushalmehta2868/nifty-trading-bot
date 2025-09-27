import { logger } from '../utils/logger';
import { TradingSignal } from '../types';
import { riskManager } from './riskManager';

export interface TradeRecord {
  id: string;
  signal: TradingSignal;
  entryTime: Date;
  exitTime: Date | null;
  entryPrice: number;
  exitPrice: number | null;
  pnl: number;
  duration: number; // in minutes
  strategy: string;
  confidence: number;
}

export interface PerformanceMetrics {
  // Basic Metrics
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;

  // P&L Metrics
  totalPnL: number;
  totalWinAmount: number;
  totalLossAmount: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  expectancy: number;

  // Risk-Adjusted Metrics
  sharpeRatio: number;
  calmarRatio: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;

  // Advanced Metrics
  consecutiveWins: number;
  consecutiveLosses: number;
  avgTradeDuration: number;
  bestTrade: number;
  worstTrade: number;

  // Kelly & Position Sizing
  kellyEfficiency: number;
  avgPositionSize: number;

  // Strategy Breakdown
  strategyPerformance: { [key: string]: PerformanceMetrics | null };
}

export interface DailyPerformance {
  date: string;
  trades: number;
  pnl: number;
  winRate: number;
  sharpeRatio: number;
  maxDrawdown: number;
}

class PerformanceAnalyzer {
  private trades: TradeRecord[] = [];
  private dailyPerformance: DailyPerformance[] = [];
  private readonly MAX_TRADE_HISTORY = 1000;
  private startingCapital = 100000; // ₹1L default
  private currentCapital = 100000;

  public recordTrade(
    signal: TradingSignal,
    entryPrice: number,
    exitPrice: number,
    exitTime: Date
  ): void {
    const pnl = this.calculatePnL(signal, entryPrice, exitPrice);
    const duration = Math.floor((exitTime.getTime() - signal.timestamp.getTime()) / (1000 * 60));

    const trade: TradeRecord = {
      id: `${signal.indexName}_${Date.now()}`,
      signal,
      entryTime: signal.timestamp,
      exitTime,
      entryPrice,
      exitPrice,
      pnl,
      duration,
      strategy: this.identifyStrategy(signal),
      confidence: signal.confidence
    };

    this.trades.push(trade);

    // Maintain trade history limit
    if (this.trades.length > this.MAX_TRADE_HISTORY) {
      this.trades.shift();
    }

    // Update capital tracking
    this.currentCapital += pnl;

    // Log trade completion
    logger.info(`📊 Performance: Trade completed - ${trade.strategy} | P&L: ₹${pnl.toFixed(2)} | Duration: ${duration}min | Capital: ₹${this.currentCapital.toFixed(0)}`);

    // Update daily performance
    this.updateDailyPerformance(trade);
  }

  private calculatePnL(signal: TradingSignal, entryPrice: number, exitPrice: number): number {
    const lotSize = signal.indexName === 'NIFTY' ? 75 : 35; // NIFTY: 75, BANKNIFTY: 35
    return (exitPrice - entryPrice) * lotSize;
  }

  private identifyStrategy(signal: TradingSignal): string {
    // Identify which strategy generated the signal based on confidence and technical values
    if (signal.confidence >= 85) return 'Multi-Timeframe';
    if (signal.confidence >= 78) return 'Bollinger+RSI';
    return 'Price Action';
  }

  private updateDailyPerformance(trade: TradeRecord): void {
    const today = new Date().toDateString();
    let dailyRecord = this.dailyPerformance.find(d => d.date === today);

    if (!dailyRecord) {
      dailyRecord = {
        date: today,
        trades: 0,
        pnl: 0,
        winRate: 0,
        sharpeRatio: 0,
        maxDrawdown: 0
      };
      this.dailyPerformance.push(dailyRecord);
    }

    dailyRecord.trades++;
    dailyRecord.pnl += trade.pnl;

    // Recalculate daily metrics
    const todaysTrades = this.trades.filter(t =>
      t.exitTime && new Date(t.exitTime).toDateString() === today
    );

    if (todaysTrades.length > 0) {
      const wins = todaysTrades.filter(t => t.pnl > 0).length;
      dailyRecord.winRate = (wins / todaysTrades.length) * 100;
      dailyRecord.sharpeRatio = this.calculateDailySharpe(todaysTrades);
      dailyRecord.maxDrawdown = this.calculateDailyMaxDrawdown(todaysTrades);
    }

    // Keep only last 30 days
    if (this.dailyPerformance.length > 30) {
      this.dailyPerformance.shift();
    }
  }

  public getPerformanceMetrics(): PerformanceMetrics {
    if (this.trades.length === 0) {
      return this.getEmptyMetrics();
    }

    const completedTrades = this.trades.filter(t => t.exitTime !== null);

    // Basic metrics
    const totalTrades = completedTrades.length;
    const winningTrades = completedTrades.filter(t => t.pnl > 0);
    const losingTrades = completedTrades.filter(t => t.pnl < 0);

    const winRate = (winningTrades.length / totalTrades) * 100;

    // P&L metrics
    const totalPnL = completedTrades.reduce((sum, t) => sum + t.pnl, 0);
    const totalWinAmount = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
    const totalLossAmount = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));

    const avgWin = winningTrades.length > 0 ? totalWinAmount / winningTrades.length : 0;
    const avgLoss = losingTrades.length > 0 ? totalLossAmount / losingTrades.length : 0;
    const profitFactor = totalLossAmount > 0 ? totalWinAmount / totalLossAmount : totalWinAmount;
    const expectancy = totalTrades > 0 ? totalPnL / totalTrades : 0;

    // Risk-adjusted metrics
    const sharpeRatio = this.calculateSharpeRatio(completedTrades);
    const { maxDrawdown, maxDrawdownPercent } = this.calculateMaxDrawdown(completedTrades);
    const calmarRatio = totalPnL > 0 && maxDrawdownPercent > 0 ?
      (totalPnL / this.startingCapital * 100) / maxDrawdownPercent : 0;

    // Advanced metrics
    const { consecutiveWins, consecutiveLosses } = this.calculateConsecutiveStreaks(completedTrades);
    const avgTradeDuration = completedTrades.length > 0 ?
      completedTrades.reduce((sum, t) => sum + t.duration, 0) / completedTrades.length : 0;

    const pnlValues = completedTrades.map(t => t.pnl);
    const bestTrade = pnlValues.length > 0 ? Math.max(...pnlValues) : 0;
    const worstTrade = pnlValues.length > 0 ? Math.min(...pnlValues) : 0;

    // Kelly efficiency (how well we're using Kelly Criterion)
    const kellyEfficiency = this.calculateKellyEfficiency(completedTrades);
    const avgPositionSize = this.calculateAvgPositionSize(completedTrades);

    // Strategy breakdown
    const strategyPerformance = this.calculateStrategyBreakdown(completedTrades);

    return {
      totalTrades,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate,
      totalPnL,
      totalWinAmount,
      totalLossAmount,
      avgWin,
      avgLoss,
      profitFactor,
      expectancy,
      sharpeRatio,
      calmarRatio,
      maxDrawdown,
      maxDrawdownPercent,
      consecutiveWins,
      consecutiveLosses,
      avgTradeDuration,
      bestTrade,
      worstTrade,
      kellyEfficiency,
      avgPositionSize,
      strategyPerformance
    };
  }

  private calculateSharpeRatio(trades: TradeRecord[]): number {
    if (trades.length < 2) return 0;

    const returns = trades.map(t => t.pnl / this.startingCapital);
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;

    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    // Annualized Sharpe (assuming 250 trading days)
    const annualizedReturn = avgReturn * 250;
    const annualizedStdDev = stdDev * Math.sqrt(250);

    return annualizedStdDev > 0 ? annualizedReturn / annualizedStdDev : 0;
  }

  private calculateMaxDrawdown(trades: TradeRecord[]): { maxDrawdown: number; maxDrawdownPercent: number } {
    let maxDrawdown = 0;
    let maxDrawdownPercent = 0;
    let runningTotal = 0;
    let peak = 0;

    for (const trade of trades) {
      runningTotal += trade.pnl;

      if (runningTotal > peak) {
        peak = runningTotal;
      }

      const currentDrawdown = peak - runningTotal;
      if (currentDrawdown > maxDrawdown) {
        maxDrawdown = currentDrawdown;
        maxDrawdownPercent = peak > 0 ? (currentDrawdown / (this.startingCapital + peak)) * 100 : 0;
      }
    }

    return { maxDrawdown, maxDrawdownPercent };
  }

  private calculateConsecutiveStreaks(trades: TradeRecord[]): { consecutiveWins: number; consecutiveLosses: number } {
    let maxWins = 0;
    let maxLosses = 0;
    let currentWins = 0;
    let currentLosses = 0;

    for (const trade of trades) {
      if (trade.pnl > 0) {
        currentWins++;
        currentLosses = 0;
        maxWins = Math.max(maxWins, currentWins);
      } else {
        currentLosses++;
        currentWins = 0;
        maxLosses = Math.max(maxLosses, currentLosses);
      }
    }

    return { consecutiveWins: maxWins, consecutiveLosses: maxLosses };
  }

  private calculateKellyEfficiency(trades: TradeRecord[]): number {
    // Calculate how efficiently we're using Kelly Criterion vs theoretical optimal
    const kellyStats = riskManager.getKellyStatistics();

    if (Object.keys(kellyStats).length === 0) return 0;

    // Simple efficiency metric: actual Sharpe ratio / theoretical Kelly Sharpe
    const actualSharpe = this.calculateSharpeRatio(trades);
    const theoreticalKellySharpe = 2.0; // Theoretical optimal for good Kelly implementation

    return actualSharpe / theoreticalKellySharpe;
  }

  private calculateAvgPositionSize(trades: TradeRecord[]): number {
    if (trades.length === 0) return 0;

    // Estimate position size from entry price and lot size
    const positionSizes = trades.map(trade => {
      const lotSize = trade.signal.indexName === 'NIFTY' ? 75 : 35;
      return trade.entryPrice * lotSize;
    });

    return positionSizes.reduce((sum, size) => sum + size, 0) / positionSizes.length;
  }

  private calculateStrategyBreakdown(trades: TradeRecord[]): { [key: string]: PerformanceMetrics | null } {
    const strategies = ['Multi-Timeframe', 'Bollinger+RSI', 'Price Action'];
    const breakdown: { [key: string]: PerformanceMetrics | null } = {};

    for (const strategy of strategies) {
      const strategyTrades = trades.filter(t => t.strategy === strategy);

      if (strategyTrades.length === 0) {
        breakdown[strategy] = null;
        continue;
      }

      // Calculate metrics for this strategy
      breakdown[strategy] = this.calculateMetricsForTrades(strategyTrades);
    }

    return breakdown;
  }

  private calculateMetricsForTrades(trades: TradeRecord[]): PerformanceMetrics {
    const winningTrades = trades.filter(t => t.pnl > 0);
    const losingTrades = trades.filter(t => t.pnl < 0);

    const totalPnL = trades.reduce((sum, t) => sum + t.pnl, 0);
    const totalWinAmount = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
    const totalLossAmount = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));

    return {
      totalTrades: trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate: (winningTrades.length / trades.length) * 100,
      totalPnL,
      totalWinAmount,
      totalLossAmount,
      avgWin: winningTrades.length > 0 ? totalWinAmount / winningTrades.length : 0,
      avgLoss: losingTrades.length > 0 ? totalLossAmount / losingTrades.length : 0,
      profitFactor: totalLossAmount > 0 ? totalWinAmount / totalLossAmount : totalWinAmount,
      expectancy: totalPnL / trades.length,
      sharpeRatio: this.calculateSharpeRatio(trades),
      calmarRatio: 0, // Simplified for strategy breakdown
      maxDrawdown: 0, // Simplified for strategy breakdown
      maxDrawdownPercent: 0, // Simplified for strategy breakdown
      consecutiveWins: 0, // Simplified for strategy breakdown
      consecutiveLosses: 0, // Simplified for strategy breakdown
      avgTradeDuration: trades.reduce((sum, t) => sum + t.duration, 0) / trades.length,
      bestTrade: Math.max(...trades.map(t => t.pnl)),
      worstTrade: Math.min(...trades.map(t => t.pnl)),
      kellyEfficiency: 0, // Simplified for strategy breakdown
      avgPositionSize: this.calculateAvgPositionSize(trades),
      strategyPerformance: {}
    };
  }

  private calculateDailySharpe(trades: TradeRecord[]): number {
    if (trades.length < 2) return 0;

    const returns = trades.map(t => t.pnl);
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    return stdDev > 0 ? avgReturn / stdDev : 0;
  }

  private calculateDailyMaxDrawdown(trades: TradeRecord[]): number {
    let maxDrawdown = 0;
    let runningTotal = 0;
    let peak = 0;

    for (const trade of trades) {
      runningTotal += trade.pnl;
      peak = Math.max(peak, runningTotal);
      maxDrawdown = Math.max(maxDrawdown, peak - runningTotal);
    }

    return maxDrawdown;
  }

  private getEmptyMetrics(): PerformanceMetrics {
    return {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      totalPnL: 0,
      totalWinAmount: 0,
      totalLossAmount: 0,
      avgWin: 0,
      avgLoss: 0,
      profitFactor: 0,
      expectancy: 0,
      sharpeRatio: 0,
      calmarRatio: 0,
      maxDrawdown: 0,
      maxDrawdownPercent: 0,
      consecutiveWins: 0,
      consecutiveLosses: 0,
      avgTradeDuration: 0,
      bestTrade: 0,
      worstTrade: 0,
      kellyEfficiency: 0,
      avgPositionSize: 0,
      strategyPerformance: {}
    };
  }

  public getDailyPerformance(): DailyPerformance[] {
    return [...this.dailyPerformance];
  }

  public generatePerformanceReport(): string {
    const metrics = this.getPerformanceMetrics();
    const currentCapital = this.currentCapital;
    const totalReturn = ((currentCapital - this.startingCapital) / this.startingCapital) * 100;

    let report = '\n📊 PERFORMANCE ANALYTICS REPORT\n';
    report += '=====================================\n\n';

    // Capital Summary
    report += `💰 CAPITAL SUMMARY:\n`;
    report += `   Starting Capital: ₹${this.startingCapital.toLocaleString()}\n`;
    report += `   Current Capital:  ₹${currentCapital.toFixed(0).toLocaleString()}\n`;
    report += `   Total Return:     ${totalReturn > 0 ? '+' : ''}${totalReturn.toFixed(2)}%\n`;
    report += `   Total P&L:        ₹${metrics.totalPnL.toFixed(2)}\n\n`;

    // Core Metrics
    report += `📈 CORE METRICS:\n`;
    report += `   Total Trades:     ${metrics.totalTrades}\n`;
    report += `   Win Rate:         ${metrics.winRate.toFixed(1)}%\n`;
    report += `   Profit Factor:    ${metrics.profitFactor.toFixed(2)}\n`;
    report += `   Expectancy:       ₹${metrics.expectancy.toFixed(2)}\n`;
    report += `   Avg Win:          ₹${metrics.avgWin.toFixed(2)}\n`;
    report += `   Avg Loss:         ₹${metrics.avgLoss.toFixed(2)}\n\n`;

    // Risk Metrics
    report += `⚡ RISK METRICS:\n`;
    report += `   Sharpe Ratio:     ${metrics.sharpeRatio.toFixed(2)}\n`;
    report += `   Calmar Ratio:     ${metrics.calmarRatio.toFixed(2)}\n`;
    report += `   Max Drawdown:     ₹${metrics.maxDrawdown.toFixed(2)} (${metrics.maxDrawdownPercent.toFixed(1)}%)\n`;
    report += `   Best Trade:       ₹${metrics.bestTrade.toFixed(2)}\n`;
    report += `   Worst Trade:      ₹${metrics.worstTrade.toFixed(2)}\n\n`;

    // Advanced Metrics
    report += `🎯 ADVANCED METRICS:\n`;
    report += `   Kelly Efficiency: ${(metrics.kellyEfficiency * 100).toFixed(1)}%\n`;
    report += `   Avg Position:     ₹${metrics.avgPositionSize.toFixed(0)}\n`;
    report += `   Avg Duration:     ${metrics.avgTradeDuration.toFixed(1)} min\n`;
    report += `   Max Win Streak:   ${metrics.consecutiveWins}\n`;
    report += `   Max Loss Streak:  ${metrics.consecutiveLosses}\n\n`;

    // Strategy Breakdown
    report += `🚀 STRATEGY BREAKDOWN:\n`;
    Object.entries(metrics.strategyPerformance).forEach(([strategy, perf]) => {
      if (perf) {
        report += `   ${strategy}:\n`;
        report += `     Trades: ${perf.totalTrades} | Win Rate: ${perf.winRate.toFixed(1)}% | P&L: ₹${perf.totalPnL.toFixed(2)}\n`;
        report += `     Profit Factor: ${perf.profitFactor.toFixed(2)} | Expectancy: ₹${perf.expectancy.toFixed(2)}\n`;
      }
    });

    return report;
  }

  public resetPerformance(): void {
    this.trades = [];
    this.dailyPerformance = [];
    this.currentCapital = this.startingCapital;
    logger.info('🔄 Performance analytics reset');
  }

  public setStartingCapital(capital: number): void {
    this.startingCapital = capital;
    this.currentCapital = capital;
    logger.info(`💰 Starting capital set to ₹${capital.toLocaleString()}`);
  }
}

export const performanceAnalyzer = new PerformanceAnalyzer();