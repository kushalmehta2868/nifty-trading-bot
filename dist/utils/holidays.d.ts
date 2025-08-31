export declare const nseHolidays: string[];
export declare const isNSEHoliday: (date: Date) => boolean;
export declare const isWeekend: (date: Date) => boolean;
export declare const isNSETradingDay: (date: Date) => boolean;
export declare const getNextTradingDay: (date: Date) => Date;
export declare const getTradingDaysInMonth: (year: number, month: number) => Date[];
