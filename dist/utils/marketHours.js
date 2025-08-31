"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TRADING_SIGNAL_HOURS = exports.NSE_MARKET_HOURS = void 0;
exports.isNSEMarketOpen = isNSEMarketOpen;
exports.isTradingSignalTime = isTradingSignalTime;
exports.isMarketOpen = isMarketOpen;
exports.getMarketStatus = getMarketStatus;
exports.getNextMarketOpen = getNextMarketOpen;
exports.getTimeUntilMarketOpen = getTimeUntilMarketOpen;
exports.formatTimeUntilMarketOpen = formatTimeUntilMarketOpen;
exports.getMarketPhase = getMarketPhase;
exports.getTimezoneInfo = getTimezoneInfo;
exports.getTradingHoursString = getTradingHoursString;
const holidays_1 = require("./holidays");
// Updated NSE Market Hours: 9:30 AM to 3:00 PM
exports.NSE_MARKET_HOURS = {
    open: { hour: 9, minute: 30 }, // 9:30 AM
    close: { hour: 15, minute: 0 }, // 3:00 PM
    timezone: 'Asia/Kolkata'
};
// Trading signal hours (subset of market hours): 9:30 AM to 3:00 PM
exports.TRADING_SIGNAL_HOURS = {
    open: { hour: 9, minute: 30 }, // 9:30 AM
    close: { hour: 15, minute: 0 }, // 3:00 PM
    timezone: 'Asia/Kolkata'
};
function isNSEMarketOpen(date = new Date()) {
    const istDate = getISTDate(date);
    // Check if it's a trading day (not weekend or holiday)
    if (!(0, holidays_1.isNSETradingDay)(istDate)) {
        return false;
    }
    const currentHour = istDate.getHours();
    const currentMinute = istDate.getMinutes();
    const currentTimeInMinutes = currentHour * 60 + currentMinute;
    const marketOpenInMinutes = exports.NSE_MARKET_HOURS.open.hour * 60 + exports.NSE_MARKET_HOURS.open.minute;
    const marketCloseInMinutes = exports.NSE_MARKET_HOURS.close.hour * 60 + exports.NSE_MARKET_HOURS.close.minute;
    return currentTimeInMinutes >= marketOpenInMinutes && currentTimeInMinutes <= marketCloseInMinutes;
}
// Check if trading signals should be active (same as market hours now)
function isTradingSignalTime(date = new Date()) {
    const istDate = getISTDate(date);
    // Check if it's a trading day
    if (!(0, holidays_1.isNSETradingDay)(istDate)) {
        return false;
    }
    const currentHour = istDate.getHours();
    const currentMinute = istDate.getMinutes();
    const currentTimeInMinutes = currentHour * 60 + currentMinute;
    const signalStartInMinutes = exports.TRADING_SIGNAL_HOURS.open.hour * 60 + exports.TRADING_SIGNAL_HOURS.open.minute;
    const signalEndInMinutes = exports.TRADING_SIGNAL_HOURS.close.hour * 60 + exports.TRADING_SIGNAL_HOURS.close.minute;
    return currentTimeInMinutes >= signalStartInMinutes && currentTimeInMinutes <= signalEndInMinutes;
}
// Alias for backward compatibility
function isMarketOpen(date = new Date()) {
    return isNSEMarketOpen(date);
}
function getMarketStatus() {
    return {
        nse: isNSEMarketOpen(),
        trading: isTradingSignalTime(),
        any: isNSEMarketOpen()
    };
}
function getISTDate(date = new Date()) {
    // Convert to IST properly
    const utcTime = date.getTime() + (date.getTimezoneOffset() * 60000);
    const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30
    return new Date(utcTime + istOffset);
}
function getNextMarketOpen(date = new Date()) {
    const istDate = getISTDate(date);
    // Check if market is currently open
    if (isNSEMarketOpen(date)) {
        return new Date(date); // Return current time if market is open
    }
    // Check if today is a trading day and we're before market open
    const currentTimeInMinutes = istDate.getHours() * 60 + istDate.getMinutes();
    const marketOpenInMinutes = exports.NSE_MARKET_HOURS.open.hour * 60 + exports.NSE_MARKET_HOURS.open.minute;
    if ((0, holidays_1.isNSETradingDay)(istDate) && currentTimeInMinutes < marketOpenInMinutes) {
        // Today is a trading day and market hasn't opened yet
        const todayOpen = new Date(istDate);
        todayOpen.setHours(exports.NSE_MARKET_HOURS.open.hour, exports.NSE_MARKET_HOURS.open.minute, 0, 0);
        // Convert back to local timezone
        const utcTime = todayOpen.getTime() - (5.5 * 60 * 60 * 1000);
        const localTime = utcTime - (new Date().getTimezoneOffset() * 60000);
        return new Date(localTime);
    }
    // Find the next trading day
    let nextDay = new Date(istDate);
    nextDay.setDate(nextDay.getDate() + 1);
    while (!(0, holidays_1.isNSETradingDay)(nextDay)) {
        nextDay.setDate(nextDay.getDate() + 1);
    }
    nextDay.setHours(exports.NSE_MARKET_HOURS.open.hour, exports.NSE_MARKET_HOURS.open.minute, 0, 0);
    // Convert back to local timezone
    const utcTime = nextDay.getTime() - (5.5 * 60 * 60 * 1000);
    const localTime = utcTime - (new Date().getTimezoneOffset() * 60000);
    return new Date(localTime);
}
function getTimeUntilMarketOpen(date = new Date()) {
    if (isNSEMarketOpen(date)) {
        return 0;
    }
    const nextOpen = getNextMarketOpen(date);
    const currentTime = date.getTime();
    const timeUntilOpen = nextOpen.getTime() - currentTime;
    // Ensure we don't return negative values or extremely large values
    if (timeUntilOpen < 0) {
        return 0;
    }
    // Cap at 7 days maximum (prevent scheduling errors)
    const maxTime = 7 * 24 * 60 * 60 * 1000;
    return Math.min(timeUntilOpen, maxTime);
}
function formatTimeUntilMarketOpen(date = new Date()) {
    if (isNSEMarketOpen(date)) {
        return 'NSE market is open (9:30 AM - 3:00 PM)';
    }
    const istDate = getISTDate(date);
    // Check if today is a holiday or weekend
    if ((0, holidays_1.isNSEHoliday)(istDate)) {
        return `Market closed - NSE Holiday`;
    }
    if ((0, holidays_1.isWeekend)(istDate)) {
        return `Market closed - Weekend`;
    }
    const nextOpen = getNextMarketOpen(date);
    const msUntilOpen = nextOpen.getTime() - date.getTime();
    // Prevent negative values
    if (msUntilOpen < 0) {
        return 'Market opening soon...';
    }
    const hours = Math.floor(msUntilOpen / (1000 * 60 * 60));
    const minutes = Math.floor((msUntilOpen % (1000 * 60 * 60)) / (1000 * 60));
    // Debug logging for troubleshooting
    console.log(`[DEBUG] Current time: ${date.toISOString()}`);
    console.log(`[DEBUG] IST time: ${istDate.toISOString()}`);
    console.log(`[DEBUG] Next open: ${nextOpen.toISOString()}`);
    console.log(`[DEBUG] Ms until open: ${msUntilOpen}`);
    console.log(`[DEBUG] Hours: ${hours}, Minutes: ${minutes}`);
    if (hours > 24) {
        const days = Math.floor(hours / 24);
        const remainingHours = hours % 24;
        return `${days}d ${remainingHours}h ${minutes}m until NSE opens (9:30 AM)`;
    }
    return `${hours}h ${minutes}m until NSE opens (9:30 AM)`;
}
// Get current market phase
function getMarketPhase(date = new Date()) {
    const istDate = getISTDate(date);
    if (!(0, holidays_1.isNSETradingDay)(istDate)) {
        return 'MARKET_CLOSED';
    }
    const currentTimeInMinutes = istDate.getHours() * 60 + istDate.getMinutes();
    const marketOpenInMinutes = exports.NSE_MARKET_HOURS.open.hour * 60 + exports.NSE_MARKET_HOURS.open.minute;
    const marketCloseInMinutes = exports.NSE_MARKET_HOURS.close.hour * 60 + exports.NSE_MARKET_HOURS.close.minute;
    if (currentTimeInMinutes < marketOpenInMinutes) {
        return 'PRE_MARKET';
    }
    else if (currentTimeInMinutes >= marketOpenInMinutes && currentTimeInMinutes <= marketCloseInMinutes) {
        return 'MARKET_OPEN';
    }
    else {
        return 'POST_MARKET';
    }
}
// Debug function to verify timezone handling
function getTimezoneInfo() {
    const now = new Date();
    const istDate = getISTDate(now);
    return {
        serverTime: now.toISOString(),
        serverTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        istTime: now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
        marketOpen: isNSEMarketOpen(now),
        tradingSignalActive: isTradingSignalTime(now),
        marketPhase: getMarketPhase(now),
        currentHour: istDate.getHours(),
        currentMinute: istDate.getMinutes(),
        dayOfWeek: istDate.getDay(),
        isHoliday: (0, holidays_1.isNSEHoliday)(istDate),
        isWeekend: (0, holidays_1.isWeekend)(istDate),
        isTradingDay: (0, holidays_1.isNSETradingDay)(istDate)
    };
}
// Get trading hours as human readable string
function getTradingHoursString() {
    return `${exports.NSE_MARKET_HOURS.open.hour}:${exports.NSE_MARKET_HOURS.open.minute.toString().padStart(2, '0')} AM - ${exports.NSE_MARKET_HOURS.close.hour}:${exports.NSE_MARKET_HOURS.close.minute.toString().padStart(2, '0') === '00' ? '00' : exports.NSE_MARKET_HOURS.close.minute.toString().padStart(2, '0')} PM (IST)`;
}
//# sourceMappingURL=marketHours.js.map