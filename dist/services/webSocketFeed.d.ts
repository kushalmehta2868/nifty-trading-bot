import { PriceSubscriber, IndexName } from '../types';
declare class WebSocketFeed {
    private ws;
    private isConnected;
    private reconnectAttempts;
    private maxReconnectAttempts;
    private subscribers;
    private priceData;
    private pingInterval;
    private pongTimeout;
    private lastPongReceived;
    private readonly PING_INTERVAL;
    private readonly PONG_TIMEOUT;
    private healthCheckInterval;
    private reconnectTimeout;
    initialize(): Promise<boolean>;
    private connect;
    private subscribe;
    private handleMessage;
    private updatePrice;
    addSubscriber(callback: PriceSubscriber): void;
    private notifySubscribers;
    getCurrentPrice(indexName: IndexName): number;
    getPriceHistory(indexName: IndexName): number[];
    private scheduleReconnect;
    private startHealthCheck;
    private stopHealthCheck;
    private startPingPong;
    private stopPingPong;
    isConnectionHealthy(): boolean;
    getConnectionStatus(): {
        connected: boolean;
        healthy: boolean;
        lastPong: number;
    };
    disconnect(): void;
}
export declare const webSocketFeed: WebSocketFeed;
export {};
