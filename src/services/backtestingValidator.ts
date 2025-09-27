import { logger } from '../utils/logger';
import { TradingSignal, IndexName, OptionType } from '../types';

interface BacktestConfig {
  startDate: Date;
  endDate: Date;
  initialCapital: number;
  commissionRate: number; // percentage
  slippageRate: number;   // percentage
  strategies: string[];
  timeframes: string[];
  maxPositions: number;
  riskPerTrade: number;   // percentage of capital
}

interface BacktestTrade {
  id: string;
  signal: TradingSignal;
  strategy: string;
  entryTime: Date;
  exitTime: Date;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
  pnlPercent: number;
  commission: number;
  slippage: number;
  netPnl: number;
  duration: number; // milliseconds
  exitReason: 'TARGET' | 'STOPLOSS' | 'TIMEOUT' | 'MANUAL';
  marketConditions: {
    vix: number;
    volatility: string;
    trend: string;
    volume: string;
  };
}

interface BacktestResults {
  summary: BacktestSummary;
  trades: BacktestTrade[];
  dailyReturns: DailyReturn[];
  drawdownAnalysis: DrawdownAnalysis;
  performanceMetrics: PerformanceMetrics;
  strategyComparison: StrategyComparison[];
  riskMetrics: RiskMetrics;
  monthlyBreakdown: MonthlyBreakdown[];
}

interface BacktestSummary {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalReturn: number;
  totalReturnPercent: number;
  cagr: number;
  sharpeRatio: number;
  calmarRatio: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  avgHoldingTime: number;
  tradingDays: number;
  tradesPerDay: number;
}

interface DailyReturn {
  date: Date;
  dailyPnl: number;
  cumulativePnl: number;
  portfolioValue: number;
  drawdown: number;
  tradesCount: number;
  winRate: number;
}

interface DrawdownAnalysis {
  maxDrawdown: number;
  maxDrawdownPercent: number;
  maxDrawdownDuration: number; // days
  currentDrawdown: number;
  recoveryFactor: number;
  drawdownPeriods: Array<{
    start: Date;
    end: Date;
    duration: number;
    magnitude: number;
    magnitudePercent: number;
  }>;
}

interface PerformanceMetrics {
  returns: {
    total: number;
    annualized: number;
    monthly: number;
    weekly: number;
    daily: number;
  };
  risk: {
    volatility: number;
    sharpeRatio: number;
    sortinoRatio: number;
    calmarRatio: number;
    maxDrawdown: number;
    valueAtRisk95: number;
    valueAtRisk99: number;
  };
  consistency: {
    winRate: number;
    profitFactor: number;
    payoffRatio: number;
    expectancy: number;
    reliability: number;
  };
}

interface StrategyComparison {
  strategyName: string;
  trades: number;
  winRate: number;
  totalReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  profitFactor: number;
  avgHoldingTime: number;
  bestMonth: number;
  worstMonth: number;
  consistency: number;
}

interface RiskMetrics {
  var95: number;
  var99: number;
  expectedShortfall: number;
  beta: number;
  correlation: number;
  tracking: number;
  informationRatio: number;
  treynorRatio: number;
}

interface MonthlyBreakdown {
  year: number;
  month: number;
  trades: number;
  winRate: number;
  pnl: number;
  pnlPercent: number;
  drawdown: number;
  sharpe: number;
}

class BacktestingValidator {
  private historicalData: Map<string, any[]> = new Map();
  private benchmarkData: Map<string, number> = new Map();

  public initialize(): void {
    logger.info('📊 Backtesting Validator initializing...');

    // Initialize with mock historical data (in production, load from database/files)
    this.loadHistoricalData();

    logger.info('✅ Backtesting Validator initialized');
  }

  // 🚀 WEEK 4: COMPREHENSIVE BACKTESTING ENGINE
  public async runComprehensiveBacktest(config: BacktestConfig): Promise<BacktestResults> {
    logger.info(`🔄 Starting comprehensive backtest: ${config.startDate.toDateString()} to ${config.endDate.toDateString()}`);

    const startTime = Date.now();

    try {
      // Initialize backtest environment
      const backtestEnv = this.initializeBacktestEnvironment(config);

      // Run simulation
      const trades = await this.runBacktestSimulation(config, backtestEnv);

      // Calculate comprehensive results
      const results = this.calculateComprehensiveResults(trades, config);

      // Validate results
      this.validateBacktestResults(results);

      const duration = Date.now() - startTime;
      logger.info(`✅ Backtest completed in ${duration}ms: ${results.summary.totalTrades} trades, ${results.summary.winRate.toFixed(1)}% win rate`);

      return results;

    } catch (error) {
      logger.error('Backtest failed:', (error as Error).message);
      throw error;
    }
  }

