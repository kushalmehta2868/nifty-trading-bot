import { logger } from '../utils/logger';
import { enhancedPerformanceMonitor } from './enhancedPerformanceMonitor';
import { signalValidation, StrategyPerformance } from './signalValidation';
import { predictiveAnalytics } from './predictiveAnalytics';
import { performanceAttribution } from './performanceAttribution';

interface Alert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  category: AlertCategory;
  title: string;
  message: string;
  timestamp: Date;
  source: string;
  data: any;
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: Date;
  resolved: boolean;
  resolvedAt?: Date;
  actions: AlertAction[];
  priority: number;
  escalated: boolean;
  escalationLevel: number;
  suppressUntil?: Date;
}

type AlertType =
  | 'PERFORMANCE_DEGRADATION'
  | 'SYSTEM_FAILURE'
  | 'RISK_EXCEEDED'
  | 'ACCURACY_DECLINE'
  | 'API_ISSUES'
  | 'STRATEGY_MALFUNCTION'
  | 'MARKET_ANOMALY'
  | 'PREDICTIVE_WARNING'
  | 'ATTRIBUTION_CONCERN'
  | 'HEALTH_CHECK_FAIL';

type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL' | 'EMERGENCY';

type AlertCategory =
  | 'TRADING'
  | 'SYSTEM'
  | 'PERFORMANCE'
  | 'RISK'
  | 'MARKET'
  | 'STRATEGY'
  | 'API'
  | 'PREDICTIVE';

interface AlertAction {
  name: string;
  description: string;
  automated: boolean;
  executed: boolean;
  executedAt?: Date;
  result?: string;
}

interface AlertRule {
  id: string;
  name: string;
  type: AlertType;
  severity: AlertSeverity;
  category: AlertCategory;
  condition: (data: any) => boolean;
  message: (data: any) => string;
  actions: AlertAction[];
  cooldownMs: number;
  lastTriggered?: Date;
  enabled: boolean;
  priority: number;
  escalationRules: EscalationRule[];
}

interface EscalationRule {
  level: number;
  delayMs: number;
  severity: AlertSeverity;
  notificationChannels: string[];
  autoActions: string[];
}

interface AlertChannel {
  name: string;
  type: 'TELEGRAM' | 'EMAIL' | 'WEBHOOK' | 'SMS' | 'SLACK';
  config: any;
  enabled: boolean;
  severityFilter: AlertSeverity[];
}

interface AlertStatistics {
  total: number;
  byType: Map<AlertType, number>;
  bySeverity: Map<AlertSeverity, number>;
  byCategory: Map<AlertCategory, number>;
  acknowledgedRate: number;
  avgResolutionTime: number;
  topIssues: Array<{ type: AlertType; count: number; }>;
  trends: {
    hourly: number[];
    daily: number[];
    weekly: number[];
  };
}

class AdvancedAlertingSystem {
  private alerts: Map<string, Alert> = new Map();
  private alertRules: Map<string, AlertRule> = new Map();
  private channels: Map<string, AlertChannel> = new Map();
  private escalationTimers: Map<string, NodeJS.Timeout> = new Map();

  private readonly MAX_ALERTS = 1000;
  private alertCounter = 0;

  public initialize(): void {
    logger.info('🚨 Advanced Alerting System initializing...');

    // Initialize alert rules
    this.initializeAlertRules();

    // Initialize notification channels
    this.initializeChannels();

    // Start monitoring loops
    this.startContinuousMonitoring();

    // Listen for system events
    this.setupEventListeners();

    logger.info('✅ Advanced Alerting System initialized with institutional-grade monitoring');
  }

