import { logger } from '../utils/logger';
import { TradingSignal, IndexName } from '../types';
import { angelAPI } from './angelAPI';
import { config } from '../config/config';
import { riskManager } from './riskManager';
import { marketVolatility } from './marketVolatility';

export interface PaperTrade {
  id: string;
  signal: TradingSignal;
  entryTime: Date;
  exitTime?: Date;
  entryPrice: number;
  exitPrice?: number;
  quantity: number;
  pnl?: number;
  pnlPercent?: number;
  status: 'OPEN' | 'CLOSED_TARGET' | 'CLOSED_SL' | 'CLOSED_TIME' | 'CLOSED_MANUAL';
  exitReason?: 'TARGET' | 'STOPLOSS' | 'TIME' | 'MANUAL' | 'EOD';
  slippageApplied: number;
  commission: number;
  netPnl?: number;
  holdingTimeMinutes?: number;
  maxProfitReached?: number;
  maxLossReached?: number;
}

export interface PaperTradingStats {
  totalTrades: number;
  openTrades: number;
  closedTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnl: number;
  totalCommissions: number;
  netPnl: number;
  averageWin: number;
  averageLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  currentDrawdown: number;
  sharpeRatio: number;
  bestTrade: number;
  worstTrade: number;
  averageHoldingTime: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  currentStreak: number;
  streakType: 'WIN' | 'LOSS' | 'NONE';
}

export interface PaperTradingSession {
  sessionId: string;
  startDate: Date;
  endDate?: Date;
  startingCapital: number;
  currentCapital: number;
  targetDuration: number; // days
  trades: PaperTrade[];
  dailyStats: Array<{
    date: string;
    trades: number;
    pnl: number;
    capitalValue: number;
    drawdown: number;
  }>;
  status: 'ACTIVE' | 'COMPLETED' | 'STOPPED';
}

class PaperTradingEngine {
  private currentSession: PaperTradingSession | null = null;
  private paperTrades: Map<string, PaperTrade> = new Map();
  private monitoringInterval: NodeJS.Timeout | null = null;
  private dailyResetInterval: NodeJS.Timeout | null = null;

  public async startPaperTrading(
    duration: number = 30, // 30 days default
    startingCapital: number = 100000 // ₹1L default
  ): Promise<void> {
    if (this.currentSession && this.currentSession.status === 'ACTIVE') {
      throw new Error('Paper trading session already active');
    }

    const sessionId = this.generateSessionId();

    this.currentSession = {
      sessionId,
      startDate: new Date(),
      startingCapital,
      currentCapital: startingCapital,
      targetDuration: duration,
      trades: [],
      dailyStats: [],
      status: 'ACTIVE'
    };

    logger.info('🧪 PAPER TRADING SESSION STARTED:');
    logger.info(`   Session ID: ${sessionId}`);
    logger.info(`   Starting Capital: ₹${startingCapital.toLocaleString()}`);
    logger.info(`   Target Duration: ${duration} days`);
    logger.info(`   Paper Mode: All trades simulated with real market data`);

    // Start monitoring open positions every 30 seconds
    this.monitoringInterval = setInterval(() => {
      this.monitorOpenPositions();
    }, 30000);

    // Daily statistics calculation at end of day
    this.scheduleDailyReset();

    // Listen for trading signals
    this.setupSignalHandler();

    // Save session to file
    this.saveSession();
  }

  public async stopPaperTrading(): Promise<void> {
    if (!this.currentSession || this.currentSession.status !== 'ACTIVE') {
      throw new Error('No active paper trading session');
    }

    // Close all open positions
    await this.closeAllOpenPositions('MANUAL');

    // Complete the session
    this.currentSession.status = 'COMPLETED';
    this.currentSession.endDate = new Date();

    // Stop monitoring
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    if (this.dailyResetInterval) {
      clearInterval(this.dailyResetInterval);
      this.dailyResetInterval = null;
    }

    // Generate final report
    await this.generateFinalReport();

    logger.info('🏁 Paper trading session completed');
  }

