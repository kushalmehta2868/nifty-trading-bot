import { TradingStats } from './types';
declare class WebSocketTradingBot {
    private isRunning;
    private startTime;
    private stats;
    private dailySummaryTimeout;
    private marketOpenTimeout;
    start(): Promise<void>;
    private scheduleDailySummary;
    private scheduleMarketOpen;
    private scheduleMarketClose;
    stop(): Promise<void>;
    getStats(): TradingStats;
    isActive(): boolean;
}
declare const bot: WebSocketTradingBot;
export default bot;
