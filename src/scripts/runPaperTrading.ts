import { paperTrader } from '../services/paperTrader';
import { logger } from '../utils/logger';

async function startPaperTradingSession(): Promise<void> {
  try {
    logger.info('🧪 Starting Paper Trading Validation Session...');

    // Parse command line arguments
    const args = process.argv.slice(2);
    const durationArg = args.find(arg => arg.startsWith('--duration='));
    const capitalArg = args.find(arg => arg.startsWith('--capital='));

    const duration = durationArg ? parseInt(durationArg.split('=')[1]) : 30; // 30 days default
    const startingCapital = capitalArg ? parseInt(capitalArg.split('=')[1]) : 100000; // ₹1L default

    if (isNaN(duration) || duration < 1 || duration > 90) {
      throw new Error('Duration must be between 1 and 90 days');
    }

    if (isNaN(startingCapital) || startingCapital < 10000 || startingCapital > 10000000) {
      throw new Error('Starting capital must be between ₹10,000 and ₹1 crore');
    }

    logger.info('📊 Paper Trading Configuration:');
    logger.info(`   Duration: ${duration} days`);
    logger.info(`   Starting Capital: ₹${startingCapital.toLocaleString()}`);
    logger.info(`   Mode: Real market data with simulated execution`);
    logger.info(`   Risk Management: Full risk controls active`);
    logger.info(`   Position Sizing: Dynamic based on volatility`);
    logger.info(`   Slippage: Applied based on market conditions`);

    // Start the paper trading session
    await paperTrader.startPaperTrading(duration, startingCapital);

    logger.info('✅ Paper trading session started successfully');
    logger.info('📈 The bot will now trade with virtual money using real market data');
    logger.info('📊 Daily reports will be generated automatically');
    logger.info('🛑 Use Ctrl+C to stop the session gracefully');

    // Set up graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('\n🛑 Received stop signal, closing paper trading session...');
      await paperTrader.stopPaperTrading();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('\n🛑 Received terminate signal, closing paper trading session...');
      await paperTrader.stopPaperTrading();
      process.exit(0);
    });

    // Keep the process running
    await new Promise(resolve => {
      // The process will run until manually stopped or duration expires
      const checkInterval = setInterval(async () => {
        try {
          const stats = await paperTrader.getSessionStats();

          // Log periodic summary (every 4 hours during market hours)
          const now = new Date();
          const hours = now.getHours();
          const minutes = now.getMinutes();

          if (hours >= 9 && hours <= 15 && minutes === 0 && (hours - 9) % 4 === 0) {
            logger.info('📊 Paper Trading Status Update:');
            logger.info(`   Total Trades: ${stats.totalTrades} (${stats.openTrades} open)`);
            logger.info(`   Win Rate: ${stats.winRate.toFixed(1)}%`);
            logger.info(`   Net P&L: ₹${stats.netPnl.toFixed(2)}`);
            logger.info(`   Current Drawdown: ${stats.currentDrawdown.toFixed(2)}%`);

            if (stats.currentStreak > 2) {
              logger.info(`   Current Streak: ${stats.currentStreak} ${stats.streakType}S`);
            }
          }

        } catch (error) {
          // Session might have ended
          clearInterval(checkInterval);
          resolve(undefined);
        }
      }, 60000); // Check every minute
    });

  } catch (error) {
    logger.error('❌ Paper trading session failed:', (error as Error).message);
    process.exit(1);
  }
}

async function stopPaperTradingSession(): Promise<void> {
  try {
    logger.info('🛑 Stopping paper trading session...');
    await paperTrader.stopPaperTrading();
    logger.info('✅ Paper trading session stopped successfully');
  } catch (error) {
    logger.error('❌ Failed to stop paper trading session:', (error as Error).message);
    process.exit(1);
  }
}

async function showPaperTradingStats(): Promise<void> {
  try {
    logger.info('📊 Fetching current paper trading statistics...');
    const stats = await paperTrader.getSessionStats();

    logger.info('');
    logger.info('═══════════════════════════════════════');
    logger.info('      📊 PAPER TRADING STATISTICS       ');
    logger.info('═══════════════════════════════════════');
    logger.info(`Total Trades: ${stats.totalTrades}`);
    logger.info(`Open Trades: ${stats.openTrades}`);
    logger.info(`Closed Trades: ${stats.closedTrades}`);
    logger.info(`Win Rate: ${stats.winRate.toFixed(1)}% (${stats.winningTrades}W/${stats.losingTrades}L)`);
    logger.info(`Net P&L: ₹${stats.netPnl.toFixed(2)}`);
    logger.info(`Profit Factor: ${stats.profitFactor.toFixed(2)}`);
    logger.info(`Average Win: ₹${stats.averageWin.toFixed(2)}`);
    logger.info(`Average Loss: ₹${stats.averageLoss.toFixed(2)}`);
    logger.info(`Best Trade: ₹${stats.bestTrade.toFixed(2)}`);
    logger.info(`Worst Trade: ₹${stats.worstTrade.toFixed(2)}`);
    logger.info(`Max Drawdown: ${stats.maxDrawdown.toFixed(2)}%`);
    logger.info(`Current Drawdown: ${stats.currentDrawdown.toFixed(2)}%`);
    logger.info(`Sharpe Ratio: ${stats.sharpeRatio.toFixed(2)}`);
    logger.info(`Average Holding Time: ${stats.averageHoldingTime.toFixed(0)} minutes`);

    if (stats.currentStreak > 0) {
      logger.info(`Current Streak: ${stats.currentStreak} ${stats.streakType}S`);
    }

    logger.info(`Max Consecutive Wins: ${stats.maxConsecutiveWins}`);
    logger.info(`Max Consecutive Losses: ${stats.maxConsecutiveLosses}`);
    logger.info('═══════════════════════════════════════');

  } catch (error) {
    logger.error('❌ Failed to fetch paper trading stats:', (error as Error).message);
    process.exit(1);
  }
}

// Parse command line to determine action
const command = process.argv[2];

switch (command) {
  case 'start':
    startPaperTradingSession();
    break;
  case 'stop':
    stopPaperTradingSession();
    break;
  case 'stats':
    showPaperTradingStats();
    break;
  default:
    logger.info('📚 Paper Trading Commands:');
    logger.info('   npm run paper start [--duration=30] [--capital=100000]  - Start paper trading session');
    logger.info('   npm run paper stop                                      - Stop current session');
    logger.info('   npm run paper stats                                     - Show current statistics');
    logger.info('');
    logger.info('Examples:');
    logger.info('   npm run paper start --duration=60 --capital=200000     - 60 days with ₹2L capital');
    logger.info('   npm run paper start --duration=30                      - 30 days with ₹1L capital (default)');
    process.exit(0);
}

export { startPaperTradingSession, stopPaperTradingSession, showPaperTradingStats };