  public async executePaperTrade(signal: TradingSignal): Promise<string | null> {
    if (!this.currentSession || this.currentSession.status !== 'ACTIVE') {
      logger.warn('No active paper trading session - signal ignored');
      return null;
    }

    try {
      // Apply all risk management checks
      const riskStatus = riskManager.checkRiskLimits(signal);
      if (!riskStatus.canTrade) {
        logger.warn(`🧪 Paper Trade REJECTED - Risk: ${riskStatus.reason}`);
        return null;
      }

      // Get volatility data for slippage calculation
      const volatilityData = await marketVolatility.getCurrentVolatility();
      const slippagePercent = marketVolatility.getSlippageAdjustment(volatilityData.regime);

      // Calculate position size based on current capital
      const optimalPositionSize = riskManager.calculateOptimalPositionSize(
        signal,
        volatilityData.positionSizeMultiplier,
        this.currentSession.currentCapital
      );

      const lotSize = config.indices[signal.indexName].lotSize;
      const adjustedEntryPrice = signal.entryPrice * (1 + slippagePercent);
      const positionValue = adjustedEntryPrice * lotSize;

      if (positionValue > optimalPositionSize) {
        logger.warn(`🧪 Paper Trade REJECTED - Position too large: ₹${positionValue} > ₹${optimalPositionSize}`);
        return null;
      }

      // Create paper trade
      const tradeId = this.generateTradeId();
      const paperTrade: PaperTrade = {
        id: tradeId,
        signal: {
          ...signal,
          entryPrice: adjustedEntryPrice,
          target: signal.target * (1 - slippagePercent), // Apply exit slippage to target
          stopLoss: signal.stopLoss * (1 - slippagePercent) // Apply exit slippage to SL
        },
        entryTime: new Date(),
        entryPrice: adjustedEntryPrice,
        quantity: lotSize,
        status: 'OPEN',
        slippageApplied: slippagePercent,
        commission: 40 // ₹40 per trade
      };

      this.paperTrades.set(tradeId, paperTrade);
      this.currentSession.trades.push(paperTrade);

      // Update capital (deduct for position)
      this.currentSession.currentCapital -= positionValue;

      // Record with risk manager
      riskManager.recordTrade(0, signal);

      logger.info('🧪 PAPER TRADE OPENED:');
      logger.info(`   ID: ${tradeId}`);
      logger.info(`   ${signal.indexName} ${signal.optionSymbol}`);
      logger.info(`   Entry: ₹${adjustedEntryPrice.toFixed(2)} (slippage: ${(slippagePercent * 100).toFixed(2)}%)`);
      logger.info(`   Target: ₹${paperTrade.signal.target.toFixed(2)} | SL: ₹${paperTrade.signal.stopLoss.toFixed(2)}`);
      logger.info(`   Quantity: ${paperTrade.quantity} | Value: ₹${positionValue.toFixed(0)}`);
      logger.info(`   Remaining Capital: ₹${this.currentSession.currentCapital.toFixed(0)}`);

      this.saveSession();
      return tradeId;

    } catch (error) {
      logger.error('Failed to execute paper trade:', (error as Error).message);
      return null;
    }
  }

  private async monitorOpenPositions(): Promise<void> {
    const openTrades = Array.from(this.paperTrades.values()).filter(t => t.status === 'OPEN');

    for (const trade of openTrades) {
      try {
        await this.checkTradeExit(trade);
      } catch (error) {
        logger.error(`Error monitoring trade ${trade.id}:`, (error as Error).message);
      }
    }
  }

  private async checkTradeExit(trade: PaperTrade): Promise<void> {
    try {
      // Get current option price
      const currentPrice = await this.getCurrentOptionPrice(trade);

      if (!currentPrice || currentPrice <= 0) {
        logger.debug(`Could not get current price for ${trade.signal.optionSymbol}`);
        return;
      }

      // Track max profit/loss reached
      if (!trade.maxProfitReached || currentPrice > trade.maxProfitReached) {
        trade.maxProfitReached = currentPrice;
      }
      if (!trade.maxLossReached || currentPrice < trade.maxLossReached) {
        trade.maxLossReached = currentPrice;
      }

      let shouldExit = false;
      let exitReason: 'TARGET' | 'STOPLOSS' | 'TIME' = 'TIME';

      // Check target hit
      if (currentPrice >= trade.signal.target) {
        shouldExit = true;
        exitReason = 'TARGET';
      }
      // Check stop loss hit
      else if (currentPrice <= trade.signal.stopLoss) {
        shouldExit = true;
        exitReason = 'STOPLOSS';
      }
      // Check time-based exit (after 5 hours or 2:45 PM)
      else if (this.shouldForceTimeExit(trade)) {
        shouldExit = true;
        exitReason = 'TIME';
      }

      if (shouldExit) {
        await this.closePaperTrade(trade, currentPrice, exitReason);
      }

    } catch (error) {
      logger.error(`Error checking exit for trade ${trade.id}:`, (error as Error).message);
    }
  }

