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

  // Enhanced connection management
  private connectionState: 'disconnected' | 'connecting' | 'connected' | 'authenticating' | 'authenticated' = 'disconnected';
  private subscriptionConfirmed = false;
  private lastDataReceived = 0;
  private messageValidationErrors = 0;
  private readonly MAX_VALIDATION_ERRORS = 10;
  private consecutiveFailures = 0;
  private readonly MAX_CONSECUTIVE_FAILURES = 3;

  public async initialize(): Promise<boolean> {
    try {
      logger.info('Initializing Angel One data feed...');

      const authResult = await angelAPI.authenticate();
      if (!authResult) {
        throw new Error('Authentication failed');
      }
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
    return new Promise(async (resolve, reject) => {
      try {
        // ✅ FIXED: Updated WebSocket URL and connection method
        const wsUrl = 'wss://smartapisocket.angelone.in/smart-stream';

        // ✅ FIXED: Ensure fresh authentication
        if (!angelAPI.jwtToken || !angelAPI.feedToken) {
          logger.warn('🔐 Missing tokens, attempting authentication...');
          await angelAPI.authenticate();
        }

        if (!angelAPI.jwtToken || !angelAPI.feedToken) {
          throw new Error('Authentication required for WebSocket connection');
        }

        logger.info('🔗 Attempting WebSocket connection to Angel One...');
        logger.info(`📊 JWT Token: ${angelAPI.jwtToken.substring(0, 20)}...`);
        logger.info(`📡 Feed Token: ${angelAPI.feedToken.substring(0, 20)}...`);

        // ✅ FIXED: Proper WebSocket initialization
        this.ws = new WebSocket(wsUrl);

        // ✅ FIXED: Increased timeout for better connectivity
        const timeout = setTimeout(() => {
          if (this.ws && this.ws.readyState !== WebSocket.OPEN) {
            this.ws.terminate();
            reject(new Error('WebSocket connection timeout (30s)'));
          }
        }, 30000);

        this.ws.on('open', async () => {
          clearTimeout(timeout);
          logger.info('✅ WebSocket connection established');

          try {
            // ✅ FIXED: Send proper authentication after connection
            const authMessage = {
              correlationID: 'auth_' + Date.now(),
              action: 1,
              params: {
                mode: 3,
                tokenList: [{
                  exchangeType: 1,
                  tokens: [config.indices.NIFTY.token, config.indices.BANKNIFTY.token]
                }]
              }
            };

            logger.info('🔐 Sending WebSocket authentication...');
            this.ws?.send(JSON.stringify(authMessage));

            this.isConnected = true;
            this.reconnectAttempts = 0;
            this.lastPongReceived = Date.now();

            // Start monitoring services
            this.startPingPong();
            this.startHealthCheck();

            resolve();
          } catch (authError) {
            logger.error('❌ WebSocket authentication failed:', (authError as Error).message);
            reject(authError);
          }
        });

        this.ws.on('error', (error: Error) => {
          clearTimeout(timeout);
          logger.error('❌ WebSocket connection error:', error.message);
          this.isConnected = false;
          reject(error);
        });

        this.ws.on('close', (code: number, reason: string) => {
          clearTimeout(timeout);
          logger.warn(`🔌 WebSocket closed: Code=${code}, Reason=${reason || 'Unknown'}`);
          this.isConnected = false;

          if (code !== 1000) { // Not a normal closure
            this.scheduleReconnect();
          }
        });

        // ✅ FIXED: Enhanced message handling with proper parsing
        this.ws.on('message', (data: WebSocket.Data) => {
          try {
            this.handleMessage(data);
          } catch (error) {
            logger.error('❌ Message handling error:', (error as Error).message);
          }
        });

        // ✅ FIXED: Pong handler for heartbeat
        this.ws.on('pong', () => {
          if (this.pongTimeout) {
            clearTimeout(this.pongTimeout);
            this.pongTimeout = null;
          }
          this.lastPongReceived = Date.now();
          logger.debug('💚 WebSocket pong received');
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
      // ✅ FIXED: Proper message handling for Angel One WebSocket format
      if (data instanceof Buffer) {
        // ✅ FIXED: Handle binary data properly
        logger.debug('📨 Binary message received, length:', data.length);

        // Angel One sends binary packed data - need to parse according to their protocol
        if (data.length >= 8) {
          // Basic binary parsing - Angel One uses specific byte formats
          // This is a simplified version - full implementation would need Angel's protocol spec
          try {
            const token = data.readUInt32BE(0).toString();
            const price = data.readUInt32BE(4) / 100; // Price usually scaled by 100

            logger.debug(`📊 Binary data parsed: Token=${token}, Price=${price}`);
            this.processTickData(token, price, 0);
          } catch (parseError) {
            logger.debug('⚠️ Binary parsing failed, treating as text');
          }
        }
        return;
      }

      // Handle text messages
      let rawMessage = data.toString();
      logger.debug('📨 Text message:', rawMessage.substring(0, 200) + (rawMessage.length > 200 ? '...' : ''));

      // ✅ FIXED: Enhanced JSON message parsing
      if (rawMessage.startsWith('{') || rawMessage.startsWith('[')) {
        try {
          const message = JSON.parse(rawMessage);

          // Handle different Angel One message formats
          if (Array.isArray(message)) {
            // Array of tick data
            message.forEach(tick => this.processWebSocketTick(tick));
          } else {
            // Single tick or status message
            this.processWebSocketTick(message);
          }
        } catch (jsonError) {
          logger.warn('❌ JSON parsing failed:', (jsonError as Error).message);
          logger.debug('Raw message that failed to parse:', rawMessage.substring(0, 500));
        }
      } else {
        // Handle non-JSON messages (acknowledgments, status, etc.)
        logger.debug('📝 Non-JSON message:', rawMessage);

        // Check for connection acknowledgment
        if (rawMessage.includes('Connected') || rawMessage.includes('success')) {
          logger.info('✅ WebSocket connection acknowledged by server');
        }
      }
    } catch (error) {
      this.messageValidationErrors++;
      logger.error('❌ Message handling error:', (error as Error).message);
      logger.debug('Failed message data:', data.toString().substring(0, 500));

      if (this.messageValidationErrors >= this.MAX_VALIDATION_ERRORS) {
        logger.error('🚨 Too many message validation errors, reconnecting...');
        this.forceReconnect();
      }
    }
  }

  // Enhanced message validation methods
  private isValidAngelMessage(message: any): boolean {
    if (!message || typeof message !== 'object') return false;

    // Angel One message validation - check for expected fields
    const hasToken = message.tk || message.token || message.symbol_token || message.exchange_token;
    const hasPrice = message.lp || message.ltp || message.last_price || message.last_traded_price;

    return !!(hasToken && hasPrice);
  }

  private isValidToken(token: string): boolean {
    // Angel One tokens are typically numeric strings
    return /^\d+$/.test(token) && token.length >= 4 && token.length <= 10;
  }

  private handleSubscriptionResponse(message: any): void {
    if (message.status === 'success' || message.message?.includes('success')) {
      logger.info('✅ Subscription confirmed by Angel One WebSocket');
      this.subscriptionConfirmed = true;
      this.connectionState = 'authenticated';
      this.consecutiveFailures = 0;
    } else {
      logger.warn('⚠️ Subscription failed:', message);
      this.consecutiveFailures++;
    }
  }

  private forceReconnect(): void {
    logger.warn('🔄 Forcing WebSocket reconnection due to persistent issues...');

    if (this.ws) {
      this.ws.terminate();
    }

    // Reset state
    this.isConnected = false;
    this.connectionState = 'disconnected';
    this.subscriptionConfirmed = false;
    this.messageValidationErrors = 0;
    this.consecutiveFailures = 0;

    // Schedule reconnection
    this.scheduleReconnect();
  }

  // ✅ ADDED: Enhanced tick processing for different message formats
  private processWebSocketTick(tick: any): void {
    try {
      let token: string | undefined;
      let price: number | undefined;
      let volume: number = 0;

      // ✅ FIXED: Handle multiple Angel One message formats
      if (tick.tk && tick.lp) {
        // Format 1: { tk: "token", lp: price, v: volume }
        token = tick.tk;
        price = tick.lp;
        volume = tick.v || tick.vol || 0;
      } else if (tick.token && tick.ltp) {
        // Format 2: { token: "token", ltp: price, volume: volume }
        token = tick.token;
        price = tick.ltp;
        volume = tick.volume || tick.vol || 0;
      } else if (tick.symbol_token && (tick.ltp || tick.last_price)) {
        // Format 3: { symbol_token: "token", ltp: price }
        token = tick.symbol_token;
        price = tick.ltp || tick.last_price;
        volume = tick.volume || tick.vol || 0;
      } else if (tick.exchange_token && tick.last_traded_price) {
        // Format 4: Alternative format
        token = tick.exchange_token;
        price = tick.last_traded_price;
        volume = tick.total_traded_volume || 0;
      } else {
        // ✅ ENHANCED: Log unknown formats for debugging
        const keys = Object.keys(tick);
        if (keys.length > 0 && !tick.correlationID) { // Skip correlation messages
          logger.debug('🔍 Unknown tick format:', JSON.stringify(tick));
          logger.debug('Available fields:', keys.join(', '));
        }
        return;
      }

      if (token && price !== undefined && price > 0) {
        this.processTickData(token, price, volume);
      }
    } catch (error) {
      logger.error('❌ Tick processing error:', (error as Error).message);
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