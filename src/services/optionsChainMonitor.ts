import { optionsChainAnalyzer, OptionsChainAnalysis } from './optionsChainAnalyzer';
import { webSocketFeed } from './webSocketFeed';
import { logger } from '../utils/logger';
import { IndexName } from '../types';

interface OptionsChainSnapshot {
  indexName: IndexName;
  timestamp: Date;
  analysis: OptionsChainAnalysis;
  previousAnalysis?: OptionsChainAnalysis;
}

interface OptionsAlert {
  type: 'PCR_EXTREME' | 'MAX_PAIN_SHIFT' | 'HIGH_OI_BUILD' | 'VOLATILITY_SKEW';
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  indexName: IndexName;
  message: string;
  data: any;
  timestamp: Date;
}

export class OptionsChainMonitor {
  private monitoringInterval: NodeJS.Timeout | null = null;
  private snapshots = new Map<IndexName, OptionsChainSnapshot[]>();
  private lastAnalysis = new Map<IndexName, OptionsChainAnalysis>();
  private alertCallbacks: ((alert: OptionsAlert) => void)[] = [];
  private isMonitoring = false;
  private readonly MONITORING_INTERVAL_MS = 300000; // 5 minutes
  private readonly MAX_SNAPSHOTS_PER_INDEX = 20; // Keep 20 snapshots (100 minutes of data)

  // PCR thresholds for alerts
  private readonly PCR_THRESHOLDS = {
    CRITICAL_HIGH: 1.8,  // Very bearish sentiment
    CRITICAL_LOW: 0.6,   // Very bullish sentiment
    WARNING_HIGH: 1.5,
    WARNING_LOW: 0.8
  };

  public startMonitoring(): void {
    if (this.isMonitoring) {
      logger.warn('📊 Options chain monitoring already active');
      return;
    }

    logger.info('🔍 Starting real-time options chain monitoring...');

    this.monitoringInterval = setInterval(() => {
      this.performMonitoringCycle();
    }, this.MONITORING_INTERVAL_MS);

    this.isMonitoring = true;

    // Perform initial monitoring cycle
    this.performMonitoringCycle();

    logger.info(`✅ Options chain monitoring started - scanning every ${this.MONITORING_INTERVAL_MS / 1000}s`);
  }