  private async getCurrentOptionPrice(trade: PaperTrade): Promise<number | null> {
    try {
      // Try to get real-time price from Angel API
      const expiry = this.extractExpiryFromSymbol(trade.signal.optionSymbol);
      const strike = this.extractStrikeFromSymbol(trade.signal.optionSymbol);

      if (strike && expiry) {
        const token = await angelAPI.getOptionToken(
          trade.signal.indexName,
          strike,
          trade.signal.optionType,
          expiry
        );

        if (token) {
          const price = await angelAPI.getOptionPrice(trade.signal.optionSymbol, token);
          if (price && price > 0) {
            return price;
          }
        }
      }

      // Fallback: estimate price based on time decay and underlying movement
      return this.estimateOptionPrice(trade);

    } catch (error) {
      logger.debug(`Price fetch failed for ${trade.signal.optionSymbol}, using estimation`);
      return this.estimateOptionPrice(trade);
    }
  }

  private estimateOptionPrice(trade: PaperTrade): number {
    const hoursHeld = (Date.now() - trade.entryTime.getTime()) / (1000 * 60 * 60);

    // Simple time decay model: 5% decay per hour, minimum 70% of entry price
    const timeDecay = Math.min(0.3, hoursHeld * 0.05);
    const estimatedPrice = trade.entryPrice * (1 - timeDecay);

    return Math.max(1, estimatedPrice);
  }

  private async closePaperTrade(
    trade: PaperTrade,
    exitPrice: number,
    exitReason: 'TARGET' | 'STOPLOSS' | 'TIME' | 'MANUAL' | 'EOD'
  ): Promise<void> {
    const exitTime = new Date();
    const holdingTimeMinutes = (exitTime.getTime() - trade.entryTime.getTime()) / (1000 * 60);

    // Calculate P&L
    const grossPnl = (exitPrice - trade.entryPrice) * trade.quantity;
    const netPnl = grossPnl - trade.commission;

    // Update trade
    trade.exitTime = exitTime;
    trade.exitPrice = exitPrice;
    trade.pnl = grossPnl;
    trade.pnlPercent = (exitPrice - trade.entryPrice) / trade.entryPrice * 100;
    trade.netPnl = netPnl;
    trade.holdingTimeMinutes = holdingTimeMinutes;
    trade.exitReason = exitReason;
    trade.status = exitReason === 'TARGET' ? 'CLOSED_TARGET' :
                   exitReason === 'STOPLOSS' ? 'CLOSED_SL' :
                   exitReason === 'TIME' ? 'CLOSED_TIME' : 'CLOSED_MANUAL';

    // Update session capital
    if (this.currentSession) {
      this.currentSession.currentCapital += (exitPrice * trade.quantity) + netPnl;
    }

    // Record with risk manager
    riskManager.recordTrade(netPnl, trade.signal);

    // Remove from active trades
    this.paperTrades.delete(trade.id);

    const pnlStatus = netPnl >= 0 ? '📈' : '📉';
    logger.info(`🧪 PAPER TRADE CLOSED (${exitReason}):`);
    logger.info(`   ID: ${trade.id}`);
    logger.info(`   ${trade.signal.indexName} ${trade.signal.optionSymbol}`);
    logger.info(`   Entry: ₹${trade.entryPrice.toFixed(2)} → Exit: ₹${exitPrice.toFixed(2)}`);
    logger.info(`   ${pnlStatus} P&L: ₹${netPnl.toFixed(2)} (${trade.pnlPercent?.toFixed(1)}%)`);
    logger.info(`   Holding Time: ${holdingTimeMinutes.toFixed(0)} minutes`);
    logger.info(`   Capital: ₹${this.currentSession?.currentCapital.toFixed(0)}`);

    this.saveSession();
  }

