import axios from 'axios';
import { logger } from '../utils/logger';
import { IndexName, TradingSignal } from '../types';

interface AIPrediction {
  success: boolean;
  indexName: string;
  currentPrice: number;
  timestamp: string;
  aiPredictions: {
    direction?: 'UP' | 'DOWN' | 'SIDEWAYS';
    direction_confidence?: number;
    success_probability?: number;
    expected_profit_percent?: number;
  };
  sentimentScore?: {
    overall_score: number;
    compound_score: number;
    confidence: number;
    sentiment_label: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  };
  tradingRecommendation: {
    action: 'BUY' | 'SELL' | 'HOLD';
    confidence: number;
    reasoning: string[];
    risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
    position_size: number;
  };
  confidence: number;
}

interface MarketDataForAI {
  indexName: string;
  currentPrice: number;
  indicators: {
    ema: number;
    rsi: number;
    bollingerBands: {
      upper: number;
      middle: number;
      lower: number;
      squeeze: boolean;
    };
    momentum: number;
    volatility: number;
    support: number;
    resistance: number;
  };
  marketConditions: {
    trend: 'BULLISH' | 'BEARISH' | 'SIDEWAYS';
    volatilityRegime: 'LOW' | 'MEDIUM' | 'HIGH';
    timeOfDay: 'OPENING' | 'MID_DAY' | 'CLOSING';
  };
}

/**
 * 🤖 AI Integration Service
 * Integrates AI predictions into the trading bot strategy
 */
class AIIntegrationService {
  private aiServiceUrl: string;
  private isAIEnabled: boolean = false;
  private aiServiceHealthy: boolean = false;
  private lastHealthCheck: number = 0;
  private healthCheckInterval: number = 60000; // 1 minute
  private requestTimeout: number = 10000; // 10 seconds
  private retryAttempts: number = 3;
  
  // AI configuration
  private aiConfig = {
    minConfidenceThreshold: 0.6,  // Minimum AI confidence to consider prediction
    sentimentWeight: 0.3,         // Weight of sentiment in final decision
    combineWithTechnicals: true,  // Whether to combine AI with technical analysis
    overrideOnHighConfidence: 0.8 // Override technical signals if AI confidence > 80%
  };

  constructor(aiServiceUrl?: string) {
    this.aiServiceUrl = aiServiceUrl || process.env.AI_SERVICE_URL || 'http://localhost:5000';
  }

  public async initialize(): Promise<void> {
    logger.info('🤖 Initializing AI Integration Service...');
    
    // Check if AI service is available
    const isHealthy = await this.checkAIServiceHealth();
    
    if (isHealthy) {
      this.isAIEnabled = true;
      this.aiServiceHealthy = true;
      logger.info('✅ AI Service is healthy and ready');
      
      // Start periodic health checks
      setInterval(() => {
        this.performPeriodicHealthCheck();
      }, this.healthCheckInterval);
    } else {
      logger.warn('⚠️ AI Service not available - trading will continue with technical analysis only');
      this.isAIEnabled = false;
    }
  }

  /**
   * 🔮 Get AI prediction for trading decision
   */
  public async getAIPrediction(
    indexName: IndexName, 
    currentPrice: number, 
    indicators: any, 
    marketConditions: any
  ): Promise<AIPrediction | null> {
    
    if (!this.isAIEnabled || !this.aiServiceHealthy) {
      return null;
    }

    try {
      const marketData: MarketDataForAI = {
        indexName,
        currentPrice,
        indicators: {
          ema: indicators.ema || 0,
          rsi: indicators.rsi || 50,
          bollingerBands: {
            upper: indicators.bollingerUpper || 0,
            middle: indicators.bollingerMiddle || 0,
            lower: indicators.bollingerLower || 0,
            squeeze: indicators.bollingerSqueeze || false
          },
          momentum: indicators.momentum || 0,
          volatility: indicators.volatility || 0.15,
          support: indicators.support || 0,
          resistance: indicators.resistance || 0
        },
        marketConditions: {
          trend: this.determineTrend(indicators),
          volatilityRegime: this.determineVolatilityRegime(indicators.volatility || 0.15),
          timeOfDay: this.getTimeOfDay()
        }
      };

      const response = await this.makeAIRequest('/predict', marketData);
      
      if (response && response.success) {
        logger.info(`🤖 AI Prediction for ${indexName}: ${response.tradingRecommendation.action} (${response.confidence.toFixed(2)} confidence)`);
        return response;
      }

      return null;

    } catch (error) {
      logger.error('AI prediction request failed:', (error as Error).message);
      this.aiServiceHealthy = false;
      return null;
    }
  }

