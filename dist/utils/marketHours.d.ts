export interface MarketHours {
    open: {
        hour: number;
        minute: number;
    };
    close: {
        hour: number;
        minute: number;
    };
    timezone: string;
}
export declare const NSE_MARKET_HOURS: MarketHours;
export declare const TRADING_SIGNAL_HOURS: MarketHours;
export declare function isNSEMarketOpen(date?: Date): boolean;
export declare function isTradingSignalTime(date?: Date): boolean;
export declare function isMarketOpen(date?: Date): boolean;
export declare function getMarketStatus(): {
    nse: boolean;
    trading: boolean;
    any: boolean;
};
export declare function getNextMarketOpen(date?: Date): Date;
export declare function getTimeUntilMarketOpen(date?: Date): number;
export declare function formatTimeUntilMarketOpen(date?: Date): string;
export declare function getMarketPhase(date?: Date): 'PRE_MARKET' | 'MARKET_OPEN' | 'POST_MARKET' | 'MARKET_CLOSED';
export declare function getTimezoneInfo(): {
    serverTime: string;
    serverTimezone: string;
    istTime: string;
    marketOpen: boolean;
    tradingSignalActive: boolean;
    marketPhase: string;
    currentHour: number;
    currentMinute: number;
    dayOfWeek: number;
    isHoliday: boolean;
    isWeekend: boolean;
    isTradingDay: boolean;
};
export declare function getTradingHoursString(): string;
