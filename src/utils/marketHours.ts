export interface MarketHours {
  open: { hour: number; minute: number };
  close: { hour: number; minute: number };
  timezone: string;
}

export const INDIAN_MARKET_HOURS: MarketHours = {
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

export function isMarketOpen(date: Date = new Date()): boolean {
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
  
  const marketOpenInMinutes = INDIAN_MARKET_HOURS.open.hour * 60 + INDIAN_MARKET_HOURS.open.minute;
  const marketCloseInMinutes = INDIAN_MARKET_HOURS.close.hour * 60 + INDIAN_MARKET_HOURS.close.minute;

  return currentTimeInMinutes >= marketOpenInMinutes && currentTimeInMinutes <= marketCloseInMinutes;
}

function getISTDate(date: Date = new Date()): Date {
  // Use proper timezone conversion
  return new Date(date.toLocaleString("en-US", {timeZone: "Asia/Kolkata"}));
}

export function getNextMarketOpen(date: Date = new Date()): Date {
  const istDate = getISTDate(date);
  let nextOpen = new Date(istDate);
  
  // If current time is after market close or weekend, move to next trading day
  const currentTimeInMinutes = istDate.getHours() * 60 + istDate.getMinutes();
  const marketCloseInMinutes = INDIAN_MARKET_HOURS.close.hour * 60 + INDIAN_MARKET_HOURS.close.minute;
  
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
  nextOpen.setHours(INDIAN_MARKET_HOURS.open.hour, INDIAN_MARKET_HOURS.open.minute, 0, 0);
  
  // Convert back to UTC for proper time calculation
  const utcOffset = 5.5 * 60 * 60 * 1000;
  return new Date(nextOpen.getTime() - utcOffset);
}

export function getTimeUntilMarketOpen(date: Date = new Date()): number {
  if (isMarketOpen(date)) {
    return 0;
  }
  
  const nextOpen = getNextMarketOpen(date);
  return nextOpen.getTime() - date.getTime();
}

export function formatTimeUntilMarketOpen(date: Date = new Date()): string {
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
    istTime: now.toLocaleString("en-US", {timeZone: "Asia/Kolkata"}),
    marketOpen: isMarketOpen(now),
    currentHour: istDate.getHours(),
    currentMinute: istDate.getMinutes(),
    dayOfWeek: istDate.getDay()
  };
}