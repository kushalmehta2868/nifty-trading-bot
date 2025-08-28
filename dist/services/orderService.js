"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.orderService = void 0;
const angelAPI_1 = require("./angelAPI");
const config_1 = require("../config/config");
const logger_1 = require("../utils/logger");
class OrderService {
    constructor() {
        this.activeOrders = [];
        this.dailyTrades = 0;
        this.dailyPnL = 0;
    }
    async initialize() {
        // Listen for trading signals to place orders
        process.on('tradingSignal', async (signal) => {
            if (config_1.config.trading.autoTrade) {
                await this.processSignal(signal);
            }
        });
        logger_1.logger.info('📋 Order service initialized');
    }
    async processSignal(signal) {
        try {
            if (this.dailyTrades >= config_1.config.trading.maxPositions) {
                logger_1.logger.warn('Daily position limit reached, skipping order');
                return;
            }
            logger_1.logger.info(`🔄 Processing order for ${signal.optionSymbol}`);
            // In real implementation, place order via Angel API
            const orderResult = await this.simulateOrder(signal);
            if (orderResult.success) {
                this.activeOrders.push({
                    signal,
                    orderId: orderResult.orderId,
                    status: 'PLACED',
                    timestamp: new Date()
                });
                this.dailyTrades++;
                logger_1.logger.info(`✅ Order placed: ${signal.optionSymbol}`);
                // Send confirmation to Telegram
                process.emit('orderPlaced', { signal, orderId: orderResult.orderId });
            }
        }
        catch (error) {
            logger_1.logger.error('Order processing failed:', error.message);
        }
    }
    async simulateOrder(signal) {
        // Simulate order placement
        return new Promise(resolve => {
            setTimeout(() => {
                resolve({
                    success: true,
                    orderId: `ORD${Date.now()}`,
                    price: signal.entryPrice,
                    quantity: config_1.config.indices[signal.indexName].lotSize
                });
            }, 1000);
        });
    }
    async placeRealOrder(signal) {
        try {
            const orderDetails = {
                variety: 'NORMAL',
                tradingsymbol: signal.optionSymbol,
                symboltoken: '', // Would need to lookup token
                transactiontype: signal.direction === 'UP' ? 'BUY' : 'BUY', // Buying options
                exchange: 'NFO',
                ordertype: 'MARKET',
                producttype: 'INTRADAY',
                duration: 'DAY',
                price: '0',
                squareoff: signal.target.toString(),
                stoploss: signal.stopLoss.toString(),
                quantity: config_1.config.indices[signal.indexName].lotSize.toString()
            };
            // This would call the actual Angel API
            const response = await angelAPI_1.angelAPI.makeRequest('/rest/secure/angelbroking/order/v1/placeOrder', 'POST', orderDetails);
            return response;
        }
        catch (error) {
            logger_1.logger.error('Real order placement failed:', error.message);
            throw error;
        }
    }
    getDailyStats() {
        return {
            trades: this.dailyTrades,
            activeOrders: this.activeOrders.length,
            pnl: this.dailyPnL
        };
    }
    getActiveOrders() {
        return [...this.activeOrders];
    }
    async cancelOrder(orderId) {
        try {
            const orderIndex = this.activeOrders.findIndex(order => order.orderId === orderId);
            if (orderIndex === -1) {
                logger_1.logger.error(`Order ${orderId} not found`);
                return false;
            }
            // In real implementation, cancel via Angel API
            // const response = await angelAPI.makeRequest('/rest/secure/angelbroking/order/v1/cancelOrder', 'POST', { orderid: orderId });
            this.activeOrders[orderIndex].status = 'CANCELLED';
            logger_1.logger.info(`Order ${orderId} cancelled successfully`);
            return true;
        }
        catch (error) {
            logger_1.logger.error('Order cancellation failed:', error.message);
            return false;
        }
    }
    updatePnL(amount) {
        this.dailyPnL += amount;
    }
    resetDailyStats() {
        this.dailyTrades = 0;
        this.dailyPnL = 0;
        this.activeOrders = [];
        logger_1.logger.info('Daily stats reset');
    }
}
exports.orderService = new OrderService();
//# sourceMappingURL=orderService.js.map