"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.INDIAN_MARKET_HOURS = void 0;
exports.isMarketOpen = isMarketOpen;
exports.getNextMarketOpen = getNextMarketOpen;
exports.getTimeUntilMarketOpen = getTimeUntilMarketOpen;
exports.formatTimeUntilMarketOpen = formatTimeUntilMarketOpen;
exports.getTimezoneInfo = getTimezoneInfo;
exports.INDIAN_MARKET_HOURS = {
    open: { hour: 9, minute: 15 },
    close: { hour: 15, minute: 30 },
    timezone: 'Asia/Kolkata'
};
// Indian market holidays (major ones - update yearly)
const MARKET_HOLIDAYS_2024 = [
    '2024-01-26', // Republic Day
    '2024-03-08', // Holi
    '2024-03-29', // Good Friday
    '2024-05-01', // Labour Day
    '2024-08-15', // Independence Day
    '2024-10-02', // Gandhi Jayanti
    '2024-11-01', // Diwali
    '2024-11-15', // Guru Nanak Jayanti
];
function isMarketOpen(date = new Date()) {
    // Always work with IST regardless of server timezone
    const istDate = getISTDate(date);
    // Check if it's weekend (Saturday = 6, Sunday = 0)
    const dayOfWeek = istDate.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
        return false;
    }
    // Check if it's a holiday
    const dateStr = istDate.toISOString().split('T')[0];
    if (MARKET_HOLIDAYS_2024.includes(dateStr)) {
        return false;
    }
    // Check market hours
    const currentHour = istDate.getHours();
    const currentMinute = istDate.getMinutes();
    const currentTimeInMinutes = currentHour * 60 + currentMinute;
    const marketOpenInMinutes = exports.INDIAN_MARKET_HOURS.open.hour * 60 + exports.INDIAN_MARKET_HOURS.open.minute;
    const marketCloseInMinutes = exports.INDIAN_MARKET_HOURS.close.hour * 60 + exports.INDIAN_MARKET_HOURS.close.minute;
    return currentTimeInMinutes >= marketOpenInMinutes && currentTimeInMinutes <= marketCloseInMinutes;
}
function getISTDate(date = new Date()) {
    // Create a new date object in IST timezone
    // This works regardless of server timezone
    const utcDate = new Date(date.toISOString());
    const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30
    return new Date(utcDate.getTime() + istOffset);
}
function getNextMarketOpen(date = new Date()) {
    const istDate = getISTDate(date);
    let nextOpen = new Date(istDate);
    // If current time is after market close or weekend, move to next trading day
    const currentTimeInMinutes = istDate.getHours() * 60 + istDate.getMinutes();
    const marketCloseInMinutes = exports.INDIAN_MARKET_HOURS.close.hour * 60 + exports.INDIAN_MARKET_HOURS.close.minute;
    if (currentTimeInMinutes > marketCloseInMinutes || istDate.getDay() === 0 || istDate.getDay() === 6) {
        // Move to next day
        nextOpen.setDate(nextOpen.getDate() + 1);
    }
    // Skip weekends
    while (nextOpen.getDay() === 0 || nextOpen.getDay() === 6) {
        nextOpen.setDate(nextOpen.getDate() + 1);
    }
    // Skip holidays
    let dateStr = nextOpen.toISOString().split('T')[0];
    while (MARKET_HOLIDAYS_2024.includes(dateStr)) {
        nextOpen.setDate(nextOpen.getDate() + 1);
        // Skip weekends again after holiday skip
        while (nextOpen.getDay() === 0 || nextOpen.getDay() === 6) {
            nextOpen.setDate(nextOpen.getDate() + 1);
        }
        dateStr = nextOpen.toISOString().split('T')[0];
    }
    // Set to market opening time
    nextOpen.setHours(exports.INDIAN_MARKET_HOURS.open.hour, exports.INDIAN_MARKET_HOURS.open.minute, 0, 0);
    // Convert back to UTC for proper time calculation
    const utcOffset = 5.5 * 60 * 60 * 1000;
    return new Date(nextOpen.getTime() - utcOffset);
}
function getTimeUntilMarketOpen(date = new Date()) {
    if (isMarketOpen(date)) {
        return 0;
    }
    const nextOpen = getNextMarketOpen(date);
    return nextOpen.getTime() - date.getTime();
}
function formatTimeUntilMarketOpen(date = new Date()) {
    const msUntilOpen = getTimeUntilMarketOpen(date);
    if (msUntilOpen === 0) {
        return 'Market is open';
    }
    const hours = Math.floor(msUntilOpen / (1000 * 60 * 60));
    const minutes = Math.floor((msUntilOpen % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 24) {
        const days = Math.floor(hours / 24);
        const remainingHours = hours % 24;
        return `${days}d ${remainingHours}h ${minutes}m until market opens`;
    }
    return `${hours}h ${minutes}m until market opens`;
}
// Debug function to verify timezone handling
function getTimezoneInfo() {
    const now = new Date();
    const istDate = getISTDate(now);
    return {
        serverTime: now.toISOString(),
        serverTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        istTime: istDate.toISOString().replace('Z', '+05:30'),
        marketOpen: isMarketOpen(now)
    };
}
//# sourceMappingURL=marketHours.js.map