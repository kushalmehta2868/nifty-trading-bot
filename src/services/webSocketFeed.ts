import WebSocket from 'ws';
import { angelAPI } from './angelAPI';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { 
  MarketData, 
  PriceData, 
  PriceUpdate, 
  PriceSubscriber, 
  WebSocketMessage, 
  SubscriptionMessage,
  IndexName
} from '../types';

class WebSocketFeed {
  private ws: WebSocket | null = null;
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private subscribers: PriceSubscriber[] = [];
  private priceData: MarketData = {
    NIFTY: { prices: [], currentPrice: 0, lastUpdate: 0 },
    BANKNIFTY: { prices: [], currentPrice: 0, lastUpdate: 0 }
  };
  private pingInterval: NodeJS.Timeout | null = null;
  private pongTimeout: NodeJS.Timeout | null = null;
  private lastPongReceived: number = Date.now();
  private readonly PING_INTERVAL = 30000; // 30 seconds
  private readonly PONG_TIMEOUT = 10000; // 10 seconds
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;

  public async initialize(): Promise<boolean> {
    try {
      logger.info('Initializing real-time Angel One WebSocket feed');

      const authResult = await angelAPI.authenticate();
      if (!authResult) {
        logger.error('Angel authentication failed - cannot proceed without real data');
        throw new Error('Authentication required for real trading data');
      }

      await this.connect();
      return true;

    } catch (error) {
      logger.error('WebSocket initialization failed:', (error as Error).message);
      logger.error('CRITICAL: Cannot operate without real market data');
      throw error;
    }
  }

  private async connect(): Promise<void> {
    try {
      // Fixed WebSocket URL format for Angel One API
      const wsUrl = `wss://smartapisocket.angelone.in/smart-stream`;
      
      this.ws = new WebSocket(wsUrl, {
        headers: {
          'Authorization': `Bearer ${angelAPI.jwtToken}`,
          'x-api-key': config.angel.apiKey,
          'x-client-code': config.angel.clientId,
          'x-feed-token': angelAPI.feedToken || ''
        }
      });

      this.ws.on('open', () => {
        logger.info('🔗 WebSocket connected to Angel SmartAPI');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.lastPongReceived = Date.now();
        this.startPingPong();
        this.startHealthCheck();
        this.subscribe();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        this.handleMessage(data);
      });

      this.ws.on('ping', () => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.pong();
          logger.debug('WebSocket ping received, sent pong');
        }
      });

      this.ws.on('pong', () => {
        this.lastPongReceived = Date.now();
        logger.debug('WebSocket pong received');
        if (this.pongTimeout) {
          clearTimeout(this.pongTimeout);
          this.pongTimeout = null;
        }
      });

      this.ws.on('close', (code: number, reason: Buffer) => {
        logger.warn(`WebSocket closed: ${code} ${reason.toString()}`);
        this.isConnected = false;
        this.stopPingPong();
        this.stopHealthCheck();
        this.scheduleReconnect();
      });