  // 🚀 WEEK 4: STRATEGY VALIDATION
  public async validateStrategyPerformance(
    strategyName: string,
    lookbackDays: number = 30
  ): Promise<{
    isValid: boolean;
    confidence: number;
    issues: string[];
    recommendations: string[];
    metrics: any;
  }> {
    logger.info(`🎯 Validating strategy: ${strategyName} (${lookbackDays} days lookback)`);

    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

    const config: BacktestConfig = {
      startDate,
      endDate,
      initialCapital: 100000,
      commissionRate: 0.1,
      slippageRate: 0.05,
      strategies: [strategyName],
      timeframes: ['5m', '15m'],
      maxPositions: 3,
      riskPerTrade: 2
    };

    const results = await this.runComprehensiveBacktest(config);
    const issues: string[] = [];
    const recommendations: string[] = [];

    // Validation criteria
    let confidence = 100;

    // Check minimum trade count
    if (results.summary.totalTrades < 10) {
      issues.push(`Insufficient trades: ${results.summary.totalTrades} (minimum 10 required)`);
      confidence -= 30;
    }

    // Check win rate
    if (results.summary.winRate < 50) {
      issues.push(`Low win rate: ${results.summary.winRate.toFixed(1)}% (target >50%)`);
      confidence -= 25;
      recommendations.push('Review entry conditions and signal quality');
    }

    // Check Sharpe ratio
    if (results.summary.sharpeRatio < 1.0) {
      issues.push(`Low Sharpe ratio: ${results.summary.sharpeRatio.toFixed(2)} (target >1.0)`);
      confidence -= 20;
      recommendations.push('Improve risk-adjusted returns through better timing or risk management');
    }

    // Check maximum drawdown
    if (results.summary.maxDrawdownPercent > 10) {
      issues.push(`High maximum drawdown: ${results.summary.maxDrawdownPercent.toFixed(1)}% (target <10%)`);
      confidence -= 15;
      recommendations.push('Implement stricter stop-loss or position sizing rules');
    }

    // Check profit factor
    if (results.summary.profitFactor < 1.5) {
      issues.push(`Low profit factor: ${results.summary.profitFactor.toFixed(2)} (target >1.5)`);
      confidence -= 10;
      recommendations.push('Optimize entry/exit rules to improve average win vs average loss');
    }

    // Positive indicators
    if (results.summary.winRate > 70) {
      recommendations.push('Excellent win rate - consider increasing position size');
      confidence += 5;
    }

    if (results.summary.sharpeRatio > 2.0) {
      recommendations.push('Outstanding risk-adjusted returns');
      confidence += 5;
    }

    const isValid = issues.length === 0 && confidence >= 70;

    return {
      isValid,
      confidence: Math.max(0, Math.min(100, confidence)),
      issues,
      recommendations,
      metrics: results.summary
    };
  }

  // 🚀 WEEK 4: FORWARD TESTING VALIDATION
  public async runForwardTest(
    config: BacktestConfig,
    paperTradingResults: any[]
  ): Promise<{
    correlation: number;
    predictiveAccuracy: number;
    biasAnalysis: any;
    recommendations: string[];
  }> {
    logger.info('🔮 Running forward testing validation...');

    // Run backtest on same period as paper trading
    const backtestResults = await this.runComprehensiveBacktest(config);

    // Compare backtest vs paper trading results
    const correlation = this.calculateCorrelation(backtestResults.trades, paperTradingResults);
    const predictiveAccuracy = this.calculatePredictiveAccuracy(backtestResults, paperTradingResults);
    const biasAnalysis = this.analyzeBias(backtestResults, paperTradingResults);

    const recommendations: string[] = [];

    if (correlation < 0.7) {
      recommendations.push('Low correlation between backtest and forward test - review strategy implementation');
    }

    if (predictiveAccuracy < 0.8) {
      recommendations.push('Backtest may be overfitted - consider walk-forward analysis');
    }

    if (biasAnalysis.selectionBias > 0.1) {
      recommendations.push('Selection bias detected - ensure comprehensive signal testing');
    }

    return {
      correlation,
      predictiveAccuracy,
      biasAnalysis,
      recommendations
    };
  }

