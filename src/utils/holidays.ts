// NSE Trading Holidays (2025-2030)
// Updated with official NSE calendar as of September 4, 2025

export const nseHolidays = [
  // 2025 Official NSE Trading Holidays (14 holidays excluding weekends)
  '2025-02-26', // Maha Shivaratri
  '2025-03-14', // Holi
  '2025-03-31', // Eid-Ul-Fitr (Ramzan Eid)
  '2025-04-10', // Mahavir Jayanti
  '2025-04-14', // Dr. Baba Saheb Ambedkar Jayanti
  '2025-04-18', // Good Friday
  '2025-05-01', // Maharashtra Day
  '2025-08-15', // Independence Day
  '2025-08-27', // Ganesh Chaturthi
  '2025-10-02', // Mahatma Gandhi Jayanti
  '2025-10-21', // Diwali-Laxmi Pujan (Muhurat trading session)
  '2025-10-22', // Diwali-Balipratipada
  '2025-11-05', // Guru Nanak Jayanti
  '2025-12-25', // Christmas
  
  // Note: The following holidays fall on weekends in 2025 and don't affect trading:
  // 2025-01-26: Republic Day (Sunday)
  // 2025-04-06: Ram Navami (Sunday)
  // 2025-06-07: Bakri Eid (Saturday)
  // 2025-07-06: Moharram (Sunday)

  // TODO: Future year holidays (2026-2030) need to be updated annually
  // These dates are estimates based on lunar calendar calculations and may not be accurate
  // Please verify with official NSE holiday calendar when available
  
  // IMPORTANT: Only 2025 holidays above are verified from official NSE sources
  // For production use beyond 2025, please update this file with official NSE holiday calendars
];

// Function to check if a given date is a trading holiday
export const isNSEHoliday = (date: Date): boolean => {
  const dateString = date.toISOString().split('T')[0];
  return nseHolidays.includes(dateString);
};

// Function to check if it's a weekend (Saturday or Sunday)
export const isWeekend = (date: Date): boolean => {
  const day = date.getDay();
  return day === 0 || day === 6; // 0 = Sunday, 6 = Saturday
};

// Function to check if NSE is open on a given date
export const isNSETradingDay = (date: Date): boolean => {
  return !isWeekend(date) && !isNSEHoliday(date);
};

// Function to get the next trading day
export const getNextTradingDay = (date: Date): Date => {
  const nextDay = new Date(date);
  nextDay.setDate(nextDay.getDate() + 1);
  
  while (!isNSETradingDay(nextDay)) {
    nextDay.setDate(nextDay.getDate() + 1);
  }
  
  return nextDay;
};

// Function to get all trading days in a given month
export const getTradingDaysInMonth = (year: number, month: number): Date[] => {
  const tradingDays: Date[] = [];
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    if (isNSETradingDay(date)) {
      tradingDays.push(date);
    }
  }
  
  return tradingDays;
};