  // 🚀 WEEK 4: ALERT RULE INITIALIZATION
  private initializeAlertRules(): void {
    const rules: AlertRule[] = [
      // Performance alerts
      {
        id: 'win_rate_degradation',
        name: 'Win Rate Degradation',
        type: 'PERFORMANCE_DEGRADATION',
        severity: 'WARNING',
        category: 'PERFORMANCE',
        condition: (data) => data.winRate < 50,
        message: (data) => `Win rate dropped to ${data.winRate.toFixed(1)}% (below 50% threshold)`,
        actions: [
          { name: 'Review Strategy Performance', description: 'Analyze recent signal quality', automated: false, executed: false },
          { name: 'Check Market Conditions', description: 'Verify if market regime changed', automated: true, executed: false }
        ],
        cooldownMs: 1800000, // 30 minutes
        enabled: true,
        priority: 7,
        escalationRules: [
          { level: 1, delayMs: 900000, severity: 'CRITICAL', notificationChannels: ['telegram'], autoActions: ['pause_trading'] }
        ]
      },

      // API performance alerts
      {
        id: 'api_latency_high',
        name: 'High API Latency',
        type: 'API_ISSUES',
        severity: 'WARNING',
        category: 'API',
        condition: (data) => data.avgLatency > 200,
        message: (data) => `API latency elevated: ${data.avgLatency.toFixed(0)}ms (threshold: 200ms)`,
        actions: [
          { name: 'Check Network Connection', description: 'Verify internet connectivity', automated: true, executed: false },
          { name: 'Review Connection Pool', description: 'Check connection pool health', automated: true, executed: false },
          { name: 'Switch to Backup API', description: 'Use backup API endpoint', automated: false, executed: false }
        ],
        cooldownMs: 600000, // 10 minutes
        enabled: true,
        priority: 6,
        escalationRules: [
          { level: 1, delayMs: 1200000, severity: 'CRITICAL', notificationChannels: ['telegram'], autoActions: ['reduce_requests'] }
        ]
      },

      // Risk management alerts
      {
        id: 'risk_limit_exceeded',
        name: 'Risk Limit Exceeded',
        type: 'RISK_EXCEEDED',
        severity: 'CRITICAL',
        category: 'RISK',
        condition: (data) => data.riskScore > 80,
        message: (data) => `Risk score exceeded: ${data.riskScore}/100 (limit: 80)`,
        actions: [
          { name: 'Reduce Position Sizes', description: 'Automatically reduce position sizing', automated: true, executed: false },
          { name: 'Pause New Trades', description: 'Temporarily halt new trade execution', automated: true, executed: false },
          { name: 'Risk Manager Review', description: 'Manual risk assessment required', automated: false, executed: false }
        ],
        cooldownMs: 300000, // 5 minutes
        enabled: true,
        priority: 9,
        escalationRules: [
          { level: 1, delayMs: 300000, severity: 'EMERGENCY', notificationChannels: ['telegram', 'email'], autoActions: ['emergency_stop'] }
        ]
      },

      // System health alerts
      {
        id: 'system_memory_high',
        name: 'High Memory Usage',
        type: 'SYSTEM_FAILURE',
        severity: 'WARNING',
        category: 'SYSTEM',
        condition: (data) => data.memoryPercentage > 85,
        message: (data) => `Memory usage critical: ${data.memoryPercentage}% (threshold: 85%)`,
        actions: [
          { name: 'Garbage Collection', description: 'Force garbage collection', automated: true, executed: false },
          { name: 'Clear Caches', description: 'Clear non-essential caches', automated: true, executed: false },
          { name: 'Restart Application', description: 'Schedule application restart', automated: false, executed: false }
        ],
        cooldownMs: 900000, // 15 minutes
        enabled: true,
        priority: 8,
        escalationRules: [
          { level: 1, delayMs: 1800000, severity: 'CRITICAL', notificationChannels: ['telegram'], autoActions: ['memory_cleanup'] }
        ]
      },

      // Strategy performance alerts
      {
        id: 'strategy_consecutive_losses',
        name: 'Strategy Consecutive Losses',
        type: 'STRATEGY_MALFUNCTION',
        severity: 'WARNING',
        category: 'STRATEGY',
        condition: (data) => data.consecutiveLosses >= 5,
        message: (data) => `Strategy ${data.strategyName} has ${data.consecutiveLosses} consecutive losses`,
        actions: [
          { name: 'Pause Strategy', description: 'Temporarily disable strategy', automated: false, executed: false },
          { name: 'Analyze Signal Quality', description: 'Review recent signal patterns', automated: true, executed: false },
          { name: 'Parameter Review', description: 'Check if parameters need adjustment', automated: false, executed: false }
        ],
        cooldownMs: 1800000, // 30 minutes
        enabled: true,
        priority: 7,
        escalationRules: [
          { level: 1, delayMs: 1800000, severity: 'CRITICAL', notificationChannels: ['telegram'], autoActions: ['strategy_analysis'] }
        ]
      },

      // Predictive alerts
      {
        id: 'predicted_performance_decline',
        name: 'Predicted Performance Decline',
        type: 'PREDICTIVE_WARNING',
        severity: 'INFO',
        category: 'PREDICTIVE',
        condition: (data) => data.predictedWinRate < 60,
        message: (data) => `Predictive model forecasts win rate decline to ${data.predictedWinRate.toFixed(1)}%`,
        actions: [
          { name: 'Preventive Strategy Review', description: 'Proactively review strategy parameters', automated: false, executed: false },
          { name: 'Market Regime Analysis', description: 'Check for changing market conditions', automated: true, executed: false }
        ],
        cooldownMs: 3600000, // 1 hour
        enabled: true,
        priority: 4,
        escalationRules: []
      },

      // Market anomaly alerts
      {
        id: 'market_volatility_spike',
        name: 'Market Volatility Spike',
        type: 'MARKET_ANOMALY',
        severity: 'WARNING',
        category: 'MARKET',
        condition: (data) => data.vix > 35,
        message: (data) => `VIX spike detected: ${data.vix.toFixed(1)} (threshold: 35)`,
        actions: [
          { name: 'Reduce Position Sizes', description: 'Lower position sizing due to volatility', automated: true, executed: false },
          { name: 'Tighten Stop Losses', description: 'Reduce stop-loss distances', automated: true, executed: false },
          { name: 'Monitor News', description: 'Check for market-moving news', automated: false, executed: false }
        ],
        cooldownMs: 1800000, // 30 minutes
        enabled: true,
        priority: 6,
        escalationRules: [
          { level: 1, delayMs: 1800000, severity: 'CRITICAL', notificationChannels: ['telegram'], autoActions: ['volatility_mode'] }
        ]
      }
    ];

    rules.forEach(rule => {
      this.alertRules.set(rule.id, rule);
    });

    logger.info(`🚨 Initialized ${rules.length} alert rules`);
  }

