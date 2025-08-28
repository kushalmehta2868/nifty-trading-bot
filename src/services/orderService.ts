import { angelAPI } from './angelAPI';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { TradingSignal, OrderDetails, OrderResponse } from '../types';

interface ActiveOrder {
  signal: TradingSignal;
  orderId: string;
  status: 'PLACED' | 'FILLED' | 'CANCELLED' | 'REJECTED';
  timestamp: Date;
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

  public async initialize(): Promise<void> {
    // Listen for trading signals to place orders
    (process as any).on('tradingSignal', async (signal: TradingSignal) => {
      if (config.trading.autoTrade) {
        await this.processSignal(signal);
      }
    });

    logger.info('📋 Order service initialized');
  }

  private async processSignal(signal: TradingSignal): Promise<void> {
    try {
      if (this.dailyTrades >= config.trading.maxPositions) {
        logger.warn('Daily position limit reached, skipping order');
        return;
      }

      logger.info(`🔄 Processing order for ${signal.optionSymbol}`);

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
        logger.info(`✅ Order placed: ${signal.optionSymbol}`);

        // Send confirmation to Telegram
        (process as any).emit('orderPlaced', { signal, orderId: orderResult.orderId });
      }

    } catch (error) {
      logger.error('Order processing failed:', (error as Error).message);
    }
  }

  private async simulateOrder(signal: TradingSignal): Promise<OrderResult> {
    // Simulate order placement
    return new Promise(resolve => {
      setTimeout(() => {
        resolve({
          success: true,
          orderId: `ORD${Date.now()}`,
          price: signal.entryPrice,
          quantity: config.indices[signal.indexName].lotSize
        });
      }, 1000);
    });
  }

  private async placeRealOrder(signal: TradingSignal): Promise<OrderResponse> {
    try {
      const orderDetails: OrderDetails = {
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
        quantity: config.indices[signal.indexName].lotSize.toString()
      };

      // This would call the actual Angel API
      const response = await angelAPI.makeRequest(
        '/rest/secure/angelbroking/order/v1/placeOrder',
        'POST',
        orderDetails
      );

      return response;

    } catch (error) {
      logger.error('Real order placement failed:', (error as Error).message);
      throw error;
    }
  }

  public getDailyStats(): DailyStats {
    return {
      trades: this.dailyTrades,
      activeOrders: this.activeOrders.length,
      pnl: this.dailyPnL
    };
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

      // In real implementation, cancel via Angel API
      // const response = await angelAPI.makeRequest('/rest/secure/angelbroking/order/v1/cancelOrder', 'POST', { orderid: orderId });

      this.activeOrders[orderIndex].status = 'CANCELLED';
      logger.info(`Order ${orderId} cancelled successfully`);
      
      return true;

    } catch (error) {
      logger.error('Order cancellation failed:', (error as Error).message);
      return false;
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
}

export const orderService = new OrderService();