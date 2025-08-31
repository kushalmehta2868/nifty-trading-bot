"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.healthMonitor = void 0;
const logger_1 = require("../utils/logger");
const webSocketFeed_1 = require("./webSocketFeed");
const strategy_1 = require("./strategy");
const orderService_1 = require("./orderService");
const config_1 = require("../config/config");
class HealthMonitor {
    constructor() {
        this.monitorInterval = null;
        this.lastHealthCheck = 0;
    }
    async initialize() {
        logger_1.logger.info('🏥 Health Monitor initializing...');
        // Start health monitoring every 30 seconds
        this.monitorInterval = setInterval(async () => {
            await this.performHealthCheck();
        }, 30000);
        // Send initial health status
        await this.performHealthCheck();
        logger_1.logger.info('🏥 Health Monitor initialized - monitoring system every 30 seconds');
    }
    async performHealthCheck() {
        try {
            const health = this.getSystemHealth();
            const issues = this.analyzeHealth(health);
            // Log detailed health status
            this.logHealthStatus(health, issues);
            // Emit health events if needed
            if (issues.length > 0) {
                const status = issues.some(i => i.severity === 'critical') ? 'critical' : 'warning';
                process.emit('systemHealth', {
                    status,
                    message: issues.map(i => i.message).join(', ')
                });
            }
            // Send hourly summary to Telegram
            const currentTime = Date.now();
            if (currentTime - this.lastHealthCheck > 3600000) { // Every hour
                await this.sendHourlySummary(health);
                this.lastHealthCheck = currentTime;
            }
        }
        catch (error) {
            logger_1.logger.error('🚨 Health check failed:', error.message);
            process.emit('systemHealth', {
                status: 'critical',
                message: 'Health monitor malfunction'
            });
        }
    }
    getSystemHealth() {
        // WebSocket health
        const wsStatus = webSocketFeed_1.webSocketFeed.getConnectionStatus();
        // Strategy health
        const niftyBuffer = strategy_1.strategy.priceBuffers?.NIFTY || [];
        const bankniftyBuffer = strategy_1.strategy.priceBuffers?.BANKNIFTY || [];
        // Order service health
        const dailyStats = orderService_1.orderService.getDailyStats();
        // System memory
        const memoryUsage = process.memoryUsage();
        const memoryUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
        const memoryPercentage = Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100);
        return {
            webSocket: {
                connected: wsStatus.connected,
                healthy: wsStatus.healthy,
                lastUpdate: wsStatus.lastPong || 0
            },
            strategy: {
                bufferSizes: {
                    NIFTY: niftyBuffer.length,
                    BANKNIFTY: bankniftyBuffer.length
                },
                lastAnalysis: Date.now() // Simplified
            },
            orders: {
                active: dailyStats.activeOrders,
                dailyTrades: dailyStats.trades,
                dailyPnL: dailyStats.pnl
            },
            memory: {
                used: memoryUsedMB,
                percentage: memoryPercentage
            },
            uptime: Math.floor(process.uptime())
        };
    }
    analyzeHealth(health) {
        const issues = [];
        // WebSocket health
        if (!health.webSocket.connected) {
            issues.push({
                severity: 'critical',
                message: 'WebSocket disconnected - no live data'
            });
        }
        else if (!health.webSocket.healthy) {
            issues.push({
                severity: 'warning',
                message: 'WebSocket connection unstable'
            });
        }
        // Data buffer health
        if (health.strategy.bufferSizes.NIFTY < 20 || health.strategy.bufferSizes.BANKNIFTY < 20) {
            issues.push({
                severity: 'warning',
                message: 'Insufficient price data for analysis'
            });
        }
        // Memory health
        if (health.memory.percentage > 85) {
            issues.push({
                severity: 'critical',
                message: `High memory usage: ${health.memory.percentage}%`
            });
        }
        else if (health.memory.percentage > 70) {
            issues.push({
                severity: 'warning',
                message: `Elevated memory usage: ${health.memory.percentage}%`
            });
        }
        // Order limits
        if (health.orders.dailyTrades >= config_1.config.trading.maxPositions) {
            issues.push({
                severity: 'warning',
                message: 'Daily trade limit reached'
            });
        }
        return issues;
    }
    logHealthStatus(health, issues) {
        const uptime = `${Math.floor(health.uptime / 3600)}h ${Math.floor((health.uptime % 3600) / 60)}m`;
        logger_1.logger.info('🏥 System Health Check:');
        logger_1.logger.info(`   🔗 WebSocket: ${health.webSocket.connected ? '🟢 Connected' : '🔴 Disconnected'} | Healthy: ${health.webSocket.healthy}`);
        logger_1.logger.info(`   📊 Data Buffers: NIFTY=${health.strategy.bufferSizes.NIFTY} | BANKNIFTY=${health.strategy.bufferSizes.BANKNIFTY}`);
        logger_1.logger.info(`   📋 Orders: Active=${health.orders.active} | Daily=${health.orders.dailyTrades}/${config_1.config.trading.maxPositions} | P&L=₹${health.orders.dailyPnL.toFixed(2)}`);
        logger_1.logger.info(`   💾 Memory: ${health.memory.used}MB (${health.memory.percentage}%) | Uptime: ${uptime}`);
        if (issues.length > 0) {
            logger_1.logger.warn(`⚠️ Health Issues Found (${issues.length}):`);
            issues.forEach(issue => {
                const emoji = issue.severity === 'critical' ? '🚨' : '⚠️';
                logger_1.logger.warn(`   ${emoji} ${issue.message}`);
            });
        }
        else {
            logger_1.logger.info('✅ All systems healthy');
        }
    }
    async sendHourlySummary(health) {
        try {
            // Import telegramBot here to avoid circular dependencies
            const { telegramBot } = await Promise.resolve().then(() => __importStar(require('./telegramBot')));
            await telegramBot.sendHourlyMarketSummary();
            logger_1.logger.info('📱 Hourly health summary sent to Telegram');
        }
        catch (error) {
            logger_1.logger.error('Failed to send hourly summary:', error.message);
        }
    }
    getHealthSummary() {
        const health = this.getSystemHealth();
        const issues = this.analyzeHealth(health);
        const uptime = `${Math.floor(health.uptime / 3600)}h ${Math.floor((health.uptime % 3600) / 60)}m`;
        let summary = `🏥 System Health Summary:\n\n`;
        summary += `🔗 WebSocket: ${health.webSocket.connected ? '🟢' : '🔴'} ${health.webSocket.healthy ? 'Healthy' : 'Issues'}\n`;
        summary += `📊 Data: NIFTY=${health.strategy.bufferSizes.NIFTY} | BNF=${health.strategy.bufferSizes.BANKNIFTY} ticks\n`;
        summary += `📋 Trading: ${health.orders.dailyTrades}/${config_1.config.trading.maxPositions} | Active=${health.orders.active}\n`;
        summary += `💾 Memory: ${health.memory.used}MB (${health.memory.percentage}%)\n`;
        summary += `⏱️ Uptime: ${uptime}\n`;
        if (issues.length > 0) {
            summary += `\n⚠️ Issues (${issues.length}):\n`;
            issues.forEach(issue => {
                const emoji = issue.severity === 'critical' ? '🚨' : '⚠️';
                summary += `${emoji} ${issue.message}\n`;
            });
        }
        else {
            summary += `\n✅ All systems healthy`;
        }
        return summary;
    }
    stop() {
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
            this.monitorInterval = null;
            logger_1.logger.info('🏥 Health Monitor stopped');
        }
    }
}
exports.healthMonitor = new HealthMonitor();
//# sourceMappingURL=healthMonitor.js.map