  private async closeAllOpenPositions(reason: 'MANUAL' | 'EOD'): Promise<void> {
    const openTrades = Array.from(this.paperTrades.values()).filter(t => t.status === 'OPEN');

    for (const trade of openTrades) {
      const currentPrice = await this.getCurrentOptionPrice(trade) || this.estimateOptionPrice(trade);
      await this.closePaperTrade(trade, currentPrice, reason);
    }
  }

  public async getSessionStats(): Promise<PaperTradingStats> {
    if (!this.currentSession) {
      throw new Error('No active paper trading session');
    }

    const allTrades = this.currentSession.trades;
    const closedTrades = allTrades.filter(t => t.status !== 'OPEN');
    const openTrades = allTrades.filter(t => t.status === 'OPEN');

    const winningTrades = closedTrades.filter(t => (t.netPnl || 0) > 0);
    const losingTrades = closedTrades.filter(t => (t.netPnl || 0) <= 0);

    const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const totalCommissions = closedTrades.reduce((sum, t) => sum + t.commission, 0);
    const netPnl = totalPnl - totalCommissions;

    const averageWin = winningTrades.length > 0 ?
      winningTrades.reduce((sum, t) => sum + (t.netPnl || 0), 0) / winningTrades.length : 0;
    const averageLoss = losingTrades.length > 0 ?
      Math.abs(losingTrades.reduce((sum, t) => sum + (t.netPnl || 0), 0)) / losingTrades.length : 0;

    const profitFactor = averageLoss > 0 ?
      (averageWin * winningTrades.length) / (averageLoss * losingTrades.length) : 0;

    const { maxDrawdown, currentDrawdown } = this.calculateDrawdown();
    const { maxConsecutiveWins, maxConsecutiveLosses, currentStreak, streakType } = this.calculateStreaks(closedTrades);

    return {
      totalTrades: allTrades.length,
      openTrades: openTrades.length,
      closedTrades: closedTrades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate: closedTrades.length > 0 ? (winningTrades.length / closedTrades.length) * 100 : 0,
      totalPnl,
      totalCommissions,
      netPnl,
      averageWin,
      averageLoss,
      profitFactor,
      maxDrawdown,
      currentDrawdown,
      sharpeRatio: this.calculateSharpeRatio(),
      bestTrade: Math.max(...closedTrades.map(t => t.netPnl || 0), 0),
      worstTrade: Math.min(...closedTrades.map(t => t.netPnl || 0), 0),
      averageHoldingTime: closedTrades.length > 0 ?
        closedTrades.reduce((sum, t) => sum + (t.holdingTimeMinutes || 0), 0) / closedTrades.length : 0,
      maxConsecutiveWins,
      maxConsecutiveLosses,
      currentStreak,
      streakType
    };
  }

  public async generateDailyReport(): Promise<void> {
    if (!this.currentSession) return;

    const stats = await this.getSessionStats();
    const currentCapital = this.currentSession.currentCapital;
    const totalReturn = (currentCapital - this.currentSession.startingCapital) / this.currentSession.startingCapital * 100;

    logger.info('📊 DAILY PAPER TRADING REPORT:');
    logger.info(`   Session: ${this.currentSession.sessionId}`);
    logger.info(`   Capital: ₹${this.currentSession.startingCapital.toLocaleString()} → ₹${currentCapital.toLocaleString()}`);
    logger.info(`   Total Return: ${totalReturn.toFixed(2)}%`);
    logger.info(`   Trades: ${stats.totalTrades} (${stats.openTrades} open, ${stats.closedTrades} closed)`);
    logger.info(`   Win Rate: ${stats.winRate.toFixed(1)}% (${stats.winningTrades}W/${stats.losingTrades}L)`);
    logger.info(`   Net P&L: ₹${stats.netPnl.toFixed(2)}`);
    logger.info(`   Profit Factor: ${stats.profitFactor.toFixed(2)}`);
    logger.info(`   Max Drawdown: ${stats.maxDrawdown.toFixed(2)}%`);

    if (stats.currentStreak > 0) {
      logger.info(`   Current Streak: ${stats.currentStreak} ${stats.streakType}S`);
    }
  }

