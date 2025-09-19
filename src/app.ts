import { webSocketFeed } from './services/webSocketFeed';
import { strategy } from './services/strategy';
import { telegramBot } from './services/telegramBot';
import { orderService } from './services/orderService';
import { logger } from './utils/logger';
import express from 'express';

class WebSocketTradingBot {
  private isRunning = false;
  private server: any = null;

  public async start(): Promise<void> {
    try {
      console.log('🚀 Minimal Trading Bot Starting...');

      // Start HTTP server for Render port binding requirement
      await this.startHttpServer();

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

  private async startHttpServer(): Promise<void> {
    const app = express();
    const port = process.env.PORT || 10000;

    // Health check endpoint
    app.get('/', (req, res) => {
      res.json({
        status: 'running',
        uptime: process.uptime(),
        memory: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
        isTrading: this.isRunning
      });
    });

    // Status endpoint
    app.get('/status', (req, res) => {
      res.json({
        bot: this.isRunning ? 'active' : 'inactive',
        services: {
          websocket: 'running',
          strategy: 'running',
          telegram: 'running',
          orders: 'running'
        }
      });
    });

    this.server = app.listen(port, () => {
      console.log(`🌐 HTTP Server running on port ${port} for Render`);
    });
  }

  public async stop(): Promise<void> {
    console.log('🛑 Stopping bot...');
    this.isRunning = false;
    webSocketFeed.disconnect();

    if (this.server) {
      this.server.close();
      console.log('✅ HTTP Server stopped');
    }

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