"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const winston_1 = __importDefault(require("winston"));
// Custom timestamp format that shows IST time in logs
const istTimestamp = winston_1.default.format((info) => {
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30
    const istDate = new Date(now.getTime() + istOffset);
    info.timestamp = istDate.toISOString().replace('T', ' ').substring(0, 19) + ' IST';
    return info;
});
exports.logger = winston_1.default.createLogger({
    level: 'info',
    format: winston_1.default.format.combine(istTimestamp(), winston_1.default.format.colorize(), winston_1.default.format.printf(({ timestamp, level, message, ...meta }) => {
        return `${timestamp} [${level}]: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
    })),
    transports: [
        new winston_1.default.transports.Console(),
        new winston_1.default.transports.File({ filename: 'trading-bot.log' })
    ]
});
//# sourceMappingURL=logger.js.map