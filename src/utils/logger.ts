import winston from 'winston';

// Custom timestamp format that shows IST time in logs
const istTimestamp = winston.format((info) => {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30
  const istDate = new Date(now.getTime() + istOffset);
  info.timestamp = istDate.toISOString().replace('T', ' ').substring(0, 19) + ' IST';
  return info;
});

// Ultra-minimal logger for memory optimization
export const logger = {
  info: (message: string, meta?: any) => {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[INFO]: ${message}`, meta || '');
    }
  },
  warn: (message: string, meta?: any) => {
    console.warn(`[WARN]: ${message}`, meta || '');
  },
  error: (message: string, meta?: any) => {
    console.error(`[ERROR]: ${message}`, meta || '');
  },
  debug: (message: string, meta?: any) => {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[DEBUG]: ${message}`, meta || '');
    }
  }
};