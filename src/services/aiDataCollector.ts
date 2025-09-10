import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger';
import { IndexName, TradingSignal, PriceUpdate } from '../types';

interface MarketSnapshot {
  timestamp: number;
  indexName: IndexName;
  price: number;
  volume: number;
  indicators: {
    ema: number;
    rsi: number;
    bollingerBands: {
      upper: number;
      middle: number;
      lower: number;
      squeeze: boolean;
    };
    support: number;
    resistance: number;
    momentum: number;
    volatility: number;
  };
  marketConditions: {
    trend: 'BULLISH' | 'BEARISH' | 'SIDEWAYS';
    volatilityRegime: 'LOW' | 'MEDIUM' | 'HIGH';
    timeOfDay: 'OPENING' | 'MID_DAY' | 'CLOSING';
    dayOfWeek: number;
  };
}

interface TradeOutcome {
  signalId: string;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  targetPrice: number;
  stopLossPrice: number;
  outcome: 'TARGET_HIT' | 'STOP_LOSS_HIT' | 'MANUAL_EXIT' | 'EXPIRED';
  profitLoss: number;
  profitLossPercent: number;
  holdingDuration: number; // milliseconds
  maxDrawdown: number;
  maxProfit: number;
  slippage: number;
  entrySnapshot: MarketSnapshot;
  exitSnapshot: MarketSnapshot;
}

interface AITrainingData {
  marketSnapshots: MarketSnapshot[];
  tradeOutcomes: TradeOutcome[];
  dailyStats: {
    date: string;
    totalTrades: number;
    winRate: number;
    avgProfit: number;
    avgLoss: number;
    maxDrawdown: number;
    volatility: number;
  }[];
}

/**
 * 🤖 AI Data Collector Service
 * Collects comprehensive market data and trading outcomes for AI model training
 */
class AIDataCollectorService {
  private dataDir = './ai-data';
  private currentSnapshots: MarketSnapshot[] = [];
  private tradeOutcomes: TradeOutcome[] = [];
  private activeSignals: Map<string, { signal: TradingSignal; entrySnapshot: MarketSnapshot }> = new Map();
  private maxSnapshotsPerDay = 5000; // ~1 snapshot every 10 seconds during trading hours

  public async initialize(): Promise<void> {
    logger.info('🤖 Initializing AI Data Collector...');
    
    // Create data directory structure
    await this.ensureDirectories();
    
    // Load existing data
    await this.loadExistingData();
    
    // Start periodic data saving (every hour)
    setInterval(() => {
      this.saveDataToDisk();
    }, 60 * 60 * 1000);
    
    logger.info('✅ AI Data Collector initialized');
  }

  /**
   * 📊 Collect market snapshot for AI training
   */
  public collectMarketSnapshot(
    indexName: IndexName,
    priceUpdate: PriceUpdate,
    indicators: any,
    marketConditions: any
  ): void {
    const snapshot: MarketSnapshot = {
      timestamp: Date.now(),
      indexName,
      price: priceUpdate.price,
      volume: 0, // Will be updated when volume data is available
      indicators: {
        ema: indicators.ema || 0,
        rsi: indicators.rsi || 50,
        bollingerBands: {
          upper: indicators.bollingerUpper || 0,
          middle: indicators.bollingerMiddle || 0,
          lower: indicators.bollingerLower || 0,
          squeeze: indicators.bollingerSqueeze || false
        },
        support: indicators.support || 0,
        resistance: indicators.resistance || 0,
        momentum: indicators.momentum || 0,
        volatility: indicators.volatility || 0
      },
      marketConditions: {
        trend: this.determineTrend(indicators),
        volatilityRegime: this.determineVolatilityRegime(indicators.volatility || 0),
        timeOfDay: this.getTimeOfDay(),
        dayOfWeek: new Date().getDay()
      }
    };

    this.currentSnapshots.push(snapshot);
    
    // Keep only recent snapshots to prevent memory issues
    if (this.currentSnapshots.length > this.maxSnapshotsPerDay) {
      this.currentSnapshots = this.currentSnapshots.slice(-this.maxSnapshotsPerDay);
    }
  }