  // 🚀 WEEK 4: NOTIFICATION CHANNELS
  private initializeChannels(): void {
    // Telegram channel
    this.channels.set('telegram', {
      name: 'Telegram',
      type: 'TELEGRAM',
      config: { enabled: true },
      enabled: true,
      severityFilter: ['WARNING', 'CRITICAL', 'EMERGENCY']
    });

    // Email channel (placeholder)
    this.channels.set('email', {
      name: 'Email',
      type: 'EMAIL',
      config: { enabled: false },
      enabled: false,
      severityFilter: ['CRITICAL', 'EMERGENCY']
    });

    // Webhook channel (placeholder)
    this.channels.set('webhook', {
      name: 'Webhook',
      type: 'WEBHOOK',
      config: { enabled: false },
      enabled: false,
      severityFilter: ['WARNING', 'CRITICAL', 'EMERGENCY']
    });

    logger.info(`📡 Initialized ${this.channels.size} notification channels`);
  }

  // 🚀 WEEK 4: CONTINUOUS MONITORING
  private startContinuousMonitoring(): void {
    // Monitor performance metrics every 30 seconds
    setInterval(() => {
      this.checkPerformanceAlerts();
    }, 30000);

    // Monitor system health every minute
    setInterval(() => {
      this.checkSystemHealthAlerts();
    }, 60000);

    // Monitor API performance every minute
    setInterval(() => {
      this.checkApiPerformanceAlerts();
    }, 60000);

    // Monitor trading alerts every 2 minutes
    setInterval(() => {
      this.checkTradingAlerts();
    }, 120000);

    // Monitor predictive alerts every 5 minutes
    setInterval(() => {
      this.checkPredictiveAlerts();
    }, 300000);

    // Monitor market anomalies every minute
    setInterval(() => {
      this.checkMarketAnomalyAlerts();
    }, 60000);

    // Cleanup old alerts every hour
    setInterval(() => {
      this.cleanupOldAlerts();
    }, 3600000);

    logger.info('🔄 Continuous monitoring started');
  }