  public stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    this.isMonitoring = false;
    logger.info('🔄 Options chain monitoring stopped');
  }

  public onAlert(callback: (alert: OptionsAlert) => void): void {
    this.alertCallbacks.push(callback);
  }

  private async performMonitoringCycle(): Promise<void> {
    try {
      const indices: IndexName[] = ['NIFTY', 'BANKNIFTY'];

      for (const indexName of indices) {
        await this.monitorIndex(indexName);
      }

      logger.debug('📊 Options monitoring cycle completed');
    } catch (error) {
      logger.error(`Options monitoring cycle failed: ${(error as Error).message}`);
    }
  }

  private async monitorIndex(indexName: IndexName): Promise<void> {
    try {
      const currentPrice = webSocketFeed.getCurrentPrice(indexName);
      if (!currentPrice) {
        logger.debug(`No current price available for ${indexName}`);
        return;
      }

      // Get current options chain analysis
      const expiry = this.generateExpiryString(indexName);
      const chainData = await optionsChainAnalyzer.getOptionsChain(indexName, currentPrice, expiry);

      if (chainData.length === 0) {
        logger.debug(`No options chain data available for ${indexName}`);
        return;
      }

      const currentAnalysis = optionsChainAnalyzer.analyzeOptionsChain(indexName, chainData, currentPrice);
      const previousAnalysis = this.lastAnalysis.get(indexName);

      // Create snapshot
      const snapshot: OptionsChainSnapshot = {
        indexName,
        timestamp: new Date(),
        analysis: currentAnalysis,
        previousAnalysis
      };

      // Store snapshot
      this.storeSnapshot(indexName, snapshot);

      // Update last analysis
      this.lastAnalysis.set(indexName, currentAnalysis);

      // Generate alerts based on analysis
      await this.generateAlerts(snapshot);

      logger.debug(`📊 ${indexName} Options: PCR=${currentAnalysis.pcr.toFixed(2)}, MaxPain=${currentAnalysis.maxPain}, Spot=${currentPrice.toFixed(0)}`);

    } catch (error) {
      logger.error(`Failed to monitor ${indexName} options: ${(error as Error).message}`);
    }
  }

  private storeSnapshot(indexName: IndexName, snapshot: OptionsChainSnapshot): void {
    if (!this.snapshots.has(indexName)) {
      this.snapshots.set(indexName, []);
    }

    const indexSnapshots = this.snapshots.get(indexName)!;
    indexSnapshots.push(snapshot);

    // Keep only the last N snapshots
    if (indexSnapshots.length > this.MAX_SNAPSHOTS_PER_INDEX) {
      indexSnapshots.shift();
    }
  }

  private async generateAlerts(snapshot: OptionsChainSnapshot): Promise<void> {
    const { analysis, previousAnalysis, indexName } = snapshot;

    // PCR extreme levels
    this.checkPCRAlerts(analysis, indexName);

    // Max Pain significant shift
    if (previousAnalysis) {
      this.checkMaxPainShift(analysis, previousAnalysis, indexName);
      this.checkOIChanges(analysis, previousAnalysis, indexName);
      this.checkVolatilitySkew(analysis, previousAnalysis, indexName);
    }
  }

  private checkPCRAlerts(analysis: OptionsChainAnalysis, indexName: IndexName): void {
    const pcr = analysis.pcr;

    if (pcr >= this.PCR_THRESHOLDS.CRITICAL_HIGH) {
      this.emitAlert({
        type: 'PCR_EXTREME',
        severity: 'CRITICAL',
        indexName,
        message: `Extremely high PCR: ${pcr.toFixed(2)} - Strong bearish sentiment, potential reversal`,
        data: { pcr, spotPrice: analysis.spotPrice, maxPain: analysis.maxPain },
        timestamp: new Date()
      });
    } else if (pcr <= this.PCR_THRESHOLDS.CRITICAL_LOW) {
      this.emitAlert({
        type: 'PCR_EXTREME',
        severity: 'CRITICAL',
        indexName,
        message: `Extremely low PCR: ${pcr.toFixed(2)} - Strong bullish sentiment, potential reversal`,
        data: { pcr, spotPrice: analysis.spotPrice, maxPain: analysis.maxPain },
        timestamp: new Date()
      });
    } else if (pcr >= this.PCR_THRESHOLDS.WARNING_HIGH) {
      this.emitAlert({
        type: 'PCR_EXTREME',
        severity: 'WARNING',
        indexName,
        message: `High PCR: ${pcr.toFixed(2)} - Bearish sentiment building`,
        data: { pcr, spotPrice: analysis.spotPrice },
        timestamp: new Date()
      });
    } else if (pcr <= this.PCR_THRESHOLDS.WARNING_LOW) {
      this.emitAlert({
        type: 'PCR_EXTREME',
        severity: 'WARNING',
        indexName,
        message: `Low PCR: ${pcr.toFixed(2)} - Bullish sentiment building`,
        data: { pcr, spotPrice: analysis.spotPrice },
        timestamp: new Date()
      });
    }
  }

  private checkMaxPainShift(analysis: OptionsChainAnalysis, previousAnalysis: OptionsChainAnalysis, indexName: IndexName): void {
    const currentMaxPain = analysis.maxPain;
    const previousMaxPain = previousAnalysis.maxPain;

    if (currentMaxPain !== previousMaxPain) {
      const shift = currentMaxPain - previousMaxPain;
      const shiftPercent = (shift / analysis.spotPrice) * 100;

      if (Math.abs(shiftPercent) > 0.5) { // 0.5% shift is significant
        this.emitAlert({
          type: 'MAX_PAIN_SHIFT',
          severity: Math.abs(shiftPercent) > 1.0 ? 'WARNING' : 'INFO',
          indexName,
          message: `Max Pain shifted from ${previousMaxPain} to ${currentMaxPain} (${shift > 0 ? '+' : ''}${shift}, ${shiftPercent.toFixed(1)}%)`,
          data: {
            currentMaxPain,
            previousMaxPain,
            shift,
            shiftPercent,
            spotPrice: analysis.spotPrice
          },
          timestamp: new Date()
        });
      }
    }
  }

  private checkOIChanges(analysis: OptionsChainAnalysis, previousAnalysis: OptionsChainAnalysis, indexName: IndexName): void {
    const currentTotalOI = analysis.totalCEOI + analysis.totalPEOI;
    const previousTotalOI = previousAnalysis.totalCEOI + previousAnalysis.totalPEOI;

    const oiChangePercent = ((currentTotalOI - previousTotalOI) / previousTotalOI) * 100;

    if (Math.abs(oiChangePercent) > 10) { // 10% OI change is significant
      this.emitAlert({
        type: 'HIGH_OI_BUILD',
        severity: Math.abs(oiChangePercent) > 20 ? 'WARNING' : 'INFO',
        indexName,
        message: `Significant OI change: ${oiChangePercent > 0 ? '+' : ''}${oiChangePercent.toFixed(1)}%`,
        data: {
          currentTotalOI,
          previousTotalOI,
          oiChangePercent,
          ceOI: analysis.totalCEOI,
          peOI: analysis.totalPEOI
        },
        timestamp: new Date()
      });
    }
  }

  private checkVolatilitySkew(analysis: OptionsChainAnalysis, previousAnalysis: OptionsChainAnalysis, indexName: IndexName): void {
    const currentSkew = analysis.volatilitySkew.skewRatio;
    const previousSkew = previousAnalysis.volatilitySkew.skewRatio;

    const skewChange = currentSkew - previousSkew;

    if (Math.abs(skewChange) > 0.2) { // 0.2 skew change is significant
      let message = '';
      if (currentSkew > 1.3) {
        message = `High put skew detected: ${currentSkew.toFixed(2)} - Fear in the market`;
      } else if (currentSkew < 0.7) {
        message = `Low put skew detected: ${currentSkew.toFixed(2)} - Complacency in the market`;
      } else {
        message = `Volatility skew changed: ${currentSkew.toFixed(2)} (${skewChange > 0 ? '+' : ''}${skewChange.toFixed(2)})`;
      }

      this.emitAlert({
        type: 'VOLATILITY_SKEW',
        severity: (currentSkew > 1.3 || currentSkew < 0.7) ? 'WARNING' : 'INFO',
        indexName,
        message,
        data: {
          currentSkew,
          previousSkew,
          skewChange,
          atmIV: analysis.volatilitySkew.atmIV,
          otmCallIV: analysis.volatilitySkew.otmCallIV,
          otmPutIV: analysis.volatilitySkew.otmPutIV
        },
        timestamp: new Date()
      });
    }
  }

  private emitAlert(alert: OptionsAlert): void {
    logger.info(`🚨 ${alert.severity} Alert: ${alert.message}`);

    this.alertCallbacks.forEach(callback => {
      try {
        callback(alert);
      } catch (error) {
        logger.error(`Alert callback failed: ${(error as Error).message}`);
      }
    });
  }

  private generateExpiryString(indexName: IndexName): string {
    const today = new Date();

    if (indexName === 'BANKNIFTY') {
      // BANKNIFTY: Monthly expiry on last working day
      const currentMonth = today.getMonth();
      const currentYear = today.getFullYear();
      const lastDay = new Date(currentYear, currentMonth + 1, 0).getDate();

      let lastWorkingDay = lastDay;
      const lastDate = new Date(currentYear, currentMonth, lastDay);

      while (lastDate.getDay() === 0 || lastDate.getDay() === 6) {
        lastWorkingDay--;
        lastDate.setDate(lastWorkingDay);
      }

      const day = lastWorkingDay.toString().padStart(2, '0');
      const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      const month = months[currentMonth];
      const year = currentYear.toString().slice(-2);

      return `${day}${month}${year}`;
    } else {
      // NIFTY: Weekly expiry on Tuesday
      const currentTuesday = new Date(today);
      const todayDay = today.getDay();

      if (todayDay <= 2) {
        const daysToTuesday = 2 - todayDay;
        currentTuesday.setDate(today.getDate() + daysToTuesday);
      } else {
        const daysToNextTuesday = 9 - todayDay;
        currentTuesday.setDate(today.getDate() + daysToNextTuesday);
      }

      const day = currentTuesday.getDate().toString().padStart(2, '0');
      const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      const month = months[currentTuesday.getMonth()];
      const year = currentTuesday.getFullYear().toString().slice(-2);

      return `${day}${month}${year}`;
    }
  }

  public getRecentAnalysis(indexName: IndexName): OptionsChainAnalysis | null {
    return this.lastAnalysis.get(indexName) || null;
  }

  public getSnapshots(indexName: IndexName, count?: number): OptionsChainSnapshot[] {
    const snapshots = this.snapshots.get(indexName) || [];
    return count ? snapshots.slice(-count) : snapshots;
  }

  public isCurrentlyMonitoring(): boolean {
    return this.isMonitoring;
  }

  public getMonitoringStatus(): {
    isMonitoring: boolean;
    intervalMs: number;
    indicesTracked: IndexName[];
    totalSnapshots: number;
  } {
    const totalSnapshots = Array.from(this.snapshots.values()).reduce((sum, snapshots) => sum + snapshots.length, 0);

    return {
      isMonitoring: this.isMonitoring,
      intervalMs: this.MONITORING_INTERVAL_MS,
      indicesTracked: Array.from(this.snapshots.keys()),
      totalSnapshots
    };
  }
}

export const optionsChainMonitor = new OptionsChainMonitor();