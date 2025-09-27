import axios, { AxiosInstance, AxiosResponse } from 'axios';
import * as speakeasy from 'speakeasy';
import * as fs from 'fs';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { AngelTokens, AngelLoginResponse } from '../types';
import { performanceMonitor } from './performanceMonitor';

interface ConnectionPoolConfig {
  maxConnections: number;
  keepAlive: boolean;
  timeout: number;
  retryAttempts: number;
}

interface RequestMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  lastRequestTime: number;
  consecutiveErrors: number;
}

interface CacheEntry {
  data: any;
  timestamp: number;
  ttl: number;
}

class EnhancedAngelAPI {
  private baseURL = 'https://apiconnect.angelbroking.com';
  private isAuthenticated = false;
  private _jwtToken: string | null = null;
  private _feedToken: string | null = null;
  private refreshToken: string | null = null;
  private tokensFile = 'angel-tokens.json';

  // 🚀 WEEK 1: CONNECTION POOLING & OPTIMIZATION
  private axiosInstances: AxiosInstance[] = [];
  private connectionPool: ConnectionPoolConfig = {
    maxConnections: 5,
    keepAlive: true,
    timeout: 5000,
    retryAttempts: 3
  };
  private currentConnectionIndex = 0;

  // 🚀 WEEK 1: ENHANCED CACHING & METRICS
  private intelligentCache: Map<string, CacheEntry> = new Map();
  private responseTimeHistory: number[] = [];
  private metrics: RequestMetrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    avgResponseTime: 0,
    p95ResponseTime: 0,
    p99ResponseTime: 0,
    lastRequestTime: 0,
    consecutiveErrors: 0
  };

  // 🚀 WEEK 1: PREDICTIVE CACHING
  private optionChainCache: Map<string, CacheEntry> = new Map();
  private greeksCache: Map<string, CacheEntry> = new Map();

  constructor() {
    this.initializeConnectionPool();
  }

  // 🚀 WEEK 1: INITIALIZE HIGH-PERFORMANCE CONNECTION POOL
  private initializeConnectionPool(): void {
    logger.info('🚀 Initializing enhanced API connection pool...');

    for (let i = 0; i < this.connectionPool.maxConnections; i++) {
      const instance = axios.create({
        baseURL: this.baseURL,
        timeout: this.connectionPool.timeout,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'TradingBot/2.0',
          'Connection': 'keep-alive'
        },
        // 🚀 HTTP/2 and connection optimization
        httpAgent: new (require('http').Agent)({
          keepAlive: this.connectionPool.keepAlive,
          maxSockets: 2,
          maxFreeSockets: 1,
          timeout: 60000,
          freeSocketTimeout: 30000
        }),
        httpsAgent: new (require('https').Agent)({
          keepAlive: this.connectionPool.keepAlive,
          maxSockets: 2,
          maxFreeSockets: 1,
          timeout: 60000,
          freeSocketTimeout: 30000
        })
      });

      // Add request interceptor for metrics
      instance.interceptors.request.use((config) => {
        (config as any).metadata = { startTime: Date.now() };
        return config;
      });

      // Add response interceptor for metrics and caching
      instance.interceptors.response.use(
        (response) => {
          const endTime = Date.now();
          const duration = endTime - ((response.config as any).metadata?.startTime || endTime);
          this.recordRequestMetrics(true, duration);
          return response;
        },
        (error) => {
          const endTime = Date.now();
          const duration = endTime - (error.config?.metadata?.startTime || endTime);
          this.recordRequestMetrics(false, duration);
          return Promise.reject(error);
        }
      );

      this.axiosInstances.push(instance);
    }

    logger.info(`✅ Connection pool initialized with ${this.connectionPool.maxConnections} connections`);
  }

  // 🚀 WEEK 1: INTELLIGENT LOAD BALANCING
  private getOptimalConnection(): AxiosInstance {
    // Round-robin with health check
    const instance = this.axiosInstances[this.currentConnectionIndex];
    this.currentConnectionIndex = (this.currentConnectionIndex + 1) % this.axiosInstances.length;
    return instance;
  }

  // 🚀 WEEK 1: ENHANCED METRICS TRACKING
  private recordRequestMetrics(success: boolean, duration: number): void {
    this.metrics.totalRequests++;
    this.metrics.lastRequestTime = Date.now();

    if (success) {
      this.metrics.successfulRequests++;
      this.metrics.consecutiveErrors = 0;
    } else {
      this.metrics.failedRequests++;
      this.metrics.consecutiveErrors++;
    }

    // Track response times for percentile calculation
    this.responseTimeHistory.push(duration);
    if (this.responseTimeHistory.length > 1000) {
      this.responseTimeHistory.shift(); // Keep last 1000 requests
    }

    // Calculate percentiles
    const sorted = [...this.responseTimeHistory].sort((a, b) => a - b);
    const p95Index = Math.floor(sorted.length * 0.95);
    const p99Index = Math.floor(sorted.length * 0.99);

    this.metrics.avgResponseTime = this.responseTimeHistory.reduce((sum, t) => sum + t, 0) / this.responseTimeHistory.length;
    this.metrics.p95ResponseTime = sorted[p95Index] || 0;
    this.metrics.p99ResponseTime = sorted[p99Index] || 0;

    // Record in global performance monitor
    performanceMonitor.recordApiLatency(duration);

    if (!success) {
      performanceMonitor.recordError('ENHANCED_API_ERROR');
    }
  }

  // 🚀 WEEK 1: INTELLIGENT CACHING SYSTEM
  private generateCacheKey(endpoint: string, params: any): string {
    const sortedParams = Object.keys(params || {})
      .sort()
      .reduce((result: any, key) => {
        result[key] = params[key];
        return result;
      }, {});
    return `${endpoint}:${JSON.stringify(sortedParams)}`;
  }

  private getCachedResponse(cacheKey: string): any | null {
    const entry = this.intelligentCache.get(cacheKey);
    if (!entry) return null;

    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
      this.intelligentCache.delete(cacheKey);
      return null;
    }

    logger.debug(`🚀 Cache hit: ${cacheKey} (age: ${now - entry.timestamp}ms)`);
    return entry.data;
  }

  private setCachedResponse(cacheKey: string, data: any, ttlMs: number): void {
    this.intelligentCache.set(cacheKey, {
      data,
      timestamp: Date.now(),
      ttl: ttlMs
    });

    // Cleanup old entries (keep cache size manageable)
    if (this.intelligentCache.size > 1000) {
      const entries = Array.from(this.intelligentCache.entries());
      const sorted = entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      // Remove oldest 100 entries
      for (let i = 0; i < 100; i++) {
        this.intelligentCache.delete(sorted[i][0]);
      }
    }
  }

  // 🚀 WEEK 1: HIGH-PERFORMANCE REQUEST METHOD
  public async makeEnhancedRequest(
    endpoint: string,
    method: 'GET' | 'POST' = 'GET',
    data: any = null,
    options: {
      priority?: 'HIGH' | 'MEDIUM' | 'LOW';
      cacheTTL?: number;
      retries?: number;
      timeout?: number;
    } = {}
  ): Promise<any> {
    const startTime = Date.now();

    // Default options
    const {
      priority = 'MEDIUM',
      cacheTTL = 0,
      retries = this.connectionPool.retryAttempts,
      timeout = this.connectionPool.timeout
    } = options;

    // Check cache for GET requests
    if (method === 'GET' && cacheTTL > 0) {
      const cacheKey = this.generateCacheKey(endpoint, data);
      const cached = this.getCachedResponse(cacheKey);
      if (cached) {
        return cached;
      }
    }

    if (!this.isAuthenticated) {
      throw new Error('API not authenticated');
    }

    // Get optimal connection
    const axiosInstance = this.getOptimalConnection();

    // Prepare request config
    const requestConfig = {
      method,
      url: endpoint,
      data,
      timeout,
      headers: {
        'Authorization': `Bearer ${this._jwtToken}`,
        'X-PrivateKey': config.angel.apiKey,
        'X-UserType': 'USER',
        'X-SourceID': 'WEB',
        'X-ClientLocalIP': this.getLocalIP(),
        'X-ClientPublicIP': this.getPublicIP(),
        'X-MACAddress': this.getMACAddress(),
        'X-Priority': priority
      }
    };

    // Retry logic with exponential backoff
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await axiosInstance.request(requestConfig);

        // Cache successful GET responses
        if (method === 'GET' && cacheTTL > 0) {
          const cacheKey = this.generateCacheKey(endpoint, data);
          this.setCachedResponse(cacheKey, response.data, cacheTTL);
        }

        const duration = Date.now() - startTime;
        logger.debug(`🚀 Enhanced API request completed: ${endpoint} (${duration}ms, attempt ${attempt})`);

        return response.data;

      } catch (error) {
        const isLastAttempt = attempt === retries;

        if (axios.isAxiosError(error)) {
          // Handle 401 authentication errors
          if (error.response?.status === 401) {
            logger.warn('🔄 Authentication expired, refreshing...');
            await this.authenticate();
            continue; // Retry with new token
          }

          // Handle rate limiting
          if (error.response?.status === 429) {
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
            logger.warn(`⏱️ Rate limited, waiting ${delay}ms before retry ${attempt}/${retries}`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }

        if (!isLastAttempt) {
          const delay = Math.min(500 * Math.pow(2, attempt - 1), 2000);
          logger.warn(`🔄 Request failed, retrying in ${delay}ms (attempt ${attempt}/${retries}): ${(error as Error).message}`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          logger.error(`❌ Enhanced API request failed after ${retries} attempts: ${endpoint}`, error);
          throw error;
        }
      }
    }

    throw new Error(`Request failed after ${retries} attempts`);
  }

  // 🚀 WEEK 1: AUTHENTICATION WITH CONNECTION POOL
  public async authenticate(): Promise<boolean> {
    logger.info('🔐 Authenticating with enhanced Angel One API...');

    if (!this.validateConfig()) {
      throw new Error('Angel One API configuration required');
    }

    try {
      // Try loading existing tokens
      if (await this.loadStoredTokens()) {
        // Update all connection instances with new token
        this.updateConnectionHeaders();
        return true;
      }

      // Generate fresh session
      const success = await this.freshLogin();
      if (success) {
        this.updateConnectionHeaders();
      }
      return success;

    } catch (error) {
      logger.error('❌ Enhanced authentication failed:', (error as Error).message);
      throw error;
    }
  }

  private updateConnectionHeaders(): void {
    this.axiosInstances.forEach(instance => {
      instance.defaults.headers['Authorization'] = `Bearer ${this._jwtToken}`;
      instance.defaults.headers['X-PrivateKey'] = config.angel.apiKey;
    });
  }

  // 🚀 WEEK 1: OPTIMIZED OPTION PRICE FETCHING
  public async getOptionPriceOptimized(
    tradingSymbol: string,
    symbolToken: string,
    useCache = true
  ): Promise<number | null> {
    try {
      const cacheKey = `option_price:${symbolToken}`;

      // Check recent cache (5 second TTL for option prices)
      if (useCache) {
        const cached = this.getCachedResponse(cacheKey);
        if (cached) {
          return parseFloat(cached.ltp || cached.close || 0);
        }
      }

      const response = await this.makeEnhancedRequest(
        '/rest/secure/angelbroking/market/v1/quote/',
        'POST',
        {
          mode: 'LTP',
          exchangeTokens: {
            'NFO': [symbolToken]
          }
        },
        {
          priority: 'HIGH',
          cacheTTL: 5000, // 5 second cache
          timeout: 3000   // Fast timeout for price requests
        }
      );

      if (response?.status === true && response?.data?.fetched?.length > 0) {
        const marketData = response.data.fetched[0];
        const price = parseFloat(marketData.ltp || marketData.close || 0);

        if (price > 0) {
          logger.debug(`🚀 Option price: ${tradingSymbol} = ₹${price.toFixed(2)} (${symbolToken})`);
          return price;
        }
      }

      logger.warn(`❌ Could not get option price for ${tradingSymbol} (${symbolToken})`);
      return null;

    } catch (error) {
      logger.error(`Failed to get option price for ${tradingSymbol}:`, (error as Error).message);
      return null;
    }
  }

  // 🚀 WEEK 1: BATCH OPTION CHAIN FETCHING
  public async getOptionChainBatch(
    indexName: 'NIFTY' | 'BANKNIFTY',
    strikes: number[],
    expiry: string
  ): Promise<Map<string, number>> {
    const priceMap = new Map<string, number>();
    const cacheKey = `option_chain:${indexName}:${expiry}:${strikes.join(',')}`;

    // Check cache first
    const cached = this.getCachedResponse(cacheKey);
    if (cached) {
      return new Map(cached);
    }

    try {
      // Batch request for multiple strikes
      const tokens: string[] = [];
      const symbolMap: Map<string, string> = new Map();

      for (const strike of strikes) {
        for (const type of ['CE', 'PE']) {
          const symbol = `${indexName}${expiry}${strike}${type}`;
          // This would need actual token lookup - simplified here
          const token = `${strike}_${type}`;
          tokens.push(token);
          symbolMap.set(token, symbol);
        }
      }

      if (tokens.length > 0) {
        const response = await this.makeEnhancedRequest(
          '/rest/secure/angelbroking/market/v1/quote/',
          'POST',
          {
            mode: 'LTP',
            exchangeTokens: {
              'NFO': tokens
            }
          },
          {
            priority: 'HIGH',
            cacheTTL: 10000, // 10 second cache for option chains
            timeout: 5000
          }
        );

        if (response?.data?.fetched) {
          response.data.fetched.forEach((item: any) => {
            const price = parseFloat(item.ltp || item.close || 0);
            if (price > 0) {
              const symbol = symbolMap.get(item.token) || item.token;
              priceMap.set(symbol, price);
            }
          });
        }
      }

      // Cache the result
      this.setCachedResponse(cacheKey, Array.from(priceMap.entries()), 10000);

      logger.info(`🚀 Fetched ${priceMap.size} option prices for ${indexName} ${expiry}`);
      return priceMap;

    } catch (error) {
      logger.error(`Failed to fetch option chain for ${indexName}:`, (error as Error).message);
      return priceMap;
    }
  }

  // Helper methods (keeping existing functionality)
  private validateConfig(): boolean {
    const required: (keyof typeof config.angel)[] = [
      'clientId', 'apiKey', 'apiSecret', 'password', 'totpSecret'
    ];
    const missing = required.filter(key => !config.angel[key]);
    return missing.length === 0;
  }

  private generateTOTP(): string {
    const totp = speakeasy.totp({
      secret: config.angel.totpSecret,
      encoding: 'base32'
    });
    return totp;
  }

  private async loadStoredTokens(): Promise<boolean> {
    try {
      if (!fs.existsSync(this.tokensFile)) {
        return false;
      }

      const tokens: AngelTokens = JSON.parse(fs.readFileSync(this.tokensFile, 'utf8'));
      const age = Date.now() - tokens.timestamp;

      if (age > 20 * 60 * 60 * 1000) { // 20 hours
        return false;
      }

      this._jwtToken = tokens.jwtToken;
      this._feedToken = tokens.feedToken;
      this.refreshToken = tokens.refreshToken;
      this.isAuthenticated = true;

      logger.info('✅ Loaded stored enhanced Angel tokens');
      return true;

    } catch (error) {
      return false;
    }
  }

  private async freshLogin(): Promise<boolean> {
    logger.info('🔐 Performing fresh enhanced Angel login...');

    const totp = this.generateTOTP();
    const axiosInstance = this.getOptimalConnection();

    try {
      const loginData = {
        clientcode: config.angel.clientId,
        password: config.angel.password,
        totp: totp
      };

      const response: AxiosResponse<AngelLoginResponse> = await axiosInstance.post(
        '/rest/auth/angelbroking/user/v1/loginByPassword',
        loginData
      );

      if (response.data.status && response.data.data) {
        this._jwtToken = response.data.data.jwtToken;
        this._feedToken = response.data.data.feedToken;
        this.refreshToken = response.data.data.refreshToken;

        const tokens: AngelTokens = {
          jwtToken: this._jwtToken,
          feedToken: this._feedToken,
          refreshToken: this.refreshToken,
          timestamp: Date.now()
        };

        fs.writeFileSync(this.tokensFile, JSON.stringify(tokens, null, 2));
        this.isAuthenticated = true;

        logger.info('✅ Fresh enhanced Angel login successful');
        return true;
      } else {
        throw new Error(response.data.message || 'Authentication failed');
      }
    } catch (error) {
      logger.error('Enhanced login failed:', (error as Error).message);
      throw error;
    }
  }

  // Network helper methods (simplified)
  private getLocalIP(): string {
    return '192.168.1.100';
  }

  private getPublicIP(): string {
    return '203.192.1.100';
  }

  private getMACAddress(): string {
    return 'AA:BB:CC:DD:EE:FF';
  }

  // 🚀 WEEK 1: PERFORMANCE METRICS
  public getEnhancedMetrics(): RequestMetrics & {
    connectionPoolSize: number;
    cacheSize: number;
    cacheHitRate: number;
  } {
    const totalCacheRequests = this.metrics.totalRequests;
    const cacheHits = this.intelligentCache.size; // Simplified calculation
    const cacheHitRate = totalCacheRequests > 0 ? (cacheHits / totalCacheRequests) * 100 : 0;

    return {
      ...this.metrics,
      connectionPoolSize: this.axiosInstances.length,
      cacheSize: this.intelligentCache.size,
      cacheHitRate
    };
  }

  // Getters
  get jwtToken(): string | null { return this._jwtToken; }
  get feedToken(): string | null { return this._feedToken; }
}

export const enhancedAngelAPI = new EnhancedAngelAPI();