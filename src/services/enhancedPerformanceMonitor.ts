import { logger } from '../utils/logger';
import { enhancedAngelAPI } from './enhancedAngelAPI';
import { signalValidation, StrategyPerformance } from './signalValidation';

export interface EnhancedPerformanceMetrics {
  // Core API Performance
  apiLatency: {
    avg: number;
    p50: number;
    p95: number;
    p99: number;
    max: number;
    count: number;
    connectionPoolUtilization: number;
    cacheHitRate: number;
  };

  // Signal Generation Performance
  signalGeneration: {
    avgLatency: number;
    maxLatency: number;
    signalsPerHour: number;
    strategiesExecuted: number;
    parallelExecutionTime: number;
  };

  // Trading Performance
  tradingPerformance: {
    totalSignals: number;
    executedSignals: number;
    executionRate: number;
    avgSlippage: number;
    fillRate: number;
    rejectRate: number;
  };

  // Real-time Accuracy Metrics
  accuracyMetrics: {
    last24h: { winRate: number; signalCount: number; };
    last7d: { winRate: number; signalCount: number; };
    last30d: { winRate: number; signalCount: number; };
    confidenceCalibrationError: number;
  };

  // System Health
  systemHealth: {
    uptime: number;
    memoryUsage: number;
    memoryPercentage: number;
    cpuUsage: number;
    errorRate: number;
    alertsTriggered: number;
  };

  // Market Data Quality
  dataQuality: {
    webSocketUptime: number;
    priceUpdatesPerSecond: number;
    dataLatency: number;
    missedUpdates: number;
    dataAccuracy: number;
  };

  // Risk Metrics
  riskMetrics: {
    currentDrawdown: number;
    maxDrawdown: number;
    valueAtRisk: number;
    portfolioHeat: number;
    riskScore: number;
  };
}

export interface PerformanceAlert {
  id: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  category: 'PERFORMANCE' | 'ACCURACY' | 'SYSTEM' | 'RISK';
  metric: string;
  value: number;
  threshold: number;
  message: string;
  timestamp: Date;
  acknowledged: boolean;
}

class EnhancedPerformanceMonitor {
  private metrics: Map<string, number[]> = new Map();
  private alerts: PerformanceAlert[] = [];
  private readonly MAX_SAMPLES = 2000;
  private readonly ALERT_COOLDOWN = 300000; // 5 minutes
  private lastAlerts: Map<string, number> = new Map();

  // Enhanced thresholds for institutional-grade monitoring
  private readonly THRESHOLDS = {
    // API Performance (institutional standards)
    apiLatency: { warning: 50, critical: 100 }, // milliseconds
    apiP95Latency: { warning: 100, critical: 200 },
    apiErrorRate: { warning: 1, critical: 3 }, // percentage
    cacheHitRate: { warning: 70, critical: 50 }, // percentage (lower is worse)

    // Signal Generation
    signalLatency: { warning: 100, critical: 200 }, // milliseconds
    signalsPerHour: { warning: 5, critical: 2 }, // minimum signals

    // Trading Performance
    executionRate: { warning: 90, critical: 80 }, // percentage
    slippage: { warning: 0.2, critical: 0.5 }, // percentage
    fillRate: { warning: 95, critical: 90 }, // percentage

    // Accuracy
    winRateDecline: { warning: 10, critical: 20 }, // percentage points
    confidenceError: { warning: 15, critical: 25 }, // percentage

    // System Health
    memoryUsage: { warning: 80, critical: 90 }, // percentage
    cpuUsage: { warning: 70, critical: 85 }, // percentage
    errorRate: { warning: 1, critical: 5 }, // percentage

    // Risk
    drawdown: { warning: 3, critical: 5 }, // percentage
    portfolioHeat: { warning: 70, critical: 85 } // percentage
  };

