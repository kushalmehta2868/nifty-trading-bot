"use strict";
// NSE Trading Holidays (2025-2030)
// Updated as of August 29, 2025
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTradingDaysInMonth = exports.getNextTradingDay = exports.isNSETradingDay = exports.isWeekend = exports.isNSEHoliday = exports.nseHolidays = void 0;
exports.nseHolidays = [
    // 2025 Holidays
    '2025-01-26', // Republic Day
    '2025-03-14', // Holi
    '2025-03-31', // Ram Navami
    '2025-04-14', // Dr. Babasaheb Ambedkar Jayanti/Mahavir Jayanti
    '2025-04-18', // Good Friday
    '2025-05-01', // Maharashtra Day
    '2025-05-12', // Buddha Purnima
    '2025-06-27', // Bakri Id
    '2025-08-15', // Independence Day
    '2025-08-16', // Parsi New Year
    '2025-09-04', // Ganesh Chaturthi
    '2025-10-02', // Gandhi Jayanti
    '2025-10-21', // Dussehra
    '2025-11-01', // Diwali/Laxmi Puja
    '2025-11-03', // Bhai Dooj
    '2025-11-24', // Guru Nanak Jayanti
    // 2026 Holidays
    '2026-01-26', // Republic Day
    '2026-03-03', // Holi
    '2026-03-19', // Ram Navami
    '2026-04-06', // Mahavir Jayanti
    '2026-04-10', // Good Friday
    '2026-04-14', // Dr. Babasaheb Ambedkar Jayanti
    '2026-05-01', // Maharashtra Day
    '2026-05-31', // Buddha Purnima
    '2026-06-16', // Bakri Id
    '2026-08-15', // Independence Day
    '2026-08-05', // Parsi New Year
    '2026-08-24', // Ganesh Chaturthi
    '2026-10-02', // Gandhi Jayanti
    '2026-10-10', // Dussehra
    '2026-10-19', // Diwali/Laxmi Puja
    '2026-11-14', // Guru Nanak Jayanti
    // 2027 Holidays
    '2027-01-26', // Republic Day
    '2027-03-22', // Holi
    '2027-04-08', // Ram Navami
    '2027-04-14', // Dr. Babasaheb Ambedkar Jayanti
    '2027-03-26', // Good Friday
    '2027-04-01', // Mahavir Jayanti
    '2027-05-01', // Maharashtra Day
    '2027-05-20', // Buddha Purnima
    '2027-06-06', // Bakri Id
    '2027-08-15', // Independence Day
    '2027-08-25', // Parsi New Year
    '2027-09-13', // Ganesh Chaturthi
    '2027-09-30', // Dussehra
    '2027-10-02', // Gandhi Jayanti
    '2027-11-08', // Diwali/Laxmi Puja
    '2027-12-03', // Guru Nanak Jayanti
    // 2028 Holidays
    '2028-01-26', // Republic Day
    '2028-03-11', // Holi
    '2028-03-28', // Ram Navami
    '2028-04-14', // Dr. Babasaheb Ambedkar Jayanti/Mahavir Jayanti
    '2028-04-14', // Good Friday
    '2028-05-01', // Maharashtra Day
    '2028-05-09', // Buddha Purnima
    '2028-05-26', // Bakri Id
    '2028-08-15', // Independence Day
    '2028-08-15', // Parsi New Year
    '2028-09-02', // Ganesh Chaturthi
    '2028-09-19', // Dussehra
    '2028-10-02', // Gandhi Jayanti
    '2028-10-28', // Diwali/Laxmi Puja
    '2028-11-22', // Guru Nanak Jayanti
    // 2029 Holidays
    '2029-01-26', // Republic Day
    '2029-02-28', // Holi
    '2029-03-17', // Ram Navami
    '2029-03-30', // Good Friday
    '2029-04-02', // Mahavir Jayanti
    '2029-04-14', // Dr. Babasaheb Ambedkar Jayanti
    '2029-05-01', // Maharashtra Day
    '2029-05-28', // Buddha Purnima
    '2029-05-15', // Bakri Id
    '2029-08-15', // Independence Day
    '2029-08-03', // Parsi New Year
    '2029-08-22', // Ganesh Chaturthi
    '2029-10-02', // Gandhi Jayanti
    '2029-10-08', // Dussehra
    '2029-11-16', // Diwali/Laxmi Puja
    '2029-12-12', // Guru Nanak Jayanti
    // 2030 Holidays
    '2030-01-26', // Republic Day
    '2030-03-18', // Holi
    '2030-04-05', // Ram Navami
    '2030-04-14', // Dr. Babasaheb Ambedkar Jayanti
    '2030-04-19', // Good Friday
    '2030-04-22', // Mahavir Jayanti
    '2030-05-01', // Maharashtra Day
    '2030-05-16', // Buddha Purnima
    '2030-05-04', // Bakri Id
    '2030-08-15', // Independence Day
    '2030-08-23', // Parsi New Year
    '2030-09-11', // Ganesh Chaturthi
    '2030-09-27', // Dussehra
    '2030-10-02', // Gandhi Jayanti
    '2030-11-05', // Diwali/Laxmi Puja
    '2030-12-01', // Guru Nanak Jayanti
];
// Function to check if a given date is a trading holiday
const isNSEHoliday = (date) => {
    const dateString = date.toISOString().split('T')[0];
    return exports.nseHolidays.includes(dateString);
};
exports.isNSEHoliday = isNSEHoliday;
// Function to check if it's a weekend (Saturday or Sunday)
const isWeekend = (date) => {
    const day = date.getDay();
    return day === 0 || day === 6; // 0 = Sunday, 6 = Saturday
};
exports.isWeekend = isWeekend;
// Function to check if NSE is open on a given date
const isNSETradingDay = (date) => {
    return !(0, exports.isWeekend)(date) && !(0, exports.isNSEHoliday)(date);
};
exports.isNSETradingDay = isNSETradingDay;
// Function to get the next trading day
const getNextTradingDay = (date) => {
    const nextDay = new Date(date);
    nextDay.setDate(nextDay.getDate() + 1);
    while (!(0, exports.isNSETradingDay)(nextDay)) {
        nextDay.setDate(nextDay.getDate() + 1);
    }
    return nextDay;
};
exports.getNextTradingDay = getNextTradingDay;
// Function to get all trading days in a given month
const getTradingDaysInMonth = (year, month) => {
    const tradingDays = [];
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);
        if ((0, exports.isNSETradingDay)(date)) {
            tradingDays.push(date);
        }
    }
    return tradingDays;
};
exports.getTradingDaysInMonth = getTradingDaysInMonth;
//# sourceMappingURL=holidays.js.map