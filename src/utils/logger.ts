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
  level: 'info',
  format: winston.format.combine(
    istTimestamp(),
    winston.format.colorize(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      return `${timestamp} [${level}]: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'trading-bot.log' })
  ]
});