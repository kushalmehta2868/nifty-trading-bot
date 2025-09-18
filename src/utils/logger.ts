import winston from 'winston';

// Custom timestamp format that shows IST time in logs
const istTimestamp = winston.format((info) => {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30
  const istDate = new Date(now.getTime() + istOffset);
  info.timestamp = istDate.toISOString().replace('T', ' ').substring(0, 19) + ' IST';
  return info;
});

export const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'error' : 'info', // Only errors in production for extreme memory conservation
  format: winston.format.combine(
    istTimestamp(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      // Remove colorize for production to save memory
      return `${timestamp} [${level}]: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
    })
  ),
  transports: [
    new winston.transports.Console()
    // Removed file logging completely to save memory in production
  ]
});