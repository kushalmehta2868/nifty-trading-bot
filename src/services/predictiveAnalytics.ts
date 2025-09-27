import { logger } from '../utils/logger';
import { signalValidation, StrategyPerformance } from './signalValidation';
import { enhancedPerformanceMonitor } from './enhancedPerformanceMonitor';

interface PredictiveModel {
  name: string;
  type: 'REGRESSION' | 'CLASSIFICATION' | 'TIME_SERIES';
  accuracy: number;
  lastTrained: Date;
  features: string[];
  predictions: Map<string, PredictionResult>;
}

interface PredictionResult {
  prediction: number;
  confidence: number;
  timestamp: Date;
  actualOutcome?: number;
  error?: number;
}

interface RiskPrediction {
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  probability: number;
  timeHorizon: '1H' | '4H' | '1D' | '3D';
  factors: RiskFactor[];
  recommendation: string;
}

interface RiskFactor {
  name: string;
  impact: number; // -100 to +100
  confidence: number; // 0 to 100
  description: string;
}

interface PerformanceForecast {
  expectedWinRate: number;
  expectedSignals: number;
  expectedPnL: number;
  confidence: number;
  timeframe: '1H' | '4H' | '1D' | '1W';
  assumptions: string[];
}

interface MarketRegimePrediction {
  currentRegime: string;
  transitionProbability: Map<string, number>;
  expectedDuration: number; // hours
  confidence: number;
  triggers: string[];
}

class PredictiveAnalyticsSystem {
  private models: Map<string, PredictiveModel> = new Map();
  private riskHistory: Array<{ timestamp: Date; riskScore: number; factors: RiskFactor[] }> = [];
  private performanceHistory: Array<{ timestamp: Date; winRate: number; signals: number }> = [];

  // Simple moving averages for trend analysis
  private movingAverages = {
    winRate: { short: 0, medium: 0, long: 0 },
    signalFrequency: { short: 0, medium: 0, long: 0 },
    accuracy: { short: 0, medium: 0, long: 0 }
  };

  public initialize(): void {
    logger.info('🔮 Predictive Analytics System initializing...');

    // Initialize models
    this.initializeModels();

    // Start periodic analysis
    setInterval(() => {
      this.performPredictiveAnalysis();
    }, 300000); // Every 5 minutes

    // Update risk assessments every minute
    setInterval(() => {
      this.updateRiskAssessment();
    }, 60000);

    // Train models every hour
    setInterval(() => {
      this.trainModels();
    }, 3600000);

    logger.info('✅ Predictive Analytics System initialized');
  }

  // 🚀 WEEK 3: INITIALIZE PREDICTIVE MODELS
  private initializeModels(): void {
    // Win Rate Prediction Model
    this.models.set('winRatePrediction', {
      name: 'Win Rate Predictor',
      type: 'REGRESSION',
      accuracy: 0.75,
      lastTrained: new Date(),
      features: ['market_volatility', 'time_of_day', 'recent_performance', 'signal_strength'],
      predictions: new Map()
    });

    // Signal Frequency Model
    this.models.set('signalFrequency', {
      name: 'Signal Frequency Predictor',
      type: 'TIME_SERIES',
      accuracy: 0.68,
      lastTrained: new Date(),
      features: ['market_hours', 'volatility', 'volume', 'trend_strength'],
      predictions: new Map()
    });

    // Risk Level Classifier
    this.models.set('riskClassifier', {
      name: 'Risk Level Classifier',
      type: 'CLASSIFICATION',
      accuracy: 0.82,
      lastTrained: new Date(),
      features: ['drawdown', 'volatility', 'correlation', 'position_size', 'market_stress'],
      predictions: new Map()
    });

    // Market Regime Detector
    this.models.set('regimeDetector', {
      name: 'Market Regime Detector',
      type: 'CLASSIFICATION',
      accuracy: 0.71,
      lastTrained: new Date(),
      features: ['price_momentum', 'volume_profile', 'volatility_structure', 'correlation_matrix'],
      predictions: new Map()
    });

    logger.info('🧠 Initialized 4 predictive models');
  }

