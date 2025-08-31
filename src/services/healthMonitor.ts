import { logger } from '../utils/logger';
import { webSocketFeed } from './webSocketFeed';
import { strategy } from './strategy';
import { orderService } from './orderService';
import { config } from '../config/config';

interface SystemHealth {
  webSocket: {
    connected: boolean;
    healthy: boolean;
    lastUpdate: number;
  };
  strategy: {
    bufferSizes: { [key: string]: number };
    lastAnalysis: number;
  };
  orders: {
    active: number;
    dailyTrades: number;
    dailyPnL: number;
  };
  memory: {
    used: number;
    percentage: number;
  };
  uptime: number;
}

class HealthMonitor {
  private monitorInterval: NodeJS.Timeout | null = null;
  private lastHealthCheck = 0;

  public async initialize(): Promise<void> {
    logger.info('🏥 Health Monitor initializing...');
    
    // Start health monitoring every 30 seconds
    this.monitorInterval = setInterval(async () => {
      await this.performHealthCheck();
    }, 30000);

    // Send initial health status
    await this.performHealthCheck();
    
    logger.info('🏥 Health Monitor initialized - monitoring system every 30 seconds');
  }

  private async performHealthCheck(): Promise<void> {
    try {
      const health = this.getSystemHealth();
      const issues = this.analyzeHealth(health);
      
      // Log detailed health status
      this.logHealthStatus(health, issues);
      
      // Emit health events if needed
      if (issues.length > 0) {
        const status = issues.some(i => i.severity === 'critical') ? 'critical' : 'warning';
        (process as any).emit('systemHealth', {
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
      
    } catch (error) {
      logger.error('🚨 Health check failed:', (error as Error).message);
      (process as any).emit('systemHealth', {
        status: 'critical',
        message: 'Health monitor malfunction'
      });
    }
  }

  private getSystemHealth(): SystemHealth {
    // WebSocket health
    const wsStatus = webSocketFeed.getConnectionStatus();
    
    // Strategy health
    const niftyBuffer = (strategy as any).priceBuffers?.NIFTY || [];
    const bankniftyBuffer = (strategy as any).priceBuffers?.BANKNIFTY || [];
    
    // Order service health
    const dailyStats = orderService.getDailyStats();
    
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

  private analyzeHealth(health: SystemHealth): Array<{ severity: 'warning' | 'critical', message: string }> {
    const issues: Array<{ severity: 'warning' | 'critical', message: string }> = [];
    
    // WebSocket health
    if (!health.webSocket.connected) {
      issues.push({
        severity: 'critical',
        message: 'WebSocket disconnected - no live data'
      });
    } else if (!health.webSocket.healthy) {
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
    } else if (health.memory.percentage > 70) {
      issues.push({
        severity: 'warning',
        message: `Elevated memory usage: ${health.memory.percentage}%`
      });
    }
    
    // Order limits
    if (health.orders.dailyTrades >= config.trading.maxPositions) {
      issues.push({
        severity: 'warning',
        message: 'Daily trade limit reached'
      });
    }
    
    return issues;
  }

  private logHealthStatus(health: SystemHealth, issues: Array<{ severity: string, message: string }>): void {
    const uptime = `${Math.floor(health.uptime / 3600)}h ${Math.floor((health.uptime % 3600) / 60)}m`;
    
    logger.info('🏥 System Health Check:');
    logger.info(`   🔗 WebSocket: ${health.webSocket.connected ? '🟢 Connected' : '🔴 Disconnected'} | Healthy: ${health.webSocket.healthy}`);
    logger.info(`   📊 Data Buffers: NIFTY=${health.strategy.bufferSizes.NIFTY} | BANKNIFTY=${health.strategy.bufferSizes.BANKNIFTY}`);
    logger.info(`   📋 Orders: Active=${health.orders.active} | Daily=${health.orders.dailyTrades}/${config.trading.maxPositions} | P&L=₹${health.orders.dailyPnL.toFixed(2)}`);
    logger.info(`   💾 Memory: ${health.memory.used}MB (${health.memory.percentage}%) | Uptime: ${uptime}`);
    
    if (issues.length > 0) {
      logger.warn(`⚠️ Health Issues Found (${issues.length}):`);
      issues.forEach(issue => {
        const emoji = issue.severity === 'critical' ? '🚨' : '⚠️';
        logger.warn(`   ${emoji} ${issue.message}`);
      });
    } else {
      logger.info('✅ All systems healthy');
    }
  }

  private async sendHourlySummary(health: SystemHealth): Promise<void> {
    try {
      // Import telegramBot here to avoid circular dependencies
      const { telegramBot } = await import('./telegramBot');
      await telegramBot.sendHourlyMarketSummary();
      
      logger.info('📱 Hourly health summary sent to Telegram');
    } catch (error) {
      logger.error('Failed to send hourly summary:', (error as Error).message);
    }
  }

  public getHealthSummary(): string {
    const health = this.getSystemHealth();
    const issues = this.analyzeHealth(health);
    const uptime = `${Math.floor(health.uptime / 3600)}h ${Math.floor((health.uptime % 3600) / 60)}m`;
    
    let summary = `🏥 System Health Summary:\n\n`;
    summary += `🔗 WebSocket: ${health.webSocket.connected ? '🟢' : '🔴'} ${health.webSocket.healthy ? 'Healthy' : 'Issues'}\n`;
    summary += `📊 Data: NIFTY=${health.strategy.bufferSizes.NIFTY} | BNF=${health.strategy.bufferSizes.BANKNIFTY} ticks\n`;
    summary += `📋 Trading: ${health.orders.dailyTrades}/${config.trading.maxPositions} | Active=${health.orders.active}\n`;
    summary += `💾 Memory: ${health.memory.used}MB (${health.memory.percentage}%)\n`;
    summary += `⏱️ Uptime: ${uptime}\n`;
    
    if (issues.length > 0) {
      summary += `\n⚠️ Issues (${issues.length}):\n`;
      issues.forEach(issue => {
        const emoji = issue.severity === 'critical' ? '🚨' : '⚠️';
        summary += `${emoji} ${issue.message}\n`;
      });
    } else {
      summary += `\n✅ All systems healthy`;
    }
    
    return summary;
  }

  public stop(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
      logger.info('🏥 Health Monitor stopped');
    }
  }
}

export const healthMonitor = new HealthMonitor();