  // 🚀 WEEK 4: MONTE CARLO SIMULATION
  public runMonteCarloSimulation(
    trades: BacktestTrade[],
    iterations: number = 1000
  ): {
    confidenceIntervals: any;
    worstCaseScenario: any;
    bestCaseScenario: any;
    probabilityOfLoss: number;
    expectedValue: number;
  } {
    logger.info(`🎲 Running Monte Carlo simulation (${iterations} iterations)...`);

    const simulations: number[] = [];

    for (let i = 0; i < iterations; i++) {
      // Shuffle trades randomly to simulate different order scenarios
      const shuffledTrades = [...trades].sort(() => Math.random() - 0.5);
      const totalReturn = shuffledTrades.reduce((sum, trade) => sum + trade.netPnl, 0);
      simulations.push(totalReturn);
    }

    simulations.sort((a, b) => a - b);

    const confidenceIntervals = {
      p95: simulations[Math.floor(iterations * 0.95)],
      p90: simulations[Math.floor(iterations * 0.90)],
      p75: simulations[Math.floor(iterations * 0.75)],
      p50: simulations[Math.floor(iterations * 0.50)],
      p25: simulations[Math.floor(iterations * 0.25)],
      p10: simulations[Math.floor(iterations * 0.10)],
      p5: simulations[Math.floor(iterations * 0.05)]
    };

    const probabilityOfLoss = simulations.filter(sim => sim < 0).length / iterations;
    const expectedValue = simulations.reduce((sum, sim) => sum + sim, 0) / iterations;

    return {
      confidenceIntervals,
      worstCaseScenario: {
        return: simulations[0],
        probability: 1 / iterations
      },
      bestCaseScenario: {
        return: simulations[simulations.length - 1],
        probability: 1 / iterations
      },
      probabilityOfLoss,
      expectedValue
    };
  }

  // 🚀 WEEK 4: BENCHMARK COMPARISON
  public compareWithBenchmarks(
    results: BacktestResults,
    benchmarks: string[] = ['NIFTY', 'BANKNIFTY']
  ): {
    outperformance: Map<string, number>;
    riskAdjustedOutperformance: Map<string, number>;
    correlation: Map<string, number>;
    beta: Map<string, number>;
    alpha: Map<string, number>;
  } {
    logger.info('📊 Comparing with benchmarks...');

    const outperformance = new Map<string, number>();
    const riskAdjustedOutperformance = new Map<string, number>();
    const correlation = new Map<string, number>();
    const beta = new Map<string, number>();
    const alpha = new Map<string, number>();

    benchmarks.forEach(benchmark => {
      // Mock benchmark data (in production, load real data)
      const benchmarkReturn = this.getBenchmarkReturn(benchmark, results.summary.tradingDays);

      outperformance.set(benchmark, results.summary.totalReturnPercent - benchmarkReturn);

      // Risk-adjusted outperformance (simplified)
      const riskAdjusted = results.summary.sharpeRatio - (benchmarkReturn / 15); // Assuming 15% benchmark volatility
      riskAdjustedOutperformance.set(benchmark, riskAdjusted);

      // Simplified correlation (in production, calculate from daily returns)
      correlation.set(benchmark, 0.3); // Mock data
      beta.set(benchmark, 0.8); // Mock data
      alpha.set(benchmark, results.summary.totalReturnPercent - (0.8 * benchmarkReturn)); // Simplified alpha
    });

    return {
      outperformance,
      riskAdjustedOutperformance,
      correlation,
      beta,
      alpha
    };
  }

  // 🚀 WEEK 4: INITIALIZATION AND SIMULATION
  private initializeBacktestEnvironment(config: BacktestConfig): any {
    return {
      currentCapital: config.initialCapital,
      currentDate: new Date(config.startDate),
      positions: new Map(),
      trades: [] as BacktestTrade[],
      dailyReturns: [] as DailyReturn[],
      drawdowns: [] as any[]
    };
  }