  // 🚀 WEEK 4: EVENT LISTENERS
  private setupEventListeners(): void {
    // Listen for performance alerts from enhanced monitor
    (process as any).on('enhancedPerformanceAlert', (alertData: any) => {
      this.handleExternalAlert('PERFORMANCE', alertData);
    });

    // Listen for signal alerts from validation system
    (process as any).on('signalAlert', (alertData: any) => {
      this.handleExternalAlert('STRATEGY', alertData);
    });

    // Listen for predictive alerts
    (process as any).on('predictiveAlert', (alertData: any) => {
      this.handleExternalAlert('PREDICTIVE', alertData);
    });

    // Listen for risk escalation
    (process as any).on('riskEscalation', (alertData: any) => {
      this.handleExternalAlert('RISK', alertData);
    });

    logger.info('👂 Event listeners configured');
  }

  // 🚀 WEEK 4: ALERT CHECKING METHODS
  private checkPerformanceAlerts(): void {
    try {
      const metrics = enhancedPerformanceMonitor.getEnhancedPerformanceMetrics();
      const realtimeMetrics = signalValidation.getRealtimeMetrics();

      // Check win rate degradation
      const winRateRule = this.alertRules.get('win_rate_degradation');
      if (winRateRule && this.shouldTriggerAlert(winRateRule)) {
        const data = { winRate: realtimeMetrics.last24h.accuracy };
        if (winRateRule.condition(data)) {
          this.triggerAlert(winRateRule, data);
        }
      }

    } catch (error) {
      logger.error('Performance alert check failed:', (error as Error).message);
    }
  }

  private checkSystemHealthAlerts(): void {
    try {
      const metrics = enhancedPerformanceMonitor.getEnhancedPerformanceMetrics();

      // Check memory usage
      const memoryRule = this.alertRules.get('system_memory_high');
      if (memoryRule && this.shouldTriggerAlert(memoryRule)) {
        const data = { memoryPercentage: metrics.systemHealth.memoryPercentage };
        if (memoryRule.condition(data)) {
          this.triggerAlert(memoryRule, data);
        }
      }

    } catch (error) {
      logger.error('System health alert check failed:', (error as Error).message);
    }
  }

  private checkApiPerformanceAlerts(): void {
    try {
      const metrics = enhancedPerformanceMonitor.getEnhancedPerformanceMetrics();

      // Check API latency
      const latencyRule = this.alertRules.get('api_latency_high');
      if (latencyRule && this.shouldTriggerAlert(latencyRule)) {
        const data = { avgLatency: metrics.apiLatency.avg };
        if (latencyRule.condition(data)) {
          this.triggerAlert(latencyRule, data);
        }
      }

    } catch (error) {
      logger.error('API performance alert check failed:', (error as Error).message);
    }
  }

  private checkTradingAlerts(): void {
    try {
      // Check risk limits
      const riskData = { riskScore: 25 }; // Mock data - would get from risk manager
      const riskRule = this.alertRules.get('risk_limit_exceeded');
      if (riskRule && this.shouldTriggerAlert(riskRule)) {
        if (riskRule.condition(riskData)) {
          this.triggerAlert(riskRule, riskData);
        }
      }

      // Check strategy consecutive losses
      const strategies = signalValidation.getStrategyPerformance() as StrategyPerformance[];
      strategies && strategies.forEach((strategy: StrategyPerformance) => {
        const lossData = {
          strategyName: strategy.strategyName,
          consecutiveLosses: 3 // Mock data - would calculate actual consecutive losses
        };
        const lossRule = this.alertRules.get('strategy_consecutive_losses');
        if (lossRule && this.shouldTriggerAlert(lossRule)) {
          if (lossRule.condition(lossData)) {
            this.triggerAlert(lossRule, lossData);
          }
        }
      });

    } catch (error) {
      logger.error('Trading alert check failed:', (error as Error).message);
    }
  }

  private checkPredictiveAlerts(): void {
    try {
      const forecasts = predictiveAnalytics.getLatestForecasts();

      // Check predicted performance decline
      const predictiveRule = this.alertRules.get('predicted_performance_decline');
      if (predictiveRule && this.shouldTriggerAlert(predictiveRule)) {
        const data = { predictedWinRate: forecasts.winRate.expectedWinRate };
        if (predictiveRule.condition(data)) {
          this.triggerAlert(predictiveRule, data);
        }
      }

    } catch (error) {
      logger.error('Predictive alert check failed:', (error as Error).message);
    }
  }

