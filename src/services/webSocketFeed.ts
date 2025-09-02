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
    NIFTY: { prices: [], volumes: [], currentPrice: 0, currentVolume: 0, lastUpdate: 0 },
    BANKNIFTY: { prices: [], volumes: [], currentPrice: 0, currentVolume: 0, lastUpdate: 0 }
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
      logger.info('Initializing Angel One data feed...');

      const authResult = await angelAPI.authenticate();
      if (!authResult) {
        throw new Error('Authentication failed');
      }

      await angelAPI.debugAngelFormats();
      // await angelAPI.testTokenLTP(); // Verify tokens work via REST

      // Try WebSocket first
      try {
        await this.connect();

        // Wait 10 seconds to see if WebSocket delivers data
        await new Promise(resolve => setTimeout(resolve, 10000));

        let hasWebSocketData = false;
        for (const indexName of ['NIFTY', 'BANKNIFTY'] as IndexName[]) {
          if (this.getCurrentPrice(indexName) > 0) {
            hasWebSocketData = true;
            break;
          }
        }

        if (hasWebSocketData) {
          logger.info('✅ WebSocket data flowing - using WebSocket');
          return true;
        } else {
          logger.warn('⚠️ WebSocket connected but no data - falling back to REST API');
          this.startRESTFallback();
          return true;
        }

      } catch (wsError) {
        logger.warn('❌ WebSocket failed - using REST API fallback');
        this.startRESTFallback();
        return true;
      }

    } catch (error) {
      logger.error('Data feed initialization failed:', (error as Error).message);
      throw error;
    }
  }


  private async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // 🔥 CORRECTED WebSocket URL 
        const wsUrl = `wss://smartapisocket.angelone.in/smart-stream`;

        // 🔥 Validate authentication first
        if (!angelAPI.jwtToken || !angelAPI.feedToken) {
          throw new Error('Missing authentication tokens');
        }

        logger.info('🔗 Connecting to Angel WebSocket...');
        logger.info(`JWT: ${angelAPI.jwtToken?.substring(0, 20)}...`);
        logger.info(`Feed: ${angelAPI.feedToken?.substring(0, 20)}...`);

        this.ws = new WebSocket(wsUrl, {
          headers: {
            'Authorization': `Bearer ${angelAPI.jwtToken}`,
            'x-api-key': config.angel.apiKey,
            'x-client-code': config.angel.clientId,
            'x-feed-token': angelAPI.feedToken
          }
        });

        // 🔥 Connection timeout
        const timeout = setTimeout(() => {
          reject(new Error('WebSocket connection timeout'));
        }, 15000);

        this.ws.on('open', () => {
          clearTimeout(timeout);
          logger.info('🔗 WebSocket connected successfully');
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.lastPongReceived = Date.now();

          // 🔥 Wait before subscribing
          setTimeout(() => {
            this.subscribe();
          }, 2000);

          resolve();
        });

        this.ws.on('error', (error: Error) => {
          clearTimeout(timeout);
          logger.error('❌ WebSocket error:', error.message);
          this.isConnected = false;
          reject(error);
        });

        // 🔥 Enhanced message handler
        this.ws.on('message', (data: WebSocket.Data) => {
          logger.info('📨 RAW WebSocket data:', data.toString());
          this.handleMessage(data);
        });

      } catch (error) {
        reject(error);
      }
    });
  }


  private subscribe(): void {
    const subscribeMsg = {
      correlationID: 'tradingbot_' + Date.now(),
      action: 1,
      mode: 3, // Mode 3 for full market data including volume
      exchangeType: 1, // NSE
      tokens: [config.indices.NIFTY.token, config.indices.BANKNIFTY.token]
    };

    if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      logger.info('📡 Sending NSE subscription for full market data...');
      this.ws.send(JSON.stringify(subscribeMsg));

      // Only NSE subscription needed now
      logger.info('📡 NSE subscription completed');
    }
  }


  private handleMessage(data: WebSocket.Data): void {
    try {
      let rawMessage = data.toString();

      // 🔥 Check if it's binary data
      if (data instanceof Buffer) {
        logger.info('📨 Binary data received, converting...');
        // For Angel One binary format, try converting to hex first
        rawMessage = data.toString('hex');
        logger.info('📨 Hex data:', rawMessage.substring(0, 100) + '...');
        return; // Skip binary parsing for now
      }

      logger.info('📨 Raw message:', rawMessage);

      if (rawMessage.startsWith('{')) {
        const message = JSON.parse(rawMessage);
        logger.info('🔍 Parsed JSON:', JSON.stringify(message, null, 2));

        // Check for different message types Angel One sends
        if (message.tk && message.lp) {
          // Format 1: tk=token, lp=last price, v=volume
          const volume = message.v || message.vol || message.volume || 0;
          this.processTickData(message.tk, message.lp, volume);
        } else if (message.token && message.ltp) {
          // Format 2: token, ltp, volume fields
          const volume = message.volume || message.vol || message.v || 0;
          this.processTickData(message.token, message.ltp, volume);
        } else if (message.symbol_token && message.ltp) {
          // Format 3: symbol_token format
          const volume = message.volume || message.vol || message.v || 0;
          this.processTickData(message.symbol_token, message.ltp, volume);
        } else {
          logger.info('📝 Unknown message format - full data:', JSON.stringify(message, null, 2));
        }
      }
    } catch (error) {
      logger.error('❌ Message parsing failed:', (error as Error).message);
    }
  }

  private processTickData(token: string, price: number, volume: number): void {
    let indexName: IndexName | null = null;

    if (token === config.indices.NIFTY.token) indexName = 'NIFTY';
    else if (token === config.indices.BANKNIFTY.token) indexName = 'BANKNIFTY';

    if (indexName) {
      logger.info(`🎉 TICK: ${indexName} = ₹${price}`);
      this.updatePrice(indexName, price, volume);
    } else {
      logger.warn(`❓ Unknown token: ${token}`);
    }
  }



  private updatePrice(indexName: IndexName, price: number, volume: number = 0): void {
    const priceData: PriceData = this.priceData[indexName];
    const now = Date.now();

    // Update current price and volume
    priceData.currentPrice = price;
    priceData.currentVolume = volume;
    priceData.lastUpdate = now;

    // Add to price history
    priceData.prices.push(price);
    if (priceData.prices.length > 100) {
      priceData.prices.shift();
    }

    // Add to volume history
    if (!priceData.volumes) {
      priceData.volumes = [];
    }
    priceData.volumes.push(volume);
    if (priceData.volumes.length > 100) {
      priceData.volumes.shift();
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

  public removeSubscriber(callback: PriceSubscriber): void {
    const index = this.subscribers.indexOf(callback);
    if (index > -1) {
      this.subscribers.splice(index, 1);
    }
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

  public getPriceData(indexName: IndexName): PriceData {
    return this.priceData[indexName];
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

    logger.info(`📡 WebSocket heartbeat started (ping every ${this.PING_INTERVAL / 1000}s)`);
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
    // More lenient: Allow up to 3x ping interval (90 seconds) before marking as unhealthy
    return this.isConnected && timeSinceLastPong < this.PING_INTERVAL * 3;
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

    // Clear all subscribers to prevent memory leaks
    this.subscribers = [];

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.isConnected = false;
  }


  // Add this to your webSocketFeed.ts as a fallback
  private restPollingInterval: NodeJS.Timeout | null = null;

  public startRESTFallback(): void {
    logger.info('🔄 Starting REST API fallback (WebSocket data unavailable)');

    this.restPollingInterval = setInterval(async () => {
      try {
        // Poll all instruments via REST API
        for (const indexName of ['NIFTY', 'BANKNIFTY'] as IndexName[]) {
          const exchange = 'NSE';

          const response = await angelAPI.makeRequest(
            '/rest/secure/angelbroking/market/v1/quote/',
            'POST',
            {
              mode: 'FULL', // Get full market data including volume
              exchangeTokens: {
                [exchange]: [config.indices[indexName].token]
              }
            }
          );

          if (response?.data?.fetched && response.data.fetched.length > 0) {
            const marketData = response.data.fetched[0];
            const price = parseFloat(marketData.ltp);

            // Try different volume field names
            const volume = parseFloat(
              marketData.volume ||
              marketData.vol ||
              marketData.totalTradedVolume ||
              marketData.totaltradedvolume ||
              '0'
            );

            logger.debug(`📊 REST: ${indexName} = ₹${price}, Volume=${volume} from ${exchange}`);
            this.updatePrice(indexName, price, volume);
          }
        }
      } catch (error) {
        logger.error('REST polling failed:', (error as Error).message);
      }
    }, 3000); // Poll every 3 seconds - reasonable for trading
  }

  public stopRESTFallback(): void {
    if (this.restPollingInterval) {
      clearInterval(this.restPollingInterval);
      this.restPollingInterval = null;
      logger.info('🔄 REST API fallback stopped');
    }
  }

}

export const webSocketFeed = new WebSocketFeed();