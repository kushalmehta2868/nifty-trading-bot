import { PriceUpdate, IndexName } from '../types';
interface PriceBufferItem {
    price: number;
    timestamp: Date;
}
interface PriceBuffers {
    NIFTY: PriceBufferItem[];
    BANKNIFTY: PriceBufferItem[];
}
declare class TradingStrategy {
    private lastSignalTime;
    priceBuffers: PriceBuffers;
    initialize(): Promise<void>;
    processTick(indexName: IndexName, priceUpdate: PriceUpdate): Promise<void>;
    private analyzeSignal;
    private executeSignal;
    private getRealOptionPrice;
    private generateExpiryString;
    private calculateEMA;
    private calculateRSI;
    private calculateStrike;
    private calculateOptimalStrike;
    private calculateSMA;
    private generateOptionSymbol;
    private isSignalInCooldown;
    private getTriggerLevel;
    private isWithinTradingHours;
    getCurrentMarketConditions(): Promise<string>;
}
export declare const strategy: TradingStrategy;
export {};