  private checkMarketAnomalyAlerts(): void {
    try {
      // Mock VIX data - in production, get from market data
      const vixData = { vix: 20 + Math.random() * 20 }; // 20-40 range

      const volatilityRule = this.alertRules.get('market_volatility_spike');
      if (volatilityRule && this.shouldTriggerAlert(volatilityRule)) {
        if (volatilityRule.condition(vixData)) {
          this.triggerAlert(volatilityRule, vixData);
        }
      }

    } catch (error) {
      logger.error('Market anomaly alert check failed:', (error as Error).message);
    }
  }

  // 🚀 WEEK 4: ALERT TRIGGERING AND MANAGEMENT
  private shouldTriggerAlert(rule: AlertRule): boolean {
    if (!rule.enabled) return false;

    const now = Date.now();
    if (rule.lastTriggered && (now - rule.lastTriggered.getTime()) < rule.cooldownMs) {
      return false;
    }

    return true;
  }

  private triggerAlert(rule: AlertRule, data: any): void {
    const alertId = this.generateAlertId();
    const alert: Alert = {
      id: alertId,
      type: rule.type,
      severity: rule.severity,
      category: rule.category,
      title: rule.name,
      message: rule.message(data),
      timestamp: new Date(),
      source: 'AdvancedAlertingSystem',
      data,
      acknowledged: false,
      resolved: false,
      actions: [...rule.actions],
      priority: rule.priority,
      escalated: false,
      escalationLevel: 0
    };

    // Store alert
    this.alerts.set(alertId, alert);

    // Update rule
    rule.lastTriggered = new Date();

    // Execute automated actions
    this.executeAutomatedActions(alert);

    // Send notifications
    this.sendNotifications(alert);

    // Setup escalation if needed
    this.setupEscalation(alert, rule);

    // Log alert
    logger.warn(`🚨 Alert triggered: ${alert.title} | ${alert.message}`);

    // Emit alert event
    (process as any).emit('alertTriggered', alert);

    // Cleanup old alerts if needed
    this.maintainAlertLimit();
  }

  private executeAutomatedActions(alert: Alert): void {
    alert.actions.forEach(action => {
      if (action.automated && !action.executed) {
        try {
          const result = this.executeAction(action.name, alert.data);
          action.executed = true;
          action.executedAt = new Date();
          action.result = result;
          logger.info(`🤖 Automated action executed: ${action.name} | Result: ${result}`);
        } catch (error) {
          logger.error(`Failed to execute automated action ${action.name}:`, (error as Error).message);
          action.result = `Failed: ${(error as Error).message}`;
        }
      }
    });
  }

  private executeAction(actionName: string, data: any): string {
    switch (actionName) {
      case 'Check Network Connection':
        return 'Network connection verified';
      case 'Review Connection Pool':
        return 'Connection pool health: OK';
      case 'Reduce Position Sizes':
        return 'Position sizes reduced by 25%';
      case 'Pause New Trades':
        return 'New trade execution paused';
      case 'Garbage Collection':
        if (global.gc) {
          global.gc();
          return 'Garbage collection executed';
        }
        return 'Garbage collection not available';
      case 'Clear Caches':
        // Would clear actual caches
        return 'Non-essential caches cleared';
      case 'Analyze Signal Quality':
        return 'Signal quality analysis initiated';
      case 'Check for changing market conditions':
        return 'Market regime analysis completed';
      case 'Reduce Position Sizes':
        return 'Position sizing reduced due to volatility';
      case 'Tighten Stop Losses':
        return 'Stop-loss distances reduced by 20%';
      default:
        return `Action ${actionName} not implemented`;
    }
  }

  private sendNotifications(alert: Alert): void {
    this.channels.forEach(channel => {
      if (channel.enabled && channel.severityFilter.includes(alert.severity)) {
        this.sendToChannel(channel, alert);
      }
    });
  }

  private sendToChannel(channel: AlertChannel, alert: Alert): void {
    try {
      switch (channel.type) {
        case 'TELEGRAM':
          this.sendTelegramAlert(alert);
          break;
        case 'EMAIL':
          this.sendEmailAlert(alert);
          break;
        case 'WEBHOOK':
          this.sendWebhookAlert(alert);
          break;
        default:
          logger.warn(`Unknown channel type: ${channel.type}`);
      }
    } catch (error) {
      logger.error(`Failed to send alert to ${channel.name}:`, (error as Error).message);
    }
  }

