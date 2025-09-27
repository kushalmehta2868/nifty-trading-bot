import express, { Express, Request, Response } from 'express';
import { Server } from 'http';
import { logger } from '../utils/logger';
import { enhancedPerformanceMonitor, EnhancedPerformanceMetrics } from './enhancedPerformanceMonitor';
import { signalValidation, StrategyPerformance } from './signalValidation';
import { enhancedAngelAPI } from './enhancedAngelAPI';

interface DashboardData {
  timestamp: string;
  systemOverview: SystemOverview;
  performanceMetrics: EnhancedPerformanceMetrics;
  tradingInsights: TradingInsights;
  riskAnalysis: RiskAnalysis;
  marketConditions: MarketConditions;
  alerts: AlertSummary;
}

interface SystemOverview {
  status: 'HEALTHY' | 'WARNING' | 'CRITICAL';
  uptime: string;
  version: string;
  environment: 'PRODUCTION' | 'STAGING' | 'DEVELOPMENT';
  lastRestart: string;
  healthScore: number;
}

interface TradingInsights {
  dailyPnL: number;
  totalSignals: number;
  winRate: number;
  bestPerformingStrategy: string;
  worstPerformingStrategy: string;
  avgHoldingTime: number;
  sharpeRatio: number;
  maxDrawdown: number;
  profitFactor: number;
}

interface RiskAnalysis {
  currentExposure: number;
  portfolioHeat: number;
  valueAtRisk: number;
  riskScore: number;
  correlationRisk: number;
  liquidityRisk: number;
  concentrationRisk: number;
}

interface MarketConditions {
  marketRegime: string;
  volatilityLevel: string;
  vixLevel: number;
  trendsDetected: string[];
  marketSentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  supportLevels: number[];
  resistanceLevels: number[];
}

interface AlertSummary {
  critical: number;
  warning: number;
  info: number;
  recentAlerts: Array<{
    severity: string;
    message: string;
    timestamp: string;
  }>;
}

class InstitutionalDashboard {
  private app: Express;
  private server: Server | null = null;
  private port = 3001;
  private isRunning = false;

  // Real-time data storage
  private dashboardData: DashboardData | null = null;
  private clients: Response[] = []; // For Server-Sent Events

  constructor() {
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  public start(): void {
    if (this.isRunning) {
      logger.warn('Dashboard already running');
      return;
    }

    try {
      this.server = this.app.listen(this.port, () => {
        logger.info(`📊 Institutional Dashboard started on http://localhost:${this.port}`);
        this.isRunning = true;
      });

      // Start real-time data updates
      this.startDataUpdates();

      logger.info('🎯 Institutional-grade monitoring dashboard initialized');
    } catch (error) {
      logger.error('Failed to start dashboard:', (error as Error).message);
      throw error;
    }
  }

  public stop(): void {
    if (this.server && this.isRunning) {
      this.server.close(() => {
        logger.info('📊 Institutional Dashboard stopped');
        this.isRunning = false;
      });
    }
  }

  private setupMiddleware(): void {
    // CORS for development
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
      next();
    });

