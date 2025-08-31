import { TradingStats } from './types';
declare class WebSocketTradingBot {
    private isRunning;
    private startTime;
    private stats;
    private dailySummaryTimeout;
    private marketOpenTimeout;
    private heartbeatInterval;
    start(): Promise<void>;
    private scheduleDailySummary;
    private scheduleMarketOpen;
    private scheduleMarketClose;
    stop(): Promise<void>;
    getStats(): TradingStats;
    isActive(): boolean;
    private startHeartbeat;
    private stopHeartbeat;
}
declare const bot: WebSocketTradingBot;
export default bot;
