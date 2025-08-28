import { TradingSignal } from '../types';
interface ActiveOrder {
    signal: TradingSignal;
    orderId: string;
    status: 'PLACED' | 'FILLED' | 'CANCELLED' | 'REJECTED';
    timestamp: Date;
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
    initialize(): Promise<void>;
    private processSignal;
    private simulateOrder;
    private placeRealOrder;
    getDailyStats(): DailyStats;
    getActiveOrders(): ActiveOrder[];
    cancelOrder(orderId: string): Promise<boolean>;
    updatePnL(amount: number): void;
    resetDailyStats(): void;
}
export declare const orderService: OrderService;
export {};
