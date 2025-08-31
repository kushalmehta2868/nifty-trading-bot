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
        this.monitoringInterval = null;
    }
    async initialize() {
        // Listen for trading signals to place orders
        process.on('tradingSignal', async (signal) => {
            if (config_1.config.trading.autoTrade) {
                await this.processSignal(signal);
            }
        });
        // Start monitoring active orders
        this.startOrderMonitoring();
        logger_1.logger.info('📋 Order service initialized with order monitoring');
    }
    async processSignal(signal) {
        try {
            logger_1.logger.info(`🎯 SIGNAL RECEIVED: ${signal.indexName} ${signal.optionType} | Confidence: ${signal.confidence.toFixed(1)}% | Strategy: ${this.getStrategyName(signal.confidence)}`);
            if (this.dailyTrades >= config_1.config.trading.maxPositions) {
                logger_1.logger.warn(`❌ Daily position limit reached (${this.dailyTrades}/${config_1.config.trading.maxPositions}) - skipping order`);
                return;
            }
            logger_1.logger.info(`🔄 Processing ${config_1.config.trading.paperTrading ? 'PAPER' : 'REAL'} order for ${signal.optionSymbol}`);
            logger_1.logger.info(`💰 Order Details: Entry=₹${signal.entryPrice} | Target=₹${signal.target} | SL=₹${signal.stopLoss}`);
            // Check available balance only for real trading
            if (!config_1.config.trading.paperTrading) {
                logger_1.logger.info('💰 Checking account balance before real order placement...');
                const hasBalance = await this.checkSufficientBalance(signal);
                if (!hasBalance) {
                    logger_1.logger.error('❌ INSUFFICIENT BALANCE - Cannot place real order');
                    process.emit('balanceInsufficient', {
                        signal,
                        message: `🚨 *INSUFFICIENT BALANCE ALERT*\n📈 *${signal.optionSymbol}*\n\n❌ Cannot place order - insufficient margin\n💰 Required: ~₹${(signal.entryPrice * config_1.config.indices[signal.indexName].lotSize * 0.2).toFixed(0)}\n\n🔧 Please add margin to continue trading`
                    });
                    return;
                }
                logger_1.logger.info('✅ Balance check passed - proceeding with real order');
            }
            else {
                logger_1.logger.info('📄 Paper trading mode - skipping balance check');
            }
            // Place order (real or paper trading)
            if (config_1.config.trading.paperTrading) {
                // Paper Trading Mode - Simulate order placement
                const paperOrderId = this.generatePaperOrderId();
                this.activeOrders.push({
                    signal,
                    orderId: paperOrderId,
                    status: 'PLACED',
                    timestamp: new Date(),
                    isPaperTrade: true
                });
                this.dailyTrades++;
                logger_1.logger.info(`📄 PAPER ORDER PLACED: ${signal.optionSymbol} - Order ID: ${paperOrderId}`);
                logger_1.logger.info(`📊 Paper Order Status: ${this.dailyTrades}/${config_1.config.trading.maxPositions} positions used`);
                // Fill paper order immediately (no artificial delays)
                setTimeout(() => {
                    logger_1.logger.info(`📄 Simulating instant fill for paper order: ${paperOrderId}`);
                    this.simulateOrderFill(paperOrderId, signal);
                }, 100); // Minimal delay for async processing
                // Send paper confirmation to Telegram
                process.emit('orderPlaced', {
                    signal,
                    orderId: paperOrderId,
                    isPaperTrade: true
                });
            }
            else {
                // Real Trading Mode
                logger_1.logger.info('💰 Placing REAL BRACKET ORDER with Angel One...');
                const orderResponse = await this.placeRealOrder(signal);
                if (orderResponse.status && orderResponse.data?.orderid) {
                    this.activeOrders.push({
                        signal,
                        orderId: orderResponse.data.orderid,
                        status: 'PLACED',
                        timestamp: new Date(),
                        isPaperTrade: false
                    });
                    this.dailyTrades++;
                    logger_1.logger.info(`✅ REAL BRACKET ORDER PLACED SUCCESSFULLY:`);
                    logger_1.logger.info(`   📋 Order ID: ${orderResponse.data.orderid}`);
                    logger_1.logger.info(`   📈 Symbol: ${signal.optionSymbol}`);
                    logger_1.logger.info(`   💰 Entry: ₹${signal.entryPrice} | Target: ₹${signal.target} | SL: ₹${signal.stopLoss}`);
                    logger_1.logger.info(`   📊 Position Status: ${this.dailyTrades}/${config_1.config.trading.maxPositions} real orders today`);
                    logger_1.logger.info(`   🤖 Angel One will automatically handle exits at target/SL levels`);
                    // Send confirmation to Telegram
                    process.emit('orderPlaced', { signal, orderId: orderResponse.data.orderid, isPaperTrade: false });
                }
                else {
                    logger_1.logger.error(`❌ REAL ORDER PLACEMENT FAILED:`);
                    logger_1.logger.error(`   📋 Response Status: ${orderResponse.status}`);
                    logger_1.logger.error(`   💬 Error Message: ${orderResponse.message}`);
                    logger_1.logger.error(`   📈 Signal: ${signal.optionSymbol}`);
                    throw new Error(`Real order failed: ${orderResponse.message}`);
                }
            }
        }
        catch (error) {
            logger_1.logger.error('Order processing failed:', error.message);
        }
    }
    /**
     * Places a Bracket Order (BO) with automatic stop loss and target execution
     * This means:
     * 1. BUY order executes immediately at market price
     * 2. Angel One automatically places TWO exit orders:
     *    - SELL order at target price (profit booking)
     *    - SELL order at stop loss price (loss protection)
     * 3. When either exit condition is hit, Angel One executes the SELL automatically
     * 4. Bot doesn't need to monitor or place any additional orders
     */
    async placeRealOrder(signal) {
        try {
            logger_1.logger.info(`Placing Bracket Order for ${signal.optionSymbol}`);
            // Get option symbol token (required for Angel API)
            const expiry = this.generateExpiryString();
            // Use the same optimal strike calculation as strategy for consistency
            const strike = this.calculateOptimalStrike(signal.spotPrice, signal.indexName, signal.optionType);
            const symbolToken = await angelAPI_1.angelAPI.getOptionToken(signal.indexName, strike, signal.optionType, expiry);
            if (!symbolToken) {
                logger_1.logger.error(`CRITICAL: Could not get symbol token for ${signal.optionSymbol}`);
                throw new Error('Symbol token lookup failed');
            }
            const orderDetails = {
                variety: 'BO', // Bracket Order for automatic SL and Target
                tradingsymbol: signal.optionSymbol,
                symboltoken: symbolToken,
                transactiontype: 'BUY', // Always buying options (CE or PE)
                exchange: 'NFO',
                ordertype: 'MARKET',
                producttype: 'BO', // Bracket Order product type
                duration: 'DAY',
                price: '0', // Market order
                squareoff: signal.target.toString(), // Target price
                stoploss: signal.stopLoss.toString(), // Stop loss price
                quantity: config_1.config.indices[signal.indexName].lotSize.toString()
            };
            logger_1.logger.info(`📋 Bracket Order Details:`, {
                Symbol: orderDetails.tradingsymbol,
                Type: 'BUY Options',
                Quantity: orderDetails.quantity,
                Target: `₹${orderDetails.squareoff}`,
                StopLoss: `₹${orderDetails.stoploss}`,
                OrderType: 'MARKET (Immediate execution)'
            });
            logger_1.logger.info(`🎯 Automatic Exit Strategy:
        - Target: ₹${signal.target} (${((signal.target / signal.entryPrice - 1) * 100).toFixed(1)}% profit)
        - Stop Loss: ₹${signal.stopLoss} (${((1 - signal.stopLoss / signal.entryPrice) * 100).toFixed(1)}% loss)
        - Angel One will automatically execute SELL orders when target/SL is hit`);
            // Call the actual Angel API
            const response = await angelAPI_1.angelAPI.makeRequest('/rest/secure/angelbroking/order/v1/placeOrder', 'POST', orderDetails);
            if (response.status) {
                logger_1.logger.info(`✅ Bracket Order placed successfully - Angel One will handle exit automatically`);
            }
            logger_1.logger.info(`Angel API Response:`, response);
            return response;
        }
        catch (error) {
            logger_1.logger.error('CRITICAL: Real order placement failed:', error.message);
            throw error;
        }
    }
    generateExpiryString() {
        // Weekly options expire on Tuesdays
        const today = new Date();
        const nextTuesday = new Date(today);
        // Find next Tuesday (Tuesday = 2)
        const daysUntilTuesday = (2 - today.getDay() + 7) % 7;
        // If today is Tuesday and market is still open, use next Tuesday
        const adjustedDays = daysUntilTuesday === 0 ? 7 : daysUntilTuesday;
        nextTuesday.setDate(today.getDate() + adjustedDays);
        const day = nextTuesday.getDate().toString().padStart(2, '0');
        const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
        const month = months[nextTuesday.getMonth()];
        const year = nextTuesday.getFullYear().toString().slice(-2);
        return `${day}${month}${year}`;
    }
    calculateStrike(spotPrice, indexName) {
        const roundTo = indexName === 'BANKNIFTY' ? 100 : 50;
        return Math.round(spotPrice / roundTo) * roundTo;
    }
    // Optimal strike calculation matching strategy.ts for better liquidity
    calculateOptimalStrike(spotPrice, indexName, optionType) {
        let baseStrike;
        let strikeInterval;
        switch (indexName) {
            case 'BANKNIFTY':
                baseStrike = Math.round(spotPrice / 100) * 100;
                strikeInterval = 100;
                break;
            case 'NIFTY':
                baseStrike = Math.round(spotPrice / 50) * 50;
                strikeInterval = 50;
                break;
            default:
                baseStrike = Math.round(spotPrice / 50) * 50;
                strikeInterval = 50;
        }
        // For better liquidity, choose strikes that are slightly out-of-the-money (OTM)
        if (optionType === 'CE') {
            // For CE options, go 1 strike above ATM for better liquidity
            return baseStrike + strikeInterval;
        }
        else if (optionType === 'PE') {
            // For PE options, go 1 strike below ATM for better liquidity
            return baseStrike - strikeInterval;
        }
        return baseStrike; // Fallback to ATM if optionType is undefined
    }
    startOrderMonitoring() {
        // Check order status every 3 seconds for optimal balance of speed and safety
        this.monitoringInterval = setInterval(async () => {
            await this.checkOrderStatus();
        }, 3000);
        logger_1.logger.info('🔍 Order monitoring started - checking every 3 seconds (optimal mode)');
    }
    async checkOrderStatus() {
        if (this.activeOrders.length === 0)
            return;
        try {
            logger_1.logger.debug(`🔍 Checking ${this.activeOrders.length} active orders...`);
            // Separate real and paper trades
            const realTrades = this.activeOrders.filter(order => !order.isPaperTrade);
            const paperTrades = this.activeOrders.filter(order => order.isPaperTrade);
            if (paperTrades.length > 0) {
                logger_1.logger.debug(`📄 Paper trades: ${paperTrades.length} (real-time price monitoring)`);
                // Check paper trades for exits using real market prices
                for (const paperOrder of paperTrades) {
                    await this.checkPaperTradeExit(paperOrder);
                }
            }
            // Only check real API order/trade books for real trades
            if (realTrades.length === 0) {
                logger_1.logger.debug('📄 All trades are paper trades - skipping order/trade book API calls');
                return;
            }
            // REDUNDANT CHECK 1: Order Book - Get current order status
            const orderBookResponse = await angelAPI_1.angelAPI.getOrderBook();
            // REDUNDANT CHECK 2: Trade Book - Get all executed trades  
            const tradeBookResponse = await angelAPI_1.angelAPI.getTradeBook();
            if (!orderBookResponse?.data && !tradeBookResponse?.data) {
                logger_1.logger.warn('⚠️ Both order book and trade book failed - retrying...');
                return;
            }
            // Process only real trades
            for (const activeOrder of realTrades) {
                if (activeOrder.status === 'EXITED_TARGET' || activeOrder.status === 'EXITED_SL') {
                    continue; // Skip already processed exits
                }
                // METHOD 1: Check order book for status updates
                if (orderBookResponse?.data) {
                    const orderUpdate = orderBookResponse.data.find((order) => order.orderid === activeOrder.orderId);
                    if (orderUpdate) {
                        await this.processOrderUpdate(activeOrder, orderUpdate);
                    }
                }
                // METHOD 2: Directly check trade book for exits (more reliable)
                if (tradeBookResponse?.data) {
                    await this.checkForExitsInTradeBook(activeOrder, tradeBookResponse.data);
                }
                // METHOD 3: Individual order status check for critical orders
                if (activeOrder.status === 'FILLED') {
                    try {
                        const individualOrderStatus = await angelAPI_1.angelAPI.getOrderStatus(activeOrder.orderId);
                        if (individualOrderStatus?.data) {
                            await this.processIndividualOrderStatus(activeOrder, individualOrderStatus.data);
                        }
                    }
                    catch (error) {
                        logger_1.logger.debug(`Individual order check failed for ${activeOrder.orderId}:`, error.message);
                    }
                }
            }
        }
        catch (error) {
            const errorMessage = error.message;
            // Handle specific rate limiting errors
            if (errorMessage.includes('rate limit') || errorMessage.includes('429') || errorMessage.includes('Too Many Requests')) {
                logger_1.logger.warn('⚠️ API rate limit detected - backing off for one cycle');
                return; // Skip this cycle to avoid further rate limiting
            }
            logger_1.logger.error('CRITICAL: Order monitoring error:', errorMessage);
            logger_1.logger.error('Retrying order monitoring in next cycle...');
        }
    }
    async processOrderUpdate(activeOrder, orderData) {
        const previousStatus = activeOrder.status;
        const currentStatus = orderData.status?.toUpperCase();
        // Check if this is a new status change
        if (previousStatus === 'PLACED' && currentStatus === 'COMPLETE') {
            // Entry order filled
            activeOrder.status = 'FILLED';
            activeOrder.entryPrice = parseFloat(orderData.averageprice || orderData.price);
            logger_1.logger.info(`✅ Entry filled: ${activeOrder.signal.optionSymbol} @ ₹${activeOrder.entryPrice}`);
            // Send Telegram notification
            this.sendEntryNotification(activeOrder);
        }
        // Check for bracket order exits by looking at trade book (redundant check)
        await this.checkForExitsInTradeBook(activeOrder, []);
    }
    async checkForExitsInTradeBook(activeOrder, tradeBookData) {
        if (activeOrder.status !== 'FILLED')
            return;
        try {
            let trades = tradeBookData;
            // If no trade book data provided, fetch it
            if (!trades) {
                const tradeBookResponse = await angelAPI_1.angelAPI.getTradeBook();
                trades = tradeBookResponse?.data;
            }
            if (!trades)
                return;
            // Look for SELL trades of the same symbol after our entry with multiple criteria
            const exitTrades = trades.filter((trade) => {
                const isMatchingSymbol = trade.tradingsymbol === activeOrder.signal.optionSymbol;
                const isSellTrade = trade.transactiontype?.toUpperCase() === 'SELL';
                const isAfterEntry = new Date(trade.filltime || trade.exchangetime || trade.filltime) > activeOrder.timestamp;
                return isMatchingSymbol && isSellTrade && isAfterEntry;
            });
            if (exitTrades.length > 0) {
                // Sort by time to get the earliest exit
                exitTrades.sort((a, b) => new Date(a.filltime || a.exchangetime).getTime() - new Date(b.filltime || b.exchangetime).getTime());
                const exitTrade = exitTrades[0];
                const exitPrice = parseFloat(exitTrade.fillprice || exitTrade.price);
                const entryPrice = activeOrder.entryPrice || activeOrder.signal.entryPrice;
                // Prevent duplicate processing
                if (activeOrder.exitPrice) {
                    logger_1.logger.debug(`Exit already processed for ${activeOrder.signal.optionSymbol}`);
                    return;
                }
                // Calculate P&L
                const pnl = (exitPrice - entryPrice) * config_1.config.indices[activeOrder.signal.indexName].lotSize;
                // Determine exit reason with more sophisticated logic
                const targetDistance = Math.abs(exitPrice - activeOrder.signal.target);
                const slDistance = Math.abs(exitPrice - activeOrder.signal.stopLoss);
                const exitReason = targetDistance < slDistance ? 'TARGET' : 'STOPLOSS';
                // Update order status
                activeOrder.status = exitReason === 'TARGET' ? 'EXITED_TARGET' : 'EXITED_SL';
                activeOrder.exitPrice = exitPrice;
                activeOrder.exitReason = exitReason;
                activeOrder.pnl = pnl;
                // Update daily P&L
                this.dailyPnL += pnl;
                logger_1.logger.info(`🎯 EXIT DETECTED: ${activeOrder.signal.optionSymbol} @ ₹${exitPrice} - ${exitReason} - P&L: ₹${pnl.toFixed(2)}`);
                logger_1.logger.info(`📊 Trade Details: Entry=₹${entryPrice}, Exit=₹${exitPrice}, Qty=${config_1.config.indices[activeOrder.signal.indexName].lotSize}`);
                // Send exit notification immediately
                this.sendExitNotification(activeOrder);
            }
        }
        catch (error) {
            logger_1.logger.error('CRITICAL: Error checking for exits in trade book:', error.message);
        }
    }
    // Additional method for individual order status checking
    async processIndividualOrderStatus(activeOrder, orderData) {
        try {
            // Additional validation for bracket orders
            if (orderData.producttype === 'BO' && orderData.status?.toUpperCase() === 'COMPLETE') {
                logger_1.logger.debug(`🔍 Bracket order ${activeOrder.orderId} shows COMPLETE - double-checking exits`);
                // Force a trade book check for this specific order
                await this.checkForExitsInTradeBook(activeOrder, []);
            }
        }
        catch (error) {
            logger_1.logger.error('Error processing individual order status:', error.message);
        }
    }
    sendEntryNotification(order) {
        const tradeType = order.isPaperTrade ? '📄 PAPER TRADE' : '💰 REAL TRADE';
        const monitoringText = order.isPaperTrade ?
            '🎯 *Paper exits simulated automatically*' :
            '🤖 *Bracket exits are active - Angel One monitoring...*';
        const message = `
✅ *ENTRY EXECUTED* ${tradeType}
📈 *${order.signal.optionSymbol}*

*Entry Price:* ₹${order.entryPrice}
*Target:* ₹${order.signal.target}
*Stop Loss:* ₹${order.signal.stopLoss}
*Time:* ${new Date().toLocaleTimeString()}

${monitoringText}
    `.trim();
        process.emit('orderFilled', { order, message });
    }
    sendExitNotification(order) {
        const isProfit = order.exitReason === 'TARGET';
        const emoji = isProfit ? '🚀' : '🛑';
        const resultText = isProfit ? 'PROFIT BOOKED' : 'STOP LOSS HIT';
        const pnlColor = isProfit ? '💰' : '💸';
        const tradeType = order.isPaperTrade ? '📄 PAPER TRADE' : '💰 REAL TRADE';
        const message = `
${emoji} *${resultText}* ${tradeType}
📈 *${order.signal.optionSymbol}*

*Entry:* ₹${order.entryPrice}
*Exit:* ₹${order.exitPrice}
${pnlColor} *P&L:* ₹${order.pnl?.toFixed(2)}
*Exit Reason:* ${order.exitReason}
*Time:* ${new Date().toLocaleTimeString()}

📊 *Daily P&L:* ₹${this.dailyPnL.toFixed(2)}
    `.trim();
        logger_1.logger.info(`📱 Sending exit notification to Telegram`);
        process.emit('orderExited', { order, message });
    }
    getDailyStats() {
        return {
            trades: this.dailyTrades,
            activeOrders: this.activeOrders.length,
            pnl: this.dailyPnL
        };
    }
    async getDailyBalanceSummary() {
        try {
            let summary = `💰 *Daily Balance Summary*\n\n`;
            // Only fetch real balance data in real trading mode
            if (!config_1.config.trading.paperTrading) {
                const availableMargin = await angelAPI_1.angelAPI.getAvailableMargin();
                const fundsResponse = await angelAPI_1.angelAPI.getFunds();
                summary += `*Available Margin:* ₹${availableMargin.toFixed(2)}\n`;
                if (fundsResponse?.data) {
                    const data = fundsResponse.data;
                    if (data.net)
                        summary += `*Net Worth:* ₹${parseFloat(data.net).toFixed(2)}\n`;
                    if (data.utilisedamount)
                        summary += `*Utilised:* ₹${parseFloat(data.utilisedamount).toFixed(2)}\n`;
                    if (data.payin)
                        summary += `*Total Fund:* ₹${parseFloat(data.payin).toFixed(2)}\n`;
                }
            }
            else {
                summary += `📄 *Paper Trading Mode*\n`;
                summary += `*Virtual Balance:* Unlimited\n`;
                summary += `*No real funds used*\n`;
            }
            summary += `\n📊 *Trading Stats:*\n`;
            summary += `*Daily Trades:* ${this.dailyTrades}\n`;
            summary += `*Daily P&L:* ₹${this.dailyPnL.toFixed(2)} ${config_1.config.trading.paperTrading ? '(virtual)' : '(real)'}\n`;
            summary += `*Active Orders:* ${this.activeOrders.length}\n`;
            summary += `*Trading Mode:* ${config_1.config.trading.paperTrading ? '📄 Paper' : '💰 Real'}\n`;
            return summary;
        }
        catch (error) {
            logger_1.logger.error('Failed to get balance summary:', error.message);
            return `⚠️ *Balance Summary Unavailable*\n\nCould not fetch account balance.\nPlease check API connection.`;
        }
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
            const order = this.activeOrders[orderIndex];
            // Handle paper trade cancellation
            if (order.isPaperTrade) {
                order.status = 'CANCELLED';
                logger_1.logger.info(`📄 Paper order ${orderId} cancelled successfully`);
                return true;
            }
            // Cancel real order via Angel API
            const response = await angelAPI_1.angelAPI.makeRequest('/rest/secure/angelbroking/order/v1/cancelOrder', 'POST', { orderid: orderId });
            if (response.status) {
                order.status = 'CANCELLED';
                logger_1.logger.info(`💰 Real order ${orderId} cancelled successfully`);
                return true;
            }
            else {
                logger_1.logger.error(`Order cancellation failed: ${response.message}`);
                return false;
            }
        }
        catch (error) {
            logger_1.logger.error('CRITICAL: Order cancellation failed:', error.message);
            return false;
        }
    }
    async checkSufficientBalance(signal) {
        try {
            logger_1.logger.info('💰 Checking account balance before placing order...');
            // Get current available margin
            const availableMargin = await angelAPI_1.angelAPI.getAvailableMargin();
            // Estimate required margin for the option order
            // For options, margin is typically 10-20% of the option premium × lot size
            // We'll use a conservative estimate of option premium × lot size × 0.2 (20%)
            const lotSize = config_1.config.indices[signal.indexName].lotSize;
            const estimatedMarginRequired = signal.entryPrice * lotSize * 0.2; // 20% margin requirement
            logger_1.logger.info(`📊 Balance Check:`);
            logger_1.logger.info(`   Available Margin: ₹${availableMargin.toFixed(2)}`);
            logger_1.logger.info(`   Estimated Required: ₹${estimatedMarginRequired.toFixed(2)}`);
            logger_1.logger.info(`   Option Premium: ₹${signal.entryPrice} × ${lotSize} lots`);
            if (availableMargin >= estimatedMarginRequired) {
                logger_1.logger.info('✅ Sufficient balance available for order');
                return true;
            }
            else {
                logger_1.logger.error('❌ Insufficient balance for order');
                logger_1.logger.error(`   Shortfall: ₹${(estimatedMarginRequired - availableMargin).toFixed(2)}`);
                return false;
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to check balance:', error.message);
            logger_1.logger.warn('⚠️ Proceeding without balance check due to API error');
            return true; // Proceed if balance check fails (API might be down temporarily)
        }
    }
    generatePaperOrderId() {
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 1000);
        return `PAPER_${timestamp}_${random}`;
    }
    async simulateOrderFill(orderId, signal) {
        try {
            const orderIndex = this.activeOrders.findIndex(order => order.orderId === orderId);
            if (orderIndex === -1)
                return;
            const order = this.activeOrders[orderIndex];
            // Use real entry price from signal - no simulation needed
            order.status = 'FILLED';
            order.entryPrice = signal.entryPrice;
            logger_1.logger.info(`📄 Paper order filled: ${signal.optionSymbol} @ ₹${signal.entryPrice.toFixed(2)} (real price)`);
            // Send entry notification
            this.sendEntryNotification(order);
            // Paper trades now use real-time price monitoring like real trades
            logger_1.logger.info(`📄 Paper trade will exit when real market price hits target/SL`);
        }
        catch (error) {
            logger_1.logger.error('Paper order fill simulation failed:', error.message);
        }
    }
    async checkPaperTradeExit(activeOrder) {
        if (!activeOrder.isPaperTrade || activeOrder.status !== 'FILLED')
            return;
        try {
            // Get real-time option price from Angel One API
            const expiry = this.generateExpiryString();
            // Use optimal strike calculation for consistency with strategy
            const strike = this.calculateOptimalStrike(activeOrder.signal.spotPrice, activeOrder.signal.indexName, activeOrder.signal.optionType);
            const symbolToken = await angelAPI_1.angelAPI.getOptionToken(activeOrder.signal.indexName, strike, activeOrder.signal.optionType, expiry);
            if (!symbolToken) {
                logger_1.logger.debug(`Could not get symbol token for ${activeOrder.signal.optionSymbol} - skipping price check`);
                return;
            }
            const currentPrice = await angelAPI_1.angelAPI.getOptionPrice(activeOrder.signal.optionSymbol, symbolToken);
            if (!currentPrice) {
                logger_1.logger.debug(`Could not get current price for ${activeOrder.signal.optionSymbol} - skipping exit check`);
                return;
            }
            const target = activeOrder.signal.target;
            const stopLoss = activeOrder.signal.stopLoss;
            const entryPrice = activeOrder.entryPrice || activeOrder.signal.entryPrice;
            // Check if current market price hit target or stop loss
            let shouldExit = false;
            let exitPrice = 0;
            let exitReason = 'TARGET';
            if (currentPrice >= target) {
                // Target hit
                shouldExit = true;
                exitPrice = target;
                exitReason = 'TARGET';
            }
            else if (currentPrice <= stopLoss) {
                // Stop loss hit
                shouldExit = true;
                exitPrice = stopLoss;
                exitReason = 'STOPLOSS';
            }
            if (shouldExit) {
                // Prevent duplicate processing
                if (activeOrder.exitPrice) {
                    logger_1.logger.debug(`Exit already processed for ${activeOrder.signal.optionSymbol}`);
                    return;
                }
                // Calculate P&L
                const pnl = (exitPrice - entryPrice) * config_1.config.indices[activeOrder.signal.indexName].lotSize;
                // Update order status
                activeOrder.status = exitReason === 'TARGET' ? 'EXITED_TARGET' : 'EXITED_SL';
                activeOrder.exitPrice = exitPrice;
                activeOrder.exitReason = exitReason;
                activeOrder.pnl = pnl;
                // Update daily P&L
                this.dailyPnL += pnl;
                logger_1.logger.info(`📄 Paper exit by real market price: ${activeOrder.signal.optionSymbol} @ ₹${exitPrice.toFixed(2)} (market: ₹${currentPrice.toFixed(2)}) - ${exitReason} - P&L: ₹${pnl.toFixed(2)}`);
                // Send exit notification
                this.sendExitNotification(activeOrder);
            }
            else {
                logger_1.logger.debug(`📄 ${activeOrder.signal.optionSymbol}: Current ₹${currentPrice.toFixed(2)} (Target: ₹${target}, SL: ₹${stopLoss})`);
            }
        }
        catch (error) {
            logger_1.logger.debug(`Paper trade exit check failed for ${activeOrder.signal.optionSymbol}:`, error.message);
        }
    }
    updatePnL(amount) {
        this.dailyPnL += amount;
    }
    getStrategyName(confidence) {
        if (confidence >= 90)
            return 'Multi-Timeframe Confluence';
        if (confidence >= 80)
            return 'Bollinger+RSI';
        return 'Price Action+Momentum';
    }
    resetDailyStats() {
        this.dailyTrades = 0;
        this.dailyPnL = 0;
        this.activeOrders = [];
        logger_1.logger.info('📊 Daily stats reset - ready for new trading session');
    }
    stopMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
            logger_1.logger.info('🔍 Order monitoring stopped');
        }
    }
}
exports.orderService = new OrderService();
//# sourceMappingURL=orderService.js.map