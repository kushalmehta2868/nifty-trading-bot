import { angelAPI } from './angelAPI';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { TradingSignal, OrderDetails, OrderResponse } from '../types';

interface ActiveOrder {
  signal: TradingSignal;
  orderId: string;
  status: 'PLACED' | 'FILLED' | 'CANCELLED' | 'REJECTED' | 'EXITED_TARGET' | 'EXITED_SL';
  timestamp: Date;
  entryPrice?: number;
  exitPrice?: number;
  exitReason?: 'TARGET' | 'STOPLOSS' | 'MANUAL';
  pnl?: number;
  isPaperTrade?: boolean; // Track paper vs real trades
}

interface OrderResult {
  success: boolean;
  orderId: string;
  price: number;
  quantity: number;
}

interface DailyStats {
  trades: number;
  activeOrders: number;
  pnl: number;
}

class OrderService {
  private activeOrders: ActiveOrder[] = [];
  private dailyTrades = 0;
  private dailyPnL = 0;
  private monitoringInterval: NodeJS.Timeout | null = null;

  public async initialize(): Promise<void> {
    // Listen for trading signals to place orders
    (process as any).on('tradingSignal', async (signal: TradingSignal) => {
      if (config.trading.autoTrade) {
        await this.processSignal(signal);
      }
    });

    // Start monitoring active orders
    this.startOrderMonitoring();

    logger.info('📋 Order service initialized with order monitoring');
  }