  /**
   * 🎯 Record signal entry for tracking
   */
  public recordSignalEntry(signal: TradingSignal): void {
    const entrySnapshot = this.getCurrentMarketSnapshot(signal.indexName);
    if (entrySnapshot) {
      this.activeSignals.set(signal.timestamp.getTime().toString(), {
        signal,
        entrySnapshot
      });
      logger.debug(`🤖 AI: Recorded signal entry for ${signal.optionSymbol}`);
    }
  }

  /**
   * 🏁 Record trade outcome for AI learning
   */
  public recordTradeOutcome(
    signalId: string,
    exitPrice: number,
    outcome: TradeOutcome['outcome'],
    exitTime: number = Date.now()
  ): void {
    const activeSignal = this.activeSignals.get(signalId);
    if (!activeSignal) {
      logger.warn(`🤖 AI: No active signal found for ID ${signalId}`);
      return;
    }

    const { signal, entrySnapshot } = activeSignal;
    const exitSnapshot = this.getCurrentMarketSnapshot(signal.indexName);
    
    if (!exitSnapshot) {
      logger.warn(`🤖 AI: No market snapshot available for exit`);
      return;
    }

    const profitLoss = exitPrice - signal.entryPrice;
    const profitLossPercent = (profitLoss / signal.entryPrice) * 100;
    const holdingDuration = exitTime - signal.timestamp.getTime();

    const tradeOutcome: TradeOutcome = {
      signalId,
      entryTime: signal.timestamp.getTime(),
      exitTime,
      entryPrice: signal.entryPrice,
      exitPrice,
      targetPrice: signal.target,
      stopLossPrice: signal.stopLoss,
      outcome,
      profitLoss,
      profitLossPercent,
      holdingDuration,
      maxDrawdown: this.calculateMaxDrawdown(signal, exitPrice),
      maxProfit: this.calculateMaxProfit(signal, exitPrice),
      slippage: this.calculateSlippage(signal.entryPrice, exitPrice, outcome),
      entrySnapshot,
      exitSnapshot
    };

    this.tradeOutcomes.push(tradeOutcome);
    this.activeSignals.delete(signalId);

    logger.info(`🤖 AI: Recorded trade outcome - ${outcome}, P&L: ${profitLossPercent.toFixed(2)}%`);
  }

  /**
   * 📈 Get training data for AI models
   */
  public getTrainingData(days: number = 30): AITrainingData {
    const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);
    