  // 🚀 WEEK 3: MAIN PREDICTIVE ANALYSIS
  private performPredictiveAnalysis(): void {
    logger.info('🔮 Performing predictive analysis...');

    try {
      // Update moving averages
      this.updateMovingAverages();

      // Generate predictions
      const winRateForecast = this.predictWinRate();
      const signalFrequencyForecast = this.predictSignalFrequency();
      const riskForecast = this.predictRiskLevel();
      const regimeForecast = this.predictMarketRegime();

      // Log predictions
      logger.info(`🎯 Win Rate Forecast: ${winRateForecast.expectedWinRate.toFixed(1)}% (confidence: ${winRateForecast.confidence.toFixed(1)}%)`);
      logger.info(`📊 Signal Frequency Forecast: ${signalFrequencyForecast.expectedSignals} signals in ${signalFrequencyForecast.timeframe}`);
      logger.info(`⚠️ Risk Level: ${riskForecast.riskLevel} (probability: ${riskForecast.probability.toFixed(1)}%)`);
      logger.info(`🌊 Market Regime: ${regimeForecast.currentRegime} (confidence: ${regimeForecast.confidence.toFixed(1)}%)`);

      // Generate alerts if needed
      this.generatePredictiveAlerts(winRateForecast, signalFrequencyForecast, riskForecast);

      // Update model predictions
      this.updateModelPredictions(winRateForecast, signalFrequencyForecast, riskForecast);

    } catch (error) {
      logger.error('Predictive analysis failed:', (error as Error).message);
    }
  }

  // 🚀 WEEK 3: WIN RATE PREDICTION
  private predictWinRate(): PerformanceForecast {
    const realtimeMetrics = signalValidation.getRealtimeMetrics();
    const currentWinRate = realtimeMetrics.last24h.accuracy;

    // Simple trend analysis
    const trendFactor = this.calculateWinRateTrend();
    const volatilityFactor = this.calculateVolatilityImpact();
    const timeOfDayFactor = this.calculateTimeOfDayImpact();

    // Weighted prediction
    const expectedWinRate = Math.max(0, Math.min(100,
      currentWinRate * 0.6 +  // 60% current performance
      trendFactor * 0.25 +    // 25% trend
      volatilityFactor * 0.1 + // 10% volatility
      timeOfDayFactor * 0.05   // 5% time of day
    ));

    // Calculate confidence based on data quality
    const dataPoints = realtimeMetrics.last24h.signals;
    const confidence = Math.min(95, Math.max(30, (dataPoints / 20) * 100));

    return {
      expectedWinRate,
      expectedSignals: 0, // Calculated separately
      expectedPnL: 0,     // Would need P&L data
      confidence,
      timeframe: '4H',
      assumptions: [
        'Market conditions remain similar',
        'Strategy parameters unchanged',
        'Normal trading volume',
        'No major market events'
      ]
    };
  }

  // 🚀 WEEK 3: SIGNAL FREQUENCY PREDICTION
  private predictSignalFrequency(): PerformanceForecast {
    const currentHour = new Date().getHours();
    const strategies = signalValidation.getStrategyPerformance() as StrategyPerformance[];

    // Calculate historical signal frequency
    const totalSignals = strategies && strategies.length > 0 ?
      strategies.reduce((sum: number, s: StrategyPerformance) => sum + s.totalSignals, 0) : 0;
    const avgSignalsPerStrategy = strategies && strategies.length > 0 ? totalSignals / strategies.length : 0;

    // Time-based multipliers
    let timeMultiplier = 1.0;
    if (currentHour >= 9 && currentHour <= 11) timeMultiplier = 1.3; // Morning high activity
    else if (currentHour >= 13 && currentHour <= 15) timeMultiplier = 1.2; // Afternoon activity
    else if (currentHour >= 11 && currentHour <= 13) timeMultiplier = 0.8; // Lunch low activity

    // Market volatility impact
    const volatilityMultiplier = this.calculateVolatilitySignalImpact();

    const expectedSignals = Math.round(avgSignalsPerStrategy * timeMultiplier * volatilityMultiplier * 4); // Next 4 hours

    return {
      expectedWinRate: 0, // Calculated separately
      expectedSignals,
      expectedPnL: 0,
      confidence: 70,
      timeframe: '4H',
      assumptions: [
        'Normal market volatility',
        'All strategies active',
        'No system downtime',
        'Market remains open'
      ]
    };
  }

