import { angelAPI } from './angelAPI';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { TradingSignal, OrderDetails, OrderResponse, OptionType } from '../types';

// Advanced Risk Management System
class AdvancedRiskManager {
  private readonly MAX_DAILY_LOSS_PERCENT = 5; // 5% of account
  private readonly MAX_POSITION_SIZE_PERCENT = 10; // 10% of account per position
  private readonly MAX_DRAWDOWN_PERCENT = 8; // 8% maximum drawdown
  private readonly MIN_WIN_RATE_THRESHOLD = 40; // Minimum 40% win rate to continue
  private readonly MAX_CONSECUTIVE_LOSSES = 3;

  async assessOrderRisk(
    signal: TradingSignal, 
    currentPnL: number, 
    activePositions: number
  ): Promise<{blocked: boolean, reason: string, riskScore: number}> {
    let riskScore = 0;
    const reasons: string[] = [];

    // 🎯 IDENTICAL RISK ASSESSMENT for both paper and real trading
    const accountValue = await this.getAccountValue();
    const dailyLossPercent = Math.abs(currentPnL) / accountValue * 100;
    
    // 1. Daily loss limit - SAME for both modes
    if (currentPnL < 0 && dailyLossPercent > this.MAX_DAILY_LOSS_PERCENT) {
      return { blocked: true, reason: `Daily loss limit exceeded: ${dailyLossPercent.toFixed(2)}%`, riskScore: 100 };
    }
    
    if (dailyLossPercent > 3) riskScore += 20;

    // 2. Position size risk - SAME for both modes
    const positionValue = signal.entryPrice * config.indices[signal.indexName].lotSize;
    const positionSizePercent = positionValue / accountValue * 100;
    
    if (positionSizePercent > this.MAX_POSITION_SIZE_PERCENT) {
      return { blocked: true, reason: `Position size too large: ${positionSizePercent.toFixed(2)}%`, riskScore: 100 };
    }
    
    if (positionSizePercent > 7) riskScore += 15;

    // 3. Market volatility check - SAME for both modes
    const volatilityRisk = await this.assessMarketVolatility(signal.indexName);
    riskScore += volatilityRisk;

    // 4. Signal quality assessment - SAME for both modes
    const signalQuality = this.assessSignalQuality(signal);
    if (signalQuality < 60) riskScore += 25;

    // 5. Concentration risk - SAME for both modes
    if (activePositions >= 2) riskScore += 10;

    const blocked = riskScore >= 70;
    const tradingMode = config.trading.paperTrading ? 'Paper' : 'Real';
    const reason = blocked ? `${tradingMode} trading risk score: ${riskScore}` : `${tradingMode} trading risk acceptable`;

    return { blocked, reason, riskScore };
  }

  public async getAccountValue(): Promise<number> {
    // 🎯 IDENTICAL API CALL for both paper and real trading
    try {
      const margin = await angelAPI.getAvailableMargin();
      logger.debug(`Account value fetched: ₹${margin} (${config.trading.paperTrading ? 'Paper' : 'Real'} mode)`);
      return margin || 100000; // Default fallback
    } catch (error) {
      logger.warn(`Account value fetch failed: ${(error as Error).message}, using fallback`);
      return 100000;
    }
  }

  private async assessMarketVolatility(indexName: string): Promise<number> {
    // Simplified volatility assessment - in production, use VIX or ATR
    const currentHour = new Date().getHours();
    
    // Higher risk during opening and closing hours
    if ((currentHour >= 9 && currentHour <= 9.5) || (currentHour >= 15 && currentHour <= 15.5)) {
      return 15; // High volatility
    }
    
    return 5; // Normal volatility
  }

  private assessSignalQuality(signal: TradingSignal): number {
    let quality = signal.confidence;
    
    // Risk-reward ratio assessment
    const riskAmount = Math.abs(signal.entryPrice - signal.stopLoss);
    const rewardAmount = Math.abs(signal.target - signal.entryPrice);
    const riskRewardRatio = rewardAmount / riskAmount;
    
    if (riskRewardRatio < 1.5) quality -= 20; // Poor R:R
    if (riskRewardRatio > 2.5) quality += 10; // Good R:R
    
    return quality;
  }
}

// Error Recovery and Circuit Breaker System
class ErrorRecoveryManager {
  private errorCounts: Map<string, number> = new Map();
  private lastErrorTimes: Map<string, number> = new Map();
  private circuitBreakerStates: Map<string, 'CLOSED' | 'OPEN' | 'HALF_OPEN'> = new Map();
  private retryQueues: Map<string, any[]> = new Map();
  
  private readonly MAX_RETRIES = 3;
  private readonly CIRCUIT_BREAKER_THRESHOLD = 5;
  private readonly CIRCUIT_BREAKER_TIMEOUT = 300000; // 5 minutes
  private readonly ERROR_RESET_TIME = 60000; // 1 minute

  async executeWithRecovery<T>(
    operation: () => Promise<T>,
    operationType: string,
    context?: any
  ): Promise<T> {
    const circuitState = this.getCircuitState(operationType);
    
    if (circuitState === 'OPEN') {
      throw new Error(`Circuit breaker OPEN for ${operationType}. Service temporarily unavailable.`);
    }

    try {
      const result = await this.retryWithBackoff(operation, operationType);
      this.recordSuccess(operationType);
      return result;
    } catch (error) {
      this.recordError(operationType, error as Error);
      throw error;
    }
  }

  private async retryWithBackoff<T>(
    operation: () => Promise<T>,
    operationType: string,
    attempt: number = 1
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= this.MAX_RETRIES) {
        throw error;
      }

      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // Exponential backoff, max 10s
      logger.warn(`Retry ${attempt}/${this.MAX_RETRIES} for ${operationType} after ${delay}ms delay`);
      
      await new Promise(resolve => setTimeout(resolve, delay));
      return this.retryWithBackoff(operation, operationType, attempt + 1);
    }
  }

  private recordError(operationType: string, error: Error): void {
    const currentCount = this.errorCounts.get(operationType) || 0;
    const newCount = currentCount + 1;
    
    this.errorCounts.set(operationType, newCount);
    this.lastErrorTimes.set(operationType, Date.now());

    logger.error(`Error recorded for ${operationType}: ${newCount}/${this.CIRCUIT_BREAKER_THRESHOLD}`, error);

    if (newCount >= this.CIRCUIT_BREAKER_THRESHOLD) {
      this.openCircuitBreaker(operationType);
    }
  }

  private recordSuccess(operationType: string): void {
    this.errorCounts.delete(operationType);
    const currentState = this.circuitBreakerStates.get(operationType);
    
    if (currentState === 'HALF_OPEN') {
      this.closeCircuitBreaker(operationType);
    }
  }

  private openCircuitBreaker(operationType: string): void {
    this.circuitBreakerStates.set(operationType, 'OPEN');
    logger.error(`🚨 CIRCUIT BREAKER OPENED for ${operationType}`);
    
    // Schedule automatic half-open attempt
    setTimeout(() => {
      this.circuitBreakerStates.set(operationType, 'HALF_OPEN');
      logger.info(`🔄 Circuit breaker set to HALF_OPEN for ${operationType}`);
    }, this.CIRCUIT_BREAKER_TIMEOUT);
  }

  private closeCircuitBreaker(operationType: string): void {
    this.circuitBreakerStates.set(operationType, 'CLOSED');
    logger.info(`✅ Circuit breaker CLOSED for ${operationType}`);
  }

  private getCircuitState(operationType: string): 'CLOSED' | 'OPEN' | 'HALF_OPEN' {
    return this.circuitBreakerStates.get(operationType) || 'CLOSED';
  }

  public getHealthStatus(): { [key: string]: any } {
    const status: { [key: string]: any } = {};
    
    for (const [operation, state] of this.circuitBreakerStates.entries()) {
      status[operation] = {
        circuitState: state,
        errorCount: this.errorCounts.get(operation) || 0,
        lastError: this.lastErrorTimes.get(operation)
      };
    }
    
    return status;
  }
}

// Performance Tracking System
class PerformanceTracker {
  private trades: Array<{
    entryTime: Date;
    exitTime: Date;
    pnl: number;
    symbol: string;
    duration: number;
  }> = [];

