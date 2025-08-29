import { isNSETradingDay, isNSEHoliday, isWeekend } from './holidays';

export interface MarketHours {
  open: { hour: number; minute: number };
  close: { hour: number; minute: number };
  timezone: string;
}

// Updated NSE Market Hours: 9:30 AM to 3:00 PM
export const NSE_MARKET_HOURS: MarketHours = {
  open: { hour: 9, minute: 30 },   // 9:30 AM
  close: { hour: 15, minute: 0 },  // 3:00 PM
  timezone: 'Asia/Kolkata'
};

// Trading signal hours (subset of market hours): 9:30 AM to 3:00 PM
export const TRADING_SIGNAL_HOURS: MarketHours = {
  open: { hour: 9, minute: 30 },   // 9:30 AM
  close: { hour: 15, minute: 0 },  // 3:00 PM
  timezone: 'Asia/Kolkata'
};

export function isNSEMarketOpen(date: Date = new Date()): boolean {
  const istDate = getISTDate(date);
  
  // Check if it's a trading day (not weekend or holiday)
  if (!isNSETradingDay(istDate)) {
    return false;
  }

  const currentHour = istDate.getHours();
  const currentMinute = istDate.getMinutes();
  const currentTimeInMinutes = currentHour * 60 + currentMinute;

  const marketOpenInMinutes = NSE_MARKET_HOURS.open.hour * 60 + NSE_MARKET_HOURS.open.minute;
  const marketCloseInMinutes = NSE_MARKET_HOURS.close.hour * 60 + NSE_MARKET_HOURS.close.minute;

  return currentTimeInMinutes >= marketOpenInMinutes && currentTimeInMinutes <= marketCloseInMinutes;
}

// Check if trading signals should be active (same as market hours now)
export function isTradingSignalTime(date: Date = new Date()): boolean {
  const istDate = getISTDate(date);
  
  // Check if it's a trading day
  if (!isNSETradingDay(istDate)) {
    return false;
  }

  const currentHour = istDate.getHours();
  const currentMinute = istDate.getMinutes();
  const currentTimeInMinutes = currentHour * 60 + currentMinute;

  const signalStartInMinutes = TRADING_SIGNAL_HOURS.open.hour * 60 + TRADING_SIGNAL_HOURS.open.minute;
  const signalEndInMinutes = TRADING_SIGNAL_HOURS.close.hour * 60 + TRADING_SIGNAL_HOURS.close.minute;

  return currentTimeInMinutes >= signalStartInMinutes && currentTimeInMinutes <= signalEndInMinutes;
}

// Alias for backward compatibility
export function isMarketOpen(date: Date = new Date()): boolean {
  return isNSEMarketOpen(date);
}

export function getMarketStatus(): { nse: boolean; trading: boolean; any: boolean } {
  return {
    nse: isNSEMarketOpen(),
    trading: isTradingSignalTime(),
    any: isNSEMarketOpen()
  };
}

function getISTDate(date: Date = new Date()): Date {
  // Convert to IST properly
  const utcTime = date.getTime() + (date.getTimezoneOffset() * 60000);
  const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30
  return new Date(utcTime + istOffset);
}

export function getNextMarketOpen(date: Date = new Date()): Date {
  const istDate = getISTDate(date);

  // Check if market is currently open
  if (isNSEMarketOpen(date)) {
    return new Date(date); // Return current time if market is open
  }

  // Check if today is a trading day and we're before market open
  const currentTimeInMinutes = istDate.getHours() * 60 + istDate.getMinutes();
  const marketOpenInMinutes = NSE_MARKET_HOURS.open.hour * 60 + NSE_MARKET_HOURS.open.minute;

  if (isNSETradingDay(istDate) && currentTimeInMinutes < marketOpenInMinutes) {
    // Today is a trading day and market hasn't opened yet
    const todayOpen = new Date(istDate);
    todayOpen.setHours(NSE_MARKET_HOURS.open.hour, NSE_MARKET_HOURS.open.minute, 0, 0);
    
    // Convert back to local timezone
    const utcTime = todayOpen.getTime() - (5.5 * 60 * 60 * 1000);
    const localTime = utcTime - (new Date().getTimezoneOffset() * 60000);
    return new Date(localTime);
  }

  // Find the next trading day
  let nextDay = new Date(istDate);
  nextDay.setDate(nextDay.getDate() + 1);
  
  while (!isNSETradingDay(nextDay)) {
    nextDay.setDate(nextDay.getDate() + 1);
  }

  nextDay.setHours(NSE_MARKET_HOURS.open.hour, NSE_MARKET_HOURS.open.minute, 0, 0);
  
  // Convert back to local timezone
  const utcTime = nextDay.getTime() - (5.5 * 60 * 60 * 1000);
  const localTime = utcTime - (new Date().getTimezoneOffset() * 60000);
  return new Date(localTime);
}

export function getTimeUntilMarketOpen(date: Date = new Date()): number {
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

export function formatTimeUntilMarketOpen(date: Date = new Date()): string {
  if (isNSEMarketOpen(date)) {
    return 'NSE market is open (9:30 AM - 3:00 PM)';
  }

  const istDate = getISTDate(date);
  
  // Check if today is a holiday or weekend
  if (isNSEHoliday(istDate)) {
    return `Market closed - NSE Holiday`;
  }
  
  if (isWeekend(istDate)) {
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
export function getMarketPhase(date: Date = new Date()): 'PRE_MARKET' | 'MARKET_OPEN' | 'POST_MARKET' | 'MARKET_CLOSED' {
  const istDate = getISTDate(date);
  
  if (!isNSETradingDay(istDate)) {
    return 'MARKET_CLOSED';
  }

  const currentTimeInMinutes = istDate.getHours() * 60 + istDate.getMinutes();
  const marketOpenInMinutes = NSE_MARKET_HOURS.open.hour * 60 + NSE_MARKET_HOURS.open.minute;
  const marketCloseInMinutes = NSE_MARKET_HOURS.close.hour * 60 + NSE_MARKET_HOURS.close.minute;

  if (currentTimeInMinutes < marketOpenInMinutes) {
    return 'PRE_MARKET';
  } else if (currentTimeInMinutes >= marketOpenInMinutes && currentTimeInMinutes <= marketCloseInMinutes) {
    return 'MARKET_OPEN';
  } else {
    return 'POST_MARKET';
  }
}

// Debug function to verify timezone handling
export function getTimezoneInfo(): {
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
} {
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
    isHoliday: isNSEHoliday(istDate),
    isWeekend: isWeekend(istDate),
    isTradingDay: isNSETradingDay(istDate)
  };
}

// Get trading hours as human readable string
export function getTradingHoursString(): string {
  return `${NSE_MARKET_HOURS.open.hour}:${NSE_MARKET_HOURS.open.minute.toString().padStart(2, '0')} AM - ${NSE_MARKET_HOURS.close.hour}:${NSE_MARKET_HOURS.close.minute.toString().padStart(2, '0') === '00' ? '00' : NSE_MARKET_HOURS.close.minute.toString().padStart(2, '0')} PM (IST)`;
}