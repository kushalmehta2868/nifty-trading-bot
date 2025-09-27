import { logger } from '../utils/logger';
import { angelAPI } from './angelAPI';

export interface PerformanceMetrics {
  apiLatency: {
    avg: number;
    p95: number;
    p99: number;
    max: number;
    count: number;
  };
  signalLatency: {
    avg: number;
    max: number;
    count: number;
  };
  executionLatency: {
    avg: number;
    max: number;
    count: number;
  };
  systemMetrics: {
    uptime: number;
    errorRate: number;
    memoryUsage: number;
    memoryPercentage: number;
  };
  tradingMetrics: {
    signalsGenerated: number;
    signalsExecuted: number;
    executionSuccessRate: number;
  };
}

export interface PerformanceAlert {
  severity: 'warning' | 'critical';
  metric: string;
  value: number;
  threshold: number;
  message: string;
  timestamp: Date;
}

class PerformanceMonitor {
  private metrics: Map<string, number[]> = new Map();
  private alerts: PerformanceAlert[] = [];
  private readonly MAX_SAMPLES = 1000; // Keep last 1000 measurements per metric
  private readonly ALERT_COOLDOWN = 300000; // 5 minutes between similar alerts
  private lastAlerts: Map<string, number> = new Map();

  // Performance thresholds (institutional grade)
  private readonly THRESHOLDS = {
    apiLatency: { warning: 100, critical: 300 }, // milliseconds
    signalLatency: { warning: 300, critical: 500 },
    executionLatency: { warning: 1500, critical: 2000 },
    errorRate: { warning: 2, critical: 5 }, // percentage
    memoryUsage: { warning: 80, critical: 90 } // percentage
  };

  private startTime = Date.now();
  private totalRequests = 0;
  private totalErrors = 0;
  private signalsGenerated = 0;
  private signalsExecuted = 0;

  public initialize(): void {
    logger.info('📊 Performance Monitor initializing...');

    // Start periodic monitoring every 30 seconds
    setInterval(() => {
      this.performHealthCheck();
    }, 30000);

    // Clear old samples every 10 minutes
    setInterval(() => {
      this.cleanupOldSamples();
    }, 600000);

    logger.info('📊 Performance Monitor initialized - tracking all system metrics');
  }

  // 🚀 METRIC RECORDING METHODS
  public recordApiLatency(duration: number): void {
    this.recordMetric('apiLatency', duration);
    this.totalRequests++;
    this.checkThreshold('apiLatency', duration);
  }

  public recordSignalLatency(duration: number): void {
    this.recordMetric('signalLatency', duration);
    this.checkThreshold('signalLatency', duration);
  }

  public recordExecutionLatency(duration: number): void {
    this.recordMetric('executionLatency', duration);
    this.checkThreshold('executionLatency', duration);
  }

  public recordError(errorType: string): void {
    this.recordMetric('errors', 1);
    this.totalErrors++;

    const errorRate = (this.totalErrors / this.totalRequests) * 100;
    this.checkThreshold('errorRate', errorRate);
  }

  public recordSignalGenerated(): void {
    this.signalsGenerated++;
  }

  public recordSignalExecuted(): void {
    this.signalsExecuted++;
  }

