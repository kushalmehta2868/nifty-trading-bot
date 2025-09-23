import { backtester, BacktestSettings } from '../services/backtester';
import { logger } from '../utils/logger';

async function runStrategyBacktest(): Promise<void> {
  try {
    logger.info('🚀 Starting Trading Strategy Backtest...');

    // Define backtest parameters
    const settings: BacktestSettings = {
      startDate: '2024-04-01', // 6 months ago
      endDate: '2024-09-22',   // Today
      initialCapital: 100000,  // ₹1 Lakh starting capital
      riskPerTrade: 10,        // 10% of capital per trade (₹10K max position)
      slippagePercent: 0.002,  // 0.2% slippage
      commissionPerTrade: 40,  // ₹40 per trade (brokerage + taxes)
      maxSimultaneousPositions: 3 // Max 3 positions at once
    };

    logger.info('📊 Backtest Settings:');
    logger.info(`   📅 Period: ${settings.startDate} to ${settings.endDate}`);
    logger.info(`   💰 Capital: ₹${settings.initialCapital.toLocaleString()}`);
    logger.info(`   🎯 Risk per Trade: ${settings.riskPerTrade}%`);
    logger.info(`   📉 Slippage: ${(settings.slippagePercent * 100).toFixed(2)}%`);
    logger.info(`   💸 Commission: ₹${settings.commissionPerTrade} per trade`);
    logger.info(`   📊 Max Positions: ${settings.maxSimultaneousPositions}`);

    // Run the backtest
    const results = await backtester.runBacktest(settings);

    // Enhanced results display
    logger.info('');
    logger.info('═══════════════════════════════════════');
    logger.info('          📊 BACKTEST SUMMARY           ');
    logger.info('═══════════════════════════════════════');

    const finalCapital = settings.initialCapital * (1 + results.summary.totalReturn / 100);

    logger.info(`💰 PERFORMANCE METRICS:`);
    logger.info(`   Initial Capital: ₹${settings.initialCapital.toLocaleString()}`);
    logger.info(`   Final Capital: ₹${finalCapital.toLocaleString()}`);
    logger.info(`   Total Return: ${results.summary.totalReturn.toFixed(2)}%`);
    logger.info(`   CAGR: ${results.summary.cagr.toFixed(2)}%`);
    logger.info(`   Net P&L: ₹${(finalCapital - settings.initialCapital).toLocaleString()}`);

    logger.info(`📈 TRADING STATISTICS:`);
    logger.info(`   Total Trades: ${results.summary.totalTrades}`);
    logger.info(`   Winning Trades: ${results.summary.winningTrades} (${results.summary.winRate.toFixed(1)}%)`);
    logger.info(`   Losing Trades: ${results.summary.losingTrades}`);
    logger.info(`   Average Win: ₹${results.summary.avgWin.toFixed(2)}`);
    logger.info(`   Average Loss: ₹${results.summary.avgLoss.toFixed(2)}`);

    logger.info(`⚖️ RISK METRICS:`);
    logger.info(`   Profit Factor: ${results.summary.profitFactor.toFixed(2)}`);
    logger.info(`   Sharpe Ratio: ${results.summary.sharpeRatio.toFixed(2)}`);
    logger.info(`   Max Drawdown: ${results.summary.maxDrawdown.toFixed(2)}%`);
    logger.info(`   Max Consecutive Wins: ${results.summary.maxConsecutiveWins}`);
    logger.info(`   Max Consecutive Losses: ${results.summary.maxConsecutiveLosses}`);

    logger.info(`💸 COST ANALYSIS:`);
    logger.info(`   Total Commissions: ₹${results.summary.totalCommissions.toFixed(2)}`);
    logger.info(`   Commission Impact: ${(results.summary.totalCommissions / settings.initialCapital * 100).toFixed(2)}%`);

    // Performance evaluation against benchmarks
    logger.info('');
    logger.info('📊 PERFORMANCE EVALUATION:');

    // Win rate assessment
    if (results.summary.winRate >= 60) {
      logger.info(`   ✅ Win Rate: EXCELLENT (${results.summary.winRate.toFixed(1)}% >= 60%)`);
    } else if (results.summary.winRate >= 50) {
      logger.info(`   ⚠️ Win Rate: GOOD (${results.summary.winRate.toFixed(1)}% >= 50%)`);
    } else {
      logger.info(`   ❌ Win Rate: POOR (${results.summary.winRate.toFixed(1)}% < 50%)`);
    }

    // Profit factor assessment
    if (results.summary.profitFactor >= 1.5) {
      logger.info(`   ✅ Profit Factor: EXCELLENT (${results.summary.profitFactor.toFixed(2)} >= 1.5)`);
    } else if (results.summary.profitFactor >= 1.2) {
      logger.info(`   ⚠️ Profit Factor: ACCEPTABLE (${results.summary.profitFactor.toFixed(2)} >= 1.2)`);
    } else {
      logger.info(`   ❌ Profit Factor: POOR (${results.summary.profitFactor.toFixed(2)} < 1.2)`);
    }

    // Sharpe ratio assessment
    if (results.summary.sharpeRatio >= 1.0) {
      logger.info(`   ✅ Sharpe Ratio: GOOD (${results.summary.sharpeRatio.toFixed(2)} >= 1.0)`);
    } else if (results.summary.sharpeRatio >= 0.5) {
      logger.info(`   ⚠️ Sharpe Ratio: ACCEPTABLE (${results.summary.sharpeRatio.toFixed(2)} >= 0.5)`);
    } else {
      logger.info(`   ❌ Sharpe Ratio: POOR (${results.summary.sharpeRatio.toFixed(2)} < 0.5)`);
    }

    // Drawdown assessment
    if (results.summary.maxDrawdown <= 10) {
      logger.info(`   ✅ Max Drawdown: EXCELLENT (${results.summary.maxDrawdown.toFixed(2)}% <= 10%)`);
    } else if (results.summary.maxDrawdown <= 20) {
      logger.info(`   ⚠️ Max Drawdown: ACCEPTABLE (${results.summary.maxDrawdown.toFixed(2)}% <= 20%)`);
    } else {
      logger.info(`   ❌ Max Drawdown: EXCESSIVE (${results.summary.maxDrawdown.toFixed(2)}% > 20%)`);
    }

    // Monthly performance breakdown
    logger.info('');
    logger.info('📅 MONTHLY PERFORMANCE:');
    results.monthlyPerformance.forEach(month => {
      const pnlStatus = month.pnl >= 0 ? '📈' : '📉';
      logger.info(`   ${month.month}: ${pnlStatus} ₹${month.pnl.toFixed(0)} (${month.trades} trades, ${month.winRate.toFixed(1)}% win rate)`);
    });

    // Overall assessment
    logger.info('');
    logger.info('🎯 FINAL ASSESSMENT:');

    const score = calculateStrategyScore(results.summary);
    logger.info(`   Strategy Score: ${score}/100`);

    if (score >= 70) {
      logger.info(`   🟢 RECOMMENDATION: STRONG BUY - Strategy shows excellent performance`);
      logger.info(`   💡 Suggested allocation: 15-25% of trading capital`);
    } else if (score >= 50) {
      logger.info(`   🟡 RECOMMENDATION: CONDITIONAL BUY - Strategy shows promise but needs improvement`);
      logger.info(`   💡 Suggested allocation: 5-10% of trading capital for testing`);
    } else {
      logger.info(`   🔴 RECOMMENDATION: DO NOT TRADE - Strategy needs significant improvement`);
      logger.info(`   💡 Focus on: Improving win rate, reducing drawdown, optimizing parameters`);
    }

    logger.info('═══════════════════════════════════════');

    // Export results to file for further analysis
    await saveBacktestResults(results);

  } catch (error) {
    logger.error('❌ Backtest failed:', (error as Error).message);
    throw error;
  }
}

