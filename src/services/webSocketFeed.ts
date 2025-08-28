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
        this.subscribe();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        this.handleMessage(data);
      });

      this.ws.on('close', (code: number, reason: Buffer) => {
        logger.warn(`WebSocket closed: ${code} ${reason.toString()}`);
        this.isConnected = false;
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
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('CRITICAL: Max reconnection attempts reached - cannot proceed without real market data');
      throw new Error('WebSocket connection permanently failed');
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    setTimeout(() => {
      logger.info(`🔄 Reconnecting WebSocket (attempt ${this.reconnectAttempts})...`);
      this.connect().catch(error => {
        logger.error('Reconnection failed:', error.message);
      });
    }, delay);
  }

  public disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    
    this.isConnected = false;
  }
}

export const webSocketFeed = new WebSocketFeed();