  private recordMetric(name: string, value: number): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }

    const values = this.metrics.get(name)!;
    values.push(value);

    // Keep only last N measurements
    if (values.length > this.MAX_SAMPLES) {
      values.splice(0, values.length - this.MAX_SAMPLES);
    }
  }

  // 📈 STATISTICAL CALCULATIONS
  public getPercentile(name: string, percentile: number): number {
    const values = this.metrics.get(name) || [];
    if (values.length === 0) return 0;

    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  public getAverage(name: string): number {
    const values = this.metrics.get(name) || [];
    if (values.length === 0) return 0;

    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  public getMax(name: string): number {
    const values = this.metrics.get(name) || [];
    return values.length > 0 ? Math.max(...values) : 0;
  }

  public getCount(name: string): number {
    const values = this.metrics.get(name) || [];
    return values.length;
  }

  // 🎯 COMPREHENSIVE PERFORMANCE REPORT
  public getPerformanceMetrics(): PerformanceMetrics {
    const memoryUsage = process.memoryUsage();
    const memoryUsedMB = Math.round(memoryUsage.rss / 1024 / 1024);
    const memoryBaseline = 300; // MB
    const memoryPercentage = Math.min(100, Math.round((memoryUsedMB / memoryBaseline) * 100));

    const apiMetrics = angelAPI.getMetrics();
    const errorRate = this.totalRequests > 0 ? (this.totalErrors / this.totalRequests) * 100 : 0;
    const executionSuccessRate = this.signalsGenerated > 0 ?
      (this.signalsExecuted / this.signalsGenerated) * 100 : 0;

    return {
      apiLatency: {
        avg: apiMetrics.avgResponseTime || this.getAverage('apiLatency'),
        p95: this.getPercentile('apiLatency', 95),
        p99: this.getPercentile('apiLatency', 99),
        max: this.getMax('apiLatency'),
        count: this.getCount('apiLatency')
      },
      signalLatency: {
        avg: this.getAverage('signalLatency'),
        max: this.getMax('signalLatency'),
        count: this.getCount('signalLatency')
      },
      executionLatency: {
        avg: this.getAverage('executionLatency'),
        max: this.getMax('executionLatency'),
        count: this.getCount('executionLatency')
      },
      systemMetrics: {
        uptime: Math.floor((Date.now() - this.startTime) / 1000),
        errorRate: errorRate,
        memoryUsage: memoryUsedMB,
        memoryPercentage: memoryPercentage
      },
      tradingMetrics: {
        signalsGenerated: this.signalsGenerated,
        signalsExecuted: this.signalsExecuted,
        executionSuccessRate: executionSuccessRate
      }
    };
  }

  // ⚠️ ALERT SYSTEM
  private checkThreshold(metric: string, value: number): void {
    const threshold = this.THRESHOLDS[metric as keyof typeof this.THRESHOLDS];
    if (!threshold) return;

    let severity: 'warning' | 'critical' | null = null;
    let thresholdValue = 0;

    if (value >= threshold.critical) {
      severity = 'critical';
      thresholdValue = threshold.critical;
    } else if (value >= threshold.warning) {
      severity = 'warning';
      thresholdValue = threshold.warning;
    }

    if (severity) {
      this.generateAlert(severity, metric, value, thresholdValue);
    }
  }

  private generateAlert(
    severity: 'warning' | 'critical',
    metric: string,
    value: number,
    threshold: number
  ): void {
    const alertKey = `${metric}_${severity}`;
    const lastAlert = this.lastAlerts.get(alertKey) || 0;

    // Cooldown period to prevent spam
    if (Date.now() - lastAlert < this.ALERT_COOLDOWN) {
      return;
    }

    const alert: PerformanceAlert = {
      severity,
      metric,
      value,
      threshold,
      message: `${metric} ${severity}: ${value.toFixed(2)} exceeds threshold ${threshold}`,
      timestamp: new Date()
    };

    this.alerts.push(alert);
    this.lastAlerts.set(alertKey, Date.now());

    // Keep only last 100 alerts
    if (this.alerts.length > 100) {
      this.alerts.splice(0, this.alerts.length - 100);
    }

    // Log alert
    const emoji = severity === 'critical' ? '🚨' : '⚠️';
    logger.warn(`${emoji} Performance Alert: ${alert.message}`);

    // Emit system event for other components to handle
    (process as any).emit('performanceAlert', alert);
  }

  private performHealthCheck(): void {
    const metrics = this.getPerformanceMetrics();

    // Check memory usage
    this.checkThreshold('memoryUsage', metrics.systemMetrics.memoryPercentage);

    // Check error rate
    this.checkThreshold('errorRate', metrics.systemMetrics.errorRate);

    // Log periodic health summary
    const uptime = `${Math.floor(metrics.systemMetrics.uptime / 3600)}h ${Math.floor((metrics.systemMetrics.uptime % 3600) / 60)}m`;

    logger.info('📊 Performance Health Check:');
    logger.info(`   🚀 API: avg=${metrics.apiLatency.avg.toFixed(0)}ms, p95=${metrics.apiLatency.p95.toFixed(0)}ms, count=${metrics.apiLatency.count}`);
    logger.info(`   ⚡ Signals: avg=${metrics.signalLatency.avg.toFixed(0)}ms, max=${metrics.signalLatency.max.toFixed(0)}ms, count=${metrics.signalLatency.count}`);
    logger.info(`   🎯 Execution: avg=${metrics.executionLatency.avg.toFixed(0)}ms, success=${metrics.tradingMetrics.executionSuccessRate.toFixed(1)}%`);
    logger.info(`   💾 System: memory=${metrics.systemMetrics.memoryPercentage}%, errors=${metrics.systemMetrics.errorRate.toFixed(2)}%, uptime=${uptime}`);
  }

  public getRecentAlerts(count: number = 10): PerformanceAlert[] {
    return this.alerts.slice(-count);
  }

  public clearAlerts(): void {
    this.alerts = [];
    logger.info('📊 Performance alerts cleared');
  }

  private cleanupOldSamples(): void {
    // Already handled by MAX_SAMPLES limit, but this could implement time-based cleanup
    logger.debug('📊 Cleaned up old performance samples');
  }

  // 📋 INSTITUTIONAL GRADE REPORTING
  public generateDetailedReport(): string {
    const metrics = this.getPerformanceMetrics();
    const uptime = `${Math.floor(metrics.systemMetrics.uptime / 3600)}h ${Math.floor((metrics.systemMetrics.uptime % 3600) / 60)}m`;

    let report = `📊 PERFORMANCE ANALYTICS REPORT\n\n`;

    // SLA Compliance
    const apiSLA = metrics.apiLatency.avg <= 100 ? '✅' : metrics.apiLatency.avg <= 300 ? '⚠️' : '❌';
    const signalSLA = metrics.signalLatency.avg <= 300 ? '✅' : metrics.signalLatency.avg <= 500 ? '⚠️' : '❌';
    const executionSLA = metrics.executionLatency.avg <= 1500 ? '✅' : metrics.executionLatency.avg <= 2000 ? '⚠️' : '❌';

    report += `🎯 SLA COMPLIANCE:\n`;
    report += `${apiSLA} API Response: ${metrics.apiLatency.avg.toFixed(0)}ms (target: <100ms)\n`;
    report += `${signalSLA} Signal Generation: ${metrics.signalLatency.avg.toFixed(0)}ms (target: <300ms)\n`;
    report += `${executionSLA} Order Execution: ${metrics.executionLatency.avg.toFixed(0)}ms (target: <1500ms)\n\n`;

    // Detailed Metrics
    report += `📈 DETAILED METRICS:\n`;
    report += `API Latency: avg=${metrics.apiLatency.avg.toFixed(0)}ms, p95=${metrics.apiLatency.p95.toFixed(0)}ms, p99=${metrics.apiLatency.p99.toFixed(0)}ms\n`;
    report += `Signal Processing: ${metrics.signalLatency.count} signals, avg=${metrics.signalLatency.avg.toFixed(0)}ms\n`;
    report += `Order Execution: ${metrics.tradingMetrics.executionSuccessRate.toFixed(1)}% success rate\n`;
    report += `System: ${metrics.systemMetrics.memoryPercentage}% memory, ${metrics.systemMetrics.errorRate.toFixed(2)}% errors, ${uptime} uptime\n\n`;

    // Recent Alerts
    const recentAlerts = this.getRecentAlerts(5);
    if (recentAlerts.length > 0) {
      report += `⚠️ RECENT ALERTS (last 5):\n`;
      recentAlerts.forEach(alert => {
        const emoji = alert.severity === 'critical' ? '🚨' : '⚠️';
        report += `${emoji} ${alert.metric}: ${alert.value.toFixed(2)} (${alert.timestamp.toLocaleTimeString()})\n`;
      });
    } else {
      report += `✅ No recent performance alerts\n`;
    }

    return report;
  }
}

export const performanceMonitor = new PerformanceMonitor();