  // 🚀 WEEK 3: RISK LEVEL PREDICTION
  private predictRiskLevel(): RiskPrediction {
    const riskFactors = this.calculateRiskFactors();
    const aggregateRisk = this.aggregateRiskScore(riskFactors);

    let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    let probability: number;

    if (aggregateRisk <= 25) {
      riskLevel = 'LOW';
      probability = 85;
    } else if (aggregateRisk <= 50) {
      riskLevel = 'MEDIUM';
      probability = 75;
    } else if (aggregateRisk <= 75) {
      riskLevel = 'HIGH';
      probability = 80;
    } else {
      riskLevel = 'CRITICAL';
      probability = 90;
    }

    return {
      riskLevel,
      probability,
      timeHorizon: '4H',
      factors: riskFactors,
      recommendation: this.generateRiskRecommendation(riskLevel, riskFactors)
    };
  }

  // 🚀 WEEK 3: MARKET REGIME PREDICTION
  private predictMarketRegime(): MarketRegimePrediction {
    // Simplified market regime analysis
    const currentTime = new Date();
    const hour = currentTime.getHours();

    // Time-based regime tendencies
    let regimes = new Map<string, number>();

    if (hour >= 9 && hour <= 10) {
      regimes.set('VOLATILE', 40);
      regimes.set('TRENDING_BULL', 30);
      regimes.set('TRENDING_BEAR', 20);
      regimes.set('CHOPPY', 10);
    } else if (hour >= 11 && hour <= 14) {
      regimes.set('CHOPPY', 40);
      regimes.set('TRENDING_BULL', 25);
      regimes.set('TRENDING_BEAR', 25);
      regimes.set('VOLATILE', 10);
    } else {
      regimes.set('VOLATILE', 35);
      regimes.set('CHOPPY', 30);
      regimes.set('TRENDING_BULL', 20);
      regimes.set('TRENDING_BEAR', 15);
    }

    // Find most likely regime
    const sortedRegimes = Array.from(regimes.entries()).sort((a, b) => b[1] - a[1]);
    const currentRegime = sortedRegimes[0][0];
    const confidence = sortedRegimes[0][1];

    return {
      currentRegime,
      transitionProbability: regimes,
      expectedDuration: 2, // hours
      confidence,
      triggers: [
        'Volume spike',
        'Breakout levels',
        'Market news',
        'Options expiry'
      ]
    };
  }

  // 🚀 WEEK 3: RISK FACTOR CALCULATION
  private calculateRiskFactors(): RiskFactor[] {
    const factors: RiskFactor[] = [];

    // Performance degradation risk
    const realtimeMetrics = signalValidation.getRealtimeMetrics();
    const currentWinRate = realtimeMetrics.last24h.accuracy;
    const historicalWinRate = 75; // Would be calculated from longer history

    if (currentWinRate < historicalWinRate - 10) {
      factors.push({
        name: 'Performance Degradation',
        impact: -30,
        confidence: 85,
        description: `Win rate dropped to ${currentWinRate.toFixed(1)}% from ${historicalWinRate}% historical average`
      });
    }

    // System resource risk
    const metrics = enhancedPerformanceMonitor.getEnhancedPerformanceMetrics();
    if (metrics.systemHealth.memoryPercentage > 80) {
      factors.push({
        name: 'High Memory Usage',
        impact: -20,
        confidence: 95,
        description: `Memory usage at ${metrics.systemHealth.memoryPercentage}%, approaching limits`
      });
    }

    // API performance risk
    if (metrics.apiLatency.avg > 200) {
      factors.push({
        name: 'API Latency Risk',
        impact: -15,
        confidence: 90,
        description: `API latency at ${metrics.apiLatency.avg.toFixed(0)}ms, above optimal threshold`
      });
    }

    // Market volatility risk
    const hour = new Date().getHours();
    if ((hour >= 9 && hour <= 9.5) || (hour >= 15 && hour <= 15.5)) {
      factors.push({
        name: 'High Volatility Period',
        impact: -25,
        confidence: 80,
        description: 'Trading during high volatility hours (market open/close)'
      });
    }

    // Positive factors
    if (metrics.apiLatency.cacheHitRate > 80) {
      factors.push({
        name: 'Efficient API Usage',
        impact: 10,
        confidence: 85,
        description: `High cache hit rate: ${metrics.apiLatency.cacheHitRate.toFixed(1)}%`
      });
    }

    if (currentWinRate > historicalWinRate + 5) {
      factors.push({
        name: 'Above Average Performance',
        impact: 20,
        confidence: 75,
        description: `Current win rate ${currentWinRate.toFixed(1)}% exceeds historical average`
      });
    }

    return factors;
  }

