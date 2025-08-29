"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.healthServer = void 0;
const express_1 = __importDefault(require("express"));
const logger_1 = require("../utils/logger");
const marketHours_1 = require("../utils/marketHours");
const webSocketFeed_1 = require("./webSocketFeed");
class HealthServer {
    constructor() {
        this.app = (0, express_1.default)();
        this.port = parseInt(process.env.PORT || '3000');
        this.setupMiddleware();
        this.setupRoutes();
    }
    setupMiddleware() {
        this.app.use(express_1.default.json());
        this.app.use((req, res, next) => {
            logger_1.logger.info(`${req.method} ${req.path} - Health check request`);
            next();
        });
    }
    setupRoutes() {
        // Health check endpoint for Render
        this.app.get('/health', (req, res) => {
            const marketStatus = (0, marketHours_1.isMarketOpen)();
            const timezoneInfo = (0, marketHours_1.getTimezoneInfo)();
            const wsStatus = webSocketFeed_1.webSocketFeed.getConnectionStatus();
            const response = {
                status: wsStatus.healthy ? 'ok' : 'degraded',
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                timezone: timezoneInfo,
                market: {
                    isOpen: marketStatus,
                    nextStatus: marketStatus ? 'Market is open' : (0, marketHours_1.formatTimeUntilMarketOpen)()
                },
                websocket: {
                    connected: wsStatus.connected,
                    healthy: wsStatus.healthy,
                    lastPong: new Date(wsStatus.lastPong).toISOString(),
                    timeSinceLastPong: Date.now() - wsStatus.lastPong
                },
                bot: {
                    running: true,
                    version: '1.0.0'
                }
            };
            // Return 200 if healthy, 503 if degraded but still functional
            const statusCode = wsStatus.healthy ? 200 : 503;
            res.status(statusCode).json(response);
        });
        // Root endpoint
        this.app.get('/', (req, res) => {
            res.json({
                message: 'Trading Bot API',
                status: 'running',
                endpoints: {
                    health: '/health',
                    status: '/status'
                }
            });
        });
        // Bot status endpoint
        this.app.get('/status', (req, res) => {
            const marketStatus = (0, marketHours_1.isMarketOpen)();
            res.json({
                bot: 'Trading Bot',
                market: marketStatus ? 'Open' : 'Closed',
                uptime: `${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m`,
                timestamp: new Date().toISOString()
            });
        });
        // Keep-alive endpoint specifically for external monitoring
        this.app.get('/ping', (req, res) => {
            res.json({
                pong: true,
                timestamp: Date.now()
            });
        });
        // WebSocket status endpoint
        this.app.get('/websocket', (req, res) => {
            const wsStatus = webSocketFeed_1.webSocketFeed.getConnectionStatus();
            const response = {
                connected: wsStatus.connected,
                healthy: wsStatus.healthy,
                lastPong: new Date(wsStatus.lastPong).toISOString(),
                timeSinceLastPong: Date.now() - wsStatus.lastPong,
                healthThreshold: 60000, // 60 seconds
                timestamp: new Date().toISOString()
            };
            const statusCode = wsStatus.connected ? (wsStatus.healthy ? 200 : 503) : 503;
            res.status(statusCode).json(response);
        });
    }
    start() {
        this.server = this.app.listen(this.port, '0.0.0.0', () => {
            logger_1.logger.info(`🌐 Health server running on port ${this.port}`);
            logger_1.logger.info(`📡 Health check available at: http://localhost:${this.port}/health`);
            logger_1.logger.info(`🔄 Keep-alive endpoint: http://localhost:${this.port}/ping`);
            logger_1.logger.info(`📊 WebSocket status: http://localhost:${this.port}/websocket`);
        });
        this.server.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                logger_1.logger.error(`Port ${this.port} is already in use`);
            }
            else {
                logger_1.logger.error('Health server error:', error.message);
            }
        });
    }
    stop() {
        if (this.server) {
            this.server.close(() => {
                logger_1.logger.info('🌐 Health server stopped');
            });
        }
    }
    getApp() {
        return this.app;
    }
}
exports.healthServer = new HealthServer();
//# sourceMappingURL=healthServer.js.map