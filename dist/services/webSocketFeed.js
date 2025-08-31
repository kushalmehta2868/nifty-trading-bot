"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.webSocketFeed = void 0;
const ws_1 = __importDefault(require("ws"));
const angelAPI_1 = require("./angelAPI");
const config_1 = require("../config/config");
const logger_1 = require("../utils/logger");
class WebSocketFeed {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.subscribers = [];
        this.priceData = {
            NIFTY: { prices: [], volumes: [], currentPrice: 0, currentVolume: 0, lastUpdate: 0 },
            BANKNIFTY: { prices: [], volumes: [], currentPrice: 0, currentVolume: 0, lastUpdate: 0 }
        };
        this.pingInterval = null;
        this.pongTimeout = null;
        this.lastPongReceived = Date.now();
        this.PING_INTERVAL = 30000; // 30 seconds
        this.PONG_TIMEOUT = 10000; // 10 seconds
        this.healthCheckInterval = null;
        this.reconnectTimeout = null;
        // Add this to your webSocketFeed.ts as a fallback
        this.restPollingInterval = null;
    }
    async initialize() {
        try {
            logger_1.logger.info('Initializing Angel One data feed...');
            const authResult = await angelAPI_1.angelAPI.authenticate();
            if (!authResult) {
                throw new Error('Authentication failed');
            }
            await angelAPI_1.angelAPI.testTokenLTP(); // Verify tokens work via REST
            // Try WebSocket first
            try {
                await this.connect();
                // Wait 10 seconds to see if WebSocket delivers data
                await new Promise(resolve => setTimeout(resolve, 10000));
                let hasWebSocketData = false;
                for (const indexName of ['NIFTY', 'BANKNIFTY']) {
                    if (this.getCurrentPrice(indexName) > 0) {
                        hasWebSocketData = true;
                        break;
                    }
                }
                if (hasWebSocketData) {
                    logger_1.logger.info('✅ WebSocket data flowing - using WebSocket');
                    return true;
                }
                else {
                    logger_1.logger.warn('⚠️ WebSocket connected but no data - falling back to REST API');
                    this.startRESTFallback();
                    return true;
                }
            }
            catch (wsError) {
                logger_1.logger.warn('❌ WebSocket failed - using REST API fallback');
                this.startRESTFallback();
                return true;
            }
        }
        catch (error) {
            logger_1.logger.error('Data feed initialization failed:', error.message);
            throw error;
        }
    }
    async connect() {
        return new Promise((resolve, reject) => {
            try {
                // 🔥 CORRECTED WebSocket URL 
                const wsUrl = `wss://smartapisocket.angelone.in/smart-stream`;
                // 🔥 Validate authentication first
                if (!angelAPI_1.angelAPI.jwtToken || !angelAPI_1.angelAPI.feedToken) {
                    throw new Error('Missing authentication tokens');
                }
                logger_1.logger.info('🔗 Connecting to Angel WebSocket...');
                logger_1.logger.info(`JWT: ${angelAPI_1.angelAPI.jwtToken?.substring(0, 20)}...`);
                logger_1.logger.info(`Feed: ${angelAPI_1.angelAPI.feedToken?.substring(0, 20)}...`);
                this.ws = new ws_1.default(wsUrl, {
                    headers: {
                        'Authorization': `Bearer ${angelAPI_1.angelAPI.jwtToken}`,
                        'x-api-key': config_1.config.angel.apiKey,
                        'x-client-code': config_1.config.angel.clientId,
                        'x-feed-token': angelAPI_1.angelAPI.feedToken
                    }
                });
                // 🔥 Connection timeout
                const timeout = setTimeout(() => {
                    reject(new Error('WebSocket connection timeout'));
                }, 15000);
                this.ws.on('open', () => {
                    clearTimeout(timeout);
                    logger_1.logger.info('🔗 WebSocket connected successfully');
                    this.isConnected = true;
                    this.reconnectAttempts = 0;
                    this.lastPongReceived = Date.now();
                    // 🔥 Wait before subscribing
                    setTimeout(() => {
                        this.subscribe();
                    }, 2000);
                    resolve();
                });
                this.ws.on('error', (error) => {
                    clearTimeout(timeout);
                    logger_1.logger.error('❌ WebSocket error:', error.message);
                    this.isConnected = false;
                    reject(error);
                });
                // 🔥 Enhanced message handler
                this.ws.on('message', (data) => {
                    logger_1.logger.info('📨 RAW WebSocket data:', data.toString());
                    this.handleMessage(data);
                });
            }
            catch (error) {
                reject(error);
            }
        });
    }
    subscribe() {
        const subscribeMsg = {
            correlationID: 'tradingbot_' + Date.now(),
            action: 1,
            mode: 3, // Mode 3 for full market data including volume
            exchangeType: 1, // NSE
            tokens: [config_1.config.indices.NIFTY.token, config_1.config.indices.BANKNIFTY.token]
        };
        if (this.isConnected && this.ws && this.ws.readyState === ws_1.default.OPEN) {
            logger_1.logger.info('📡 Sending NSE subscription for full market data...');
            this.ws.send(JSON.stringify(subscribeMsg));
            // Only NSE subscription needed now
            logger_1.logger.info('📡 NSE subscription completed');
        }
    }
    handleMessage(data) {
        try {
            let rawMessage = data.toString();
            // 🔥 Check if it's binary data
            if (data instanceof Buffer) {
                logger_1.logger.info('📨 Binary data received, converting...');
                // For Angel One binary format, try converting to hex first
                rawMessage = data.toString('hex');
                logger_1.logger.info('📨 Hex data:', rawMessage.substring(0, 100) + '...');
                return; // Skip binary parsing for now
            }
            logger_1.logger.info('📨 Raw message:', rawMessage);
            if (rawMessage.startsWith('{')) {
                const message = JSON.parse(rawMessage);
                logger_1.logger.info('🔍 Parsed JSON:', JSON.stringify(message, null, 2));
                // Check for different message types Angel One sends
                if (message.tk && message.lp) {
                    // Format 1: tk=token, lp=last price, v=volume
                    const volume = message.v || message.vol || message.volume || 0;
                    this.processTickData(message.tk, message.lp, volume);
                }
                else if (message.token && message.ltp) {
                    // Format 2: token, ltp, volume fields
                    const volume = message.volume || message.vol || message.v || 0;
                    this.processTickData(message.token, message.ltp, volume);
                }
                else if (message.symbol_token && message.ltp) {
                    // Format 3: symbol_token format
                    const volume = message.volume || message.vol || message.v || 0;
                    this.processTickData(message.symbol_token, message.ltp, volume);
                }
                else {
                    logger_1.logger.info('📝 Unknown message format - full data:', JSON.stringify(message, null, 2));
                }
            }
        }
        catch (error) {
            logger_1.logger.error('❌ Message parsing failed:', error.message);
        }
    }
    processTickData(token, price, volume) {
        let indexName = null;
        if (token === config_1.config.indices.NIFTY.token)
            indexName = 'NIFTY';
        else if (token === config_1.config.indices.BANKNIFTY.token)
            indexName = 'BANKNIFTY';
        if (indexName) {
            logger_1.logger.info(`🎉 TICK: ${indexName} = ₹${price}`);
            this.updatePrice(indexName, price, volume);
        }
        else {
            logger_1.logger.warn(`❓ Unknown token: ${token}`);
        }
    }
    updatePrice(indexName, price, volume = 0) {
        const priceData = this.priceData[indexName];
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
    addSubscriber(callback) {
        this.subscribers.push(callback);
    }
    notifySubscribers(indexName, priceUpdate) {
        this.subscribers.forEach(callback => {
            try {
                callback(indexName, priceUpdate);
            }
            catch (error) {
                logger_1.logger.error('Subscriber callback error:', error.message);
            }
        });
    }
    getCurrentPrice(indexName) {
        return this.priceData[indexName].currentPrice;
    }
    getPriceHistory(indexName) {
        return this.priceData[indexName].prices;
    }
    getPriceData(indexName) {
        return this.priceData[indexName];
    }
    scheduleReconnect() {
        // Clear existing reconnect timeout
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            logger_1.logger.error('CRITICAL: Max reconnection attempts reached - cannot proceed without real market data');
            throw new Error('WebSocket connection permanently failed');
        }
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        this.reconnectAttempts++;
        this.reconnectTimeout = setTimeout(() => {
            logger_1.logger.info(`🔄 Reconnecting WebSocket (attempt ${this.reconnectAttempts})...`);
            this.connect().catch(error => {
                logger_1.logger.error('Reconnection failed:', error.message);
                this.scheduleReconnect();
            });
        }, delay);
    }
    startHealthCheck() {
        this.stopHealthCheck(); // Clear any existing intervals
        this.healthCheckInterval = setInterval(() => {
            if (!this.isConnectionHealthy()) {
                logger_1.logger.warn('WebSocket connection unhealthy - forcing reconnection');
                if (this.ws) {
                    this.ws.terminate();
                }
            }
        }, 60000); // Check every minute
        logger_1.logger.debug('WebSocket health monitoring started');
    }
    stopHealthCheck() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
        logger_1.logger.debug('WebSocket health monitoring stopped');
    }
    startPingPong() {
        this.stopPingPong(); // Clear any existing intervals
        this.pingInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === ws_1.default.OPEN) {
                this.ws.ping();
                logger_1.logger.debug('WebSocket ping sent');
                // Set timeout for pong response
                this.pongTimeout = setTimeout(() => {
                    logger_1.logger.warn('WebSocket pong timeout - connection may be dead');
                    if (this.ws) {
                        this.ws.terminate();
                    }
                }, this.PONG_TIMEOUT);
            }
        }, this.PING_INTERVAL);
        logger_1.logger.info(`📡 WebSocket heartbeat started (ping every ${this.PING_INTERVAL / 1000}s)`);
    }
    stopPingPong() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
        if (this.pongTimeout) {
            clearTimeout(this.pongTimeout);
            this.pongTimeout = null;
        }
        logger_1.logger.debug('WebSocket heartbeat stopped');
    }
    isConnectionHealthy() {
        const timeSinceLastPong = Date.now() - this.lastPongReceived;
        return this.isConnected && timeSinceLastPong < this.PING_INTERVAL * 2;
    }
    getConnectionStatus() {
        return {
            connected: this.isConnected,
            healthy: this.isConnectionHealthy(),
            lastPong: this.lastPongReceived
        };
    }
    disconnect() {
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
    startRESTFallback() {
        logger_1.logger.info('🔄 Starting REST API fallback (WebSocket data unavailable)');
        this.restPollingInterval = setInterval(async () => {
            try {
                // Poll all instruments via REST API
                for (const indexName of ['NIFTY', 'BANKNIFTY']) {
                    const exchange = 'NSE';
                    const response = await angelAPI_1.angelAPI.makeRequest('/rest/secure/angelbroking/market/v1/quote/', 'POST', {
                        mode: 'FULL', // Get full market data including volume
                        exchangeTokens: {
                            [exchange]: [config_1.config.indices[indexName].token]
                        }
                    });
                    if (response?.data?.fetched && response.data.fetched.length > 0) {
                        const marketData = response.data.fetched[0];
                        const price = parseFloat(marketData.ltp);
                        // Try different volume field names
                        const volume = parseFloat(marketData.volume ||
                            marketData.vol ||
                            marketData.totalTradedVolume ||
                            marketData.totaltradedvolume ||
                            '0');
                        logger_1.logger.debug(`📊 REST: ${indexName} = ₹${price}, Volume=${volume} from ${exchange}`);
                        this.updatePrice(indexName, price, volume);
                    }
                }
            }
            catch (error) {
                logger_1.logger.error('REST polling failed:', error.message);
            }
        }, 3000); // Poll every 3 seconds - reasonable for trading
    }
    stopRESTFallback() {
        if (this.restPollingInterval) {
            clearInterval(this.restPollingInterval);
            this.restPollingInterval = null;
            logger_1.logger.info('🔄 REST API fallback stopped');
        }
    }
}
exports.webSocketFeed = new WebSocketFeed();
//# sourceMappingURL=webSocketFeed.js.map