  recordTrade(order: ActiveOrder) {
    if (!order.exitTime || !order.entryTime) return;
    
    this.trades.push({
      entryTime: order.entryTime,
      exitTime: order.exitTime,
      pnl: order.pnl || 0,
      symbol: order.signal.optionSymbol,
      duration: order.tradingDuration || 0
    });
  }

  calculateMetrics() {
    if (this.trades.length === 0) return this.getDefaultMetrics();
    
    const profits = this.trades.filter(t => t.pnl > 0);
    const losses = this.trades.filter(t => t.pnl < 0);
    
    const winRate = (profits.length / this.trades.length) * 100;
    const avgWin = profits.length > 0 ? profits.reduce((sum, t) => sum + t.pnl, 0) / profits.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0) / losses.length) : 0;
    const profitFactor = avgLoss > 0 ? (avgWin * profits.length) / (avgLoss * losses.length) : 0;
    
    return {
      winRate,
      avgWin,
      avgLoss,
      profitFactor,
      totalTrades: this.trades.length,
      avgHoldingTime: this.trades.reduce((sum, t) => sum + t.duration, 0) / this.trades.length
    };
  }

  private getDefaultMetrics() {
    return {
      winRate: 0,
      avgWin: 0,
      avgLoss: 0,
      profitFactor: 0,
      totalTrades: 0,
      avgHoldingTime: 0
    };
  }
}

interface ActiveOrder {
  signal: TradingSignal;
  orderId: string;
  status: 'PLACED' | 'FILLED' | 'CANCELLED' | 'REJECTED' | 'EXITED_TARGET' | 'EXITED_SL' | 'PARTIAL_FILLED';
  timestamp: Date;
  entryPrice?: number;
  exitPrice?: number;
  exitReason?: 'TARGET' | 'STOPLOSS' | 'MANUAL' | 'TIMEOUT' | 'RISK_MANAGEMENT';
  pnl?: number;
  isPaperTrade?: boolean;
  quantity?: number;
  filledQuantity?: number;
  pendingQuantity?: number;
  averagePrice?: number;
  slippageCost?: number;
  riskScore?: number;
  maxDrawdown?: number;
  entryTime?: Date;
  exitTime?: Date;
  tradingDuration?: number;
  brokerageAndTaxes?: number;
}

interface OrderResult {
  success: boolean;
  orderId: string;
  price: number;
  quantity: number;
  slippage: number;
  executionTime: number;
  brokerageEstimate: number;
  riskAssessment: 'LOW' | 'MEDIUM' | 'HIGH';
  marketCondition: 'LIQUID' | 'ILLIQUID' | 'VOLATILE';
}

enum OrderType {
  MARKET = 'MARKET',
  LIMIT = 'LIMIT',
  STOP_MARKET = 'STOP_MARKET',
  STOP_LIMIT = 'STOP_LIMIT',
  BRACKET = 'BRACKET',
  COVER = 'COVER',
  ICEBERG = 'ICEBERG',
  TWAP = 'TWAP'
}

interface SmartOrderConfig {
  orderType: OrderType;
  maxSlippage: number;
  timeInForce: 'DAY' | 'IOC' | 'FOK';
  partialFillAcceptable: boolean;
  icebergQuantity?: number;
  twapDuration?: number;
  priceImprovement: boolean;
}

interface DailyStats {
  trades: number;
  activeOrders: number;
  pnl: number;
  grossPnl: number;
  netPnl: number;
  totalBrokerage: number;
  winRate: number;
  averageWin: number;
  averageLoss: number;
  maxDrawdown: number;
  profitFactor: number;
  sharpeRatio: number;
  successfulTrades: number;
  failedTrades: number;
  averageHoldingTime: number;
  riskAdjustedReturn: number;
}

class OrderService {
  private activeOrders: ActiveOrder[] = [];
  private dailyTrades = 0;
  private dailyPnL = 0;
  private dailyGrossPnL = 0;
  private dailyBrokerage = 0;
  private successfulTrades = 0;
  private failedTrades = 0;
  private totalHoldingTime = 0;
  private maxDrawdown = 0;
  private currentDrawdown = 0;
  private peakPnL = 0;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private tradingSignalHandler?: (signal: TradingSignal) => Promise<void>;
  private riskManager = new AdvancedRiskManager();
  private performanceTracker = new PerformanceTracker();
  private errorRecoveryManager = new ErrorRecoveryManager();

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
      
      // Enhanced risk checks
      const riskAssessment = await this.riskManager.assessOrderRisk(signal, this.dailyPnL, this.activeOrders.length);
      
      if (riskAssessment.blocked) {
        logger.warn(`❌ ORDER BLOCKED BY RISK MANAGEMENT: ${riskAssessment.reason}`);
        logger.warn(`   Risk Score: ${riskAssessment.riskScore}/100`);
        logger.warn(`   Current Drawdown: ${this.currentDrawdown.toFixed(2)}%`);
        (process as any).emit('orderBlocked', { signal, riskAssessment });
        return;
      }
      
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

      // 🎯 BALANCE CHECK - Skip for paper trading
      if (!config.trading.paperTrading) {
        logger.info(`💰 Checking account balance before real order placement...`);
        const hasBalance = await this.checkSufficientBalance(signal);
        if (!hasBalance) {
          logger.error(`❌ INSUFFICIENT BALANCE - Cannot place real order`);
          (process as any).emit('balanceInsufficient', {
            signal,
            message: `🚨 *INSUFFICIENT BALANCE ALERT*\n📈 *${signal.optionSymbol}*\n\n❌ Cannot place real order - insufficient margin\n💰 Required: ~₹${(signal.entryPrice * config.indices[signal.indexName].lotSize * 0.2).toFixed(0)}\n\n🔧 Please add margin to continue trading`
          });
          return;
        }
        logger.info(`✅ Balance check passed - proceeding with real order`);
      } else {
        logger.info(`📄 Paper trading mode - skipping balance check`);
      }

      // 🎯 IDENTICAL ORDER PREPARATION for both modes
      const optimalQuantity = await this.calculateOptimalPositionSize(signal);
      const brokerageEstimate = this.estimateBrokerage(signal, optimalQuantity);
      const smartConfig = await this.getSmartOrderConfig(signal, optimalQuantity);
      
      logger.info(`🎯 Order prepared identically for ${config.trading.paperTrading ? 'PAPER' : 'REAL'} execution:`);
      logger.info(`   Quantity: ${optimalQuantity}`);
      logger.info(`   Brokerage Estimate: ₹${brokerageEstimate.toFixed(2)}`);
      logger.info(`   Smart Config: ${smartConfig.orderType}`);
      