function calculateStrategyScore(summary: any): number {
  let score = 0;

  // Win rate (30 points max)
  if (summary.winRate >= 60) score += 30;
  else if (summary.winRate >= 50) score += 25;
  else if (summary.winRate >= 40) score += 15;
  else score += 5;

  // Profit factor (25 points max)
  if (summary.profitFactor >= 2.0) score += 25;
  else if (summary.profitFactor >= 1.5) score += 20;
  else if (summary.profitFactor >= 1.2) score += 15;
  else if (summary.profitFactor >= 1.0) score += 10;
  else score += 0;

  // Sharpe ratio (20 points max)
  if (summary.sharpeRatio >= 1.5) score += 20;
  else if (summary.sharpeRatio >= 1.0) score += 15;
  else if (summary.sharpeRatio >= 0.5) score += 10;
  else score += 0;

  // Max drawdown (15 points max)
  if (summary.maxDrawdown <= 5) score += 15;
  else if (summary.maxDrawdown <= 10) score += 12;
  else if (summary.maxDrawdown <= 15) score += 8;
  else if (summary.maxDrawdown <= 20) score += 5;
  else score += 0;

  // Total return (10 points max)
  if (summary.totalReturn >= 30) score += 10;
  else if (summary.totalReturn >= 20) score += 8;
  else if (summary.totalReturn >= 10) score += 6;
  else if (summary.totalReturn >= 0) score += 3;
  else score += 0;

  return Math.min(100, score);
}

async function saveBacktestResults(results: any): Promise<void> {
  const fs = require('fs');
  const path = require('path');

  const resultsDir = path.join(process.cwd(), 'backtest-results');
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `backtest-${timestamp}.json`;
  const filepath = path.join(resultsDir, filename);

  fs.writeFileSync(filepath, JSON.stringify(results, null, 2));
  logger.info(`📁 Backtest results saved to: ${filepath}`);
}

// Run the backtest
if (require.main === module) {
  runStrategyBacktest()
    .then(() => {
      logger.info('✅ Backtest completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('❌ Backtest failed:', error.message);
      process.exit(1);
    });
}

export { runStrategyBacktest };