  private async generateFinalReport(): Promise<void> {
    if (!this.currentSession) return;

    const stats = await this.getSessionStats();
    const sessionDays = Math.ceil((Date.now() - this.currentSession.startDate.getTime()) / (1000 * 60 * 60 * 24));
    const finalCapital = this.currentSession.currentCapital;
    const totalReturn = (finalCapital - this.currentSession.startingCapital) / this.currentSession.startingCapital * 100;

    logger.info('');
    logger.info('═══════════════════════════════════════');
    logger.info('     🧪 PAPER TRADING FINAL REPORT      ');
    logger.info('═══════════════════════════════════════');
    logger.info(`Session: ${this.currentSession.sessionId}`);
    logger.info(`Duration: ${sessionDays} days`);
    logger.info(`Starting Capital: ₹${this.currentSession.startingCapital.toLocaleString()}`);
    logger.info(`Final Capital: ₹${finalCapital.toLocaleString()}`);
    logger.info(`Total Return: ${totalReturn.toFixed(2)}%`);
    logger.info('');
    logger.info('📊 TRADING STATISTICS:');
    logger.info(`   Total Trades: ${stats.totalTrades}`);
    logger.info(`   Win Rate: ${stats.winRate.toFixed(1)}% (${stats.winningTrades} wins, ${stats.losingTrades} losses)`);
    logger.info(`   Profit Factor: ${stats.profitFactor.toFixed(2)}`);
    logger.info(`   Average Win: ₹${stats.averageWin.toFixed(2)}`);
    logger.info(`   Average Loss: ₹${stats.averageLoss.toFixed(2)}`);
    logger.info(`   Best Trade: ₹${stats.bestTrade.toFixed(2)}`);
    logger.info(`   Worst Trade: ₹${stats.worstTrade.toFixed(2)}`);
    logger.info(`   Average Holding Time: ${stats.averageHoldingTime.toFixed(0)} minutes`);
    logger.info('');
    logger.info('⚖️ RISK METRICS:');
    logger.info(`   Max Drawdown: ${stats.maxDrawdown.toFixed(2)}%`);
    logger.info(`   Sharpe Ratio: ${stats.sharpeRatio.toFixed(2)}`);
    logger.info(`   Max Consecutive Wins: ${stats.maxConsecutiveWins}`);
    logger.info(`   Max Consecutive Losses: ${stats.maxConsecutiveLosses}`);
    logger.info('');
    logger.info('💸 COST ANALYSIS:');
    logger.info(`   Total Commissions: ₹${stats.totalCommissions.toFixed(2)}`);
    logger.info(`   Commission Impact: ${(stats.totalCommissions / this.currentSession.startingCapital * 100).toFixed(2)}%`);
    logger.info('');

    // Performance assessment
    this.assessPerformance(stats, totalReturn);

    logger.info('═══════════════════════════════════════');

    // Save final report to file
    this.saveFinalReport(stats, totalReturn, sessionDays);
  }

