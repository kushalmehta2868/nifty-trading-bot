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
export declare const INDIAN_MARKET_HOURS: MarketHours;
export declare function isMarketOpen(date?: Date): boolean;
export declare function getNextMarketOpen(date?: Date): Date;
export declare function getTimeUntilMarketOpen(date?: Date): number;
export declare function formatTimeUntilMarketOpen(date?: Date): string;
export declare function getTimezoneInfo(): {
    serverTime: string;
    serverTimezone: string;
    istTime: string;
    marketOpen: boolean;
};