  private startTime = Date.now();
  private totalRequests = 0;
  private totalErrors = 0;
  private signalsGenerated = 0;
  private signalsExecuted = 0;
  private systemAlerts = 0;

  // Real-time metrics
  private realtimeMetrics = {
    currentRequests: 0,
    lastMinuteRequests: 0,
    priceUpdatesReceived: 0,
    lastPriceUpdate: 0
  };

  public initialize(): void {
    logger.info('📊 Enhanced Performance Monitor initializing...');

    // Start comprehensive monitoring every 30 seconds
    setInterval(() => {
      this.performEnhancedHealthCheck();
    }, 30000);

    // Real-time metrics update every 10 seconds
    setInterval(() => {
      this.updateRealtimeMetrics();
    }, 10000);

    // Deep analysis every 5 minutes
    setInterval(() => {
      this.performDeepAnalysis();
    }, 300000);

    // Cleanup old data every hour
    setInterval(() => {
      this.cleanupOldData();
    }, 3600000);

    logger.info('📊 Enhanced Performance Monitor initialized with institutional-grade thresholds');
  }

  // 🚀 WEEK 1: ENHANCED METRIC RECORDING
  public recordEnhancedApiLatency(duration: number, cacheHit: boolean = false): void {
    this.recordMetric('apiLatency', duration);
    this.recordMetric('cacheHits', cacheHit ? 1 : 0);
    this.totalRequests++;

    // Check institutional thresholds
    this.checkEnhancedThreshold('apiLatency', duration);

    // Record in original performance monitor for compatibility
    // performanceMonitor.recordApiLatency(duration);
  }

  public recordSignalGenerationLatency(duration: number, strategiesCount: number): void {
    this.recordMetric('signalLatency', duration);
    this.recordMetric('strategiesExecuted', strategiesCount);
    this.signalsGenerated++;

    this.checkEnhancedThreshold('signalLatency', duration);
  }

  public recordExecutionMetrics(slippage: number, filled: boolean, rejected: boolean): void {
    this.recordMetric('slippage', slippage);
    this.recordMetric('fills', filled ? 1 : 0);
    this.recordMetric('rejections', rejected ? 1 : 0);

    if (filled) this.signalsExecuted++;

    this.checkEnhancedThreshold('slippage', slippage);
  }

  public recordPriceUpdate(): void {
    this.realtimeMetrics.priceUpdatesReceived++;
    this.realtimeMetrics.lastPriceUpdate = Date.now();
  }

  public recordSystemError(errorType: string): void {
    this.recordMetric('errors', 1);
    this.totalErrors++;

    const errorRate = (this.totalErrors / Math.max(this.totalRequests, 1)) * 100;
    this.checkEnhancedThreshold('errorRate', errorRate);
  }

