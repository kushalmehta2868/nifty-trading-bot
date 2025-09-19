import { webSocketFeed } from './services/webSocketFeed';
import { strategy } from './services/strategy';
import { telegramBot } from './services/telegramBot';
import { orderService } from './services/orderService';
import { logger } from './utils/logger';

class WebSocketTradingBot {
  private isRunning = false;

  public async start(): Promise<void> {
    try {
      console.log('🚀 Minimal Trading Bot Starting...');

      // Only essential services - NO memory monitoring, NO cleanup
      await webSocketFeed.initialize();
      console.log('✅ WebSocket initialized');

      await strategy.initialize();
      console.log('✅ Strategy initialized');

      await telegramBot.initialize();
      console.log('✅ Telegram initialized');

      await orderService.initialize();
      console.log('✅ OrderService initialized');

      this.isRunning = true;
      console.log('✅ Minimal bot running - NO memory management');

    } catch (error) {
      console.error('❌ STARTUP FAILED:', (error as Error).message);
      process.exit(1);
    }
  }

  public async stop(): Promise<void> {
    console.log('🛑 Stopping bot...');
    this.isRunning = false;
    webSocketFeed.disconnect();
    console.log('✅ Bot stopped');
  }

  public isActive(): boolean {
    return this.isRunning;
  }
}

// Start the bot
console.log('🔄 Initializing Minimal Trading Bot...');
const bot = new WebSocketTradingBot();

// Handle startup
console.log('🚀 Starting bot...');
bot.start().catch(error => {
  console.error('❌ Bot startup failed:', error.message);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Received SIGINT, shutting down...');
  await bot.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down...');
  await bot.stop();
  process.exit(0);
});

export default bot;