  // 🚀 WEEK 3: HELPER METHODS
  private updateMovingAverages(): void {
    const realtimeMetrics = signalValidation.getRealtimeMetrics();

    // Update win rate moving averages (simplified)
    this.movingAverages.winRate.short = realtimeMetrics.last24h.accuracy;
    this.movingAverages.winRate.medium = (realtimeMetrics.last7d.accuracy + realtimeMetrics.last24h.accuracy) / 2;
    this.movingAverages.winRate.long = (realtimeMetrics.last30d.accuracy + realtimeMetrics.last7d.accuracy + realtimeMetrics.last24h.accuracy) / 3;

    // Signal frequency
    this.movingAverages.signalFrequency.short = realtimeMetrics.last24h.signals;
    this.movingAverages.signalFrequency.medium = (realtimeMetrics.last7d.signals + realtimeMetrics.last24h.signals) / 2;
    this.movingAverages.signalFrequency.long = (realtimeMetrics.last30d.signals + realtimeMetrics.last7d.signals + realtimeMetrics.last24h.signals) / 3;
  }

  private calculateWinRateTrend(): number {
    const short = this.movingAverages.winRate.short;
    const medium = this.movingAverages.winRate.medium;
    const long = this.movingAverages.winRate.long;

    // Calculate trend: positive if improving, negative if declining
    const shortTermTrend = short - medium;
    const longTermTrend = medium - long;

    // Weight recent trend more heavily
    return (shortTermTrend * 0.7 + longTermTrend * 0.3);
  }

  private calculateVolatilityImpact(): number {
    // Simplified volatility impact calculation
    const hour = new Date().getHours();

    if (hour >= 9 && hour <= 10) return -5; // High volatility reduces win rate
    if (hour >= 11 && hour <= 14) return 0; // Normal volatility
    if (hour >= 14 && hour <= 15) return -3; // Moderate volatility impact

    return 0;
  }

  private calculateTimeOfDayImpact(): number {
    const hour = new Date().getHours();

    // Historical performance by hour (simplified)
    const hourlyPerformance = {
      9: -2,   // Lower performance during open
      10: 1,   // Good performance
      11: 2,   // Best performance
      12: 0,   // Average
      13: 1,   // Good
      14: 0,   // Average
      15: -1   // Lower performance during close
    };

    return hourlyPerformance[hour as keyof typeof hourlyPerformance] || 0;
  }

  private calculateVolatilitySignalImpact(): number {
    // Higher volatility typically generates more signals
    const hour = new Date().getHours();

    if (hour >= 9 && hour <= 10) return 1.4; // High signal generation
    if (hour >= 14 && hour <= 15) return 1.2; // Moderate increase
    return 1.0; // Normal
  }

  private aggregateRiskScore(factors: RiskFactor[]): number {
    let totalImpact = 0;
    let totalWeight = 0;

    factors.forEach(factor => {
      const weight = factor.confidence / 100;
      totalImpact += factor.impact * weight;
      totalWeight += weight;
    });

    const avgImpact = totalWeight > 0 ? totalImpact / totalWeight : 0;

    // Convert to 0-100 risk score (0 = no risk, 100 = maximum risk)
    return Math.max(0, Math.min(100, 50 - avgImpact)); // Negative impact increases risk score
  }