  // 🚀 WEEK 1: ENHANCED METRICS CALCULATION
  private recordMetric(name: string, value: number): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }

    const values = this.metrics.get(name)!;
    values.push(value);

    // Keep only recent samples for memory efficiency
    if (values.length > this.MAX_SAMPLES) {
      values.splice(0, values.length - this.MAX_SAMPLES);
    }
  }

  // Enhanced percentile calculations
  public getPercentile(name: string, percentile: number): number {
    const values = this.metrics.get(name) || [];
    if (values.length === 0) return 0;

    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  public getAverage(name: string, timeWindowMs?: number): number {
    const values = this.metrics.get(name) || [];
    if (values.length === 0) return 0;

    let relevantValues = values;
    if (timeWindowMs) {
      // Filter to recent time window (simplified - in production you'd store timestamps)
      const recentCount = Math.min(values.length, Math.floor(timeWindowMs / 10000)); // Assuming 10s intervals
      relevantValues = values.slice(-recentCount);
    }

    return relevantValues.reduce((sum, val) => sum + val, 0) / relevantValues.length;
  }

  // 🚀 WEEK 1: COMPREHENSIVE PERFORMANCE REPORT
  public getEnhancedPerformanceMetrics(): EnhancedPerformanceMetrics {
    const memoryUsage = process.memoryUsage();
    const memoryUsedMB = Math.round(memoryUsage.rss / 1024 / 1024);
    const memoryBaseline = 512; // MB
    const memoryPercentage = Math.min(100, Math.round((memoryUsedMB / memoryBaseline) * 100));

    // Get enhanced API metrics
    const enhancedApiMetrics = enhancedAngelAPI.getEnhancedMetrics();

    // Get signal validation metrics
    const signalMetrics = signalValidation.getRealtimeMetrics();
    const strategyPerformance = signalValidation.getStrategyPerformance() as StrategyPerformance[];

    // Calculate accuracy metrics
    const overallAccuracy = strategyPerformance && strategyPerformance.length > 0 ?
      strategyPerformance.reduce((sum: number, s: StrategyPerformance) => sum + s.winRate, 0) / strategyPerformance.length : 0;

    const confidenceCalibration = signalValidation.getConfidenceCalibration();
    const avgConfidenceError = confidenceCalibration.length > 0 ?
      confidenceCalibration.reduce((sum, c) => sum + Math.abs(c.predicted - c.actual), 0) / confidenceCalibration.length : 0;

    // Calculate trading performance
    const executionRate = this.signalsGenerated > 0 ? (this.signalsExecuted / this.signalsGenerated) * 100 : 0;
    const fillRate = this.getAverage('fills') * 100;
    const rejectRate = this.getAverage('rejections') * 100;

    // Calculate system metrics
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    const errorRate = this.totalRequests > 0 ? (this.totalErrors / this.totalRequests) * 100 : 0;

    // Calculate signals per hour
    const uptimeHours = uptime / 3600;
    const signalsPerHour = uptimeHours > 0 ? this.signalsGenerated / uptimeHours : 0;

    return {
      apiLatency: {
        avg: enhancedApiMetrics.avgResponseTime || this.getAverage('apiLatency'),
        p50: this.getPercentile('apiLatency', 50),
        p95: this.getPercentile('apiLatency', 95),
        p99: this.getPercentile('apiLatency', 99),
        max: this.getMax('apiLatency'),
        count: enhancedApiMetrics.totalRequests,
        connectionPoolUtilization: (enhancedApiMetrics.connectionPoolSize / 5) * 100,
        cacheHitRate: enhancedApiMetrics.cacheHitRate
      },

      signalGeneration: {
        avgLatency: this.getAverage('signalLatency'),
        maxLatency: this.getMax('signalLatency'),
        signalsPerHour: signalsPerHour,
        strategiesExecuted: this.getAverage('strategiesExecuted'),
        parallelExecutionTime: this.getAverage('signalLatency') // Simplified
      },

      tradingPerformance: {
        totalSignals: this.signalsGenerated,
        executedSignals: this.signalsExecuted,
        executionRate: executionRate,
        avgSlippage: this.getAverage('slippage'),
        fillRate: fillRate,
        rejectRate: rejectRate
      },

      accuracyMetrics: {
        last24h: {
          winRate: signalMetrics.last24h.accuracy,
          signalCount: signalMetrics.last24h.signals
        },
        last7d: {
          winRate: signalMetrics.last7d.accuracy,
          signalCount: signalMetrics.last7d.signals
        },
        last30d: {
          winRate: signalMetrics.last30d.accuracy,
          signalCount: signalMetrics.last30d.signals
        },
        confidenceCalibrationError: avgConfidenceError
      },

      systemHealth: {
        uptime: uptime,
        memoryUsage: memoryUsedMB,
        memoryPercentage: memoryPercentage,
        cpuUsage: this.getCPUUsage(),
        errorRate: errorRate,
        alertsTriggered: this.systemAlerts
      },

      dataQuality: {
        webSocketUptime: this.calculateWebSocketUptime(),
        priceUpdatesPerSecond: this.calculatePriceUpdatesPerSecond(),
        dataLatency: this.getAverage('dataLatency'),
        missedUpdates: this.getSum('missedUpdates'),
        dataAccuracy: this.calculateDataAccuracy()
      },

      riskMetrics: {
        currentDrawdown: this.calculateCurrentDrawdown(),
        maxDrawdown: this.getMax('drawdown'),
        valueAtRisk: this.calculateVaR(),
        portfolioHeat: this.calculatePortfolioHeat(),
        riskScore: this.calculateRiskScore()
      }
    };
  }

  // 🚀 WEEK 1: ENHANCED THRESHOLD CHECKING
  private checkEnhancedThreshold(metric: string, value: number): void {
    const threshold = this.THRESHOLDS[metric as keyof typeof this.THRESHOLDS];
    if (!threshold) return;

    let severity: 'WARNING' | 'CRITICAL' | null = null;
    let thresholdValue = 0;

    if (value >= threshold.critical) {
      severity = 'CRITICAL';
      thresholdValue = threshold.critical;
    } else if (value >= threshold.warning) {
      severity = 'WARNING';
      thresholdValue = threshold.warning;
    }

    if (severity) {
      this.generateEnhancedAlert(severity, 'PERFORMANCE', metric, value, thresholdValue);
    }
  }

  private generateEnhancedAlert(
    severity: 'WARNING' | 'CRITICAL',
    category: 'PERFORMANCE' | 'ACCURACY' | 'SYSTEM' | 'RISK',
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
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      severity,
      category,
      metric,
      value,
      threshold,
      message: `${metric} ${severity.toLowerCase()}: ${value.toFixed(2)} exceeds threshold ${threshold}`,
      timestamp: new Date(),
      acknowledged: false
    };

    this.alerts.push(alert);
    this.lastAlerts.set(alertKey, Date.now());
    this.systemAlerts++;

    // Keep only last 100 alerts
    if (this.alerts.length > 100) {
      this.alerts.splice(0, this.alerts.length - 100);
    }

    // Log alert
    const emoji = severity === 'CRITICAL' ? '🚨' : '⚠️';
    logger.warn(`${emoji} Enhanced Performance Alert: ${alert.message}`);

    // Emit system event
    (process as any).emit('enhancedPerformanceAlert', alert);
  }

  // 🚀 WEEK 1: ENHANCED HEALTH CHECK
  private performEnhancedHealthCheck(): void {
    const metrics = this.getEnhancedPerformanceMetrics();

    // Check all critical thresholds
    this.checkEnhancedThreshold('memoryUsage', metrics.systemHealth.memoryPercentage);
    this.checkEnhancedThreshold('errorRate', metrics.systemHealth.errorRate);
    this.checkEnhancedThreshold('cacheHitRate', metrics.apiLatency.cacheHitRate);

    // Check accuracy degradation
    if (metrics.accuracyMetrics.last24h.signalCount >= 5) {
      this.checkAccuracyDegradation(metrics.accuracyMetrics.last24h.winRate);
    }

    // Log comprehensive health summary
    const uptime = `${Math.floor(metrics.systemHealth.uptime / 3600)}h ${Math.floor((metrics.systemHealth.uptime % 3600) / 60)}m`;

    logger.info('📊 Enhanced Performance Health Check:');
    logger.info(`   🚀 API: avg=${metrics.apiLatency.avg.toFixed(0)}ms, p95=${metrics.apiLatency.p95.toFixed(0)}ms, cache=${metrics.apiLatency.cacheHitRate.toFixed(1)}%`);
    logger.info(`   ⚡ Signals: ${metrics.signalGeneration.signalsPerHour.toFixed(1)}/hr, latency=${metrics.signalGeneration.avgLatency.toFixed(0)}ms`);
    logger.info(`   🎯 Accuracy: 24h=${metrics.accuracyMetrics.last24h.winRate.toFixed(1)}% (${metrics.accuracyMetrics.last24h.signalCount} signals)`);
    logger.info(`   💾 System: memory=${metrics.systemHealth.memoryPercentage}%, errors=${metrics.systemHealth.errorRate.toFixed(2)}%, uptime=${uptime}`);
    logger.info(`   📊 Trading: exec=${metrics.tradingPerformance.executionRate.toFixed(1)}%, slippage=${metrics.tradingPerformance.avgSlippage.toFixed(3)}%`);
  }

  private checkAccuracyDegradation(currentWinRate: number): void {
    // Get historical win rate for comparison
    const historicalWinRate = 75; // You could calculate this from longer history
    const degradation = historicalWinRate - currentWinRate;

    if (degradation >= this.THRESHOLDS.winRateDecline.critical) {
      this.generateEnhancedAlert('CRITICAL', 'ACCURACY', 'winRateDecline', degradation, this.THRESHOLDS.winRateDecline.critical);
    } else if (degradation >= this.THRESHOLDS.winRateDecline.warning) {
      this.generateEnhancedAlert('WARNING', 'ACCURACY', 'winRateDecline', degradation, this.THRESHOLDS.winRateDecline.warning);
    }
  }

  // 🚀 WEEK 1: REAL-TIME METRICS UPDATE
  private updateRealtimeMetrics(): void {
    this.realtimeMetrics.lastMinuteRequests = this.realtimeMetrics.currentRequests;
    this.realtimeMetrics.currentRequests = 0;

    // Update price update rate
    const priceUpdateRate = this.realtimeMetrics.priceUpdatesReceived / 10; // Per second over 10s window
    this.recordMetric('priceUpdatesPerSecond', priceUpdateRate);
    this.realtimeMetrics.priceUpdatesReceived = 0;

    // Check for data staleness
    const timeSinceLastUpdate = Date.now() - this.realtimeMetrics.lastPriceUpdate;
    if (timeSinceLastUpdate > 30000) { // 30 seconds
      this.generateEnhancedAlert('WARNING', 'SYSTEM', 'dataStale', timeSinceLastUpdate, 30000);
    }
  }

  // 🚀 WEEK 1: DEEP ANALYSIS
  private performDeepAnalysis(): void {
    logger.info('🔍 Performing deep performance analysis...');

    // Analyze patterns in latency
    this.analyzeLatencyPatterns();

    // Analyze accuracy trends
    this.analyzeAccuracyTrends();

    // Analyze resource usage trends
    this.analyzeResourceTrends();

    // Generate predictive alerts
    this.generatePredictiveAlerts();
  }

  private analyzeLatencyPatterns(): void {
    const latencies = this.metrics.get('apiLatency') || [];
    if (latencies.length < 100) return;

    const recentLatencies = latencies.slice(-50);
    const earlierLatencies = latencies.slice(-100, -50);

    const recentAvg = recentLatencies.reduce((sum, l) => sum + l, 0) / recentLatencies.length;
    const earlierAvg = earlierLatencies.reduce((sum, l) => sum + l, 0) / earlierLatencies.length;

    const degradation = ((recentAvg - earlierAvg) / earlierAvg) * 100;

    if (degradation > 50) {
      logger.warn(`📈 Latency trend: ${degradation.toFixed(1)}% increase detected`);
      this.generateEnhancedAlert('WARNING', 'PERFORMANCE', 'latencyTrend', degradation, 50);
    }
  }

  private analyzeAccuracyTrends(): void {
    // Implementation for accuracy trend analysis
    const strategyPerformance = signalValidation.getStrategyPerformance() as StrategyPerformance[];

    strategyPerformance && strategyPerformance.forEach((strategy: StrategyPerformance) => {
      if (strategy.totalSignals >= 20 && strategy.winRate < 50) {
        logger.warn(`📉 Strategy accuracy concern: ${strategy.strategyName} at ${strategy.winRate.toFixed(1)}%`);
        this.generateEnhancedAlert('WARNING', 'ACCURACY', 'strategyAccuracy', strategy.winRate, 50);
      }
    });
  }

  private analyzeResourceTrends(): void {
    // Implementation for resource trend analysis
    const memoryUsage = process.memoryUsage();
    const memoryMB = memoryUsage.rss / 1024 / 1024;

    this.recordMetric('memoryUsageMB', memoryMB);

    // Check for memory leaks
    const memoryHistory = this.metrics.get('memoryUsageMB') || [];
    if (memoryHistory.length >= 60) { // 10 minutes of data
      const recentMemory = memoryHistory.slice(-12); // Last 2 minutes
      const earlierMemory = memoryHistory.slice(-60, -48); // Earlier 2 minutes

      const recentAvg = recentMemory.reduce((sum, m) => sum + m, 0) / recentMemory.length;
      const earlierAvg = earlierMemory.reduce((sum, m) => sum + m, 0) / earlierMemory.length;

      const growth = ((recentAvg - earlierAvg) / earlierAvg) * 100;

      if (growth > 10) {
        logger.warn(`📈 Memory growth detected: ${growth.toFixed(1)}% increase`);
        this.generateEnhancedAlert('WARNING', 'SYSTEM', 'memoryGrowth', growth, 10);
      }
    }
  }

  private generatePredictiveAlerts(): void {
    // Implementation for predictive alerting based on trends
    // This is a simplified version - in production you'd use more sophisticated algorithms

    const metrics = this.getEnhancedPerformanceMetrics();

    // Predict if we'll hit memory limit
    if (metrics.systemHealth.memoryPercentage > 70) {
      const growthRate = this.calculateMemoryGrowthRate();
      const timeToLimit = this.calculateTimeToMemoryLimit(growthRate);

      if (timeToLimit < 3600) { // Less than 1 hour
        logger.warn(`🔮 Predictive alert: Memory limit in ${Math.round(timeToLimit/60)} minutes`);
        this.generateEnhancedAlert('WARNING', 'SYSTEM', 'predictiveMemory', timeToLimit, 3600);
      }
    }
  }

  // Helper calculation methods
  private getMax(name: string): number {
    const values = this.metrics.get(name) || [];
    return values.length > 0 ? Math.max(...values) : 0;
  }

  private getSum(name: string): number {
    const values = this.metrics.get(name) || [];
    return values.reduce((sum, val) => sum + val, 0);
  }

  private getCPUUsage(): number {
    // Simplified CPU usage calculation
    // In production, you'd use process.cpuUsage() or external monitoring
    return Math.random() * 50 + 20; // Mock data
  }

  private calculateWebSocketUptime(): number {
    // Calculate WebSocket connection uptime percentage
    return 98.5; // Mock data - implement real calculation
  }

  private calculatePriceUpdatesPerSecond(): number {
    const updates = this.getAverage('priceUpdatesPerSecond');
    return updates || 0;
  }

  private calculateDataAccuracy(): number {
    // Calculate data accuracy percentage
    return 99.2; // Mock data - implement real calculation
  }

  private calculateCurrentDrawdown(): number {
    // Calculate current portfolio drawdown
    return 0; // Would need trading history
  }

  private calculateVaR(): number {
    // Calculate Value at Risk
    return 0; // Would need position and price data
  }

  private calculatePortfolioHeat(): number {
    // Calculate portfolio heat (risk exposure)
    return 0; // Would need position data
  }

  private calculateRiskScore(): number {
    // Calculate overall risk score
    return 0; // Would need comprehensive risk calculation
  }

  private calculateMemoryGrowthRate(): number {
    // Calculate memory growth rate per hour
    return 0; // Simplified
  }

  private calculateTimeToMemoryLimit(growthRate: number): number {
    // Calculate time to memory limit in seconds
    return 3600; // Simplified
  }

  private cleanupOldData(): void {
    // Clean up old metrics data
    for (const [key, values] of this.metrics.entries()) {
      if (values.length > this.MAX_SAMPLES) {
        values.splice(0, values.length - this.MAX_SAMPLES);
      }
    }

    logger.debug('🧹 Enhanced performance data cleanup completed');
  }

  // Public methods for accessing data
  public getRecentAlerts(count: number = 10): PerformanceAlert[] {
    return this.alerts
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, count);
  }

  public acknowledgeAlert(alertId: string): boolean {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      logger.info(`✅ Alert acknowledged: ${alertId}`);
      return true;
    }
    return false;
  }

  public getDetailedReport(): string {
    const metrics = this.getEnhancedPerformanceMetrics();
    const uptime = `${Math.floor(metrics.systemHealth.uptime / 3600)}h ${Math.floor((metrics.systemHealth.uptime % 3600) / 60)}m`;

    let report = `📊 ENHANCED PERFORMANCE REPORT\n\n`;

    // SLA Compliance with institutional standards
    const apiSLA = metrics.apiLatency.avg <= 50 ? '✅' : metrics.apiLatency.avg <= 100 ? '⚠️' : '❌';
    const accuracySLA = metrics.accuracyMetrics.last24h.winRate >= 65 ? '✅' : metrics.accuracyMetrics.last24h.winRate >= 50 ? '⚠️' : '❌';
    const systemSLA = metrics.systemHealth.memoryPercentage <= 80 ? '✅' : metrics.systemHealth.memoryPercentage <= 90 ? '⚠️' : '❌';

    report += `🎯 INSTITUTIONAL SLA COMPLIANCE:\n`;
    report += `${apiSLA} API Performance: ${metrics.apiLatency.avg.toFixed(0)}ms avg (target: <50ms)\n`;
    report += `${accuracySLA} Trading Accuracy: ${metrics.accuracyMetrics.last24h.winRate.toFixed(1)}% (target: >65%)\n`;
    report += `${systemSLA} System Health: ${metrics.systemHealth.memoryPercentage}% memory (target: <80%)\n\n`;

    // Detailed Performance Metrics
    report += `📈 DETAILED PERFORMANCE METRICS:\n`;
    report += `API: avg=${metrics.apiLatency.avg.toFixed(0)}ms, p95=${metrics.apiLatency.p95.toFixed(0)}ms, cache=${metrics.apiLatency.cacheHitRate.toFixed(1)}%\n`;
    report += `Signals: ${metrics.signalGeneration.signalsPerHour.toFixed(1)}/hr, exec=${metrics.tradingPerformance.executionRate.toFixed(1)}%\n`;
    report += `Accuracy: 24h=${metrics.accuracyMetrics.last24h.winRate.toFixed(1)}%, 7d=${metrics.accuracyMetrics.last7d.winRate.toFixed(1)}%\n`;
    report += `System: memory=${metrics.systemHealth.memoryPercentage}%, errors=${metrics.systemHealth.errorRate.toFixed(2)}%, uptime=${uptime}\n\n`;

    // Recent Alerts
    const recentAlerts = this.getRecentAlerts(5);
    if (recentAlerts.length > 0) {
      report += `⚠️ RECENT ALERTS (last 5):\n`;
      recentAlerts.forEach(alert => {
        const emoji = alert.severity === 'CRITICAL' ? '🚨' : '⚠️';
        const ack = alert.acknowledged ? '✅' : '❌';
        report += `${emoji} ${ack} ${alert.metric}: ${alert.value.toFixed(2)} (${alert.timestamp.toLocaleTimeString()})\n`;
      });
    } else {
      report += `✅ No recent performance alerts\n`;
    }

    return report;
  }
}

export const enhancedPerformanceMonitor = new EnhancedPerformanceMonitor();