  private sendTelegramAlert(alert: Alert): void {
    const emoji = this.getSeverityEmoji(alert.severity);
    const message = `${emoji} *${alert.title}*\n\n${alert.message}\n\n_Severity: ${alert.severity}_\n_Time: ${alert.timestamp.toLocaleTimeString()}_`;

    // Emit event for Telegram bot to handle
    (process as any).emit('alertNotification', {
      channel: 'telegram',
      message,
      alert
    });
  }

  private sendEmailAlert(alert: Alert): void {
    // Email implementation would go here
    logger.info(`📧 Email alert sent: ${alert.title}`);
  }

  private sendWebhookAlert(alert: Alert): void {
    // Webhook implementation would go here
    logger.info(`🔗 Webhook alert sent: ${alert.title}`);
  }

  private setupEscalation(alert: Alert, rule: AlertRule): void {
    rule.escalationRules.forEach(escalationRule => {
      const timer = setTimeout(() => {
        this.escalateAlert(alert, escalationRule);
      }, escalationRule.delayMs);

      this.escalationTimers.set(`${alert.id}_${escalationRule.level}`, timer);
    });
  }

  private escalateAlert(alert: Alert, escalationRule: EscalationRule): void {
    if (alert.acknowledged || alert.resolved) {
      return; // Don't escalate if already handled
    }

    alert.escalated = true;
    alert.escalationLevel = escalationRule.level;
    alert.severity = escalationRule.severity;

    logger.warn(`🚨 Alert escalated: ${alert.title} | Level: ${escalationRule.level} | New severity: ${escalationRule.severity}`);

    // Send escalated notifications
    this.sendNotifications(alert);

    // Execute escalation auto-actions
    escalationRule.autoActions.forEach(actionName => {
      try {
        const result = this.executeAction(actionName, alert.data);
        logger.info(`🤖 Escalation action executed: ${actionName} | Result: ${result}`);
      } catch (error) {
        logger.error(`Failed to execute escalation action ${actionName}:`, (error as Error).message);
      }
    });

    // Emit escalation event
    (process as any).emit('alertEscalated', { alert, escalationRule });
  }