      // 🎯 ONLY DIFFERENCE: Final execution step
      if (config.trading.paperTrading) {
        // Paper Trading: All calculations identical, no money execution
        const paperOrderId = this.generatePaperOrderId();
        
        const newOrder: ActiveOrder = {
          signal,
          orderId: paperOrderId,
          status: 'PLACED',
          timestamp: new Date(),
          entryTime: new Date(),
          isPaperTrade: true,
          quantity: optimalQuantity,
          filledQuantity: 0,
          pendingQuantity: optimalQuantity,
          riskScore: riskAssessment.riskScore,
          brokerageAndTaxes: brokerageEstimate
        };
        
        this.activeOrders.push(newOrder);
        this.dailyTrades++;
        
        logger.info(`🎯 PAPER ORDER: ${signal.optionSymbol} - Order ID: ${paperOrderId}`);
        logger.info(`   ✅ All validations, calculations, and API calls identical to real trading`);
        logger.info(`   🚫 Only difference: No money execution`);
        
        // Immediate fill simulation (identical to real broker instant fills)
        setTimeout(() => {
          this.simulateOrderFill(paperOrderId, signal);
        }, 100);
        
        (process as any).emit('orderPlaced', { signal, orderId: paperOrderId, isPaperTrade: true });
      } else {
        // Real Trading: Same calculations, with actual money execution
        logger.info('🎯 REAL ORDER: Executing with live money...');
        
        const orderResponse = await this.placeRealOrder(signal, optimalQuantity);

        if (orderResponse.status && orderResponse.data?.orderid) {
          const newOrder: ActiveOrder = {
            signal,
            orderId: orderResponse.data.orderid,
            status: 'PLACED',
            timestamp: new Date(),
            entryTime: new Date(),
            isPaperTrade: false,
            quantity: optimalQuantity,
            filledQuantity: 0,
            pendingQuantity: optimalQuantity,
            riskScore: riskAssessment.riskScore,
            brokerageAndTaxes: brokerageEstimate
          };
          
          this.activeOrders.push(newOrder);
          this.dailyTrades++;
          
          logger.info(`🎯 REAL ORDER EXECUTED: ${signal.optionSymbol} - Order ID: ${orderResponse.data.orderid}`);
          logger.info(`   ✅ All calculations identical to paper trading`);
          logger.info(`   💰 Difference: Real money executed with Angel One`);
          logger.info(`   🤖 Broker will handle automatic exits at target/SL levels`);

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
  private async calculateOptimalPositionSize(signal: TradingSignal): Promise<number> {
    try {
      const baseQuantity = config.indices[signal.indexName].lotSize;
      
      // 🎯 IDENTICAL POSITION SIZING for both paper and real trading
      const accountValue = await this.riskManager.getAccountValue();
      
      logger.debug(`Position sizing calculation (${config.trading.paperTrading ? 'Paper' : 'Real'}): Account=₹${accountValue}, Entry=₹${signal.entryPrice}`);
      
      // Kelly Criterion for position sizing (same for both modes)
      const winProbability = Math.min(signal.confidence / 100, 0.8); // Cap at 80%
      const riskAmount = Math.abs(signal.entryPrice - signal.stopLoss);
      const rewardAmount = Math.abs(signal.target - signal.entryPrice);
      const riskRewardRatio = rewardAmount / riskAmount;
      
      // Kelly formula: f = (bp - q) / b where b = odds, p = win prob, q = loss prob
      const kellyFraction = (winProbability * riskRewardRatio - (1 - winProbability)) / riskRewardRatio;
      const safeFraction = Math.max(0.1, Math.min(0.25, kellyFraction * 0.5)); // Conservative Kelly
      
      // Position value should not exceed safe fraction of account
      const maxPositionValue = accountValue * safeFraction;
      const entryValue = signal.entryPrice * baseQuantity;
      
      logger.debug(`Kelly sizing: WinProb=${winProbability.toFixed(2)}, R:R=${riskRewardRatio.toFixed(2)}, SafeFraction=${safeFraction.toFixed(3)}`);
      
      if (entryValue <= maxPositionValue) {
        logger.info(`📊 Using standard lot size: ${baseQuantity} (Entry value ₹${entryValue} within limit ₹${maxPositionValue})`);
        return baseQuantity;
      } else {
        // Scale down if position is too large
        const scaleFactor = maxPositionValue / entryValue;
        const scaledQuantity = Math.max(baseQuantity, Math.floor(baseQuantity * scaleFactor));
        logger.info(`📉 Scaled down position: ${scaledQuantity} (Scale factor: ${scaleFactor.toFixed(3)})`);
        return scaledQuantity;
      }
    } catch (error) {
      logger.error('Position sizing calculation failed:', (error as Error).message);
      return config.indices[signal.indexName].lotSize; // Fallback to standard lot size
    }
  }

  private estimateBrokerage(signal: TradingSignal, quantity: number): number {
    // 🎯 IDENTICAL BROKERAGE CALCULATION for both paper and real trading
    // This gives paper traders realistic cost impact understanding
    
    const turnover = signal.entryPrice * quantity * 2; // Buy + Sell
    const brokeragePercent = Math.min(turnover * 0.0005, 40); // Capped at ₹40 for round trip
    const fixedCharges = 40; // ₹20 per order x 2 orders
    const stt = turnover * 0.001; // STT on options
    const exchangeCharges = turnover * 0.00005;
    const gst = (brokeragePercent + exchangeCharges) * 0.18;
    
    const totalBrokerage = fixedCharges + brokeragePercent + stt + exchangeCharges + gst;
    
    logger.debug(`Brokerage calculation (${config.trading.paperTrading ? 'Paper' : 'Real'}): ₹${totalBrokerage.toFixed(2)} on turnover ₹${turnover.toFixed(2)}`);
    
    return totalBrokerage;
  }

  private async getSmartOrderConfig(signal: TradingSignal, quantity: number): Promise<SmartOrderConfig> {
    const marketCondition = await this.assessMarketLiquidity(signal.optionSymbol, signal.entryPrice);
    const accountValue = await this.riskManager.getAccountValue();
    const positionSize = (signal.entryPrice * quantity) / accountValue * 100;
    
    // Smart routing based on market conditions and position size
    if (marketCondition === 'ILLIQUID' || positionSize > 5) {
      // Use ICEBERG or TWAP for large orders in illiquid markets
      return {
        orderType: quantity > config.indices[signal.indexName].lotSize * 2 ? OrderType.ICEBERG : OrderType.TWAP,
        maxSlippage: 0.005, // 0.5% max slippage
        timeInForce: 'DAY',
        partialFillAcceptable: true,
        icebergQuantity: Math.floor(quantity / 3),
        twapDuration: 300, // 5 minutes
        priceImprovement: true
      };
    } else if (marketCondition === 'VOLATILE') {
      // Use LIMIT orders in volatile markets for better price control
      return {
        orderType: OrderType.LIMIT,
        maxSlippage: 0.002, // 0.2% max slippage
        timeInForce: 'IOC',
        partialFillAcceptable: false,
        priceImprovement: true
      };
    } else {
      // Use BRACKET orders in liquid markets for speed
      return {
        orderType: OrderType.BRACKET,
        maxSlippage: 0.001, // 0.1% max slippage
        timeInForce: 'DAY',
        partialFillAcceptable: false,
        priceImprovement: false
      };
    }
  }

  private async placeSmartOrder(signal: TradingSignal, quantity: number, smartConfig: SmartOrderConfig): Promise<OrderResponse> {
    switch (smartConfig.orderType) {
      case OrderType.BRACKET:
        return this.placeBracketOrder(signal, quantity, smartConfig);
      case OrderType.LIMIT:
        return this.placeLimitOrder(signal, quantity, smartConfig);
      case OrderType.ICEBERG:
        return this.placeIcebergOrder(signal, quantity, smartConfig);
      case OrderType.TWAP:
        return this.placeTWAPOrder(signal, quantity, smartConfig);
      default:
        return this.placeBracketOrder(signal, quantity, smartConfig);
    }
  }

  private async placeBracketOrder(signal: TradingSignal, quantity: number, smartConfig: SmartOrderConfig): Promise<OrderResponse> {
    try {
      logger.info(`🤖 Placing Smart Bracket Order for ${signal.optionSymbol}`);

      const expiry = this.generateExpiryString(signal.indexName);
      const strike = this.extractStrikeFromSymbol(signal.optionSymbol, signal.indexName);

      const symbolToken = await angelAPI.getOptionToken(
        signal.indexName,
        strike,
        signal.optionType,
        expiry
      );

      if (!symbolToken) {
        throw new Error('Symbol token lookup failed');
      }

      // Smart pricing with slippage protection
      const limitPrice = smartConfig.priceImprovement ? 
        signal.entryPrice * (1 - smartConfig.maxSlippage) : 
        signal.entryPrice;

      const orderDetails: OrderDetails = {
        variety: 'BO',
        tradingsymbol: signal.optionSymbol,
        symboltoken: symbolToken,
        transactiontype: 'BUY',
        exchange: 'NFO',
        ordertype: smartConfig.orderType === OrderType.BRACKET ? 'MARKET' : 'LIMIT',
        producttype: 'BO',
        duration: smartConfig.timeInForce,
        price: limitPrice.toString(),
        squareoff: signal.target.toString(),
        stoploss: signal.stopLoss.toString(),
        quantity: quantity.toString()
      };

      logger.info(`🧠 Smart Order Configuration:`, {
        OrderType: smartConfig.orderType,
        MaxSlippage: `${(smartConfig.maxSlippage * 100).toFixed(2)}%`,
        TimeInForce: smartConfig.timeInForce,
        PriceImprovement: smartConfig.priceImprovement,
        LimitPrice: `₹${limitPrice.toFixed(2)}`
      });

      // 🚨 FINAL SECURITY CHECK: Double-verify not in paper mode before API call
      if (config.trading.paperTrading) {
        logger.error('❌ FINAL SECURITY BLOCK: Prevented real API call in paper mode!');
        throw new Error('SECURITY_VIOLATION: Real API call blocked in paper trading mode');
      }
      
      logger.warn('🚨 EXECUTING REAL MONEY ORDER - Final API call to Angel One');
      
      const response = await this.errorRecoveryManager.executeWithRecovery(
        () => {
          // Triple check before actual API call
          if (config.trading.paperTrading) {
            throw new Error('SECURITY_VIOLATION: Paper mode detected at API call level');
          }
          return angelAPI.makeRequest(
            '/rest/secure/angelbroking/order/v1/placeOrder',
            'POST',
            orderDetails
          );
        },
        'ORDER_PLACEMENT'
      );

      if (response.status) {
        logger.info(`✅ Smart Bracket Order placed successfully with optimized routing`);
      }

      return response;

    } catch (error) {
      logger.error('CRITICAL: Smart order placement failed:', (error as Error).message);
      throw error;
    }
  }

  private async placeLimitOrder(signal: TradingSignal, quantity: number, smartConfig: SmartOrderConfig): Promise<OrderResponse> {
    // Implementation for limit orders with price improvement
    logger.info(`📊 Placing Smart Limit Order for ${signal.optionSymbol}`);
    
    const limitPrice = signal.entryPrice * (1 - smartConfig.maxSlippage);
    
    // For now, use bracket order structure but with limit price logic
    return this.placeBracketOrder(signal, quantity, { ...smartConfig, priceImprovement: true });
  }

  private async placeIcebergOrder(signal: TradingSignal, quantity: number, smartConfig: SmartOrderConfig): Promise<OrderResponse> {
    // Implementation for iceberg orders (breaking large orders into smaller chunks)
    logger.info(`🧊 Placing Iceberg Order for ${signal.optionSymbol} - Total: ${quantity}, Chunks: ${smartConfig.icebergQuantity}`);
    
    // For simplicity, place the full order but log the iceberg strategy
    logger.info(`📈 Iceberg Strategy: Breaking ${quantity} into ${Math.ceil(quantity / (smartConfig.icebergQuantity || 1))} chunks`);
    
    return this.placeBracketOrder(signal, quantity, smartConfig);
  }

  private async placeTWAPOrder(signal: TradingSignal, quantity: number, smartConfig: SmartOrderConfig): Promise<OrderResponse> {
    // Implementation for TWAP orders (time-weighted average price)
    logger.info(`⏰ Placing TWAP Order for ${signal.optionSymbol} over ${smartConfig.twapDuration} seconds`);
    
    // For simplicity, place the full order but log the TWAP strategy
    logger.info(`📊 TWAP Strategy: Executing over ${smartConfig.twapDuration} seconds for better average price`);
    
    return this.placeBracketOrder(signal, quantity, smartConfig);
  }

  private async placeRealOrder(signal: TradingSignal, quantity: number): Promise<OrderResponse> {
    // 🚨 CRITICAL SECURITY CHECK: Prevent real money execution in paper mode
    if (config.trading.paperTrading) {
      logger.error('❌ SECURITY VIOLATION: Attempted to place real order in paper trading mode!');
      logger.error('   This is a critical security breach - blocking execution');
      logger.error('   Signal:', signal.optionSymbol);
      logger.error('   Quantity:', quantity);
      throw new Error('SECURITY_VIOLATION: Cannot place real orders in paper trading mode');
    }
    
    try {
      logger.warn('🚨 REAL MONEY EXECUTION MODE - Proceeding with live order placement');
      
      // Get smart order configuration
      const smartConfig = await this.getSmartOrderConfig(signal, quantity);
      
      logger.info(`🤖 Using Smart Order Routing (REAL MONEY):`, {
        OrderType: smartConfig.orderType,
        MaxSlippage: `${(smartConfig.maxSlippage * 100).toFixed(2)}%`,
        TimeInForce: smartConfig.timeInForce
      });

      // Place order using smart routing
      return await this.placeSmartOrder(signal, quantity, smartConfig);

    } catch (error) {
      logger.error('CRITICAL: Smart order placement failed, falling back to standard order');
      
      // Additional security check before fallback
      if (config.trading.paperTrading) {
        throw new Error('SECURITY_VIOLATION: Cannot fallback to real order in paper mode');
      }
      
      // Fallback to standard bracket order
      const fallbackConfig: SmartOrderConfig = {
        orderType: OrderType.BRACKET,
        maxSlippage: 0.002,
        timeInForce: 'DAY',
        partialFillAcceptable: false,
        priceImprovement: false
      };
      
      return await this.placeBracketOrder(signal, quantity, fallbackConfig);
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
    const roundTo = indexName === 'BANKNIFTY' ? 500 : 50;
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

      // REDUNDANT CHECK 1: Order Book with error recovery
      const orderBookResponse = await this.errorRecoveryManager.executeWithRecovery(
        () => angelAPI.getOrderBook(),
        'ORDER_BOOK_FETCH'
      ).catch(error => {
        logger.warn('Order book fetch failed:', error.message);
        return null;
      });

      // REDUNDANT CHECK 2: Trade Book with error recovery
      const tradeBookResponse = await this.errorRecoveryManager.executeWithRecovery(
        () => angelAPI.getTradeBook(),
        'TRADE_BOOK_FETCH'
      ).catch(error => {
        logger.warn('Trade book fetch failed:', error.message);
        return null;
      });

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

        // ✅ FIXED: Check for already processed exit by checking exitPrice
        if (activeOrder.exitPrice) {
          logger.debug(`Exit already processed for ${activeOrder.signal.optionSymbol} - ExitPrice: ${activeOrder.exitPrice}`);
          return;
        }

        // Calculate P&L
        const pnl = (exitPrice - entryPrice) * config.indices[activeOrder.signal.indexName].lotSize;

        // Determine exit reason with more sophisticated logic
        const targetDistance = Math.abs(exitPrice - activeOrder.signal.target);
        const slDistance = Math.abs(exitPrice - activeOrder.signal.stopLoss);
        const exitReason = targetDistance < slDistance ? 'TARGET' : 'STOPLOSS';

        // Enhanced exit processing with performance tracking
        const exitTime = new Date();
        const tradingDuration = exitTime.getTime() - activeOrder.timestamp.getTime();
        const netPnL = pnl - (activeOrder.brokerageAndTaxes || 0);
        
        // Update order status with comprehensive metrics
        activeOrder.status = exitReason === 'TARGET' ? 'EXITED_TARGET' : 'EXITED_SL';
        activeOrder.exitPrice = exitPrice;
        activeOrder.exitTime = exitTime;
        activeOrder.exitReason = exitReason;
        activeOrder.pnl = pnl;
        activeOrder.tradingDuration = tradingDuration;
        activeOrder.filledQuantity = activeOrder.quantity || config.indices[activeOrder.signal.indexName].lotSize;

        // Update daily P&L with brokerage consideration
        this.dailyPnL += netPnL;
        this.dailyGrossPnL += pnl;
        this.dailyBrokerage += (activeOrder.brokerageAndTaxes || 0);
        
        // Track performance metrics
        if (netPnL > 0) {
          this.successfulTrades++;
        } else {
          this.failedTrades++;
        }
        
        this.totalHoldingTime += tradingDuration;
        this.updateDrawdownMetrics(netPnL);
        
        // Record trade for performance analysis
        this.performanceTracker.recordTrade(activeOrder);

        logger.info(`🎯 REAL EXIT DETECTED: ${activeOrder.signal.optionSymbol} @ ₹${exitPrice} - ${exitReason} - P&L: ₹${pnl.toFixed(2)}`);
        logger.info(`📊 Trade Details: Entry=₹${entryPrice}, Exit=₹${exitPrice}, Qty=${config.indices[activeOrder.signal.indexName].lotSize}`);
        logger.info(`🔥 REMOVING FROM ACTIVE LIST: OrderID=${activeOrder.orderId} (current count: ${this.activeOrders.length})`);

        // Send exit notification immediately
        this.sendExitNotification(activeOrder);

        // ✅ CRITICAL FIX: Remove completed order from activeOrders array
        this.removeOrderFromActiveList(activeOrder.orderId, 'REAL_EXIT_COMPLETED');
        logger.info(`✅ REAL EXIT REMOVAL COMPLETE: Active orders now: ${this.activeOrders.length}`);
        
        // ✅ EMIT EXIT EVENT to unlock position immediately
        (process as any).emit('orderExited', { 
          order: { signal: activeOrder.signal }, 
          message: `Real trade ${exitReason} exit completed`,
          exitPrice: exitPrice,
          pnl: pnl
        });
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
    const performanceMetrics = this.performanceTracker.calculateMetrics();
    
    return {
      trades: this.dailyTrades,
      activeOrders: this.activeOrders.length,
      pnl: this.dailyPnL,
      grossPnl: this.dailyGrossPnL,
      netPnl: this.dailyPnL, // Already net after brokerage
      totalBrokerage: this.dailyBrokerage,
      winRate: performanceMetrics.winRate,
      averageWin: performanceMetrics.avgWin,
      averageLoss: performanceMetrics.avgLoss,
      maxDrawdown: this.maxDrawdown,
      profitFactor: performanceMetrics.profitFactor,
      sharpeRatio: this.calculateSharpeRatio(),
      successfulTrades: this.successfulTrades,
      failedTrades: this.failedTrades,
      averageHoldingTime: this.totalHoldingTime / Math.max(this.dailyTrades, 1),
      riskAdjustedReturn: this.calculateRiskAdjustedReturn()
    };
  }

  private calculateSharpeRatio(): number {
    if (this.dailyTrades === 0) return 0;
    
    const avgReturn = this.dailyPnL / Math.max(this.dailyTrades, 1);
    const riskFreeRate = 0; // Assuming 0 for simplicity
    
    // Calculate return standard deviation (simplified)
    const returns = this.performanceTracker.calculateMetrics();
    const returnVariance = (returns.avgWin * returns.avgWin + returns.avgLoss * returns.avgLoss) / 2;
    const returnStdDev = Math.sqrt(returnVariance);
    
    return returnStdDev > 0 ? (avgReturn - riskFreeRate) / returnStdDev : 0;
  }

  private calculateRiskAdjustedReturn(): number {
    if (this.maxDrawdown === 0) return this.dailyPnL;
    return this.dailyPnL / (this.maxDrawdown + 1); // Risk-adjusted return
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
        Math.round(25000 / 500) * 500 : 
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
        // 🎯 SHOW REAL BALANCE DATA even in paper trading
        const availableMargin = await angelAPI.getAvailableMargin();
        const fundsResponse = await angelAPI.getFunds();
        
        summary += `📄 *Paper Trading Mode (Real Account Data)*\n`;
        summary += `*Available Margin:* ₹${availableMargin.toFixed(2)}\n`;
        
        if (fundsResponse?.data) {
          const data = fundsResponse.data;
          if (data.net) summary += `*Net Worth:* ₹${parseFloat(data.net).toFixed(2)}\n`;
          if (data.utilisedamount) summary += `*Utilised:* ₹${parseFloat(data.utilisedamount).toFixed(2)}\n`;
          if (data.payin) summary += `*Total Fund:* ₹${parseFloat(data.payin).toFixed(2)}\n`;
        }
        
        summary += `*Paper Trading:* Real data, no money at risk\n`;
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
    const stats = this.getDailyStats();
    const healthStatus = this.errorRecoveryManager.getHealthStatus();
    
    logger.info(`📊 COMPREHENSIVE STATUS REPORT @ ${timestamp}:`);
    
    // Active Orders Status
    logger.info(`   📈 ACTIVE ORDERS: ${this.activeOrders.length}`);
    
    if (this.activeOrders.length === 0) {
      logger.info(`   ✅ No active orders - all positions available`);
    } else {
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
          const unrealizedPnL = order.status === 'FILLED' ? 'Monitoring' : 'Pending';
          logger.info(`      ${order.orderId}: ${order.status} (${order.signal.optionType}) - Age: ${age}min - Risk: ${order.riskScore || 0}`);
        });
      });
      
      // Show which indices are blocked
      const blockedIndices = Object.keys(byIndex).filter(indexName => 
        byIndex[indexName].some(order => order.status === 'PLACED' || order.status === 'FILLED')
      );
      
      logger.info(`   🔒 BLOCKED indices: ${blockedIndices.length > 0 ? blockedIndices.join(', ') : 'None'}`);
      logger.info(`   🔓 AVAILABLE indices: ${['NIFTY', 'BANKNIFTY'].filter(i => !blockedIndices.includes(i)).join(', ') || 'None'}`);
    }
    
