export interface MarketHours {
  open: { hour: number; minute: number };
  close: { hour: number; minute: number };
  timezone: string;
}

export const NSE_MARKET_HOURS: MarketHours = {
  open: { hour: 9, minute: 15 },
  close: { hour: 15, minute: 30 },
  timezone: 'Asia/Kolkata'
};

export const MCX_MARKET_HOURS: MarketHours = {
  open: { hour: 9, minute: 0 },    // 9:00 AM
  close: { hour: 23, minute: 30 }, // 11:30 PM
  timezone: 'Asia/Kolkata'
};

// Combined market hours (earliest open to latest close)
export const COMBINED_MARKET_HOURS: MarketHours = {
  open: { hour: 9, minute: 0 },    // MCX opens earliest
  close: { hour: 23, minute: 30 }, // MCX closes latest
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

// MCX holidays (different from NSE)
const MCX_HOLIDAYS_2024 = [
  '2024-01-26', // Republic Day
  '2024-03-08', // Holi
  '2024-03-29', // Good Friday
  '2024-05-01', // Labour Day
  '2024-08-15', // Independence Day
  '2024-10-02', // Gandhi Jayanti
  '2024-11-01', // Diwali
  '2024-11-15', // Guru Nanak Jayanti
];

export function isNSEMarketOpen(date: Date = new Date()): boolean {
  const istDate = getISTDate(date);
  const dayOfWeek = istDate.getDay();

  if (dayOfWeek === 0 || dayOfWeek === 6) return false;

  const dateStr = istDate.toISOString().split('T')[0];
  if (MARKET_HOLIDAYS_2024.includes(dateStr)) return false;

  const currentHour = istDate.getHours();
  const currentMinute = istDate.getMinutes();
  const currentTimeInMinutes = currentHour * 60 + currentMinute;

  const marketOpenInMinutes = NSE_MARKET_HOURS.open.hour * 60 + NSE_MARKET_HOURS.open.minute;
  const marketCloseInMinutes = NSE_MARKET_HOURS.close.hour * 60 + NSE_MARKET_HOURS.close.minute;

  return currentTimeInMinutes >= marketOpenInMinutes && currentTimeInMinutes <= marketCloseInMinutes;
}

export function isMCXMarketOpen(date: Date = new Date()): boolean {
  const istDate = getISTDate(date);
  const dayOfWeek = istDate.getDay();

  if (dayOfWeek === 0 || dayOfWeek === 6) return false;

  const dateStr = istDate.toISOString().split('T')[0];
  if (MCX_HOLIDAYS_2024.includes(dateStr)) return false;

  const currentHour = istDate.getHours();
  const currentMinute = istDate.getMinutes();
  const currentTimeInMinutes = currentHour * 60 + currentMinute;

  const marketOpenInMinutes = MCX_MARKET_HOURS.open.hour * 60 + MCX_MARKET_HOURS.open.minute;
  const marketCloseInMinutes = MCX_MARKET_HOURS.close.hour * 60 + MCX_MARKET_HOURS.close.minute;

  return currentTimeInMinutes >= marketOpenInMinutes && currentTimeInMinutes <= marketCloseInMinutes;
}

// Combined function - returns true if ANY market is open
export function isMarketOpen(date: Date = new Date()): boolean {
  return isNSEMarketOpen(date) || isMCXMarketOpen(date);
}

export function getMarketStatus(): { nse: boolean; mcx: boolean; any: boolean } {
  return {
    nse: isNSEMarketOpen(),
    mcx: isMCXMarketOpen(),
    any: isMarketOpen()
  };
}

function getISTDate(date: Date = new Date()): Date {
  // Use proper timezone conversion
  return new Date(date.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
}

export function getNextMarketOpen(date: Date = new Date()): Date {
  const istDate = getISTDate(date);
  let nextOpen = new Date(istDate);

  // Check if any market is currently open
  if (isMarketOpen(date)) {
    return nextOpen; // Market is already open
  }

  // Find next opening time
  const currentTimeInMinutes = istDate.getHours() * 60 + istDate.getMinutes();
  const nseFutureOpen = NSE_MARKET_HOURS.open.hour * 60 + NSE_MARKET_HOURS.open.minute;
  const mcxFutureOpen = MCX_MARKET_HOURS.open.hour * 60 + MCX_MARKET_HOURS.open.minute;

  // If today and before MCX opens, return MCX opening time
  if (currentTimeInMinutes < mcxFutureOpen) {
    nextOpen.setHours(MCX_MARKET_HOURS.open.hour, MCX_MARKET_HOURS.open.minute, 0, 0);
    return nextOpen;
  }

  // Otherwise move to next day and return MCX opening time
  nextOpen.setDate(nextOpen.getDate() + 1);

  // Skip weekends
  while (nextOpen.getDay() === 0 || nextOpen.getDay() === 6) {
    nextOpen.setDate(nextOpen.getDate() + 1);
  }

  nextOpen.setHours(MCX_MARKET_HOURS.open.hour, MCX_MARKET_HOURS.open.minute, 0, 0);
  return nextOpen;
}

export function getTimeUntilMarketOpen(date: Date = new Date()): number {
  if (isMarketOpen(date)) {
    return 0;
  }

  const nextOpen = getNextMarketOpen(date);
  return nextOpen.getTime() - date.getTime();
}

export function formatTimeUntilMarketOpen(date: Date = new Date()): string {
  if (isMarketOpen(date)) {
    const status = getMarketStatus();
    if (status.nse && status.mcx) {
      return 'Both NSE & MCX markets are open';
    } else if (status.nse) {
      return 'NSE market is open';
    } else if (status.mcx) {
      return 'MCX market is open';
    }
  }

  const nextOpen = getNextMarketOpen(date);
  const msUntilOpen = nextOpen.getTime() - date.getTime();
  const hours = Math.floor(msUntilOpen / (1000 * 60 * 60));
  const minutes = Math.floor((msUntilOpen % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 24) {
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h ${minutes}m until next market opens (MCX)`;
  }

  return `${hours}h ${minutes}m until next market opens (MCX)`;
}

// Debug function to verify timezone handling
export function getTimezoneInfo(): {
  serverTime: string;
  serverTimezone: string;
  istTime: string;
  marketOpen: boolean;
  currentHour: number;
  currentMinute: number;
  dayOfWeek: number;
} {
  const now = new Date();
  const istDate = getISTDate(now);

  return {
    serverTime: now.toISOString(),
    serverTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    istTime: now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
    marketOpen: isMarketOpen(now),
    currentHour: istDate.getHours(),
    currentMinute: istDate.getMinutes(),
    dayOfWeek: istDate.getDay()
  };
}