    return {
      marketSnapshots: this.currentSnapshots.filter(s => s.timestamp > cutoffTime),
      tradeOutcomes: this.tradeOutcomes.filter(t => t.entryTime > cutoffTime),
      dailyStats: this.calculateDailyStats(cutoffTime)
    };
  }

  /**
   * 💾 Export data for Python AI training
   */
  public async exportTrainingData(outputPath?: string): Promise<string> {
    const trainingData = this.getTrainingData(90); // 3 months of data
    const exportPath = outputPath || path.join(this.dataDir, `training_data_${Date.now()}.json`);
    
    await fs.writeFile(exportPath, JSON.stringify(trainingData, null, 2));
    logger.info(`🤖 AI: Training data exported to ${exportPath}`);
    
    return exportPath;
  }

  private async ensureDirectories(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.mkdir(path.join(this.dataDir, 'snapshots'), { recursive: true });
    await fs.mkdir(path.join(this.dataDir, 'outcomes'), { recursive: true });
    await fs.mkdir(path.join(this.dataDir, 'exports'), { recursive: true });
  }

  private async loadExistingData(): Promise<void> {
    try {
      const snapshotsPath = path.join(this.dataDir, 'current_snapshots.json');
      const outcomesPath = path.join(this.dataDir, 'trade_outcomes.json');

      try {
        const snapshotsData = await fs.readFile(snapshotsPath, 'utf-8');
        this.currentSnapshots = JSON.parse(snapshotsData);
      } catch (error) {
        logger.debug('No existing snapshots found');
      }

      try {
        const outcomesData = await fs.readFile(outcomesPath, 'utf-8');
        this.tradeOutcomes = JSON.parse(outcomesData);
      } catch (error) {
        logger.debug('No existing outcomes found');
      }

      logger.info(`🤖 AI: Loaded ${this.currentSnapshots.length} snapshots, ${this.tradeOutcomes.length} outcomes`);
    } catch (error) {
      logger.error('Error loading existing AI data:', (error as Error).message);
    }
  }

  private async saveDataToDisk(): Promise<void> {
    try {
      const snapshotsPath = path.join(this.dataDir, 'current_snapshots.json');
      const outcomesPath = path.join(this.dataDir, 'trade_outcomes.json');

      await fs.writeFile(snapshotsPath, JSON.stringify(this.currentSnapshots, null, 2));
      await fs.writeFile(outcomesPath, JSON.stringify(this.tradeOutcomes, null, 2));

      logger.debug(`🤖 AI: Saved ${this.currentSnapshots.length} snapshots, ${this.tradeOutcomes.length} outcomes`);
    } catch (error) {
      logger.error('Error saving AI data:', (error as Error).message);
    }
  }

  private getCurrentMarketSnapshot(indexName: IndexName): MarketSnapshot | null {
    return this.currentSnapshots
      .filter(s => s.indexName === indexName)
      .sort((a, b) => b.timestamp - a.timestamp)[0] || null;
  }

  private determineTrend(indicators: any): 'BULLISH' | 'BEARISH' | 'SIDEWAYS' {
    if (indicators.ema && indicators.momentum) {
      if (indicators.momentum > 0.01) return 'BULLISH';
      if (indicators.momentum < -0.01) return 'BEARISH';
    }
    return 'SIDEWAYS';
  }

  private determineVolatilityRegime(volatility: number): 'LOW' | 'MEDIUM' | 'HIGH' {
    if (volatility < 0.15) return 'LOW';
    if (volatility < 0.25) return 'MEDIUM';
    return 'HIGH';
  }

  private getTimeOfDay(): 'OPENING' | 'MID_DAY' | 'CLOSING' {
    const hour = new Date().getHours();
    if (hour >= 9 && hour < 11) return 'OPENING';
    if (hour >= 14 && hour < 16) return 'CLOSING';
    return 'MID_DAY';
  }

  private calculateMaxDrawdown(signal: TradingSignal, exitPrice: number): number {
    // Simplified - in real implementation, track minute-by-minute prices
    return Math.min(0, (signal.stopLoss - signal.entryPrice) / signal.entryPrice * 100);
  }

  private calculateMaxProfit(signal: TradingSignal, exitPrice: number): number {
    // Simplified - in real implementation, track minute-by-minute prices
    return Math.max(0, (signal.target - signal.entryPrice) / signal.entryPrice * 100);
  }

  private calculateSlippage(entryPrice: number, exitPrice: number, outcome: TradeOutcome['outcome']): number {
    // Simplified slippage calculation
    return Math.abs(exitPrice - entryPrice) * 0.01; // Assume 1% slippage
  }

  private calculateDailyStats(cutoffTime: number): AITrainingData['dailyStats'] {
    const dailyStats: { [date: string]: any } = {};
    
    this.tradeOutcomes
      .filter(t => t.entryTime > cutoffTime)
      .forEach(outcome => {
        const date = new Date(outcome.entryTime).toISOString().split('T')[0];
        if (!dailyStats[date]) {
          dailyStats[date] = {
            date,
            trades: [],
            totalTrades: 0,
            winningTrades: 0,
            totalProfit: 0,
            totalLoss: 0
          };
        }
        
        dailyStats[date].trades.push(outcome);
        dailyStats[date].totalTrades++;
        if (outcome.profitLoss > 0) {
          dailyStats[date].winningTrades++;
          dailyStats[date].totalProfit += outcome.profitLoss;
        } else {
          dailyStats[date].totalLoss += Math.abs(outcome.profitLoss);
        }
      });

    return Object.values(dailyStats).map((stats: any) => ({
      date: stats.date,
      totalTrades: stats.totalTrades,
      winRate: (stats.winningTrades / stats.totalTrades) * 100,
      avgProfit: stats.totalProfit / Math.max(1, stats.winningTrades),
      avgLoss: stats.totalLoss / Math.max(1, stats.totalTrades - stats.winningTrades),
      maxDrawdown: Math.min(...stats.trades.map((t: TradeOutcome) => t.maxDrawdown)),
      volatility: this.calculateDailyVolatility(stats.trades)
    }));
  }

  private calculateDailyVolatility(trades: TradeOutcome[]): number {
    if (trades.length < 2) return 0;
    const returns = trades.map(t => t.profitLossPercent);
    const mean = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
    const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - mean, 2), 0) / returns.length;
    return Math.sqrt(variance);
  }
}

export const aiDataCollector = new AIDataCollectorService();