  private assessPerformance(stats: PaperTradingStats, totalReturn: number): void {
    logger.info('🎯 PERFORMANCE ASSESSMENT:');

    let score = 0;

    // Win rate assessment
    if (stats.winRate >= 60) {
      logger.info(`   ✅ Win Rate: EXCELLENT (${stats.winRate.toFixed(1)}%)`);
      score += 25;
    } else if (stats.winRate >= 50) {
      logger.info(`   ⚠️ Win Rate: GOOD (${stats.winRate.toFixed(1)}%)`);
      score += 20;
    } else {
      logger.info(`   ❌ Win Rate: NEEDS IMPROVEMENT (${stats.winRate.toFixed(1)}%)`);
      score += 10;
    }

    // Profit factor assessment
    if (stats.profitFactor >= 1.5) {
      logger.info(`   ✅ Profit Factor: EXCELLENT (${stats.profitFactor.toFixed(2)})`);
      score += 25;
    } else if (stats.profitFactor >= 1.2) {
      logger.info(`   ⚠️ Profit Factor: ACCEPTABLE (${stats.profitFactor.toFixed(2)})`);
      score += 15;
    } else {
      logger.info(`   ❌ Profit Factor: POOR (${stats.profitFactor.toFixed(2)})`);
      score += 5;
    }

    // Return assessment
    if (totalReturn >= 15) {
      logger.info(`   ✅ Returns: EXCELLENT (${totalReturn.toFixed(2)}%)`);
      score += 25;
    } else if (totalReturn >= 5) {
      logger.info(`   ⚠️ Returns: GOOD (${totalReturn.toFixed(2)}%)`);
      score += 15;
    } else if (totalReturn >= 0) {
      logger.info(`   ⚠️ Returns: BREAK-EVEN (${totalReturn.toFixed(2)}%)`);
      score += 10;
    } else {
      logger.info(`   ❌ Returns: LOSS (${totalReturn.toFixed(2)}%)`);
      score += 0;
    }

    // Drawdown assessment
    if (stats.maxDrawdown <= 10) {
      logger.info(`   ✅ Drawdown: EXCELLENT (${stats.maxDrawdown.toFixed(2)}%)`);
      score += 25;
    } else if (stats.maxDrawdown <= 20) {
      logger.info(`   ⚠️ Drawdown: ACCEPTABLE (${stats.maxDrawdown.toFixed(2)}%)`);
      score += 15;
    } else {
      logger.info(`   ❌ Drawdown: EXCESSIVE (${stats.maxDrawdown.toFixed(2)}%)`);
      score += 5;
    }

    logger.info(`');
    logger.info(`Overall Score: ${score}/100`);

    if (score >= 75) {
      logger.info(`🟢 RECOMMENDATION: READY FOR LIVE TRADING`);
      logger.info(`   Strategy shows strong performance across all metrics`);
    } else if (score >= 50) {
      logger.info(`🟡 RECOMMENDATION: NEEDS MINOR IMPROVEMENTS`);
      logger.info(`   Consider optimizing parameters before live trading`);
    } else {
      logger.info(`🔴 RECOMMENDATION: SIGNIFICANT IMPROVEMENTS NEEDED`);
      logger.info(`   Strategy requires major refinements before live deployment`);
    }
  }

  // Helper methods
  private generateSessionId(): string {
    return `PAPER_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  }

  private generateTradeId(): string {
    return `PT_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
  }

  private shouldForceTimeExit(trade: PaperTrade): boolean {
    const hoursHeld = (Date.now() - trade.entryTime.getTime()) / (1000 * 60 * 60);
    const currentTime = new Date();
    const hours = currentTime.getHours();
    const minutes = currentTime.getMinutes();

    // Force exit after 5 hours OR after 2:45 PM
    return hoursHeld >= 5 || (hours >= 14 && minutes >= 45);
  }

  private extractExpiryFromSymbol(symbol: string): string | null {
    const match = symbol.match(/(\d{2}[A-Z]{3}\d{2})/);
    return match ? match[1] : null;
  }

  private extractStrikeFromSymbol(symbol: string): number | null {
    const match = symbol.match(/(\d{4,6})(CE|PE)$/);
    return match ? parseInt(match[1]) : null;
  }

  private calculateDrawdown(): { maxDrawdown: number; currentDrawdown: number } {
    if (!this.currentSession) return { maxDrawdown: 0, currentDrawdown: 0 };

    let peakCapital = this.currentSession.startingCapital;
    let maxDrawdown = 0;

    for (const trade of this.currentSession.trades.filter(t => t.status !== 'OPEN')) {
      const capitalAfterTrade = peakCapital + (trade.netPnl || 0);
      peakCapital = Math.max(peakCapital, capitalAfterTrade);

      const drawdown = (peakCapital - capitalAfterTrade) / peakCapital * 100;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }

    const currentDrawdown = (peakCapital - this.currentSession.currentCapital) / peakCapital * 100;

    return { maxDrawdown, currentDrawdown };
  }

  private calculateStreaks(trades: PaperTrade[]): {
    maxConsecutiveWins: number;
    maxConsecutiveLosses: number;
    currentStreak: number;
    streakType: 'WIN' | 'LOSS' | 'NONE';
  } {
    let maxWins = 0;
    let maxLosses = 0;
    let currentWins = 0;
    let currentLosses = 0;
    let currentStreak = 0;
    let streakType: 'WIN' | 'LOSS' | 'NONE' = 'NONE';

    for (const trade of trades) {
      const isWin = (trade.netPnl || 0) > 0;

      if (isWin) {
        currentWins++;
        currentLosses = 0;
      } else {
        currentLosses++;
        currentWins = 0;
      }

      maxWins = Math.max(maxWins, currentWins);
      maxLosses = Math.max(maxLosses, currentLosses);
    }

    // Current streak from last trade
    if (trades.length > 0) {
      const lastTrade = trades[trades.length - 1];
      const isLastWin = (lastTrade.netPnl || 0) > 0;

      if (isLastWin) {
        currentStreak = currentWins;
        streakType = 'WIN';
      } else {
        currentStreak = currentLosses;
        streakType = 'LOSS';
      }
    }

    return {
      maxConsecutiveWins: maxWins,
      maxConsecutiveLosses: maxLosses,
      currentStreak,
      streakType
    };
  }

  private calculateSharpeRatio(): number {
    // Simplified Sharpe calculation based on trade returns
    if (!this.currentSession || this.currentSession.trades.length < 10) return 0;

    const tradeReturns = this.currentSession.trades
      .filter(t => t.status !== 'OPEN' && t.pnlPercent !== undefined)
      .map(t => (t.pnlPercent || 0) / 100);

    if (tradeReturns.length < 2) return 0;

    const avgReturn = tradeReturns.reduce((sum, r) => sum + r, 0) / tradeReturns.length;
    const variance = tradeReturns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / tradeReturns.length;
    const volatility = Math.sqrt(variance);

    return volatility > 0 ? avgReturn / volatility : 0;
  }

  private setupSignalHandler(): void {
    // Listen for trading signals and execute as paper trades
    (process as any).on('tradingSignal', async (signal: TradingSignal) => {
      await this.executePaperTrade(signal);
    });
  }

  private scheduleDailyReset(): void {
    // Calculate time until next 9:30 AM for daily reset
    const now = new Date();
    const tomorrow930 = new Date();
    tomorrow930.setDate(tomorrow930.getDate() + 1);
    tomorrow930.setHours(9, 30, 0, 0);

    const timeUntilReset = tomorrow930.getTime() - now.getTime();

    this.dailyResetInterval = setTimeout(() => {
      this.generateDailyReport();

      // Schedule next daily reset
      this.dailyResetInterval = setInterval(() => {
        this.generateDailyReport();
      }, 24 * 60 * 60 * 1000); // Every 24 hours

    }, timeUntilReset);
  }

  private saveSession(): void {
    // Save session data to file for persistence
    try {
      const fs = require('fs');
      const path = require('path');

      const sessionDir = path.join(process.cwd(), 'paper-trading-sessions');
      if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
      }

      const sessionFile = path.join(sessionDir, `${this.currentSession?.sessionId}.json`);
      fs.writeFileSync(sessionFile, JSON.stringify(this.currentSession, null, 2));

    } catch (error) {
      logger.error('Failed to save paper trading session:', (error as Error).message);
    }
  }

  private saveFinalReport(stats: PaperTradingStats, totalReturn: number, sessionDays: number): void {
    try {
      const fs = require('fs');
      const path = require('path');

      const reportDir = path.join(process.cwd(), 'paper-trading-reports');
      if (!fs.existsSync(reportDir)) {
        fs.mkdirSync(reportDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const reportFile = path.join(reportDir, `paper-report-${timestamp}.json`);

      const report = {
        session: this.currentSession,
        stats,
        totalReturn,
        sessionDays,
        generatedAt: new Date().toISOString()
      };

      fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
      logger.info(`📁 Final report saved to: ${reportFile}`);

    } catch (error) {
      logger.error('Failed to save final report:', (error as Error).message);
    }
  }
}

export const paperTrader = new PaperTradingEngine();