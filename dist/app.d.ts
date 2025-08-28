import { TradingStats } from './types';
declare class WebSocketTradingBot {
    private isRunning;
    private startTime;
    private stats;
    private dailySummaryTimeout;
    start(): Promise<void>;
    private scheduleDailySummary;
    stop(): Promise<void>;
    getStats(): TradingStats;
    isActive(): boolean;
}
declare const bot: WebSocketTradingBot;
export default bot;