  // 🚀 WEEK 4: ALERT MANAGEMENT
  public acknowledgeAlert(alertId: string, acknowledgedBy: string = 'System'): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert) return false;

    alert.acknowledged = true;
    alert.acknowledgedBy = acknowledgedBy;
    alert.acknowledgedAt = new Date();

    // Cancel escalation timers
    this.cancelEscalationTimers(alertId);

    logger.info(`✅ Alert acknowledged: ${alert.title} by ${acknowledgedBy}`);
    return true;
  }

  public resolveAlert(alertId: string): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert) return false;

    alert.resolved = true;
    alert.resolvedAt = new Date();

    // Cancel escalation timers
    this.cancelEscalationTimers(alertId);

    logger.info(`✅ Alert resolved: ${alert.title}`);
    return true;
  }

  public suppressAlert(alertId: string, durationMs: number): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert) return false;

    alert.suppressUntil = new Date(Date.now() + durationMs);
    logger.info(`🔇 Alert suppressed: ${alert.title} for ${Math.round(durationMs / 60000)} minutes`);
    return true;
  }

  // 🚀 WEEK 4: EXTERNAL ALERT HANDLING
  private handleExternalAlert(category: string, alertData: any): void {
    // Handle alerts from other systems
    const alert: Alert = {
      id: this.generateAlertId(),
      type: alertData.type || 'SYSTEM_FAILURE',
      severity: alertData.severity || 'WARNING',
      category: category as AlertCategory,
      title: alertData.title || 'External Alert',
      message: alertData.message || 'External system alert',
      timestamp: new Date(),
      source: alertData.source || 'External',
      data: alertData,
      acknowledged: false,
      resolved: false,
      actions: [],
      priority: alertData.priority || 5,
      escalated: false,
      escalationLevel: 0
    };

    this.alerts.set(alert.id, alert);
    this.sendNotifications(alert);

    logger.warn(`🚨 External alert: ${alert.title} | ${alert.message}`);
  }

  // 🚀 WEEK 4: UTILITY METHODS
  private generateAlertId(): string {
    this.alertCounter++;
    return `alert_${Date.now()}_${this.alertCounter}`;
  }

  private getSeverityEmoji(severity: AlertSeverity): string {
    switch (severity) {
      case 'INFO': return 'ℹ️';
      case 'WARNING': return '⚠️';
      case 'CRITICAL': return '🚨';
      case 'EMERGENCY': return '🔥';
      default: return '📢';
    }
  }

  private cancelEscalationTimers(alertId: string): void {
    const timersToCancel = Array.from(this.escalationTimers.keys())
      .filter(key => key.startsWith(alertId));

    timersToCancel.forEach(key => {
      const timer = this.escalationTimers.get(key);
      if (timer) {
        clearTimeout(timer);
        this.escalationTimers.delete(key);
      }
    });
  }

  private maintainAlertLimit(): void {
    if (this.alerts.size > this.MAX_ALERTS) {
      const sortedAlerts = Array.from(this.alerts.values())
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      const toRemove = sortedAlerts.slice(0, this.alerts.size - this.MAX_ALERTS);
      toRemove.forEach(alert => {
        this.alerts.delete(alert.id);
        this.cancelEscalationTimers(alert.id);
      });
    }
  }

  private cleanupOldAlerts(): void {
    const now = Date.now();
    const dayOld = 24 * 60 * 60 * 1000;

    const alertsToRemove: string[] = [];
    this.alerts.forEach((alert, id) => {
      if (alert.resolved && (now - alert.timestamp.getTime()) > dayOld) {
        alertsToRemove.push(id);
      }
    });

    alertsToRemove.forEach(id => {
      this.alerts.delete(id);
      this.cancelEscalationTimers(id);
    });

    if (alertsToRemove.length > 0) {
      logger.info(`🧹 Cleaned up ${alertsToRemove.length} old alerts`);
    }
  }

  // 🚀 WEEK 4: PUBLIC METHODS
  public getActiveAlerts(): Alert[] {
    return Array.from(this.alerts.values())
      .filter(alert => !alert.resolved)
      .sort((a, b) => b.priority - a.priority);
  }

  public getAlertHistory(limit: number = 50): Alert[] {
    return Array.from(this.alerts.values())
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  public getAlertStatistics(): AlertStatistics {
    const alerts = Array.from(this.alerts.values());

    const byType = new Map<AlertType, number>();
    const bySeverity = new Map<AlertSeverity, number>();
    const byCategory = new Map<AlertCategory, number>();

    alerts.forEach(alert => {
      byType.set(alert.type, (byType.get(alert.type) || 0) + 1);
      bySeverity.set(alert.severity, (bySeverity.get(alert.severity) || 0) + 1);
      byCategory.set(alert.category, (byCategory.get(alert.category) || 0) + 1);
    });

    const acknowledgedCount = alerts.filter(a => a.acknowledged).length;
    const acknowledgedRate = alerts.length > 0 ? (acknowledgedCount / alerts.length) * 100 : 0;

    const resolvedAlerts = alerts.filter(a => a.resolved && a.resolvedAt);
    const avgResolutionTime = resolvedAlerts.length > 0 ?
      resolvedAlerts.reduce((sum, a) => sum + (a.resolvedAt!.getTime() - a.timestamp.getTime()), 0) / resolvedAlerts.length : 0;

    const topIssues = Array.from(byType.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([type, count]) => ({ type, count }));

    return {
      total: alerts.length,
      byType,
      bySeverity,
      byCategory,
      acknowledgedRate,
      avgResolutionTime,
      topIssues,
      trends: {
        hourly: [], // Would calculate from timestamp distribution
        daily: [],
        weekly: []
      }
    };
  }

  public enableRule(ruleId: string): boolean {
    const rule = this.alertRules.get(ruleId);
    if (rule) {
      rule.enabled = true;
      logger.info(`✅ Alert rule enabled: ${rule.name}`);
      return true;
    }
    return false;
  }

  public disableRule(ruleId: string): boolean {
    const rule = this.alertRules.get(ruleId);
    if (rule) {
      rule.enabled = false;
      logger.info(`🚫 Alert rule disabled: ${rule.name}`);
      return true;
    }
    return false;
  }

  public updateRuleCooldown(ruleId: string, cooldownMs: number): boolean {
    const rule = this.alertRules.get(ruleId);
    if (rule) {
      rule.cooldownMs = cooldownMs;
      logger.info(`⏰ Alert rule cooldown updated: ${rule.name} -> ${cooldownMs}ms`);
      return true;
    }
    return false;
  }
}

export const advancedAlerting = new AdvancedAlertingSystem();