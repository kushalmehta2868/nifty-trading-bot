import { PriceSubscriber, IndexName } from '../types';
declare class WebSocketFeed {
    private ws;
    private isConnected;
    private reconnectAttempts;
    private maxReconnectAttempts;
    private subscribers;
    private priceData;
    private mockInterval;
    initialize(): Promise<boolean>;
    private connect;
    private subscribe;
    private handleMessage;
    private updatePrice;
    private startMockFeed;
    addSubscriber(callback: PriceSubscriber): void;
    private notifySubscribers;
    getCurrentPrice(indexName: IndexName): number;
    getPriceHistory(indexName: IndexName): number[];
    private scheduleReconnect;
    disconnect(): void;
}
export declare const webSocketFeed: WebSocketFeed;
export {};
