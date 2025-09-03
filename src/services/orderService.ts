import { angelAPI } from './angelAPI';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { TradingSignal, OrderDetails, OrderResponse, OptionType } from '../types';

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
  private tradingSignalHandler?: (signal: TradingSignal) => Promise<void>;

  public async initialize(): Promise<void> {
    // Store the handler reference for cleanup
    this.tradingSignalHandler = async (signal: TradingSignal) => {
      if (config.trading.autoTrade) {
        await this.processSignal(signal);
      }
    };
    
    // Listen for trading signals to place orders
    (process as any).on('tradingSignal', this.tradingSignalHandler);

    // Start monitoring active orders
    this.startOrderMonitoring();

    logger.info('📋 Order service initialized with order monitoring');
  }

  private async processSignal(signal: TradingSignal): Promise<void> {
    try {
      logger.info(`🎯 SIGNAL RECEIVED: ${signal.indexName} ${signal.optionType} | Confidence: ${signal.confidence.toFixed(1)}% | Strategy: ${this.getStrategyName(signal.confidence)}`);
      
      if (this.dailyTrades >= config.trading.maxPositions) {
        logger.warn(`❌ Daily position limit reached (${this.dailyTrades}/${config.trading.maxPositions}) - skipping order`);
        return;
      }

      // ✅ CHECK FOR EXISTING ACTIVE POSITIONS IN SAME INDEX (only truly active orders)
      const existingPosition = this.activeOrders.find(order => 
        order.signal.indexName === signal.indexName && 
        (order.status === 'PLACED' || order.status === 'FILLED')
      );

      // Log detailed check for debugging
      logger.info(`🔍 Position check for ${signal.indexName}:`);
      logger.info(`   Total orders in array: ${this.activeOrders.length}`);
      const indexOrders = this.activeOrders.filter(order => order.signal.indexName === signal.indexName);
      logger.info(`   Orders for ${signal.indexName}: ${indexOrders.length}`);
      indexOrders.forEach(order => {
        logger.info(`     Order ${order.orderId}: ${order.status} (${order.signal.optionType})`);
      });
      logger.info(`   Existing active position found: ${existingPosition ? 'YES' : 'NO'}`);

      if (existingPosition) {
        logger.warn(`❌ POSITION CONFLICT: ${signal.indexName} ${signal.optionType} signal blocked`);
        logger.warn(`   Existing: ${existingPosition.signal.optionType} (${existingPosition.status}) - Order ID: ${existingPosition.orderId}`);
        logger.warn(`   📋 Rule: Only one position per index allowed at a time`);
        
        // Emit position blocked event to inform strategy
        (process as any).emit('positionBlocked', { 
          signal, 
          existingOrder: existingPosition,
          reason: 'INDEX_ALREADY_ACTIVE' 
        });
        
        return;
      }

      logger.info(`🔄 Processing ${config.trading.paperTrading ? 'PAPER' : 'REAL'} order for ${signal.optionSymbol}`);
      logger.info(`💰 Order Details: Entry=₹${signal.entryPrice} | Target=₹${signal.target} | SL=₹${signal.stopLoss}`);

      // Check available balance only for real trading
      if (!config.trading.paperTrading) {
        logger.info('💰 Checking account balance before real order placement...');
        const hasBalance = await this.checkSufficientBalance(signal);
        if (!hasBalance) {
          logger.error('❌ INSUFFICIENT BALANCE - Cannot place real order');
          (process as any).emit('balanceInsufficient', {
            signal,
            message: `🚨 *INSUFFICIENT BALANCE ALERT*\n📈 *${signal.optionSymbol}*\n\n❌ Cannot place order - insufficient margin\n💰 Required: ~₹${(signal.entryPrice * config.indices[signal.indexName].lotSize * 0.2).toFixed(0)}\n\n🔧 Please add margin to continue trading`
          });
          return;
        }
        logger.info('✅ Balance check passed - proceeding with real order');
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
        logger.info(`📄 PAPER ORDER PLACED: ${signal.optionSymbol} - Order ID: ${paperOrderId}`);
        logger.info(`📊 Paper Order Status: ${this.dailyTrades}/${config.trading.maxPositions} positions used`);
        logger.info(`📋 ADDED ORDER to active list: ${paperOrderId} (${signal.indexName}_${signal.optionType})`);
        logger.info(`📊 Active orders count: ${this.activeOrders.length} (after addition)`);
        
        // Fill paper order immediately (no artificial delays)
        setTimeout(() => {
          logger.info(`📄 Simulating instant fill for paper order: ${paperOrderId}`);
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
        logger.info('💰 Placing REAL BRACKET ORDER with Angel One...');
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
          logger.info(`✅ REAL BRACKET ORDER PLACED SUCCESSFULLY:`);
          logger.info(`   📋 Order ID: ${orderResponse.data.orderid}`);
          logger.info(`   📈 Symbol: ${signal.optionSymbol}`);
          logger.info(`   💰 Entry: ₹${signal.entryPrice} | Target: ₹${signal.target} | SL: ₹${signal.stopLoss}`);
          logger.info(`   📊 Position Status: ${this.dailyTrades}/${config.trading.maxPositions} real orders today`);
          logger.info(`   🤖 Angel One will automatically handle exits at target/SL levels`);
          logger.info(`📋 ADDED ORDER to active list: ${orderResponse.data.orderid} (${signal.indexName}_${signal.optionType})`);
          logger.info(`📊 Active orders count: ${this.activeOrders.length} (after addition)`);

          // Send confirmation to Telegram
          (process as any).emit('orderPlaced', { signal, orderId: orderResponse.data.orderid, isPaperTrade: false });
        } else {
          logger.error(`❌ REAL ORDER PLACEMENT FAILED:`);
          logger.error(`   📋 Response Status: ${orderResponse.status}`);
          logger.error(`   💬 Error Message: ${orderResponse.message}`);
          logger.error(`   📈 Signal: ${signal.optionSymbol}`);
          
          // Emit order rejection event to unlock position in strategy
          (process as any).emit('orderRejected', { signal, reason: orderResponse.message });
          
          throw new Error(`Real order failed: ${orderResponse.message}`);
        }
      }

    } catch (error) {
      logger.error('Order processing failed:', (error as Error).message);
      
      // Emit order failure event to unlock position in strategy
      (process as any).emit('orderFailed', { signal, reason: (error as Error).message });
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
      const expiry = this.generateExpiryString(signal.indexName);
      // ✅ CRITICAL FIX: Extract strike from signal's option symbol (already calculated with premium control)
      const strike = this.extractStrikeFromSymbol(signal.optionSymbol, signal.indexName);

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

  private generateExpiryString(indexName?: string): string {
    const today = new Date();
    
    if (indexName === 'BANKNIFTY') {
      // BANKNIFTY: Monthly expiry only (no weekly since Nov 2024)
      // Expiry: Last day of the month
      const currentMonth = today.getMonth();
      const currentYear = today.getFullYear();
      
      // Get last day of current month
      let lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0);
      
      // If last day of month is today or has passed, move to next month
      if (lastDayOfMonth <= today) {
        const nextMonth = currentMonth + 1;
        const nextYear = nextMonth > 11 ? currentYear + 1 : currentYear;
        const adjustedMonth = nextMonth > 11 ? 0 : nextMonth;
        
        lastDayOfMonth = new Date(nextYear, adjustedMonth + 1, 0);
      }
      
      const day = lastDayOfMonth.getDate().toString().padStart(2, '0');
      const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      const month = months[lastDayOfMonth.getMonth()];
      const year = lastDayOfMonth.getFullYear().toString().slice(-2);
      
      return `${day}${month}${year}`;
    } else {
      // NIFTY: Weekly expiry on Tuesday (changed from Thursday since Sept 1, 2025)
      const nextTuesday = new Date(today);
      const daysUntilTuesday = (2 - today.getDay() + 7) % 7; // 2 = Tuesday
      const adjustedDays = daysUntilTuesday === 0 ? 7 : daysUntilTuesday;
      nextTuesday.setDate(today.getDate() + adjustedDays);

      const day = nextTuesday.getDate().toString().padStart(2, '0');
      const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      const month = months[nextTuesday.getMonth()];
      const year = nextTuesday.getFullYear().toString().slice(-2);

      return `${day}${month}${year}`;
    }
  }

  private calculateStrike(spotPrice: number, indexName: string): number {
    const roundTo = indexName === 'BANKNIFTY' ? 100 : 50;
    return Math.round(spotPrice / roundTo) * roundTo;
  }

  // ✅ REMOVED: Old calculateOptimalStrike method - now using extractStrikeFromSymbol
  // Strike is calculated in strategy.ts with premium control and passed via signal.optionSymbol

  private startOrderMonitoring(): void {
    let cycleCount = 0;
    
    // Check order status every 3 seconds for optimal balance of speed and safety
    this.monitoringInterval = setInterval(async () => {
      cycleCount++;
      
      await this.checkOrderStatus();
      
      // Run stale order cleanup every 30 cycles (90 seconds)
      if (cycleCount % 30 === 0) {
        this.cleanupStaleOrders();
      }
      
      // Log detailed active orders status every 20 cycles (60 seconds)
      if (cycleCount % 20 === 0) {
        this.logActiveOrdersStatus();
      }
    }, 3000);

    logger.info('🔍 Order monitoring started - checking every 3s, logging every 60s, cleanup every 90s');
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

        // ✅ CRITICAL FIX: Remove completed order from activeOrders array
        this.removeOrderFromActiveList(activeOrder.orderId, 'EXIT_COMPLETED');
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
    const tradeType = order.isPaperTrade ? '📄' : '💰';
    
    const message = `
✅ *ENTRY* ${tradeType}
📈 ${order.signal.optionSymbol}
💰 Entry: ₹${order.entryPrice} | 🎯 Target: ₹${order.signal.target} | 🛑 SL: ₹${order.signal.stopLoss}
    `.trim();

    (process as any).emit('orderFilled', { order, message });
  }

  private sendExitNotification(order: ActiveOrder): void {
    const isProfit = order.exitReason === 'TARGET';
    const emoji = isProfit ? '🚀' : '🛑';
    const resultText = isProfit ? 'PROFIT' : 'STOPLOSS';
    const pnlColor = isProfit ? '💰' : '💸';
    const tradeType = order.isPaperTrade ? '📄' : '💰';

    const message = `
${emoji} *${resultText}* ${tradeType}
📈 ${order.signal.optionSymbol}
💰 Entry: ₹${order.entryPrice} | Exit: ₹${order.exitPrice}
${pnlColor} P&L: ₹${order.pnl?.toFixed(2)} | Daily: ₹${this.dailyPnL.toFixed(2)}
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

  // ✅ Helper method to extract strike price from option symbol (same as strategy)
  private extractStrikeFromSymbol(optionSymbol: string, indexName: string): number {
    try {
      // Format: NIFTY03SEP25024700CE or BANKNIFTY26SEP2552500PE
      // Remove index name and expiry to get strike+type
      const indexNameLength = indexName.length;
      const expiryLength = 7; // Format: 03SEP25
      const typeLength = 2; // CE or PE
      
      const symbolWithoutIndex = optionSymbol.substring(indexNameLength);
      const symbolWithoutExpiry = symbolWithoutIndex.substring(expiryLength);
      const strikeWithType = symbolWithoutExpiry.substring(0, symbolWithoutExpiry.length - typeLength);
      
      const extractedStrike = parseInt(strikeWithType);
      logger.info(`📋 Extracted strike ${extractedStrike} from ${optionSymbol}`);
      return extractedStrike;
    } catch (error) {
      logger.error(`Failed to extract strike from ${optionSymbol}, using fallback calculation`);
      // Fallback to ATM calculation
      const baseStrike = indexName === 'BANKNIFTY' ? 
        Math.round(25000 / 100) * 100 : 
        Math.round(25000 / 50) * 50;
      return baseStrike;
    }
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

  public logActiveOrdersStatus(): void {
    const timestamp = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
    
    logger.info(`📊 ACTIVE ORDERS STATUS @ ${timestamp}:`);
    logger.info(`   Total active orders: ${this.activeOrders.length}`);
    
    if (this.activeOrders.length === 0) {
      logger.info(`   ✅ No active orders - all positions available`);
      return;
    }
    
    // Group by index and status
    const byIndex: { [key: string]: ActiveOrder[] } = {};
    this.activeOrders.forEach(order => {
      const key = order.signal.indexName;
      if (!byIndex[key]) byIndex[key] = [];
      byIndex[key].push(order);
    });
    
    Object.keys(byIndex).forEach(indexName => {
      const orders = byIndex[indexName];
      logger.info(`   📈 ${indexName}: ${orders.length} orders`);
      
      orders.forEach(order => {
        const age = Math.floor((Date.now() - order.timestamp.getTime()) / 60000);
        logger.info(`      ${order.orderId}: ${order.status} (${order.signal.optionType}) - Age: ${age}min`);
      });
    });
    
    // Show which indices are blocked
    const blockedIndices = Object.keys(byIndex).filter(indexName => 
      byIndex[indexName].some(order => order.status === 'PLACED' || order.status === 'FILLED')
    );
    
    logger.info(`   🔒 BLOCKED indices: ${blockedIndices.length > 0 ? blockedIndices.join(', ') : 'None'}`);
    logger.info(`   🔓 AVAILABLE indices: ${['NIFTY', 'BANKNIFTY'].filter(i => !blockedIndices.includes(i)).join(', ') || 'None'}`);
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
        
        // Emit cancellation event to unlock position in strategy
        (process as any).emit('orderCancelled', { order });
        
        // ✅ CRITICAL FIX: Remove cancelled order from activeOrders array
        this.removeOrderFromActiveList(orderId, 'PAPER_CANCELLED');
        
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
        
        // Emit cancellation event to unlock position in strategy
        (process as any).emit('orderCancelled', { order });
        
        // ✅ CRITICAL FIX: Remove cancelled order from activeOrders array
        this.removeOrderFromActiveList(orderId, 'REAL_CANCELLED');
        
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
      const expiry = this.generateExpiryString(activeOrder.signal.indexName);
      // ✅ CRITICAL FIX: Extract strike from signal's option symbol (already calculated with premium control)
      const strike = this.extractStrikeFromSymbol(activeOrder.signal.optionSymbol, activeOrder.signal.indexName);
      
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
      
      if (!currentPrice || currentPrice <= 0) {
        // Enhanced logging for debugging paper trade exits
        const shouldLog = Date.now() % 60000 < 3000; // Log every 60 seconds
        if (shouldLog) {
          logger.warn(`📄 PAPER TRADE EXIT DEBUG: ${activeOrder.signal.optionSymbol}`);
          logger.warn(`   Symbol Token: ${symbolToken}`);
          logger.warn(`   Current Price: ${currentPrice} (invalid)`);
          logger.warn(`   Entry Price: ₹${activeOrder.entryPrice || activeOrder.signal.entryPrice}`);
          logger.warn(`   Target: ₹${activeOrder.signal.target} | SL: ₹${activeOrder.signal.stopLoss}`);
          logger.warn(`   ⚠️ Cannot exit - invalid price data`);
        }
        return;
      }
      
      // Additional validation - ensure current price is reasonable relative to entry price
      const entryPrice = activeOrder.entryPrice || activeOrder.signal.entryPrice;
      const priceRatio = currentPrice / entryPrice;
      
      if (priceRatio > 10 || priceRatio < 0.1) {
        logger.warn(`⚠️ Suspicious price ratio for ${activeOrder.signal.optionSymbol}: Current ₹${currentPrice} vs Entry ₹${entryPrice} (ratio: ${priceRatio.toFixed(2)}) - skipping exit check`);
        return;
      }

      const target = activeOrder.signal.target;
      const stopLoss = activeOrder.signal.stopLoss;

      // Check if current market price hit target or stop loss with realistic exit logic
      let shouldExit = false;
      let exitPrice: number = 0;
      let exitReason: 'TARGET' | 'STOPLOSS' = 'TARGET';

      // ✅ REALISTIC PAPER TRADING EXIT LOGIC
      if (currentPrice >= target) {
        // Target hit - exit at current market price with small slippage simulation
        shouldExit = true;
        const slippage = currentPrice * 0.001; // 0.1% slippage (slightly worse than target)
        exitPrice = Math.max(target, currentPrice - slippage); // Don't exit below target
        exitReason = 'TARGET';
        logger.info(`📄 Paper trade target hit: Current ₹${currentPrice} >= Target ₹${target}, Exit at ₹${exitPrice} (with slippage)`);
      } else if (currentPrice <= stopLoss) {
        // Stop loss hit - exit at current market price with slippage simulation
        shouldExit = true;
        const slippage = currentPrice * 0.002; // 0.2% slippage (worse execution on SL)
        exitPrice = Math.min(stopLoss, currentPrice - slippage); // Don't exit above stop loss
        exitReason = 'STOPLOSS';
        logger.info(`📄 Paper trade stop loss hit: Current ₹${currentPrice} <= SL ₹${stopLoss}, Exit at ₹${exitPrice} (with slippage)`);
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

        // ✅ CRITICAL FIX: Remove completed order from activeOrders array
        this.removeOrderFromActiveList(activeOrder.orderId, 'PAPER_EXIT_COMPLETED');
      } else {
        // Enhanced monitoring with exit readiness indicators
        const shouldLog = Date.now() % 30000 < 3000; // Log every 30 seconds
        if (shouldLog) {
          const targetDistance = ((currentPrice - target) / target * 100).toFixed(2);
          const slDistance = ((currentPrice - stopLoss) / stopLoss * 100).toFixed(2);
          const targetProgress = ((currentPrice - entryPrice) / (target - entryPrice) * 100).toFixed(1);
          const slProgress = ((entryPrice - currentPrice) / (entryPrice - stopLoss) * 100).toFixed(1);
          
          // Enhanced exit readiness indicators
          let status = '🔄 Monitoring';
          if (currentPrice >= target * 0.95) status = '🎯 Near Target (95%+)';
          else if (currentPrice >= target * 0.85) status = '🟡 Approaching Target (85%+)';
          else if (currentPrice <= stopLoss * 1.05) status = '🚨 Near Stop Loss (105%-)';
          else if (currentPrice <= stopLoss * 1.15) status = '🟠 Approaching SL (115%-)';
          
          logger.info(`📄 ${activeOrder.signal.optionSymbol}: ${status}`);
          logger.info(`   Current: ₹${currentPrice.toFixed(2)} | Target: ₹${target.toFixed(2)} (${targetDistance}%) | SL: ₹${stopLoss.toFixed(2)} (${slDistance}%)`);
          logger.info(`   Progress: Target ${targetProgress}% | SL Risk ${slProgress}%`);
          
          // Debug exit conditions
          if (currentPrice >= target) {
            logger.error(`🚨 BUG DETECTED: Current price (₹${currentPrice}) >= Target (₹${target}) but exit not triggered!`);
          }
          if (currentPrice <= stopLoss) {
            logger.error(`🚨 BUG DETECTED: Current price (₹${currentPrice}) <= Stop Loss (₹${stopLoss}) but exit not triggered!`);
          }
        }
      }

    } catch (error) {
      logger.debug(`Paper trade exit check failed for ${activeOrder.signal.optionSymbol}:`, (error as Error).message);
    }
  }

  public updatePnL(amount: number): void {
    this.dailyPnL += amount;
  }

  private getStrategyName(confidence: number): string {
    if (confidence >= 90) return 'Multi-Timeframe Confluence';
    if (confidence >= 80) return 'Bollinger+RSI';
    return 'Price Action+Momentum';
  }

  private removeOrderFromActiveList(orderId: string, reason: string): void {
    const orderIndex = this.activeOrders.findIndex(order => order.orderId === orderId);
    
    if (orderIndex !== -1) {
      const removedOrder = this.activeOrders[orderIndex];
      this.activeOrders.splice(orderIndex, 1);
      
      logger.info(`🗑️ REMOVED ORDER from active list: ${orderId} - ${reason}`);
      logger.info(`📊 Active orders count: ${this.activeOrders.length} (after removal)`);
      
      // Log detailed active orders status
      const remainingOrders = this.activeOrders.map(order => 
        `${order.signal.indexName}_${order.signal.optionType}:${order.status}`
      ).join(', ');
      
      logger.info(`📋 Remaining active orders: ${remainingOrders || 'None'}`);
    } else {
      logger.warn(`⚠️ Order ${orderId} not found in activeOrders list for removal (${reason})`);
    }
  }

  public cleanupStaleOrders(): void {
    const now = Date.now();
    const staleThreshold = 2 * 60 * 60 * 1000; // 2 hours
    
    const staleOrders = this.activeOrders.filter(order => {
      const orderAge = now - order.timestamp.getTime();
      return orderAge > staleThreshold && (order.status === 'PLACED' || order.status === 'FILLED');
    });
    
    if (staleOrders.length > 0) {
      logger.warn(`🧹 Found ${staleOrders.length} stale orders (>2 hours old):`);
      
      staleOrders.forEach(order => {
        logger.warn(`   Stale: ${order.orderId} (${order.signal.indexName}_${order.signal.optionType}) - Age: ${Math.floor((now - order.timestamp.getTime()) / 60000)} minutes`);
        
        // Force remove stale orders and emit exit event to unlock positions
        this.removeOrderFromActiveList(order.orderId, 'STALE_ORDER_CLEANUP');
        (process as any).emit('orderExited', { order: { signal: order.signal }, message: 'Stale order cleanup' });
      });
    } else {
      logger.info('✅ No stale orders found');
    }
  }

  public forceCleanActiveOrders(): void {
    logger.warn(`🔧 FORCE CLEANING ${this.activeOrders.length} active orders`);
    
    // Emit exit events for all remaining orders to unlock positions
    this.activeOrders.forEach(order => {
      logger.warn(`   Force removing: ${order.orderId} (${order.signal.indexName}_${order.signal.optionType}) - Status: ${order.status}`);
      (process as any).emit('orderExited', { order: { signal: order.signal }, message: 'Force cleanup' });
    });
    
    this.activeOrders = [];
    logger.info('🧹 All active orders force cleaned - positions unlocked');
  }

  public resetDailyStats(): void {
    this.dailyTrades = 0;
    this.dailyPnL = 0;
    this.activeOrders = [];
    logger.info('📊 Daily stats reset - ready for new trading session');
  }

  public stopMonitoring(): void {
    // Remove the event listener to prevent memory leak
    if (this.tradingSignalHandler) {
      (process as any).removeListener('tradingSignal', this.tradingSignalHandler);
    }
    
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      logger.info('🔍 Order monitoring stopped');
    }
  }
}

export const orderService = new OrderService();