  /**
   * 📊 Enhance trading signal with AI predictions
   */
  public async enhanceSignalWithAI(
    originalSignal: TradingSignal,
    indicators: any,
    marketConditions: any
  ): Promise<{
    enhancedSignal: TradingSignal;
    aiAnalysis: {
      aiPrediction: AIPrediction | null;
      finalDecision: 'PROCEED' | 'REJECT' | 'MODIFY';
      reasoning: string[];
      confidenceAdjustment: number;
    };
  }> {

    const aiAnalysis = {
      aiPrediction: null as AIPrediction | null,
      finalDecision: 'PROCEED' as 'PROCEED' | 'REJECT' | 'MODIFY',
      reasoning: [] as string[],
      confidenceAdjustment: 0
    };

    // Get AI prediction
    const aiPrediction = await this.getAIPrediction(
      originalSignal.indexName,
      originalSignal.spotPrice,
      indicators,
      marketConditions
    );

    aiAnalysis.aiPrediction = aiPrediction;

    if (!aiPrediction) {
      aiAnalysis.reasoning.push('AI prediction not available - using technical analysis only');
      return {
        enhancedSignal: originalSignal,
        aiAnalysis
      };
    }

    // Analyze AI prediction vs technical signal
    const aiRecommendation = aiPrediction.tradingRecommendation;
    const signalDirection = originalSignal.optionType === 'CE' ? 'BUY' : 'SELL';
    
    // Check if AI agrees with technical signal
    const aiAgreement = this.checkAIAgreement(signalDirection, aiRecommendation);

    // Make enhancement decision
    let enhancedSignal = { ...originalSignal };

    if (aiPrediction.confidence > this.aiConfig.overrideOnHighConfidence) {
      // High confidence AI prediction - consider overriding
      if (aiAgreement.agrees) {
        // AI agrees - boost confidence
        enhancedSignal.confidence = Math.min(98, originalSignal.confidence + 15);
        aiAnalysis.confidenceAdjustment = 15;
        aiAnalysis.reasoning.push(`High-confidence AI agreement (+15% confidence)`);
        aiAnalysis.finalDecision = 'PROCEED';
      } else {
        // AI disagrees with high confidence - reject signal
        aiAnalysis.finalDecision = 'REJECT';
        aiAnalysis.reasoning.push(`High-confidence AI disagreement - rejecting signal`);
        aiAnalysis.reasoning.push(`AI recommends: ${aiRecommendation.action}, Signal: ${signalDirection}`);
      }
    } else if (aiPrediction.confidence > this.aiConfig.minConfidenceThreshold) {
      // Moderate confidence AI prediction
      if (aiAgreement.agrees) {
        // Moderate agreement - slight confidence boost
        enhancedSignal.confidence = Math.min(95, originalSignal.confidence + 8);
        aiAnalysis.confidenceAdjustment = 8;
        aiAnalysis.reasoning.push(`Moderate AI agreement (+8% confidence)`);
      } else {
        // Moderate disagreement - reduce confidence
        enhancedSignal.confidence = Math.max(40, originalSignal.confidence - 10);
        aiAnalysis.confidenceAdjustment = -10;
        aiAnalysis.reasoning.push(`Moderate AI disagreement (-10% confidence)`);
      }
      aiAnalysis.finalDecision = 'MODIFY';
    } else {
      // Low confidence AI prediction - minimal impact
      aiAnalysis.reasoning.push('Low AI confidence - minimal impact on signal');
      if (!aiAgreement.agrees) {
        enhancedSignal.confidence = Math.max(45, originalSignal.confidence - 5);
        aiAnalysis.confidenceAdjustment = -5;
      }
    }

    // Factor in sentiment analysis
    if (aiPrediction.sentimentScore) {
      const sentimentImpact = this.calculateSentimentImpact(
        aiPrediction.sentimentScore,
        signalDirection
      );
      
      enhancedSignal.confidence = Math.max(30, Math.min(98, 
        enhancedSignal.confidence + sentimentImpact
      ));
      
      aiAnalysis.confidenceAdjustment += sentimentImpact;
      if (sentimentImpact !== 0) {
        aiAnalysis.reasoning.push(
          `Sentiment analysis: ${sentimentImpact > 0 ? '+' : ''}${sentimentImpact}% confidence (${aiPrediction.sentimentScore.sentiment_label})`
        );
      }
    }

    // Adjust position sizing based on AI recommendation
    if (aiPrediction.tradingRecommendation.position_size !== 1.0) {
      const sizeMultiplier = aiPrediction.tradingRecommendation.position_size;
      aiAnalysis.reasoning.push(`AI suggests ${(sizeMultiplier * 100).toFixed(0)}% position size`);
      
      // Note: Position size adjustment would be handled by order service
      // We can store this information in the signal for later use
      (enhancedSignal as any).aiPositionSizeMultiplier = sizeMultiplier;
    }

    return {
      enhancedSignal,
      aiAnalysis
    };
  }

  /**
   * 📈 Get sentiment analysis for index
   */
  public async getSentimentAnalysis(indexName: IndexName): Promise<any> {
    if (!this.isAIEnabled || !this.aiServiceHealthy) {
      return null;
    }

    try {
      const response = await axios.get(`${this.aiServiceUrl}/sentiment/${indexName}`, {
        timeout: this.requestTimeout
      });
      
      return response.data.sentiment;
    } catch (error) {
      logger.error('Sentiment analysis request failed:', (error as Error).message);
      return null;
    }
  }