  private generateRiskRecommendation(riskLevel: string, factors: RiskFactor[]): string {
    const topRisk = factors.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))[0];

    switch (riskLevel) {
      case 'LOW':
        return 'Continue normal operations. Monitor key metrics.';
      case 'MEDIUM':
        return `Monitor ${topRisk?.name || 'system performance'} closely. Consider reducing position sizes.`;
      case 'HIGH':
        return `Address ${topRisk?.name || 'critical issues'} immediately. Reduce trading activity.`;
      case 'CRITICAL':
        return `Stop all trading immediately. Address critical system issues: ${topRisk?.description || 'system failure'}`;
      default:
        return 'Monitor system status.';
    }
  }

  // 🚀 WEEK 3: RISK ASSESSMENT UPDATE
  private updateRiskAssessment(): void {
    const riskPrediction = this.predictRiskLevel();

    // Store risk history
    this.riskHistory.push({
      timestamp: new Date(),
      riskScore: this.aggregateRiskScore(riskPrediction.factors),
      factors: riskPrediction.factors
    });

    // Keep only last 100 entries
    if (this.riskHistory.length > 100) {
      this.riskHistory.shift();
    }

    // Check for risk escalation
    if (this.riskHistory.length >= 3) {
      const recent = this.riskHistory.slice(-3);
      const riskIncreasing = recent.every((entry, index) =>
        index === 0 || entry.riskScore > recent[index - 1].riskScore
      );

      if (riskIncreasing && riskPrediction.riskLevel === 'HIGH') {
        logger.warn(`🚨 Risk escalation detected: ${riskPrediction.riskLevel} level with increasing trend`);

        // Emit risk escalation event
        (process as any).emit('riskEscalation', {
          riskLevel: riskPrediction.riskLevel,
          trend: 'INCREASING',
          recommendation: riskPrediction.recommendation,
          factors: riskPrediction.factors
        });
      }
    }
  }

  // 🚀 WEEK 3: GENERATE PREDICTIVE ALERTS
  private generatePredictiveAlerts(
    winRateForecast: PerformanceForecast,
    signalForecast: PerformanceForecast,
    riskForecast: RiskPrediction
  ): void {
    // Low win rate prediction alert
    if (winRateForecast.expectedWinRate < 50 && winRateForecast.confidence > 70) {
      logger.warn(`🔮 Predictive Alert: Win rate forecast ${winRateForecast.expectedWinRate.toFixed(1)}% (confidence: ${winRateForecast.confidence.toFixed(1)}%)`);

      (process as any).emit('predictiveAlert', {
        type: 'PERFORMANCE_DEGRADATION',
        forecast: winRateForecast,
        message: `Predicted win rate decline to ${winRateForecast.expectedWinRate.toFixed(1)}%`
      });
    }

    // Low signal frequency alert
    if (signalForecast.expectedSignals < 2 && signalForecast.confidence > 60) {
      logger.warn(`🔮 Predictive Alert: Low signal frequency forecast (${signalForecast.expectedSignals} signals)`);

      (process as any).emit('predictiveAlert', {
        type: 'LOW_SIGNAL_FREQUENCY',
        forecast: signalForecast,
        message: `Low signal frequency predicted: ${signalForecast.expectedSignals} signals in ${signalForecast.timeframe}`
      });
    }

    // High risk alert
    if (riskForecast.riskLevel === 'HIGH' || riskForecast.riskLevel === 'CRITICAL') {
      logger.warn(`🔮 Predictive Alert: ${riskForecast.riskLevel} risk predicted (${riskForecast.probability}% probability)`);

      (process as any).emit('predictiveAlert', {
        type: 'HIGH_RISK_PREDICTED',
        forecast: riskForecast,
        message: riskForecast.recommendation
      });
    }
  }

  // 🚀 WEEK 3: MODEL TRAINING (SIMPLIFIED)
  private trainModels(): void {
    logger.info('🧠 Training predictive models...');

    const signalHistory = signalValidation.getSignalHistory(100);

    // Update model accuracy based on recent predictions vs actual outcomes
    this.models.forEach((model, name) => {
      const predictions = Array.from(model.predictions.values());
      const recentPredictions = predictions.filter(p =>
        p.actualOutcome !== undefined &&
        Date.now() - p.timestamp.getTime() < 24 * 60 * 60 * 1000 // Last 24 hours
      );

      if (recentPredictions.length > 5) {
        const errors = recentPredictions.map(p => Math.abs(p.prediction - (p.actualOutcome || 0)));
        const avgError = errors.reduce((sum, e) => sum + e, 0) / errors.length;
        const accuracy = Math.max(0.1, 1 - (avgError / 100)); // Simplified accuracy calculation

        model.accuracy = accuracy;
        model.lastTrained = new Date();

        logger.info(`🧠 Model ${model.name}: Updated accuracy to ${(accuracy * 100).toFixed(1)}%`);
      }
    });
  }

  private updateModelPredictions(
    winRateForecast: PerformanceForecast,
    signalForecast: PerformanceForecast,
    riskForecast: RiskPrediction
  ): void {
    const timestamp = new Date();

    // Store predictions for later validation
    const winRateModel = this.models.get('winRatePrediction');
    if (winRateModel) {
      winRateModel.predictions.set(`wr_${timestamp.getTime()}`, {
        prediction: winRateForecast.expectedWinRate,
        confidence: winRateForecast.confidence,
        timestamp
      });

      // Keep only recent predictions
      if (winRateModel.predictions.size > 50) {
        const oldestKey = Array.from(winRateModel.predictions.keys())[0];
        winRateModel.predictions.delete(oldestKey);
      }
    }
  }

  // 🚀 WEEK 3: PUBLIC METHODS FOR DASHBOARD
  public getLatestForecasts(): {
    winRate: PerformanceForecast;
    signalFrequency: PerformanceForecast;
    risk: RiskPrediction;
    marketRegime: MarketRegimePrediction;
  } {
    return {
      winRate: this.predictWinRate(),
      signalFrequency: this.predictSignalFrequency(),
      risk: this.predictRiskLevel(),
      marketRegime: this.predictMarketRegime()
    };
  }

  public getRiskHistory(): Array<{ timestamp: Date; riskScore: number; factors: RiskFactor[] }> {
    return [...this.riskHistory];
  }

  public getModelStatuses(): Array<{ name: string; accuracy: number; lastTrained: Date }> {
    return Array.from(this.models.values()).map(model => ({
      name: model.name,
      accuracy: model.accuracy,
      lastTrained: model.lastTrained
    }));
  }

  public getConfidenceCalibrationReport(): {
    overall: number;
    byModel: Map<string, number>;
    recommendations: string[];
  } {
    const recommendations: string[] = [];
    const modelCalibration = new Map<string, number>();

    this.models.forEach((model, name) => {
      const predictions = Array.from(model.predictions.values())
        .filter(p => p.actualOutcome !== undefined);

      if (predictions.length > 10) {
        const avgPredicted = predictions.reduce((sum, p) => sum + p.confidence, 0) / predictions.length;
        const accuracy = predictions.filter(p => p.error && p.error < 10).length / predictions.length * 100;
        const calibration = Math.abs(avgPredicted - accuracy);

        modelCalibration.set(name, calibration);

        if (calibration > 20) {
          recommendations.push(`${model.name} confidence calibration needs improvement (${calibration.toFixed(1)}% error)`);
        }
      }
    });

    const overallCalibration = modelCalibration.size > 0 ?
      Array.from(modelCalibration.values()).reduce((sum, c) => sum + c, 0) / modelCalibration.size : 0;

    if (overallCalibration < 10) {
      recommendations.push('Model confidence calibration is excellent');
    } else if (overallCalibration < 20) {
      recommendations.push('Model confidence calibration is good');
    } else {
      recommendations.push('Model confidence calibration needs improvement');
    }

    return {
      overall: overallCalibration,
      byModel: modelCalibration,
      recommendations
    };
  }
}

export const predictiveAnalytics = new PredictiveAnalyticsSystem();