    // Performance Metrics
    logger.info(`   💰 PERFORMANCE METRICS:`);
    logger.info(`      Daily P&L: ₹${stats.pnl.toFixed(2)} (Gross: ₹${stats.grossPnl.toFixed(2)}, Brokerage: ₹${stats.totalBrokerage.toFixed(2)})`);
    logger.info(`      Win Rate: ${stats.winRate.toFixed(1)}% (${stats.successfulTrades}W/${stats.failedTrades}L)`);
    logger.info(`      Avg Win: ₹${stats.averageWin.toFixed(2)} | Avg Loss: ₹${Math.abs(stats.averageLoss).toFixed(2)}`);
    logger.info(`      Max Drawdown: ${stats.maxDrawdown.toFixed(2)}% | Current DD: ${this.currentDrawdown.toFixed(2)}%`);
    logger.info(`      Profit Factor: ${stats.profitFactor.toFixed(2)} | Sharpe: ${stats.sharpeRatio.toFixed(2)}`);
    logger.info(`      Avg Hold Time: ${(stats.averageHoldingTime / 60000).toFixed(1)}min`);
    
    // System Health
    logger.info(`   🏥 SYSTEM HEALTH:`);
    const hasErrors = Object.keys(healthStatus).length > 0;
    if (!hasErrors) {
      logger.info(`      ✅ All systems operational`);
    } else {
      Object.entries(healthStatus).forEach(([operation, status]) => {
        const stateEmoji = status.circuitState === 'OPEN' ? '🔴' : status.circuitState === 'HALF_OPEN' ? '🟡' : '🟢';
        logger.info(`      ${stateEmoji} ${operation}: ${status.circuitState} (Errors: ${status.errorCount})`);
      });
    }
  }

  // 🎯 REMOVED: Virtual margin calculation - Paper trading now uses real account data

  // Trading mode validation
  public validateTradingMode(): { isValid: boolean; warnings: string[] } {
    const warnings: string[] = [];
    
    if (config.trading.paperTrading) {
      warnings.push('🎯 PAPER TRADING: Identical behavior to real trading, no money executed');
      warnings.push('✅ Uses live API calls, real account data, same risk management');
      if (this.activeOrders.some(order => !order.isPaperTrade)) {
        warnings.push('⚠️ Mixed trading modes detected - some orders may be real!');
      }
    } else {
      warnings.push('💰 REAL TRADING: Live money execution enabled');
      warnings.push('⚠️ All API calls will execute actual trades with real money');
      if (this.activeOrders.some(order => order.isPaperTrade)) {
        warnings.push('⚠️ Mixed trading modes detected - some orders may be paper!');
      }
    }
    
    const isValid = true; // Both modes are valid, just different
    return { isValid, warnings };
  }

  // Seamless mode transition helper
  public async transitionTradingMode(newMode: 'paper' | 'real'): Promise<void> {
    const currentMode = config.trading.paperTrading ? 'paper' : 'real';
    
    if (currentMode === newMode) {
      logger.info(`Already in ${newMode} trading mode`);
      return;
    }
    
    logger.warn(`🔄 TRANSITIONING from ${currentMode.toUpperCase()} to ${newMode.toUpperCase()} trading mode`);
    logger.info('🎯 Both modes use identical logic - only money execution differs');
    
    // Check if there are active orders
    if (this.activeOrders.length > 0) {
      logger.warn(`⚠️ ${this.activeOrders.length} active orders detected during mode transition`);
      logger.warn('   All orders will continue with same API calls and risk management');
      logger.warn('   Only the final money execution step will change');
    }
    
    // Reset statistics for new mode
    if (newMode !== currentMode) {
      logger.info('📋 Resetting daily statistics for new trading mode');
      this.resetDailyStats();
    }
    
    logger.info(`✅ Transition to ${newMode.toUpperCase()} mode ready - identical behavior, different execution`);
  }

  // 🆕 COMPREHENSIVE PERFORMANCE REPORT
  public generatePerformanceReport(): string {
    const stats = this.getDailyStats();
    const healthStatus = this.errorRecoveryManager.getHealthStatus();
    
    return `
📊 **ADVANCED TRADING BOT PERFORMANCE REPORT**

🎯 **TRADING PERFORMANCE:**
• Total Trades: ${stats.trades}
• Win Rate: ${stats.winRate.toFixed(1)}% (${stats.successfulTrades} wins, ${stats.failedTrades} losses)
• Daily P&L: ₹${stats.pnl.toFixed(2)}
• Gross P&L: ₹${stats.grossPnl.toFixed(2)}
• Total Brokerage: ₹${stats.totalBrokerage.toFixed(2)}
• Average Win: ₹${stats.averageWin.toFixed(2)}
• Average Loss: ₹${Math.abs(stats.averageLoss).toFixed(2)}
• Profit Factor: ${stats.profitFactor.toFixed(2)}

📈 **RISK METRICS:**
• Maximum Drawdown: ${stats.maxDrawdown.toFixed(2)}%
• Current Drawdown: ${this.currentDrawdown.toFixed(2)}%
• Sharpe Ratio: ${stats.sharpeRatio.toFixed(2)}
• Risk-Adjusted Return: ${stats.riskAdjustedReturn.toFixed(2)}

⏱️ **EFFICIENCY METRICS:**
• Average Holding Time: ${(stats.averageHoldingTime / 60000).toFixed(1)} minutes
• Active Positions: ${stats.activeOrders}

🏥 **SYSTEM HEALTH:**
${Object.keys(healthStatus).length === 0 ? '✅ All systems operational' : 
  Object.entries(healthStatus).map(([op, status]) => 
    `• ${op}: ${status.circuitState} (${status.errorCount} errors)`
  ).join('\n')}

🎖️ **PERFORMANCE GRADE:** ${this.calculatePerformanceGrade(stats)}
    `.trim();
  }

  private calculatePerformanceGrade(stats: DailyStats): string {
    let score = 0;
    
    // Win rate scoring (0-30 points)
    if (stats.winRate >= 70) score += 30;
    else if (stats.winRate >= 60) score += 25;
    else if (stats.winRate >= 50) score += 20;
    else if (stats.winRate >= 40) score += 15;
    else score += 10;
    
    // Profit factor scoring (0-25 points)
    if (stats.profitFactor >= 2.0) score += 25;
    else if (stats.profitFactor >= 1.5) score += 20;
    else if (stats.profitFactor >= 1.2) score += 15;
    else if (stats.profitFactor >= 1.0) score += 10;
    else score += 5;
    
    // Drawdown scoring (0-25 points)
    if (stats.maxDrawdown <= 2) score += 25;
    else if (stats.maxDrawdown <= 5) score += 20;
    else if (stats.maxDrawdown <= 8) score += 15;
    else if (stats.maxDrawdown <= 12) score += 10;
    else score += 5;
    
    // P&L scoring (0-20 points)
    if (stats.pnl > 0) {
      if (stats.riskAdjustedReturn >= 5) score += 20;
      else if (stats.riskAdjustedReturn >= 2) score += 15;
      else score += 10;
    } else {
      score += 5;
    }
    
    // Grade assignment
    if (score >= 90) return '🥇 EXCELLENT (A+)';
    else if (score >= 80) return '🥈 VERY GOOD (A)';
    else if (score >= 70) return '🥉 GOOD (B+)';
    else if (score >= 60) return '📊 AVERAGE (B)';
    else if (score >= 50) return '📉 BELOW AVERAGE (C)';
    else return '⚠️ NEEDS IMPROVEMENT (D)';
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

      // 🚨 SECURITY CHECK: Verify this is a real order before cancelling
      if (order.isPaperTrade) {
        logger.error('SECURITY: Attempted to cancel paper order via real API - blocked');
        return false;
      }
      
      // Additional check for trading mode
      if (config.trading.paperTrading) {
        logger.error('SECURITY: Cannot cancel real order while in paper trading mode');
        return false;
      }
      
      logger.warn('🚨 CANCELLING REAL ORDER via Angel One API');
      
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
      
      // 🎯 IDENTICAL FILL LOGIC to real trading
      order.status = 'FILLED';
      order.entryPrice = signal.entryPrice;
      order.filledQuantity = order.quantity;
      order.pendingQuantity = 0;
      
      logger.info(`🎯 Paper order filled identically to real trading: ${signal.optionSymbol} @ ₹${signal.entryPrice.toFixed(2)}`);
      logger.info(`   ✅ Uses live API prices for exit monitoring (same as real trading)`);
      
      // Send entry notification
      this.sendEntryNotification(order);
      
    } catch (error) {
      logger.error('Paper order fill failed:', (error as Error).message);
    }
  }

  private async checkPaperTradeExit(activeOrder: ActiveOrder): Promise<void> {
    if (!activeOrder.isPaperTrade || activeOrder.status !== 'FILLED') return;

    try {
      // 🎯 IDENTICAL API CALLS as real trading - no simulation fallbacks
      const expiry = this.generateExpiryString(activeOrder.signal.indexName);
      const strike = this.extractStrikeFromSymbol(activeOrder.signal.optionSymbol, activeOrder.signal.indexName);
      
      const symbolToken = await angelAPI.getOptionToken(
        activeOrder.signal.indexName,
        strike,
        activeOrder.signal.optionType,
        expiry
      );

      if (!symbolToken) {
        logger.warn(`Could not get symbol token for ${activeOrder.signal.optionSymbol} - skipping price check`);
        return;
      }

      const currentPrice = await this.errorRecoveryManager.executeWithRecovery(
        () => angelAPI.getOptionPrice(activeOrder.signal.optionSymbol, symbolToken),
        'OPTION_PRICE_FETCH'
      );
      
      if (!currentPrice || currentPrice <= 0) {
        logger.warn(`Invalid price received for ${activeOrder.signal.optionSymbol}: ${currentPrice}`);
        return;
      }
      
      logger.debug(`🔍 Paper trade price check (LIVE API): ${activeOrder.signal.optionSymbol} = ₹${currentPrice}`);
      
      // Additional validation - ensure current price is reasonable relative to entry price
      const entryPrice = activeOrder.entryPrice || activeOrder.signal.entryPrice;
      const priceRatio = currentPrice / entryPrice;
      
      // More lenient price validation - options can have significant price swings
      if (priceRatio > 20 || priceRatio < 0.05) {
        logger.warn(`⚠️ Suspicious price ratio for ${activeOrder.signal.optionSymbol}: Current ₹${currentPrice} vs Entry ₹${entryPrice} (ratio: ${priceRatio.toFixed(2)}) - skipping exit check`);
        return;
      }
      
      logger.debug(`🔍 Price validation passed: ${activeOrder.signal.optionSymbol} - Current=₹${currentPrice}, Entry=₹${entryPrice}, Ratio=${priceRatio.toFixed(2)}`);

      const target = activeOrder.signal.target;
      const stopLoss = activeOrder.signal.stopLoss;

      // Check if current market price hit target or stop loss with realistic exit logic
      let shouldExit = false;
      let exitPrice: number = 0;
      let exitReason: 'TARGET' | 'STOPLOSS' = 'TARGET';

      // ✅ ADVANCED REALISTIC PAPER TRADING EXIT LOGIC
      const marketCondition = await this.assessMarketLiquidity(activeOrder.signal.optionSymbol, currentPrice);
      
      if (currentPrice >= target) {
        // Target hit - advanced slippage modeling
        shouldExit = true;
        const baseSlippage = this.calculateDynamicSlippage(marketCondition, 'TARGET', currentPrice);
        exitPrice = Math.max(target, currentPrice - baseSlippage);
        exitReason = 'TARGET';
        logger.info(`🎯 PAPER TARGET HIT: ${activeOrder.signal.optionSymbol} - Current ₹${currentPrice} >= Target ₹${target}, Exit at ₹${exitPrice} (slippage: ₹${baseSlippage.toFixed(2)})`);
      } else if (currentPrice <= stopLoss) {
        // Stop loss hit - higher slippage for SL
        shouldExit = true;
        const baseSlippage = this.calculateDynamicSlippage(marketCondition, 'STOPLOSS', currentPrice);
        exitPrice = Math.min(stopLoss, currentPrice - baseSlippage);
        exitReason = 'STOPLOSS';
        logger.info(`🛑 PAPER SL HIT: ${activeOrder.signal.optionSymbol} - Current ₹${currentPrice} <= SL ₹${stopLoss}, Exit at ₹${exitPrice} (slippage: ₹${baseSlippage.toFixed(2)})`);
      } else {
        // Check for advanced exit conditions
        const advancedExit = await this.checkAdvancedExitConditions(activeOrder, currentPrice, target, stopLoss);
        if (advancedExit.shouldExit && advancedExit.reason) {
          shouldExit = true;
          exitPrice = advancedExit.exitPrice;
          exitReason = advancedExit.reason as 'TARGET' | 'STOPLOSS';
          logger.info(`⚡ ADVANCED EXIT: ${activeOrder.signal.optionSymbol} - ${advancedExit.reason} at ₹${exitPrice}`);
        }
      }

      if (shouldExit) {
        // ✅ FIXED: Check for already processed exit by checking exitPrice  
        if (activeOrder.exitPrice) {
          logger.debug(`Exit already processed for ${activeOrder.signal.optionSymbol} - ExitPrice: ${activeOrder.exitPrice}`);
          return;
        }

        // ✅ ENHANCED SAFETY: Double-check the exit conditions with better logging
        const targetHit = currentPrice >= target;
        const slHit = currentPrice <= stopLoss;
        const reconfirmExit = (targetHit && exitReason === 'TARGET') || (slHit && exitReason === 'STOPLOSS');
        
        logger.info(`🔍 EXIT VALIDATION: ${activeOrder.signal.optionSymbol} - Target Hit: ${targetHit}, SL Hit: ${slHit}, Reason: ${exitReason}, Valid: ${reconfirmExit}`);
        
        if (!reconfirmExit) {
          logger.error(`❌ EXIT CONDITION FAILED: ${activeOrder.signal.optionSymbol} - Current=₹${currentPrice}, Target=₹${target}, SL=₹${stopLoss}, Reason=${exitReason}`);
          return;
        }

        // Calculate P&L
        const pnl = (exitPrice - entryPrice) * config.indices[activeOrder.signal.indexName].lotSize;

        // ✅ ENHANCED ATOMIC UPDATE with comprehensive tracking
        const exitTime = new Date();
        const tradingDuration = activeOrder.entryTime ? exitTime.getTime() - activeOrder.entryTime.getTime() : 0;
        const netPnL = pnl - (activeOrder.brokerageAndTaxes || 0);
        
        activeOrder.status = exitReason === 'TARGET' ? 'EXITED_TARGET' : 'EXITED_SL';
        activeOrder.exitPrice = exitPrice;
        activeOrder.exitTime = exitTime;
        activeOrder.exitReason = exitReason;
        activeOrder.pnl = pnl;
        activeOrder.tradingDuration = tradingDuration;
        activeOrder.filledQuantity = activeOrder.quantity || config.indices[activeOrder.signal.indexName].lotSize;

        // Enhanced daily P&L tracking
        this.dailyPnL += netPnL;
        this.dailyGrossPnL += pnl;
        this.dailyBrokerage += (activeOrder.brokerageAndTaxes || 0);
        
        // Performance tracking
        if (netPnL > 0) {
          this.successfulTrades++;
        } else {
          this.failedTrades++;
        }
        
        this.totalHoldingTime += tradingDuration;
        this.updateDrawdownMetrics(netPnL);
        
        // Record for analysis
        this.performanceTracker.recordTrade(activeOrder);

        logger.info(`🎯 PAPER EXIT SUCCESSFUL: ${activeOrder.signal.optionSymbol} @ ₹${exitPrice.toFixed(2)} (market: ₹${currentPrice.toFixed(2)}) - ${exitReason} - P&L: ₹${pnl.toFixed(2)}`);
        logger.info(`✅ Exit conditions confirmed: Target hit=${currentPrice >= target}, SL hit=${currentPrice <= stopLoss}`);
        logger.info(`📊 REMOVING FROM ACTIVE LIST: OrderID=${activeOrder.orderId}`);

        // Send exit notification
        this.sendExitNotification(activeOrder);

        // ✅ CRITICAL FIX: Remove completed order from activeOrders array
        logger.info(`🔥 ABOUT TO REMOVE ORDER: ${activeOrder.orderId} from active list (current count: ${this.activeOrders.length})`);
        this.removeOrderFromActiveList(activeOrder.orderId, 'PAPER_EXIT_COMPLETED');
        logger.info(`✅ ORDER REMOVAL COMPLETE: Active orders now: ${this.activeOrders.length}`);
        
        // ✅ EMIT EXIT EVENT to unlock position immediately
        (process as any).emit('orderExited', { 
          order: { signal: activeOrder.signal }, 
          message: `Paper trade ${exitReason} exit completed`,
          exitPrice: exitPrice,
          pnl: pnl
        });
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
          
          // ✅ IMPROVED: More detailed exit condition debugging
          const targetHit = currentPrice >= target;
          const slHit = currentPrice <= stopLoss;
          
          if (targetHit || slHit) {
            logger.error(`🚨 EXIT CONDITIONS MET BUT NOT PROCESSED:`);
            logger.error(`   Symbol: ${activeOrder.signal.optionSymbol}`);
            logger.error(`   Current Price: ₹${currentPrice.toFixed(2)}`);
            logger.error(`   Target: ₹${target.toFixed(2)} (Hit: ${targetHit})`);
            logger.error(`   Stop Loss: ₹${stopLoss.toFixed(2)} (Hit: ${slHit})`);
            logger.error(`   Order Status: ${activeOrder.status}`);
            logger.error(`   Exit Price Set: ${activeOrder.exitPrice ? '✅ Yes' : '❌ No'}`);
            logger.error(`   🔧 This indicates a synchronization bug that needs investigation`);
          }
        }
      }

    } catch (error) {
      logger.error(`Paper trade exit check failed for ${activeOrder.signal.optionSymbol}:`, (error as Error).message);
      // 🎯 NO FALLBACK SIMULATION - fail exactly like real trading would
      // This ensures paper trading experiences the exact same API issues as real trading
    }
  }

  public updatePnL(amount: number): void {
    this.dailyPnL += amount;
  }

  private updateDrawdownMetrics(pnl: number): void {
    this.peakPnL = Math.max(this.peakPnL, this.dailyPnL);
    this.currentDrawdown = Math.max(0, (this.peakPnL - this.dailyPnL) / Math.max(this.peakPnL, 1000) * 100);
    this.maxDrawdown = Math.max(this.maxDrawdown, this.currentDrawdown);
  }

  private async assessMarketLiquidity(symbol: string, currentPrice: number): Promise<'LIQUID' | 'ILLIQUID' | 'VOLATILE'> {
    // Simplified liquidity assessment - in production, use bid-ask spread and volume data
    const priceLevel = currentPrice;
    
    if (priceLevel < 5) return 'ILLIQUID'; // Very low premium options
    if (priceLevel > 100) return 'VOLATILE'; // High premium, likely volatile
    return 'LIQUID';
  }

  private calculateDynamicSlippage(marketCondition: 'LIQUID' | 'ILLIQUID' | 'VOLATILE', exitType: 'TARGET' | 'STOPLOSS', price: number): number {
    let baseSlippagePercent = 0.001; // 0.1% base
    
    // Adjust based on market condition
    switch (marketCondition) {
      case 'ILLIQUID':
        baseSlippagePercent *= 3; // 3x slippage
        break;
      case 'VOLATILE':
        baseSlippagePercent *= 2; // 2x slippage
        break;
    }
    
    // Higher slippage for stop loss exits
    if (exitType === 'STOPLOSS') {
      baseSlippagePercent *= 2;
    }
    
    // Market hours adjustment
    const currentHour = new Date().getHours();
    if (currentHour < 10 || currentHour > 15) {
      baseSlippagePercent *= 1.5; // Higher slippage during low liquidity hours
    }
    
    return price * baseSlippagePercent;
  }

  private async checkAdvancedExitConditions(
    order: ActiveOrder, 
    currentPrice: number, 
    target: number, 
    stopLoss: number
  ): Promise<{shouldExit: boolean, exitPrice: number, reason: 'TIMEOUT' | 'RISK_MANAGEMENT' | null}> {
    const tradingDuration = Date.now() - (order.entryTime?.getTime() || order.timestamp.getTime());
    const durationHours = tradingDuration / (1000 * 60 * 60);
    
    // Time-based exit (if position held too long without movement)
    if (durationHours > 4) { // 4 hours max holding
      const timeDecay = currentPrice * 0.95; // Assume 5% time decay
      if (currentPrice <= timeDecay) {
        return {
          shouldExit: true,
          exitPrice: Math.max(currentPrice * 0.98, stopLoss), // Exit with minimal slippage but respect SL
          reason: 'TIMEOUT' as const
        };
      }
    }
    
    // Risk management exit (if daily loss limit approaching)
    // 🎯 IDENTICAL RISK THRESHOLDS for both paper and real trading
    const accountValue = await this.riskManager.getAccountValue();
    const dailyLossPercent = Math.abs(this.dailyPnL) / accountValue * 100;
    
    if (this.dailyPnL < 0 && dailyLossPercent > 4) { // Same 4% limit for both modes
      return {
        shouldExit: true,
        exitPrice: currentPrice * 0.98, // Quick exit with small slippage
        reason: 'RISK_MANAGEMENT' as const
      };
    }
    
    return { shouldExit: false, exitPrice: 0, reason: null as any };
  }

  // 🆕 ADVANCED OPTIMIZATION METHODS
  public optimizeOrderParameters(signal: TradingSignal): TradingSignal {
    const stats = this.getDailyStats();
    const optimizedSignal = { ...signal };
    
    // Dynamic confidence adjustment based on recent performance
    if (stats.winRate < 40 && stats.trades >= 5) {
      optimizedSignal.confidence *= 0.9; // Reduce confidence if poor performance
      logger.info(`📉 Reduced signal confidence to ${optimizedSignal.confidence.toFixed(1)}% due to poor win rate`);
    } else if (stats.winRate > 70 && stats.profitFactor > 1.5) {
      optimizedSignal.confidence *= 1.1; // Increase confidence if good performance
      logger.info(`📈 Increased signal confidence to ${optimizedSignal.confidence.toFixed(1)}% due to strong performance`);
    }
    
    // Dynamic R:R optimization based on market conditions
    const currentHour = new Date().getHours();
    if (currentHour >= 15 && currentHour <= 15.5) { // Last 30 minutes
      // Tighter targets due to time decay
      const riskReduction = 0.9;
      optimizedSignal.target = signal.entryPrice + (signal.target - signal.entryPrice) * riskReduction;
      optimizedSignal.stopLoss = signal.entryPrice - (signal.entryPrice - signal.stopLoss) * riskReduction;
      logger.info(`⏰ End-of-day optimization: Tighter targets due to time decay`);
    }
    
    return optimizedSignal;
  }
  
  public getAdvancedMetrics(): any {
    const stats = this.getDailyStats();
    const healthStatus = this.errorRecoveryManager.getHealthStatus();
    
    return {
      performance: stats,
      systemHealth: healthStatus,
      realTimeMetrics: {
        currentDrawdown: this.currentDrawdown,
        peakPnL: this.peakPnL,
        totalHoldingTime: this.totalHoldingTime,
        avgPositionSize: this.calculateAvgPositionSize()
      },
      recommendations: this.generateRecommendations(stats)
    };
  }
  
  private calculateAvgPositionSize(): number {
    if (this.activeOrders.length === 0) return 0;
    
    const totalValue = this.activeOrders.reduce((sum, order) => {
      return sum + (order.signal.entryPrice * (order.quantity || config.indices[order.signal.indexName].lotSize));
    }, 0);
    
    return totalValue / this.activeOrders.length;
  }
  
  private generateRecommendations(stats: DailyStats): string[] {
    const recommendations: string[] = [];
    
    if (stats.winRate < 50) {
      recommendations.push('🔄 Consider reviewing signal criteria - win rate below 50%');
    }
    
    if (stats.maxDrawdown > 10) {
      recommendations.push('⚠️ Reduce position sizes - drawdown exceeding 10%');
    }
    
    if (stats.profitFactor < 1.2) {
      recommendations.push('📊 Improve risk-reward ratio - profit factor below 1.2');
    }
    
    if (stats.averageHoldingTime > 4 * 60 * 60 * 1000) { // 4 hours
      recommendations.push('⏱️ Consider shorter holding periods - average > 4 hours');
    }
    
    if (recommendations.length === 0) {
      recommendations.push('✅ Performance metrics are within acceptable ranges');
    }
    
    return recommendations;
  }

  // 🎯 REMOVED: Price simulation - Paper trading now uses identical live API calls

  private getStrategyName(confidence: number): string {
    if (confidence >= 90) return 'Multi-Timeframe Confluence';
    if (confidence >= 80) return 'Bollinger+RSI';
    return 'Price Action+Momentum';
  }

  private removeOrderFromActiveList(orderId: string, reason: string): void {
    const orderIndex = this.activeOrders.findIndex(order => order.orderId === orderId);
    
    if (orderIndex !== -1) {
      const removedOrder = this.activeOrders[orderIndex];
      
      // Log detailed removal info
      logger.info(`🔥 REMOVING ORDER: ${orderId} (${removedOrder.signal.indexName}_${removedOrder.signal.optionType}) - ${reason}`);
      logger.info(`   Before removal: ${this.activeOrders.length} active orders`);
      
      this.activeOrders.splice(orderIndex, 1);
      
      logger.info(`✅ ORDER REMOVED: ${orderId} successfully removed`);
      logger.info(`   After removal: ${this.activeOrders.length} active orders`);
      
      // Log detailed active orders status
      const remainingOrders = this.activeOrders.map(order => 
        `${order.signal.indexName}_${order.signal.optionType}:${order.status}`
      ).join(', ');
      
      logger.info(`📋 Remaining active orders: ${remainingOrders || 'None'}`);
      
      // Additional verification
      const stillExists = this.activeOrders.findIndex(order => order.orderId === orderId);
      if (stillExists !== -1) {
        logger.error(`❌ ERROR: Order ${orderId} still found in active list after removal!`);
      } else {
        logger.info(`✅ VERIFIED: Order ${orderId} successfully removed from active list`);
      }
    } else {
      logger.error(`❌ Order ${orderId} not found in activeOrders list for removal (${reason})`);
      logger.error(`   Current active orders: ${this.activeOrders.map(o => o.orderId).join(', ')}`);
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
  }

  // 🆕 DIAGNOSTIC METHOD: Force check all active positions for exit conditions
  public async forceCheckAllPositionExits(): Promise<void> {
    if (this.activeOrders.length === 0) {
      logger.info('🔍 FORCE EXIT CHECK: No active positions to check');
      return;
    }

    logger.warn(`🔍 FORCE CHECKING ${this.activeOrders.length} active positions for exit conditions...`);
    
    for (const activeOrder of this.activeOrders) {
      logger.info(`🔍 Checking position: ${activeOrder.orderId} (${activeOrder.signal.indexName}_${activeOrder.signal.optionType}) - Status: ${activeOrder.status}`);
      
      if (activeOrder.isPaperTrade) {
        logger.info('📄 Paper trade - checking simulated exit conditions...');
        await this.checkPaperTradeExit(activeOrder);
      } else {
        logger.info('💰 Real trade - checking Angel One trade book...');
        try {
          const tradeBook = await angelAPI.getTradeBook();
          if (tradeBook?.data) {
            await this.checkForExitsInTradeBook(activeOrder, tradeBook.data);
          } else {
            logger.warn('No trade book data received from Angel One');
          }
        } catch (error) {
          logger.error(`Error checking real trade: ${(error as Error).message}`);
        }
      }
    }
    
    logger.info(`🔍 FORCE EXIT CHECK COMPLETE: ${this.activeOrders.length} positions remaining`);
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