  private async processSignal(signal: TradingSignal): Promise<void> {
    try {
      if (this.dailyTrades >= config.trading.maxPositions) {
        logger.warn('Daily position limit reached, skipping order');
        return;
      }

      logger.info(`🔄 Processing order for ${signal.optionSymbol}`);

      // Check available balance only for real trading
      if (!config.trading.paperTrading) {
        const hasBalance = await this.checkSufficientBalance(signal);
        if (!hasBalance) {
          logger.error('❌ Insufficient balance to place order - skipping signal');
          (process as any).emit('balanceInsufficient', {
            signal,
            message: `⚠️ *INSUFFICIENT BALANCE*\n📈 *${signal.optionSymbol}*\n\n❌ Cannot place order - insufficient funds\n💰 Please add margin to continue trading`
          });
          return;
        }
      } else {
        logger.info('📄 Paper trading mode - skipping balance check');
      }

      // Place order (real or paper trading)
      if (config.trading.paperTrading) {
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
        logger.info(`📄 Paper order simulated: ${signal.optionSymbol} - Paper Order ID: ${paperOrderId}`);
        
        // Fill paper order immediately (no artificial delays)
        setTimeout(() => {
          this.simulateOrderFill(paperOrderId, signal);
        }, 100); // Minimal delay for async processing
        
        // Send paper confirmation to Telegram
        (process as any).emit('orderPlaced', { 
          signal, 
          orderId: paperOrderId,
          isPaperTrade: true
        });
      } else {
        // Real Trading Mode
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
          logger.info(`✅ Real order placed: ${signal.optionSymbol} - Order ID: ${orderResponse.data.orderid}`);

          // Send confirmation to Telegram
          (process as any).emit('orderPlaced', { signal, orderId: orderResponse.data.orderid });
        } else {
          logger.error(`Order placement failed: ${orderResponse.message}`);
          throw new Error(`Order failed: ${orderResponse.message}`);
        }
      }

    } catch (error) {
      logger.error('Order processing failed:', (error as Error).message);
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
  private async placeRealOrder(signal: TradingSignal): Promise<OrderResponse> {
    try {
      logger.info(`Placing Bracket Order for ${signal.optionSymbol}`);

      // Get option symbol token (required for Angel API)
      const expiry = this.generateExpiryString();
      const strike = this.calculateStrike(signal.spotPrice, signal.indexName);

      const symbolToken = await angelAPI.getOptionToken(
        signal.indexName,
        strike,
        signal.optionType,
        expiry
      );

      if (!symbolToken) {
        logger.error(`CRITICAL: Could not get symbol token for ${signal.optionSymbol}`);
        throw new Error('Symbol token lookup failed');
      }

      const orderDetails: OrderDetails = {
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
        quantity: config.indices[signal.indexName].lotSize.toString()
      };

      logger.info(`📋 Bracket Order Details:`, {
        Symbol: orderDetails.tradingsymbol,
        Type: 'BUY Options',
        Quantity: orderDetails.quantity,
        Target: `₹${orderDetails.squareoff}`,
        StopLoss: `₹${orderDetails.stoploss}`,
        OrderType: 'MARKET (Immediate execution)'
      });

      logger.info(`🎯 Automatic Exit Strategy:
        - Target: ₹${signal.target} (${((signal.target / signal.entryPrice - 1) * 100).toFixed(1)}% profit)
        - Stop Loss: ₹${signal.stopLoss} (${((1 - signal.stopLoss / signal.entryPrice) * 100).toFixed(1)}% loss)
        - Angel One will automatically execute SELL orders when target/SL is hit`);

      // Call the actual Angel API
      const response = await angelAPI.makeRequest(
        '/rest/secure/angelbroking/order/v1/placeOrder',
        'POST',
        orderDetails
      );

      if (response.status) {
        logger.info(`✅ Bracket Order placed successfully - Angel One will handle exit automatically`);
      }

      logger.info(`Angel API Response:`, response);
      return response;

    } catch (error) {
      logger.error('CRITICAL: Real order placement failed:', (error as Error).message);
      throw error;
    }
  }

  private generateExpiryString(): string {
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

  private calculateStrike(spotPrice: number, indexName: string): number {
    const roundTo = indexName === 'BANKNIFTY' ? 100 : 50;
    return Math.round(spotPrice / roundTo) * roundTo;
  }

  private startOrderMonitoring(): void {
    // Check order status every 3 seconds for optimal balance of speed and safety
    this.monitoringInterval = setInterval(async () => {
      await this.checkOrderStatus();
    }, 3000);

    logger.info('🔍 Order monitoring started - checking every 3 seconds (optimal mode)');
  }

  private async checkOrderStatus(): Promise<void> {
    if (this.activeOrders.length === 0) return;

    try {
      logger.debug(`🔍 Checking ${this.activeOrders.length} active orders...`);

      // Separate real and paper trades
      const realTrades = this.activeOrders.filter(order => !order.isPaperTrade);
      const paperTrades = this.activeOrders.filter(order => order.isPaperTrade);

      if (paperTrades.length > 0) {
        logger.debug(`📄 Paper trades: ${paperTrades.length} (real-time price monitoring)`);
        
        // Check paper trades for exits using real market prices
        for (const paperOrder of paperTrades) {
          await this.checkPaperTradeExit(paperOrder);
        }
      }

      // Only check real API order/trade books for real trades
      if (realTrades.length === 0) {
        logger.debug('📄 All trades are paper trades - skipping order/trade book API calls');
        return;
      }

      // REDUNDANT CHECK 1: Order Book - Get current order status
      const orderBookResponse = await angelAPI.getOrderBook();

      // REDUNDANT CHECK 2: Trade Book - Get all executed trades  
      const tradeBookResponse = await angelAPI.getTradeBook();

      if (!orderBookResponse?.data && !tradeBookResponse?.data) {
        logger.warn('⚠️ Both order book and trade book failed - retrying...');
        return;
      }

      // Process only real trades
      for (const activeOrder of realTrades) {
        if (activeOrder.status === 'EXITED_TARGET' || activeOrder.status === 'EXITED_SL') {
          continue; // Skip already processed exits
        }

        // METHOD 1: Check order book for status updates
        if (orderBookResponse?.data) {
          const orderUpdate = orderBookResponse.data.find((order: any) =>
            order.orderid === activeOrder.orderId
          );

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
            const individualOrderStatus = await angelAPI.getOrderStatus(activeOrder.orderId);
            if (individualOrderStatus?.data) {
              await this.processIndividualOrderStatus(activeOrder, individualOrderStatus.data);
            }
          } catch (error) {
            logger.debug(`Individual order check failed for ${activeOrder.orderId}:`, (error as Error).message);
          }
        }
      }
    } catch (error) {
      const errorMessage = (error as Error).message;

      // Handle specific rate limiting errors
      if (errorMessage.includes('rate limit') || errorMessage.includes('429') || errorMessage.includes('Too Many Requests')) {
        logger.warn('⚠️ API rate limit detected - backing off for one cycle');
        return; // Skip this cycle to avoid further rate limiting
      }

      logger.error('CRITICAL: Order monitoring error:', errorMessage);
      logger.error('Retrying order monitoring in next cycle...');
    }
  }

  private async processOrderUpdate(activeOrder: ActiveOrder, orderData: any): Promise<void> {
    const previousStatus = activeOrder.status;
    const currentStatus = orderData.status?.toUpperCase();

    // Check if this is a new status change
    if (previousStatus === 'PLACED' && currentStatus === 'COMPLETE') {
      // Entry order filled
      activeOrder.status = 'FILLED';
      activeOrder.entryPrice = parseFloat(orderData.averageprice || orderData.price);

      logger.info(`✅ Entry filled: ${activeOrder.signal.optionSymbol} @ ₹${activeOrder.entryPrice}`);

      // Send Telegram notification
      this.sendEntryNotification(activeOrder);
    }

    // Check for bracket order exits by looking at trade book (redundant check)
    await this.checkForExitsInTradeBook(activeOrder, []);
  }

  private async checkForExitsInTradeBook(activeOrder: ActiveOrder, tradeBookData?: any[]): Promise<void> {
    if (activeOrder.status !== 'FILLED') return;

    try {
      let trades = tradeBookData;

      // If no trade book data provided, fetch it
      if (!trades) {
        const tradeBookResponse = await angelAPI.getTradeBook();
        trades = tradeBookResponse?.data;
      }

      if (!trades) return;

      // Look for SELL trades of the same symbol after our entry with multiple criteria
      const exitTrades = trades.filter((trade: any) => {
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
          logger.debug(`Exit already processed for ${activeOrder.signal.optionSymbol}`);
          return;
        }

        // Calculate P&L
        const pnl = (exitPrice - entryPrice) * config.indices[activeOrder.signal.indexName].lotSize;

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

        logger.info(`🎯 EXIT DETECTED: ${activeOrder.signal.optionSymbol} @ ₹${exitPrice} - ${exitReason} - P&L: ₹${pnl.toFixed(2)}`);
        logger.info(`📊 Trade Details: Entry=₹${entryPrice}, Exit=₹${exitPrice}, Qty=${config.indices[activeOrder.signal.indexName].lotSize}`);

        // Send exit notification immediately
        this.sendExitNotification(activeOrder);
      }
    } catch (error) {
      logger.error('CRITICAL: Error checking for exits in trade book:', (error as Error).message);
    }
  }

  // Additional method for individual order status checking
  private async processIndividualOrderStatus(activeOrder: ActiveOrder, orderData: any): Promise<void> {
    try {
      // Additional validation for bracket orders
      if (orderData.producttype === 'BO' && orderData.status?.toUpperCase() === 'COMPLETE') {
        logger.debug(`🔍 Bracket order ${activeOrder.orderId} shows COMPLETE - double-checking exits`);

        // Force a trade book check for this specific order
        await this.checkForExitsInTradeBook(activeOrder, []);
      }
    } catch (error) {
      logger.error('Error processing individual order status:', (error as Error).message);
    }
  }

  private sendEntryNotification(order: ActiveOrder): void {
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

    (process as any).emit('orderFilled', { order, message });
  }

  private sendExitNotification(order: ActiveOrder): void {
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

    logger.info(`📱 Sending exit notification to Telegram`);
    (process as any).emit('orderExited', { order, message });
  }

  public getDailyStats(): DailyStats {
    return {
      trades: this.dailyTrades,
      activeOrders: this.activeOrders.length,
      pnl: this.dailyPnL
    };
  }

  public async getDailyBalanceSummary(): Promise<string> {
    try {
      let summary = `💰 *Daily Balance Summary*\n\n`;
      
      // Only fetch real balance data in real trading mode
      if (!config.trading.paperTrading) {
        const availableMargin = await angelAPI.getAvailableMargin();
        const fundsResponse = await angelAPI.getFunds();
        
        summary += `*Available Margin:* ₹${availableMargin.toFixed(2)}\n`;
        
        if (fundsResponse?.data) {
          const data = fundsResponse.data;
          if (data.net) summary += `*Net Worth:* ₹${parseFloat(data.net).toFixed(2)}\n`;
          if (data.utilisedamount) summary += `*Utilised:* ₹${parseFloat(data.utilisedamount).toFixed(2)}\n`;
          if (data.payin) summary += `*Total Fund:* ₹${parseFloat(data.payin).toFixed(2)}\n`;
        }
      } else {
        summary += `📄 *Paper Trading Mode*\n`;
        summary += `*Virtual Balance:* Unlimited\n`;
        summary += `*No real funds used*\n`;
      }

      summary += `\n📊 *Trading Stats:*\n`;
      summary += `*Daily Trades:* ${this.dailyTrades}\n`;
      summary += `*Daily P&L:* ₹${this.dailyPnL.toFixed(2)} ${config.trading.paperTrading ? '(virtual)' : '(real)'}\n`;
      summary += `*Active Orders:* ${this.activeOrders.length}\n`;
      summary += `*Trading Mode:* ${config.trading.paperTrading ? '📄 Paper' : '💰 Real'}\n`;

      return summary;
    } catch (error) {
      logger.error('Failed to get balance summary:', (error as Error).message);
      return `⚠️ *Balance Summary Unavailable*\n\nCould not fetch account balance.\nPlease check API connection.`;
    }
  }

  public getActiveOrders(): ActiveOrder[] {
    return [...this.activeOrders];
  }

  public async cancelOrder(orderId: string): Promise<boolean> {
    try {
      const orderIndex = this.activeOrders.findIndex(order => order.orderId === orderId);

      if (orderIndex === -1) {
        logger.error(`Order ${orderId} not found`);
        return false;
      }

      const order = this.activeOrders[orderIndex];

      // Handle paper trade cancellation
      if (order.isPaperTrade) {
        order.status = 'CANCELLED';
        logger.info(`📄 Paper order ${orderId} cancelled successfully`);
        return true;
      }

      // Cancel real order via Angel API
      const response = await angelAPI.makeRequest(
        '/rest/secure/angelbroking/order/v1/cancelOrder',
        'POST',
        { orderid: orderId }
      );

      if (response.status) {
        order.status = 'CANCELLED';
        logger.info(`💰 Real order ${orderId} cancelled successfully`);
        return true;
      } else {
        logger.error(`Order cancellation failed: ${response.message}`);
        return false;
      }

    } catch (error) {
      logger.error('CRITICAL: Order cancellation failed:', (error as Error).message);
      return false;
    }
  }

  private async checkSufficientBalance(signal: TradingSignal): Promise<boolean> {
    try {
      logger.info('💰 Checking account balance before placing order...');

      // Get current available margin
      const availableMargin = await angelAPI.getAvailableMargin();

      // Estimate required margin for the option order
      // For options, margin is typically 10-20% of the option premium × lot size
      // We'll use a conservative estimate of option premium × lot size × 0.2 (20%)
      const lotSize = config.indices[signal.indexName].lotSize;
      const estimatedMarginRequired = signal.entryPrice * lotSize * 0.2; // 20% margin requirement

      logger.info(`📊 Balance Check:`);
      logger.info(`   Available Margin: ₹${availableMargin.toFixed(2)}`);
      logger.info(`   Estimated Required: ₹${estimatedMarginRequired.toFixed(2)}`);
      logger.info(`   Option Premium: ₹${signal.entryPrice} × ${lotSize} lots`);

      if (availableMargin >= estimatedMarginRequired) {
        logger.info('✅ Sufficient balance available for order');
        return true;
      } else {
        logger.error('❌ Insufficient balance for order');
        logger.error(`   Shortfall: ₹${(estimatedMarginRequired - availableMargin).toFixed(2)}`);
        return false;
      }

    } catch (error) {
      logger.error('Failed to check balance:', (error as Error).message);
      logger.warn('⚠️ Proceeding without balance check due to API error');
      return true; // Proceed if balance check fails (API might be down temporarily)
    }
  }

  private generatePaperOrderId(): string {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000);
    return `PAPER_${timestamp}_${random}`;
  }

