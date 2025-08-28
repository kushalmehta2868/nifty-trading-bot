import express from 'express';
import { logger } from '../utils/logger';
import { isMarketOpen, formatTimeUntilMarketOpen, getTimezoneInfo } from '../utils/marketHours';

class HealthServer {
  private app: express.Application;
  private server: any;
  private readonly port: number;

  constructor() {
    this.app = express();
    this.port = parseInt(process.env.PORT || '3000');
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(express.json());
    this.app.use((req, res, next) => {
      logger.info(`${req.method} ${req.path} - Health check request`);
      next();
    });
  }

  private setupRoutes(): void {
    // Health check endpoint for Render
    this.app.get('/health', (req, res) => {
      const marketStatus = isMarketOpen();
      const timezoneInfo = getTimezoneInfo();
      const response = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        timezone: timezoneInfo,
        market: {
          isOpen: marketStatus,
          nextStatus: marketStatus ? 'Market is open' : formatTimeUntilMarketOpen()
        },
        bot: {
          running: true,
          version: '1.0.0'
        }
      };

      res.json(response);
    });

    // Root endpoint
    this.app.get('/', (req, res) => {
      res.json({
        message: 'Trading Bot API',
        status: 'running',
        endpoints: {
          health: '/health',
          status: '/status'
        }
      });
    });

    // Bot status endpoint
    this.app.get('/status', (req, res) => {
      const marketStatus = isMarketOpen();
      res.json({
        bot: 'Trading Bot',
        market: marketStatus ? 'Open' : 'Closed',
        uptime: `${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m`,
        timestamp: new Date().toISOString()
      });
    });

    // Keep-alive endpoint specifically for external monitoring
    this.app.get('/ping', (req, res) => {
      res.json({ 
        pong: true, 
        timestamp: Date.now() 
      });
    });
  }

  public start(): void {
    this.server = this.app.listen(this.port, '0.0.0.0', () => {
      logger.info(`🌐 Health server running on port ${this.port}`);
      logger.info(`📡 Health check available at: http://localhost:${this.port}/health`);
      logger.info(`🔄 Keep-alive endpoint: http://localhost:${this.port}/ping`);
    });

    this.server.on('error', (error: any) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(`Port ${this.port} is already in use`);
      } else {
        logger.error('Health server error:', error.message);
      }
    });
  }

  public stop(): void {
    if (this.server) {
      this.server.close(() => {
        logger.info('🌐 Health server stopped');
      });
    }
  }

  public getApp(): express.Application {
    return this.app;
  }
}

export const healthServer = new HealthServer();