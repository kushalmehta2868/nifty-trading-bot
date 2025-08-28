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
            NIFTY: { prices: [], currentPrice: 0, lastUpdate: 0 },
            BANKNIFTY: { prices: [], currentPrice: 0, lastUpdate: 0 }
        };
    }
    async initialize() {
        try {
            logger_1.logger.info('Initializing real-time Angel One WebSocket feed');
            const authResult = await angelAPI_1.angelAPI.authenticate();
            if (!authResult) {
                logger_1.logger.error('Angel authentication failed - cannot proceed without real data');
                throw new Error('Authentication required for real trading data');
            }
            await this.connect();
            return true;
        }
        catch (error) {
            logger_1.logger.error('WebSocket initialization failed:', error.message);
            logger_1.logger.error('CRITICAL: Cannot operate without real market data');
            throw error;
        }
    }
    async connect() {
        try {
            // Fixed WebSocket URL format for Angel One API
            const wsUrl = `wss://smartapisocket.angelone.in/smart-stream`;
            this.ws = new ws_1.default(wsUrl, {
                headers: {
                    'Authorization': `Bearer ${angelAPI_1.angelAPI.jwtToken}`,
                    'x-api-key': config_1.config.angel.apiKey,
                    'x-client-code': config_1.config.angel.clientId,
                    'x-feed-token': angelAPI_1.angelAPI.feedToken || ''
                }
            });
            this.ws.on('open', () => {
                logger_1.logger.info('🔗 WebSocket connected to Angel SmartAPI');
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.subscribe();
            });
            this.ws.on('message', (data) => {
                this.handleMessage(data);
            });
            this.ws.on('close', (code, reason) => {
                logger_1.logger.warn(`WebSocket closed: ${code} ${reason.toString()}`);
                this.isConnected = false;
                this.scheduleReconnect();
            });
            this.ws.on('error', (error) => {
                logger_1.logger.error('WebSocket error:', error.message);
                this.isConnected = false;
                if (error.message.includes('401') || error.message.includes('403')) {
                    logger_1.logger.error('CRITICAL: Authentication failed for WebSocket - cannot proceed without real data');
                    throw new Error('WebSocket authentication failed');
                }
            });
        }
        catch (error) {
            logger_1.logger.error('WebSocket connection failed:', error.message);
            throw error;
        }
    }
    subscribe() {
        const subscribeMsg = {
            action: 1, // Subscribe
            mode: 1, // LTP
            tokenList: [
                {
                    exchangeType: 1,
                    tokens: [config_1.config.indices.NIFTY.token, config_1.config.indices.BANKNIFTY.token]
                }
            ]
        };
        if (this.isConnected && this.ws && this.ws.readyState === ws_1.default.OPEN) {
            this.ws.send(JSON.stringify(subscribeMsg));
            logger_1.logger.info('📡 Subscribed to NIFTY & Bank NIFTY live feeds');
        }
    }
    handleMessage(data) {
        try {
            const message = JSON.parse(data.toString());
            if (message.token && message.ltp) {
                let indexName = null;
                if (message.token === config_1.config.indices.NIFTY.token) {
                    indexName = 'NIFTY';
                }
                else if (message.token === config_1.config.indices.BANKNIFTY.token) {
                    indexName = 'BANKNIFTY';
                }
                if (indexName) {
                    const price = typeof message.ltp === 'string' ?
                        parseFloat(message.ltp) : message.ltp;
                    this.updatePrice(indexName, price);
                }
            }
        }
        catch (error) {
            logger_1.logger.error('Error parsing WebSocket message:', error.message);
        }
    }
    updatePrice(indexName, price) {
        const priceData = this.priceData[indexName];
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
    scheduleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            logger_1.logger.error('CRITICAL: Max reconnection attempts reached - cannot proceed without real market data');
            throw new Error('WebSocket connection permanently failed');
        }
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        this.reconnectAttempts++;
        setTimeout(() => {
            logger_1.logger.info(`🔄 Reconnecting WebSocket (attempt ${this.reconnectAttempts})...`);
            this.connect().catch(error => {
                logger_1.logger.error('Reconnection failed:', error.message);
            });
        }, delay);
    }
    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.isConnected = false;
    }
}
exports.webSocketFeed = new WebSocketFeed();
//# sourceMappingURL=webSocketFeed.js.map