    this.app.use(express.json());
    this.app.use(express.static('public'));
  }

  private setupRoutes(): void {
    // 🚀 WEEK 3: MAIN DASHBOARD ROUTES

    // Main dashboard page
    this.app.get('/', (req: Request, res: Response) => {
      res.send(this.generateDashboardHTML());
    });

    // Real-time data endpoint
    this.app.get('/api/dashboard-data', (req: Request, res: Response) => {
      res.json(this.dashboardData || this.generateEmptyDashboardData());
    });

    // Server-Sent Events for real-time updates
    this.app.get('/api/realtime', (req: Request, res: Response) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });

      this.clients.push(res);

      // Send initial data
      this.sendEventToClient(res, 'dashboard-update', this.dashboardData);

      // Handle client disconnect
      req.on('close', () => {
        this.clients = this.clients.filter(client => client !== res);
      });
    });

    // 🚀 WEEK 3: SPECIFIC API ENDPOINTS

    // Performance metrics
    this.app.get('/api/performance', (req: Request, res: Response) => {
      const metrics = enhancedPerformanceMonitor.getEnhancedPerformanceMetrics();
      res.json(metrics);
    });

    // Trading signals history
    this.app.get('/api/signals', (req: Request, res: Response) => {
      const limit = parseInt(req.query.limit as string) || 50;
      const signals = signalValidation.getSignalHistory(limit);
      res.json(signals);
    });

    // Strategy performance
    this.app.get('/api/strategies', (req: Request, res: Response) => {
      const strategies = signalValidation.getStrategyPerformance();
      res.json(strategies);
    });

    // Real-time accuracy metrics
    this.app.get('/api/accuracy', (req: Request, res: Response) => {
      const accuracy = signalValidation.getRealtimeMetrics();
      res.json(accuracy);
    });

    // Alerts endpoint
    this.app.get('/api/alerts', (req: Request, res: Response) => {
      const count = parseInt(req.query.count as string) || 20;
      const alerts = enhancedPerformanceMonitor.getRecentAlerts(count);
      res.json(alerts);
    });

    // Acknowledge alert
    this.app.post('/api/alerts/:id/acknowledge', (req: Request, res: Response) => {
      const alertId = req.params.id;
      const success = enhancedPerformanceMonitor.acknowledgeAlert(alertId);
      res.json({ success, alertId });
    });

    // Detailed performance report
    this.app.get('/api/report', (req: Request, res: Response) => {
      const report = enhancedPerformanceMonitor.getDetailedReport();
      res.json({ report, timestamp: new Date().toISOString() });
    });

    // API health check
    this.app.get('/api/health', (req: Request, res: Response) => {
      const apiMetrics = enhancedAngelAPI.getEnhancedMetrics();
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        api: apiMetrics
      });
    });

    // 🚀 WEEK 3: ADVANCED ANALYTICS ENDPOINTS

    // Confidence calibration analysis
    this.app.get('/api/confidence-calibration', (req: Request, res: Response) => {
      const calibration = signalValidation.getConfidenceCalibration();
      res.json(calibration);
    });

    // Performance attribution
    this.app.get('/api/attribution', (req: Request, res: Response) => {
      const attribution = this.calculatePerformanceAttribution();
      res.json(attribution);
    });

    // Risk analysis
    this.app.get('/api/risk', (req: Request, res: Response) => {
      const riskData = this.calculateRiskAnalysis();
      res.json(riskData);
    });

    // Market conditions
    this.app.get('/api/market-conditions', (req: Request, res: Response) => {
      const conditions = this.analyzeMarketConditions();
      res.json(conditions);
    });
  }

  // 🚀 WEEK 3: REAL-TIME DATA UPDATES
  private startDataUpdates(): void {
    // Update dashboard data every 10 seconds
    setInterval(() => {
      this.updateDashboardData();
    }, 10000);

    // Initial data load
    this.updateDashboardData();
  }

  private updateDashboardData(): void {
    try {
      const metrics = enhancedPerformanceMonitor.getEnhancedPerformanceMetrics();
      const alerts = enhancedPerformanceMonitor.getRecentAlerts(10);
      const strategies = signalValidation.getStrategyPerformance() as StrategyPerformance[];

      this.dashboardData = {
        timestamp: new Date().toISOString(),
        systemOverview: this.generateSystemOverview(metrics),
        performanceMetrics: metrics,
        tradingInsights: this.generateTradingInsights(strategies || []),
        riskAnalysis: this.calculateRiskAnalysis(),
        marketConditions: this.analyzeMarketConditions(),
        alerts: this.generateAlertSummary(alerts)
      };

      // Send update to all connected clients
      this.broadcastUpdate('dashboard-update', this.dashboardData);

    } catch (error) {
      logger.error('Failed to update dashboard data:', (error as Error).message);
    }
  }

  private generateSystemOverview(metrics: EnhancedPerformanceMetrics): SystemOverview {
    // Calculate overall health score
    let healthScore = 100;

    // Deduct points for various issues
    if (metrics.systemHealth.errorRate > 1) healthScore -= 20;
    if (metrics.systemHealth.memoryPercentage > 80) healthScore -= 15;
    if (metrics.apiLatency.avg > 100) healthScore -= 15;
    if (metrics.accuracyMetrics.last24h.winRate < 60) healthScore -= 25;

    let status: 'HEALTHY' | 'WARNING' | 'CRITICAL' = 'HEALTHY';
    if (healthScore < 50) status = 'CRITICAL';
    else if (healthScore < 75) status = 'WARNING';

    const uptimeSeconds = metrics.systemHealth.uptime;
    const uptime = `${Math.floor(uptimeSeconds / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m`;

    return {
      status,
      uptime,
      version: '2.0.0-enhanced',
      environment: 'PRODUCTION',
      lastRestart: new Date(Date.now() - uptimeSeconds * 1000).toISOString(),
      healthScore: Math.max(0, healthScore)
    };
  }

  private generateTradingInsights(strategies: any[]): TradingInsights {
    if (strategies.length === 0) {
      return {
        dailyPnL: 0,
        totalSignals: 0,
        winRate: 0,
        bestPerformingStrategy: 'N/A',
        worstPerformingStrategy: 'N/A',
        avgHoldingTime: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        profitFactor: 0
      };
    }

    // Calculate aggregate metrics
    const totalSignals = strategies.reduce((sum, s) => sum + s.totalSignals, 0);
    const totalWins = strategies.reduce((sum, s) => sum + s.winningSignals, 0);
    const overallWinRate = totalSignals > 0 ? (totalWins / totalSignals) * 100 : 0;

    // Find best and worst strategies
    const sortedByWinRate = strategies.sort((a, b) => b.winRate - a.winRate);
    const bestStrategy = sortedByWinRate[0]?.strategyName || 'N/A';
    const worstStrategy = sortedByWinRate[sortedByWinRate.length - 1]?.strategyName || 'N/A';

    // Calculate aggregate Sharpe ratio
    const avgSharpe = strategies.length > 0 ?
      strategies.reduce((sum, s) => sum + s.sharpeRatio, 0) / strategies.length : 0;

    return {
      dailyPnL: 0, // Would need actual P&L tracking
      totalSignals,
      winRate: overallWinRate,
      bestPerformingStrategy: bestStrategy,
      worstPerformingStrategy: worstStrategy,
      avgHoldingTime: 45, // Mock data - would calculate from actual trades
      sharpeRatio: avgSharpe,
      maxDrawdown: 0, // Would need drawdown calculation
      profitFactor: strategies.length > 0 ? strategies[0].profitFactor : 0
    };
  }

  private calculateRiskAnalysis(): RiskAnalysis {
    // This would integrate with your risk management system
    return {
      currentExposure: 15000, // Mock data
      portfolioHeat: 25,
      valueAtRisk: 2500,
      riskScore: 35,
      correlationRisk: 15,
      liquidityRisk: 10,
      concentrationRisk: 20
    };
  }

  private analyzeMarketConditions(): MarketConditions {
    // This would integrate with your market analysis
    return {
      marketRegime: 'TRENDING_BULL',
      volatilityLevel: 'MEDIUM',
      vixLevel: 18.5,
      trendsDetected: ['Bullish momentum', 'Volume confirmation'],
      marketSentiment: 'BULLISH',
      supportLevels: [24800, 24750],
      resistanceLevels: [25000, 25100]
    };
  }

  private generateAlertSummary(alerts: any[]): AlertSummary {
    const critical = alerts.filter(a => a.severity === 'CRITICAL').length;
    const warning = alerts.filter(a => a.severity === 'WARNING').length;
    const info = alerts.filter(a => a.severity === 'INFO').length;

    const recentAlerts = alerts.slice(0, 5).map(alert => ({
      severity: alert.severity,
      message: alert.message,
      timestamp: alert.timestamp
    }));

    return {
      critical,
      warning,
      info,
      recentAlerts
    };
  }

  private calculatePerformanceAttribution(): any {
    // Performance attribution analysis
    const strategies = signalValidation.getStrategyPerformance() as StrategyPerformance[];

    return {
      strategiesContribution: (strategies || []).map((s: StrategyPerformance) => ({
        name: s.strategyName,
        contribution: s.winRate * (s.totalSignals / 100), // Simplified calculation
        winRate: s.winRate,
        signals: s.totalSignals
      })),
      timeBasedAttribution: {
        morning: 25,    // Mock data
        midday: 35,
        afternoon: 40
      },
      instrumentAttribution: {
        NIFTY: 55,      // Mock data
        BANKNIFTY: 45
      }
    };
  }

  // 🚀 WEEK 3: SERVER-SENT EVENTS FOR REAL-TIME UPDATES
  private broadcastUpdate(event: string, data: any): void {
    this.clients.forEach(client => {
      this.sendEventToClient(client, event, data);
    });
  }

  private sendEventToClient(client: Response, event: string, data: any): void {
    try {
      client.write(`event: ${event}\n`);
      client.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (error) {
      // Client disconnected
      this.clients = this.clients.filter(c => c !== client);
    }
  }

  private generateEmptyDashboardData(): DashboardData {
    return {
      timestamp: new Date().toISOString(),
      systemOverview: {
        status: 'HEALTHY',
        uptime: '0h 0m',
        version: '2.0.0-enhanced',
        environment: 'PRODUCTION',
        lastRestart: new Date().toISOString(),
        healthScore: 100
      },
      performanceMetrics: {} as EnhancedPerformanceMetrics,
      tradingInsights: {
        dailyPnL: 0,
        totalSignals: 0,
        winRate: 0,
        bestPerformingStrategy: 'N/A',
        worstPerformingStrategy: 'N/A',
        avgHoldingTime: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        profitFactor: 0
      },
      riskAnalysis: {
        currentExposure: 0,
        portfolioHeat: 0,
        valueAtRisk: 0,
        riskScore: 0,
        correlationRisk: 0,
        liquidityRisk: 0,
        concentrationRisk: 0
      },
      marketConditions: {
        marketRegime: 'UNKNOWN',
        volatilityLevel: 'MEDIUM',
        vixLevel: 20,
        trendsDetected: [],
        marketSentiment: 'NEUTRAL',
        supportLevels: [],
        resistanceLevels: []
      },
      alerts: {
        critical: 0,
        warning: 0,
        info: 0,
        recentAlerts: []
      }
    };
  }

  // 🚀 WEEK 3: GENERATE INSTITUTIONAL-GRADE HTML DASHBOARD
  private generateDashboardHTML(): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Institutional Trading Dashboard - Angel SmartAPI Bot</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
            color: #ffffff;
            min-height: 100vh;
        }

        .dashboard {
            max-width: 1600px;
            margin: 0 auto;
            padding: 20px;
        }

        .header {
            text-align: center;
            margin-bottom: 30px;
        }

        .header h1 {
            font-size: 2.5rem;
            margin-bottom: 10px;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
        }

        .header .subtitle {
            font-size: 1.2rem;
            opacity: 0.9;
        }

        .status-bar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: rgba(255,255,255,0.1);
            border-radius: 10px;
            padding: 15px 25px;
            margin-bottom: 30px;
            backdrop-filter: blur(10px);
        }

        .status-item {
            text-align: center;
        }

        .status-item .label {
            font-size: 0.9rem;
            opacity: 0.8;
            margin-bottom: 5px;
        }

        .status-item .value {
            font-size: 1.4rem;
            font-weight: bold;
        }

        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }

        .card {
            background: rgba(255,255,255,0.1);
            border-radius: 15px;
            padding: 25px;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255,255,255,0.2);
            transition: transform 0.3s ease;
        }

        .card:hover {
            transform: translateY(-5px);
        }

        .card h3 {
            font-size: 1.3rem;
            margin-bottom: 20px;
            color: #ffd700;
        }

        .metric-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
            padding: 10px 0;
            border-bottom: 1px solid rgba(255,255,255,0.1);
        }

        .metric-row:last-child {
            border-bottom: none;
            margin-bottom: 0;
        }

        .metric-label {
            opacity: 0.9;
        }

        .metric-value {
            font-weight: bold;
            font-size: 1.1rem;
        }

        .status-healthy { color: #00ff88; }
        .status-warning { color: #ffaa00; }
        .status-critical { color: #ff4444; }

        .alerts-panel {
            background: rgba(255,255,255,0.1);
            border-radius: 15px;
            padding: 25px;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255,255,255,0.2);
        }

        .alert-item {
            display: flex;
            align-items: center;
            padding: 10px 15px;
            margin-bottom: 10px;
            border-radius: 8px;
            background: rgba(255,255,255,0.05);
        }

        .alert-severity {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            margin-right: 15px;
        }

        .alert-critical { background: #ff4444; }
        .alert-warning { background: #ffaa00; }
        .alert-info { background: #00aaff; }

        .footer {
            text-align: center;
            margin-top: 40px;
            opacity: 0.7;
            font-size: 0.9rem;
        }

        .loading {
            text-align: center;
            padding: 40px;
            font-size: 1.2rem;
        }

        @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.7; }
            100% { opacity: 1; }
        }

        .pulse {
            animation: pulse 2s infinite;
        }
    </style>
</head>
<body>
    <div class="dashboard">
        <div class="header">
            <h1>🏛️ Institutional Trading Dashboard</h1>
            <div class="subtitle">Angel SmartAPI NIFTY/BANKNIFTY Options Bot - Real-time Monitoring</div>
        </div>

        <div class="status-bar">
            <div class="status-item">
                <div class="label">System Status</div>
                <div class="value status-healthy" id="system-status">HEALTHY</div>
            </div>
            <div class="status-item">
                <div class="label">Uptime</div>
                <div class="value" id="uptime">0h 0m</div>
            </div>
            <div class="status-item">
                <div class="label">Health Score</div>
                <div class="value" id="health-score">100%</div>
            </div>
            <div class="status-item">
                <div class="label">Win Rate (24h)</div>
                <div class="value" id="win-rate">0%</div>
            </div>
            <div class="status-item">
                <div class="label">API Latency</div>
                <div class="value" id="api-latency">0ms</div>
            </div>
        </div>

        <div class="grid">
            <div class="card">
                <h3>📊 Performance Metrics</h3>
                <div id="performance-metrics" class="loading pulse">Loading...</div>
            </div>

            <div class="card">
                <h3>🎯 Trading Insights</h3>
                <div id="trading-insights" class="loading pulse">Loading...</div>
            </div>

            <div class="card">
                <h3>⚡ API Performance</h3>
                <div id="api-performance" class="loading pulse">Loading...</div>
            </div>

            <div class="card">
                <h3>🛡️ Risk Analysis</h3>
                <div id="risk-analysis" class="loading pulse">Loading...</div>
            </div>
        </div>

        <div class="alerts-panel">
            <h3>🚨 System Alerts</h3>
            <div id="alerts-container" class="loading pulse">Loading alerts...</div>
        </div>

        <div class="footer">
            Last updated: <span id="last-update">Never</span> |
            Next update in: <span id="next-update">10s</span> |
            Enhanced Trading Bot v2.0.0
        </div>
    </div>

    <script>
        let countdownTimer = 10;
        let eventSource = null;

        // Initialize dashboard
        function initDashboard() {
            console.log('🚀 Initializing Institutional Dashboard...');

            // Setup Server-Sent Events for real-time updates
            eventSource = new EventSource('/api/realtime');

            eventSource.addEventListener('dashboard-update', function(event) {
                try {
                    const data = JSON.parse(event.data);
                    updateDashboard(data);
                } catch (error) {
                    console.error('Failed to parse dashboard data:', error);
                }
            });

            eventSource.onerror = function(event) {
                console.error('EventSource failed:', event);
                // Fallback to polling
                setTimeout(loadDashboardData, 5000);
            };

            // Load initial data
            loadDashboardData();

            // Start countdown timer
            startCountdown();
        }

        // Load dashboard data via REST API (fallback)
        async function loadDashboardData() {
            try {
                const response = await fetch('/api/dashboard-data');
                const data = await response.json();
                updateDashboard(data);
            } catch (error) {
                console.error('Failed to load dashboard data:', error);
            }
        }

        // Update dashboard with new data
        function updateDashboard(data) {
            if (!data) return;

            console.log('📊 Dashboard data updated:', new Date().toLocaleTimeString());

            // Update status bar
            updateStatusBar(data);

            // Update performance metrics
            updatePerformanceMetrics(data.performanceMetrics);

            // Update trading insights
            updateTradingInsights(data.tradingInsights);

            // Update API performance
            updateApiPerformance(data.performanceMetrics);

            // Update risk analysis
            updateRiskAnalysis(data.riskAnalysis);

            // Update alerts
            updateAlerts(data.alerts);

            // Update timestamp
            document.getElementById('last-update').textContent = new Date().toLocaleTimeString();

            // Reset countdown
            countdownTimer = 10;
        }

        function updateStatusBar(data) {
            const systemStatus = document.getElementById('system-status');
            const uptime = document.getElementById('uptime');
            const healthScore = document.getElementById('health-score');
            const winRate = document.getElementById('win-rate');
            const apiLatency = document.getElementById('api-latency');

            if (systemStatus) {
                systemStatus.textContent = data.systemOverview.status;
                systemStatus.className = 'value status-' + data.systemOverview.status.toLowerCase();
            }

            if (uptime) uptime.textContent = data.systemOverview.uptime;
            if (healthScore) healthScore.textContent = data.systemOverview.healthScore + '%';
            if (winRate) winRate.textContent = data.tradingInsights.winRate.toFixed(1) + '%';
            if (apiLatency) apiLatency.textContent = data.performanceMetrics.apiLatency?.avg?.toFixed(0) + 'ms';
        }

        function updatePerformanceMetrics(metrics) {
            if (!metrics) return;

            const container = document.getElementById('performance-metrics');
            container.innerHTML = \`
                <div class="metric-row">
                    <span class="metric-label">Signals Generated</span>
                    <span class="metric-value">\${metrics.tradingPerformance?.totalSignals || 0}</span>
                </div>
                <div class="metric-row">
                    <span class="metric-label">Execution Rate</span>
                    <span class="metric-value">\${(metrics.tradingPerformance?.executionRate || 0).toFixed(1)}%</span>
                </div>
                <div class="metric-row">
                    <span class="metric-label">Memory Usage</span>
                    <span class="metric-value">\${metrics.systemHealth?.memoryPercentage || 0}%</span>
                </div>
                <div class="metric-row">
                    <span class="metric-label">Error Rate</span>
                    <span class="metric-value">\${(metrics.systemHealth?.errorRate || 0).toFixed(2)}%</span>
                </div>
            \`;
        }

        function updateTradingInsights(insights) {
            if (!insights) return;

            const container = document.getElementById('trading-insights');
            container.innerHTML = \`
                <div class="metric-row">
                    <span class="metric-label">Total Signals</span>
                    <span class="metric-value">\${insights.totalSignals}</span>
                </div>
                <div class="metric-row">
                    <span class="metric-label">Win Rate</span>
                    <span class="metric-value">\${insights.winRate.toFixed(1)}%</span>
                </div>
                <div class="metric-row">
                    <span class="metric-label">Best Strategy</span>
                    <span class="metric-value">\${insights.bestPerformingStrategy}</span>
                </div>
                <div class="metric-row">
                    <span class="metric-label">Profit Factor</span>
                    <span class="metric-value">\${insights.profitFactor.toFixed(2)}</span>
                </div>
            \`;
        }

        function updateApiPerformance(metrics) {
            if (!metrics || !metrics.apiLatency) return;

            const container = document.getElementById('api-performance');
            container.innerHTML = \`
                <div class="metric-row">
                    <span class="metric-label">Avg Latency</span>
                    <span class="metric-value">\${metrics.apiLatency.avg.toFixed(0)}ms</span>
                </div>
                <div class="metric-row">
                    <span class="metric-label">P95 Latency</span>
                    <span class="metric-value">\${metrics.apiLatency.p95.toFixed(0)}ms</span>
                </div>
                <div class="metric-row">
                    <span class="metric-label">Cache Hit Rate</span>
                    <span class="metric-value">\${metrics.apiLatency.cacheHitRate.toFixed(1)}%</span>
                </div>
                <div class="metric-row">
                    <span class="metric-label">Total Requests</span>
                    <span class="metric-value">\${metrics.apiLatency.count}</span>
                </div>
            \`;
        }

        function updateRiskAnalysis(risk) {
            if (!risk) return;

            const container = document.getElementById('risk-analysis');
            container.innerHTML = \`
                <div class="metric-row">
                    <span class="metric-label">Portfolio Heat</span>
                    <span class="metric-value">\${risk.portfolioHeat}%</span>
                </div>
                <div class="metric-row">
                    <span class="metric-label">Risk Score</span>
                    <span class="metric-value">\${risk.riskScore}/100</span>
                </div>
                <div class="metric-row">
                    <span class="metric-label">Current Exposure</span>
                    <span class="metric-value">₹\${risk.currentExposure.toLocaleString()}</span>
                </div>
                <div class="metric-row">
                    <span class="metric-label">Value at Risk</span>
                    <span class="metric-value">₹\${risk.valueAtRisk.toLocaleString()}</span>
                </div>
            \`;
        }

        function updateAlerts(alertData) {
            if (!alertData) return;

            const container = document.getElementById('alerts-container');

            if (alertData.recentAlerts.length === 0) {
                container.innerHTML = '<div style="text-align: center; color: #00ff88; padding: 20px;">✅ No active alerts</div>';
                return;
            }

            let alertsHtml = \`
                <div style="display: flex; gap: 20px; margin-bottom: 20px;">
                    <span>Critical: <strong>\${alertData.critical}</strong></span>
                    <span>Warning: <strong>\${alertData.warning}</strong></span>
                    <span>Info: <strong>\${alertData.info}</strong></span>
                </div>
            \`;

            alertData.recentAlerts.forEach(alert => {
                alertsHtml += \`
                    <div class="alert-item">
                        <div class="alert-severity alert-\${alert.severity.toLowerCase()}"></div>
                        <div>
                            <div>\${alert.message}</div>
                            <div style="font-size: 0.9rem; opacity: 0.7; margin-top: 5px;">
                                \${new Date(alert.timestamp).toLocaleTimeString()}
                            </div>
                        </div>
                    </div>
                \`;
            });

            container.innerHTML = alertsHtml;
        }

        function startCountdown() {
            setInterval(() => {
                const nextUpdateElement = document.getElementById('next-update');
                if (nextUpdateElement) {
                    nextUpdateElement.textContent = countdownTimer + 's';
                }

                countdownTimer--;
                if (countdownTimer < 0) {
                    countdownTimer = 10; // Reset to 10 seconds
                }
            }, 1000);
        }

        // Initialize when page loads
        window.addEventListener('DOMContentLoaded', initDashboard);

        // Cleanup on page unload
        window.addEventListener('beforeunload', function() {
            if (eventSource) {
                eventSource.close();
            }
        });
    </script>
</body>
</html>
    `;
  }
}

export const institutionalDashboard = new InstitutionalDashboard();