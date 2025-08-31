import { TradingSignal } from '../types';
interface ActiveOrder {
    signal: TradingSignal;
    orderId: string;
    status: 'PLACED' | 'FILLED' | 'CANCELLED' | 'REJECTED' | 'EXITED_TARGET' | 'EXITED_SL';
    timestamp: Date;
    entryPrice?: number;
    exitPrice?: number;
    exitReason?: 'TARGET' | 'STOPLOSS' | 'MANUAL';
    pnl?: number;
    isPaperTrade?: boolean;
}
interface DailyStats {
    trades: number;
    activeOrders: number;
    pnl: number;
}
declare class OrderService {
    private activeOrders;
    private dailyTrades;
    private dailyPnL;
    private monitoringInterval;
    initialize(): Promise<void>;
    private processSignal;
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
    private placeRealOrder;
    private generateExpiryString;
    private calculateStrike;
    private startOrderMonitoring;
    private checkOrderStatus;
    private processOrderUpdate;
    private checkForExitsInTradeBook;
    private processIndividualOrderStatus;
    private sendEntryNotification;
    private sendExitNotification;
    getDailyStats(): DailyStats;
    getDailyBalanceSummary(): Promise<string>;
    getActiveOrders(): ActiveOrder[];
    cancelOrder(orderId: string): Promise<boolean>;
    private checkSufficientBalance;
    private generatePaperOrderId;
    private simulateOrderFill;
    private checkPaperTradeExit;
    updatePnL(amount: number): void;
    resetDailyStats(): void;
    stopMonitoring(): void;
}
export declare const orderService: OrderService;
export {};