  private async makeAIRequest(endpoint: string, data: any): Promise<AIPrediction | null> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        const response = await axios.post(`${this.aiServiceUrl}${endpoint}`, data, {
          timeout: this.requestTimeout,
          headers: {
            'Content-Type': 'application/json'
          }
        });

        if (response.data && response.data.success) {
          return response.data;
        } else {
          throw new Error(response.data?.error || 'Invalid AI service response');
        }

      } catch (error) {
        lastError = error as Error;
        
        if (attempt < this.retryAttempts) {
          const delay = attempt * 1000; // Exponential backoff
          logger.debug(`AI request attempt ${attempt} failed, retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new Error('All AI request attempts failed');
  }

  private async checkAIServiceHealth(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.aiServiceUrl}/health`, {
        timeout: 5000
      });
      
      return response.data?.status === 'healthy' && response.data?.model_loaded === true;
    } catch (error) {
      logger.debug('AI service health check failed:', (error as Error).message);
      return false;
    }
  }

  private async performPeriodicHealthCheck(): Promise<void> {
    if (Date.now() - this.lastHealthCheck < this.healthCheckInterval) {
      return;
    }

    this.lastHealthCheck = Date.now();
    const isHealthy = await this.checkAIServiceHealth();
    
    if (this.aiServiceHealthy !== isHealthy) {
      this.aiServiceHealthy = isHealthy;
      
      if (isHealthy) {
        logger.info('✅ AI Service restored');
      } else {
        logger.warn('⚠️ AI Service became unhealthy');
      }
    }
  }

  private checkAIAgreement(signalDirection: string, aiRecommendation: any): { agrees: boolean; reason: string } {
    const normalizedSignal = signalDirection.toUpperCase();
    const normalizedAI = aiRecommendation.action.toUpperCase();

    if (normalizedSignal === normalizedAI) {
      return { agrees: true, reason: 'Direct agreement' };
    }

    // Check for compatible actions
    if (normalizedSignal === 'BUY' && normalizedAI === 'HOLD' && aiRecommendation.confidence > 0.5) {
      return { agrees: true, reason: 'Compatible - AI neutral but leaning positive' };
    }

    if (normalizedSignal === 'SELL' && normalizedAI === 'HOLD' && aiRecommendation.confidence > 0.5) {
      return { agrees: true, reason: 'Compatible - AI neutral but leaning negative' };
    }

    return { agrees: false, reason: `AI recommends ${normalizedAI}, signal suggests ${normalizedSignal}` };
  }

  private calculateSentimentImpact(sentimentScore: any, signalDirection: string): number {
    const sentimentValue = sentimentScore.compound_score;
    const sentimentConfidence = sentimentScore.confidence;
    
    // Calculate base sentiment impact
    let impact = 0;
    
    if (Math.abs(sentimentValue) > 0.3) { // Strong sentiment
      const sentimentDirection = sentimentValue > 0 ? 'POSITIVE' : 'NEGATIVE';
      const signalPositive = signalDirection === 'BUY';
      
      if ((sentimentDirection === 'POSITIVE' && signalPositive) || 
          (sentimentDirection === 'NEGATIVE' && !signalPositive)) {
        // Sentiment agrees with signal
        impact = Math.floor(Math.abs(sentimentValue) * 10 * sentimentConfidence);
      } else {
        // Sentiment disagrees with signal
        impact = -Math.floor(Math.abs(sentimentValue) * 8 * sentimentConfidence);
      }
    }

    // Apply sentiment weight from configuration
    return Math.round(impact * this.aiConfig.sentimentWeight);
  }

  private determineTrend(indicators: any): 'BULLISH' | 'BEARISH' | 'SIDEWAYS' {
    if (indicators.momentum > 0.01) return 'BULLISH';
    if (indicators.momentum < -0.01) return 'BEARISH';
    return 'SIDEWAYS';
  }

  private determineVolatilityRegime(volatility: number): 'LOW' | 'MEDIUM' | 'HIGH' {
    if (volatility < 0.15) return 'LOW';
    if (volatility < 0.25) return 'MEDIUM';
    return 'HIGH';
  }

  private getTimeOfDay(): 'OPENING' | 'MID_DAY' | 'CLOSING' {
    const hour = new Date().getHours();
    if (hour >= 9 && hour < 11) return 'OPENING';
    if (hour >= 14 && hour < 16) return 'CLOSING';
    return 'MID_DAY';
  }

  // Getters for status
  public isEnabled(): boolean {
    return this.isAIEnabled;
  }

  public isHealthy(): boolean {
    return this.aiServiceHealthy;
  }

  public getStatus() {
    return {
      enabled: this.isAIEnabled,
      healthy: this.aiServiceHealthy,
      serviceUrl: this.aiServiceUrl,
      lastHealthCheck: new Date(this.lastHealthCheck).toISOString(),
      configuration: this.aiConfig
    };
  }
}

export const aiIntegration = new AIIntegrationService();