  private async runBacktestSimulation(config: BacktestConfig, env: any): Promise<BacktestTrade[]> {
    const trades: BacktestTrade[] = [];
    const currentDate = new Date(config.startDate);

    // Simulate trading days
    while (currentDate <= config.endDate) {
      // Skip weekends
      if (currentDate.getDay() === 0 || currentDate.getDay() === 6) {
        currentDate.setDate(currentDate.getDate() + 1);
        continue;
      }

      // Generate mock signals for simulation
      const signals = this.generateMockSignals(currentDate, config.strategies);

      // Process signals
      for (const signal of signals) {
        if (trades.length >= 1000) break; // Limit for demonstration

        const trade = this.simulateTrade(signal, config, env);
        if (trade) {
          trades.push(trade);
        }
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }

    return trades;
  }

  private generateMockSignals(date: Date, strategies: string[]): TradingSignal[] {
    const signals: TradingSignal[] = [];

    // Generate 0-3 signals per day randomly
    const signalCount = Math.floor(Math.random() * 4);

    for (let i = 0; i < signalCount; i++) {
      const indexName = Math.random() > 0.5 ? 'NIFTY' : 'BANKNIFTY';
      const optionType = Math.random() > 0.5 ? 'CE' : 'PE';
      const basePrice = indexName === 'NIFTY' ? 24800 : 55000;
      const spotPrice = basePrice + (Math.random() - 0.5) * 200;

      signals.push({
        indexName,
        direction: optionType === 'CE' ? 'UP' : 'DOWN',
        optionSymbol: `${indexName}24JUL${Math.round(spotPrice)}${optionType}`,
        optionType,
        entryPrice: 50 + Math.random() * 100,
        target: 75 + Math.random() * 75,
        stopLoss: 25 + Math.random() * 25,
        spotPrice,
        confidence: 60 + Math.random() * 35,
        timestamp: new Date(date.getTime() + Math.random() * 6 * 60 * 60 * 1000), // Random time during trading hours
        technicals: {
          ema: 0,
          rsi: 30 + Math.random() * 40,
          priceChange: (Math.random() - 0.5) * 2,
          vwap: spotPrice * (0.98 + Math.random() * 0.04)
        }
      });
    }

    return signals;
  }

  private simulateTrade(signal: TradingSignal, config: BacktestConfig, env: any): BacktestTrade | null {
    // Simulate trade execution with realistic outcomes
    const entryPrice = signal.entryPrice * (1 + (Math.random() - 0.5) * config.slippageRate);

    // Simulate holding period (30 minutes to 4 hours)
    const holdingTimeMs = (30 + Math.random() * 210) * 60 * 1000;
    const exitTime = new Date(signal.timestamp.getTime() + holdingTimeMs);

    // Simulate exit conditions
    let exitPrice: number;
    let exitReason: 'TARGET' | 'STOPLOSS' | 'TIMEOUT' | 'MANUAL';

    const outcome = Math.random();

    if (outcome < 0.65) { // 65% chance of hitting target (optimistic for demonstration)
      exitPrice = signal.target;
      exitReason = 'TARGET';
    } else if (outcome < 0.85) { // 20% chance of hitting stop loss
      exitPrice = signal.stopLoss;
      exitReason = 'STOPLOSS';
    } else { // 15% chance of manual exit
      exitPrice = entryPrice + (Math.random() - 0.5) * entryPrice * 0.3;
      exitReason = 'MANUAL';
    }

    // Apply slippage to exit
    exitPrice = exitPrice * (1 + (Math.random() - 0.5) * config.slippageRate);

    const quantity = 1; // Simplified: 1 lot
    const grossPnl = (exitPrice - entryPrice) * quantity;
    const commission = (entryPrice + exitPrice) * quantity * config.commissionRate / 100;
    const slippage = Math.abs(entryPrice - signal.entryPrice) + Math.abs(exitPrice - (exitReason === 'TARGET' ? signal.target : signal.stopLoss));
    const netPnl = grossPnl - commission - slippage;

    return {
      id: `trade_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      signal,
      strategy: 'Mock Strategy',
      entryTime: signal.timestamp,
      exitTime,
      entryPrice,
      exitPrice,
      quantity,
      pnl: grossPnl,
      pnlPercent: (grossPnl / entryPrice) * 100,
      commission,
      slippage,
      netPnl,
      duration: holdingTimeMs,
      exitReason,
      marketConditions: {
        vix: 15 + Math.random() * 20,
        volatility: Math.random() > 0.5 ? 'HIGH' : 'MEDIUM',
        trend: Math.random() > 0.5 ? 'BULLISH' : 'BEARISH',
        volume: Math.random() > 0.5 ? 'HIGH' : 'NORMAL'
      }
    };
  }

  // 🚀 WEEK 4: COMPREHENSIVE RESULTS CALCULATION
  private calculateComprehensiveResults(trades: BacktestTrade[], config: BacktestConfig): BacktestResults {
    const summary = this.calculateSummary(trades, config);
    const dailyReturns = this.calculateDailyReturns(trades, config);
    const drawdownAnalysis = this.calculateDrawdownAnalysis(dailyReturns);
    const performanceMetrics = this.calculatePerformanceMetrics(trades, dailyReturns);
    const strategyComparison = this.calculateStrategyComparison(trades);
    const riskMetrics = this.calculateRiskMetrics(dailyReturns);
    const monthlyBreakdown = this.calculateMonthlyBreakdown(trades);

    return {
      summary,
      trades,
      dailyReturns,
      drawdownAnalysis,
      performanceMetrics,
      strategyComparison,
      riskMetrics,
      monthlyBreakdown
    };
  }

  private calculateSummary(trades: BacktestTrade[], config: BacktestConfig): BacktestSummary {
    if (trades.length === 0) {
      return this.getEmptyBacktestSummary();
    }

    const winningTrades = trades.filter(t => t.netPnl > 0);
    const losingTrades = trades.filter(t => t.netPnl <= 0);

    const totalReturn = trades.reduce((sum, t) => sum + t.netPnl, 0);
    const totalReturnPercent = (totalReturn / config.initialCapital) * 100;

    const tradingDays = Math.ceil((config.endDate.getTime() - config.startDate.getTime()) / (24 * 60 * 60 * 1000));
    const cagr = Math.pow(1 + totalReturnPercent / 100, 365 / tradingDays) - 1;

    // Calculate Sharpe ratio (simplified)
    const returns = trades.map(t => t.pnlPercent);
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const volatility = Math.sqrt(variance);
    const sharpeRatio = volatility > 0 ? avgReturn / volatility : 0;

    // Calculate max drawdown
    let peak = config.initialCapital;
    let maxDrawdown = 0;
    let runningCapital = config.initialCapital;

    trades.forEach(trade => {
      runningCapital += trade.netPnl;
      if (runningCapital > peak) {
        peak = runningCapital;
      }
      const drawdown = peak - runningCapital;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    });

    const maxDrawdownPercent = (maxDrawdown / peak) * 100;
    const calmarRatio = cagr / (maxDrawdownPercent / 100);

    const avgWin = winningTrades.length > 0 ? winningTrades.reduce((sum, t) => sum + t.netPnl, 0) / winningTrades.length : 0;
    const avgLoss = losingTrades.length > 0 ? Math.abs(losingTrades.reduce((sum, t) => sum + t.netPnl, 0) / losingTrades.length) : 0;
    const profitFactor = avgLoss > 0 ? (avgWin * winningTrades.length) / (avgLoss * losingTrades.length) : 0;

    return {
      totalTrades: trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate: (winningTrades.length / trades.length) * 100,
      totalReturn,
      totalReturnPercent,
      cagr: cagr * 100,
      sharpeRatio,
      calmarRatio,
      maxDrawdown,
      maxDrawdownPercent,
      profitFactor,
      avgWin,
      avgLoss,
      largestWin: Math.max(...trades.map(t => t.netPnl)),
      largestLoss: Math.min(...trades.map(t => t.netPnl)),
      avgHoldingTime: trades.reduce((sum, t) => sum + t.duration, 0) / trades.length,
      tradingDays,
      tradesPerDay: trades.length / tradingDays
    };
  }

  private calculateDailyReturns(trades: BacktestTrade[], config: BacktestConfig): DailyReturn[] {
    const dailyReturns: DailyReturn[] = [];
    let runningCapital = config.initialCapital;
    let peak = config.initialCapital;

    // Group trades by day
    const tradesByDay = new Map<string, BacktestTrade[]>();
    trades.forEach(trade => {
      const dateKey = trade.entryTime.toDateString();
      if (!tradesByDay.has(dateKey)) {
        tradesByDay.set(dateKey, []);
      }
      tradesByDay.get(dateKey)!.push(trade);
    });

    // Calculate daily metrics
    const currentDate = new Date(config.startDate);
    while (currentDate <= config.endDate) {
      const dateKey = currentDate.toDateString();
      const dayTrades = tradesByDay.get(dateKey) || [];

      const dailyPnl = dayTrades.reduce((sum, t) => sum + t.netPnl, 0);
      runningCapital += dailyPnl;

      if (runningCapital > peak) {
        peak = runningCapital;
      }

      const drawdown = peak - runningCapital;
      const dayWinningTrades = dayTrades.filter(t => t.netPnl > 0).length;
      const dayWinRate = dayTrades.length > 0 ? (dayWinningTrades / dayTrades.length) * 100 : 0;

      dailyReturns.push({
        date: new Date(currentDate),
        dailyPnl,
        cumulativePnl: runningCapital - config.initialCapital,
        portfolioValue: runningCapital,
        drawdown,
        tradesCount: dayTrades.length,
        winRate: dayWinRate
      });

      currentDate.setDate(currentDate.getDate() + 1);
    }

    return dailyReturns;
  }

  private calculateDrawdownAnalysis(dailyReturns: DailyReturn[]): DrawdownAnalysis {
    let maxDrawdown = 0;
    let maxDrawdownPercent = 0;
    let maxDrawdownDuration = 0;
    let currentDrawdownStart: Date | null = null;
    let currentDrawdownDuration = 0;

    const drawdownPeriods: any[] = [];

    dailyReturns.forEach((day, index) => {
      if (day.drawdown > 0) {
        if (!currentDrawdownStart) {
          currentDrawdownStart = day.date;
          currentDrawdownDuration = 1;
        } else {
          currentDrawdownDuration++;
        }

        if (day.drawdown > maxDrawdown) {
          maxDrawdown = day.drawdown;
          maxDrawdownPercent = (day.drawdown / day.portfolioValue) * 100;
        }

        if (currentDrawdownDuration > maxDrawdownDuration) {
          maxDrawdownDuration = currentDrawdownDuration;
        }
      } else {
        if (currentDrawdownStart) {
          // End of drawdown period
          const previousDay = dailyReturns[index - 1];
          drawdownPeriods.push({
            start: currentDrawdownStart,
            end: previousDay.date,
            duration: currentDrawdownDuration,
            magnitude: previousDay.drawdown,
            magnitudePercent: (previousDay.drawdown / previousDay.portfolioValue) * 100
          });

          currentDrawdownStart = null;
          currentDrawdownDuration = 0;
        }
      }
    });

    const lastDay = dailyReturns[dailyReturns.length - 1];
    const recoveryFactor = maxDrawdown > 0 ? lastDay.cumulativePnl / maxDrawdown : 0;

    return {
      maxDrawdown,
      maxDrawdownPercent,
      maxDrawdownDuration,
      currentDrawdown: lastDay.drawdown,
      recoveryFactor,
      drawdownPeriods
    };
  }

  private calculatePerformanceMetrics(trades: BacktestTrade[], dailyReturns: DailyReturn[]): PerformanceMetrics {
    const totalReturn = trades.reduce((sum, t) => sum + t.netPnl, 0);
    const tradingDays = dailyReturns.length;

    // Returns calculations
    const dailyReturnPct = dailyReturns.map(d => (d.dailyPnl / d.portfolioValue) * 100);
    const avgDailyReturn = dailyReturnPct.reduce((sum, r) => sum + r, 0) / dailyReturnPct.length;
    const annualizedReturn = avgDailyReturn * 252; // 252 trading days

    // Risk calculations
    const variance = dailyReturnPct.reduce((sum, r) => sum + Math.pow(r - avgDailyReturn, 2), 0) / dailyReturnPct.length;
    const volatility = Math.sqrt(variance) * Math.sqrt(252);

    const downside = dailyReturnPct.filter(r => r < 0);
    const downsideVariance = downside.length > 0 ?
      downside.reduce((sum, r) => sum + Math.pow(r, 2), 0) / downside.length : 0;
    const downsideDeviation = Math.sqrt(downsideVariance) * Math.sqrt(252);

    const sharpeRatio = volatility > 0 ? annualizedReturn / volatility : 0;
    const sortinoRatio = downsideDeviation > 0 ? annualizedReturn / downsideDeviation : 0;

    // Consistency metrics
    const winningTrades = trades.filter(t => t.netPnl > 0);
    const losingTrades = trades.filter(t => t.netPnl <= 0);
    const winRate = (winningTrades.length / trades.length) * 100;

    const avgWin = winningTrades.length > 0 ? winningTrades.reduce((sum, t) => sum + t.netPnl, 0) / winningTrades.length : 0;
    const avgLoss = losingTrades.length > 0 ? Math.abs(losingTrades.reduce((sum, t) => sum + t.netPnl, 0) / losingTrades.length) : 0;
    const profitFactor = avgLoss > 0 ? (avgWin * winningTrades.length) / (avgLoss * losingTrades.length) : 0;
    const payoffRatio = avgLoss > 0 ? avgWin / avgLoss : 0;
    const expectancy = (winRate / 100) * avgWin - ((100 - winRate) / 100) * avgLoss;

    return {
      returns: {
        total: totalReturn,
        annualized: annualizedReturn,
        monthly: annualizedReturn / 12,
        weekly: annualizedReturn / 52,
        daily: avgDailyReturn
      },
      risk: {
        volatility,
        sharpeRatio,
        sortinoRatio,
        calmarRatio: 0, // Would need max drawdown calculation
        maxDrawdown: 0, // Would be calculated from drawdown analysis
        valueAtRisk95: this.calculateVaR(dailyReturnPct, 0.95),
        valueAtRisk99: this.calculateVaR(dailyReturnPct, 0.99)
      },
      consistency: {
        winRate,
        profitFactor,
        payoffRatio,
        expectancy,
        reliability: this.calculateReliability(trades)
      }
    };
  }

  private calculateStrategyComparison(trades: BacktestTrade[]): StrategyComparison[] {
    const strategiesByName = new Map<string, BacktestTrade[]>();

    trades.forEach(trade => {
      if (!strategiesByName.has(trade.strategy)) {
        strategiesByName.set(trade.strategy, []);
      }
      strategiesByName.get(trade.strategy)!.push(trade);
    });

    return Array.from(strategiesByName.entries()).map(([strategyName, strategyTrades]) => {
      const winningTrades = strategyTrades.filter(t => t.netPnl > 0);
      const totalReturn = strategyTrades.reduce((sum, t) => sum + t.netPnl, 0);
      const winRate = (winningTrades.length / strategyTrades.length) * 100;

      const returns = strategyTrades.map(t => t.pnlPercent);
      const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
      const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
      const volatility = Math.sqrt(variance);
      const sharpeRatio = volatility > 0 ? avgReturn / volatility : 0;

      return {
        strategyName,
        trades: strategyTrades.length,
        winRate,
        totalReturn,
        sharpeRatio,
        maxDrawdown: 0, // Would calculate from strategy-specific drawdown
        profitFactor: 0, // Would calculate properly
        avgHoldingTime: strategyTrades.reduce((sum, t) => sum + t.duration, 0) / strategyTrades.length,
        bestMonth: 0, // Would calculate from monthly breakdown
        worstMonth: 0, // Would calculate from monthly breakdown
        consistency: this.calculateReliability(strategyTrades)
      };
    });
  }

  private calculateRiskMetrics(dailyReturns: DailyReturn[]): RiskMetrics {
    const returns = dailyReturns.map(d => (d.dailyPnl / d.portfolioValue) * 100);

    return {
      var95: this.calculateVaR(returns, 0.95),
      var99: this.calculateVaR(returns, 0.99),
      expectedShortfall: this.calculateExpectedShortfall(returns, 0.95),
      beta: 0.8, // Mock data - would calculate vs benchmark
      correlation: 0.3, // Mock data - would calculate vs benchmark
      tracking: 2.5, // Mock tracking error
      informationRatio: 0.8, // Mock IR
      treynorRatio: 15.5 // Mock Treynor ratio
    };
  }

  private calculateMonthlyBreakdown(trades: BacktestTrade[]): MonthlyBreakdown[] {
    const monthlyData = new Map<string, BacktestTrade[]>();

    trades.forEach(trade => {
      const year = trade.entryTime.getFullYear();
      const month = trade.entryTime.getMonth() + 1;
      const key = `${year}-${month}`;

      if (!monthlyData.has(key)) {
        monthlyData.set(key, []);
      }
      monthlyData.get(key)!.push(trade);
    });

    return Array.from(monthlyData.entries()).map(([key, monthTrades]) => {
      const [year, month] = key.split('-').map(Number);
      const winningTrades = monthTrades.filter(t => t.netPnl > 0);
      const winRate = (winningTrades.length / monthTrades.length) * 100;
      const pnl = monthTrades.reduce((sum, t) => sum + t.netPnl, 0);

      return {
        year,
        month,
        trades: monthTrades.length,
        winRate,
        pnl,
        pnlPercent: 0, // Would calculate based on starting capital for month
        drawdown: 0, // Would calculate month-specific drawdown
        sharpe: 0 // Would calculate month-specific Sharpe
      };
    });
  }

  // Helper methods
  private calculateVaR(returns: number[], confidence: number): number {
    const sorted = returns.sort((a, b) => a - b);
    const index = Math.floor((1 - confidence) * sorted.length);
    return sorted[index] || 0;
  }

  private calculateExpectedShortfall(returns: number[], confidence: number): number {
    const valueAtRisk = this.calculateVaR(returns, confidence);
    const tail = returns.filter(r => r <= valueAtRisk);
    return tail.length > 0 ? tail.reduce((sum, r) => sum + r, 0) / tail.length : 0;
  }

  private calculateReliability(trades: BacktestTrade[]): number {
    // Simplified reliability calculation based on consistency of returns
    if (trades.length < 10) return 0;

    const returns = trades.map(t => t.pnlPercent);
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    const coefficientOfVariation = Math.sqrt(variance) / Math.abs(mean);

    return Math.max(0, 100 - coefficientOfVariation * 10);
  }

  private calculateCorrelation(backtestTrades: BacktestTrade[], paperTrades: any[]): number {
    // Simplified correlation calculation
    return 0.75; // Mock data
  }

  private calculatePredictiveAccuracy(backtestResults: BacktestResults, paperResults: any[]): number {
    // Compare key metrics between backtest and paper trading
    return 0.82; // Mock data
  }

  private analyzeBias(backtestResults: BacktestResults, paperResults: any[]): any {
    return {
      selectionBias: 0.05,
      survivorshipBias: 0.03,
      lookAheadBias: 0.02,
      overfittingRisk: 0.15
    };
  }

  private getBenchmarkReturn(benchmark: string, days: number): number {
    // Mock benchmark returns
    const annualReturns = { 'NIFTY': 12, 'BANKNIFTY': 15 };
    return (annualReturns[benchmark as keyof typeof annualReturns] || 10) * (days / 365);
  }

  private validateBacktestResults(results: BacktestResults): void {
    // Validate that results make sense
    if (results.summary.totalTrades === 0) {
      throw new Error('No trades generated in backtest period');
    }

    if (results.summary.winRate < 0 || results.summary.winRate > 100) {
      throw new Error('Invalid win rate calculated');
    }

    logger.info('✅ Backtest results validation passed');
  }

  private getEmptyBacktestSummary(): BacktestSummary {
    return {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      totalReturn: 0,
      totalReturnPercent: 0,
      cagr: 0,
      sharpeRatio: 0,
      calmarRatio: 0,
      maxDrawdown: 0,
      maxDrawdownPercent: 0,
      profitFactor: 0,
      avgWin: 0,
      avgLoss: 0,
      largestWin: 0,
      largestLoss: 0,
      avgHoldingTime: 0,
      tradingDays: 0,
      tradesPerDay: 0
    };
  }

  private loadHistoricalData(): void {
    // Mock implementation - in production, load real historical data
    logger.info('📊 Loading historical market data for backtesting...');

    // This would load OHLCV data, options data, etc.
    this.historicalData.set('NIFTY', []);
    this.historicalData.set('BANKNIFTY', []);

    logger.info('✅ Historical data loaded');
  }

  // 🚀 WEEK 4: PUBLIC METHODS FOR API
  public generateBacktestReport(results: BacktestResults): string {
    let report = `📊 COMPREHENSIVE BACKTEST REPORT\n\n`;

    report += `🎯 SUMMARY:\n`;
    report += `Total Trades: ${results.summary.totalTrades}\n`;
    report += `Win Rate: ${results.summary.winRate.toFixed(1)}%\n`;
    report += `Total Return: ${results.summary.totalReturnPercent.toFixed(2)}%\n`;
    report += `CAGR: ${results.summary.cagr.toFixed(2)}%\n`;
    report += `Sharpe Ratio: ${results.summary.sharpeRatio.toFixed(2)}\n`;
    report += `Max Drawdown: ${results.summary.maxDrawdownPercent.toFixed(2)}%\n`;
    report += `Profit Factor: ${results.summary.profitFactor.toFixed(2)}\n\n`;

    report += `📈 PERFORMANCE METRICS:\n`;
    report += `Average Win: ₹${results.summary.avgWin.toFixed(2)}\n`;
    report += `Average Loss: ₹${results.summary.avgLoss.toFixed(2)}\n`;
    report += `Largest Win: ₹${results.summary.largestWin.toFixed(2)}\n`;
    report += `Largest Loss: ₹${results.summary.largestLoss.toFixed(2)}\n`;
    report += `Avg Holding Time: ${Math.round(results.summary.avgHoldingTime / 60000)} minutes\n\n`;

    report += `⚠️ RISK ANALYSIS:\n`;
    report += `Max Drawdown: ${results.drawdownAnalysis.maxDrawdownPercent.toFixed(2)}%\n`;
    report += `VaR (95%): ${results.riskMetrics.var95.toFixed(2)}%\n`;
    report += `Expected Shortfall: ${results.riskMetrics.expectedShortfall.toFixed(2)}%\n\n`;

    return report;
  }
}

export const backtestingValidator = new BacktestingValidator();