      this.ws.on('error', (error: Error) => {
        logger.error('WebSocket error:', error.message);
        this.isConnected = false;
        
        if (error.message.includes('401') || error.message.includes('403')) {
          logger.error('CRITICAL: Authentication failed for WebSocket - cannot proceed without real data');
          throw new Error('WebSocket authentication failed');
        }
      });

    } catch (error) {
      logger.error('WebSocket connection failed:', (error as Error).message);
      throw error;
    }
  }

  private subscribe(): void {
    const subscribeMsg: SubscriptionMessage = {
      action: 1, // Subscribe
      mode: 1,   // LTP
      tokenList: [
        {
          exchangeType: 1,
          tokens: [config.indices.NIFTY.token, config.indices.BANKNIFTY.token]
        }
      ]
    };

    if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(subscribeMsg));
      logger.info('📡 Subscribed to NIFTY & Bank NIFTY live feeds');
    }
  }

  private handleMessage(data: WebSocket.Data): void {
    try {
      const message: WebSocketMessage = JSON.parse(data.toString());

      if (message.token && message.ltp) {
        let indexName: IndexName | null = null;

        if (message.token === config.indices.NIFTY.token) {
          indexName = 'NIFTY';
        } else if (message.token === config.indices.BANKNIFTY.token) {
          indexName = 'BANKNIFTY';
        }

        if (indexName) {
          const price = typeof message.ltp === 'string' ? 
            parseFloat(message.ltp) : message.ltp;
          this.updatePrice(indexName, price);
        }
      }

    } catch (error) {
      logger.error('Error parsing WebSocket message:', (error as Error).message);
    }
  }

  private updatePrice(indexName: IndexName, price: number): void {
    const priceData: PriceData = this.priceData[indexName];
    const now = Date.now();

    // Update current price
    priceData.currentPrice = price;
    priceData.lastUpdate = now;

    // Add to price history
    priceData.prices.push(price);
    if (priceData.prices.length > 100) {
      priceData.prices.shift();
    }

    // Notify subscribers
    this.notifySubscribers(indexName, {
      price,
      timestamp: new Date(),
      source: 'WebSocket'
    });
  }


  public addSubscriber(callback: PriceSubscriber): void {
    this.subscribers.push(callback);
  }

  private notifySubscribers(indexName: IndexName, priceUpdate: PriceUpdate): void {
    this.subscribers.forEach(callback => {
      try {
        callback(indexName, priceUpdate);
      } catch (error) {
        logger.error('Subscriber callback error:', (error as Error).message);
      }
    });
  }

  public getCurrentPrice(indexName: IndexName): number {
    return this.priceData[indexName].currentPrice;
  }

  public getPriceHistory(indexName: IndexName): number[] {
    return this.priceData[indexName].prices;
  }

  private scheduleReconnect(): void {
    // Clear existing reconnect timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('CRITICAL: Max reconnection attempts reached - cannot proceed without real market data');
      throw new Error('WebSocket connection permanently failed');
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    this.reconnectTimeout = setTimeout(() => {
      logger.info(`🔄 Reconnecting WebSocket (attempt ${this.reconnectAttempts})...`);
      this.connect().catch(error => {
        logger.error('Reconnection failed:', error.message);
        this.scheduleReconnect();
      });
    }, delay);
  }

  private startHealthCheck(): void {
    this.stopHealthCheck(); // Clear any existing intervals
    
    this.healthCheckInterval = setInterval(() => {
      if (!this.isConnectionHealthy()) {
        logger.warn('WebSocket connection unhealthy - forcing reconnection');
        if (this.ws) {
          this.ws.terminate();
        }
      }
    }, 60000); // Check every minute
    
    logger.debug('WebSocket health monitoring started');
  }

  private stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    
    logger.debug('WebSocket health monitoring stopped');
  }

  private startPingPong(): void {
    this.stopPingPong(); // Clear any existing intervals
    
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
        logger.debug('WebSocket ping sent');
        
        // Set timeout for pong response
        this.pongTimeout = setTimeout(() => {
          logger.warn('WebSocket pong timeout - connection may be dead');
          if (this.ws) {
            this.ws.terminate();
          }
        }, this.PONG_TIMEOUT);
      }
    }, this.PING_INTERVAL);
    
    logger.info(`📡 WebSocket heartbeat started (ping every ${this.PING_INTERVAL/1000}s)`);
  }

  private stopPingPong(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
    
    logger.debug('WebSocket heartbeat stopped');
  }

  public isConnectionHealthy(): boolean {
    const timeSinceLastPong = Date.now() - this.lastPongReceived;
    return this.isConnected && timeSinceLastPong < this.PING_INTERVAL * 2;
  }

  public getConnectionStatus(): { connected: boolean; healthy: boolean; lastPong: number } {
    return {
      connected: this.isConnected,
      healthy: this.isConnectionHealthy(),
      lastPong: this.lastPongReceived
    };
  }

  public disconnect(): void {
    this.stopPingPong();
    this.stopHealthCheck();
    
    // Clear reconnect timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.isConnected = false;
  }
}

export const webSocketFeed = new WebSocketFeed();