  private async simulateOrderFill(orderId: string, signal: TradingSignal): Promise<void> {
    try {
      const orderIndex = this.activeOrders.findIndex(order => order.orderId === orderId);
      if (orderIndex === -1) return;

      const order = this.activeOrders[orderIndex];
      
      // Use real entry price from signal - no simulation needed
      order.status = 'FILLED';
      order.entryPrice = signal.entryPrice;
      
      logger.info(`📄 Paper order filled: ${signal.optionSymbol} @ ₹${signal.entryPrice.toFixed(2)} (real price)`);
      
      // Send entry notification
      this.sendEntryNotification(order);
      
      // Paper trades now use real-time price monitoring like real trades
      logger.info(`📄 Paper trade will exit when real market price hits target/SL`);
      
    } catch (error) {
      logger.error('Paper order fill simulation failed:', (error as Error).message);
    }
  }

  private async checkPaperTradeExit(activeOrder: ActiveOrder): Promise<void> {
    if (!activeOrder.isPaperTrade || activeOrder.status !== 'FILLED') return;

    try {
      // Get real-time option price from Angel One API
      const expiry = this.generateExpiryString();
      const strike = this.calculateStrike(activeOrder.signal.spotPrice, activeOrder.signal.indexName);
      
      const symbolToken = await angelAPI.getOptionToken(
        activeOrder.signal.indexName,
        strike,
        activeOrder.signal.optionType,
        expiry
      );

      if (!symbolToken) {
        logger.debug(`Could not get symbol token for ${activeOrder.signal.optionSymbol} - skipping price check`);
        return;
      }

      const currentPrice = await angelAPI.getOptionPrice(activeOrder.signal.optionSymbol, symbolToken);
      
      if (!currentPrice) {
        logger.debug(`Could not get current price for ${activeOrder.signal.optionSymbol} - skipping exit check`);
        return;
      }

      const target = activeOrder.signal.target;
      const stopLoss = activeOrder.signal.stopLoss;
      const entryPrice = activeOrder.entryPrice || activeOrder.signal.entryPrice;

      // Check if current market price hit target or stop loss
      let shouldExit = false;
      let exitPrice: number = 0;
      let exitReason: 'TARGET' | 'STOPLOSS' = 'TARGET';

      if (currentPrice >= target) {
        // Target hit
        shouldExit = true;
        exitPrice = target;
        exitReason = 'TARGET';
      } else if (currentPrice <= stopLoss) {
        // Stop loss hit
        shouldExit = true;
        exitPrice = stopLoss;
        exitReason = 'STOPLOSS';
      }

      if (shouldExit) {
        // Prevent duplicate processing
        if (activeOrder.exitPrice) {
          logger.debug(`Exit already processed for ${activeOrder.signal.optionSymbol}`);
          return;
        }

        // Calculate P&L
        const pnl = (exitPrice - entryPrice) * config.indices[activeOrder.signal.indexName].lotSize;

        // Update order status
        activeOrder.status = exitReason === 'TARGET' ? 'EXITED_TARGET' : 'EXITED_SL';
        activeOrder.exitPrice = exitPrice;
        activeOrder.exitReason = exitReason;
        activeOrder.pnl = pnl;

        // Update daily P&L
        this.dailyPnL += pnl;

        logger.info(`📄 Paper exit by real market price: ${activeOrder.signal.optionSymbol} @ ₹${exitPrice.toFixed(2)} (market: ₹${currentPrice.toFixed(2)}) - ${exitReason} - P&L: ₹${pnl.toFixed(2)}`);

        // Send exit notification
        this.sendExitNotification(activeOrder);
      } else {
        logger.debug(`📄 ${activeOrder.signal.optionSymbol}: Current ₹${currentPrice.toFixed(2)} (Target: ₹${target}, SL: ₹${stopLoss})`);
      }

    } catch (error) {
      logger.debug(`Paper trade exit check failed for ${activeOrder.signal.optionSymbol}:`, (error as Error).message);
    }
  }

  public updatePnL(amount: number): void {
    this.dailyPnL += amount;
  }

  public resetDailyStats(): void {
    this.dailyTrades = 0;
    this.dailyPnL = 0;
    this.activeOrders = [];
    logger.info('Daily stats reset');
  }

  public stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      logger.info('🔍 Order monitoring stopped');
    }
  }
}

export const orderService = new OrderService();