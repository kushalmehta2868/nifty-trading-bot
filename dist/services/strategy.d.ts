declare class TradingStrategy {
    private lastSignalTime;
    private priceBuffers;
    initialize(): Promise<void>;
    private processTick;
    private analyzeSignal;
    private executeSignal;
    private calculateEMA;
    private calculateRSI;
    private calculateStrike;
    private estimateOptionPrice;
    private generateOptionSymbol;
    private isInCooldown;
}
export declare const strategy: TradingStrategy;
export {};
