import axios, { AxiosResponse } from 'axios';
import * as speakeasy from 'speakeasy';
import * as fs from 'fs';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import {
  AngelTokens,
  AngelLoginResponse,
  AngelProfileResponse,
  GreeksData
} from '../types';
import { performanceMonitor } from './performanceMonitor';

interface QueuedRequest {
  request: () => Promise<any>;
  resolve: (value: any) => void;
  reject: (error: any) => void;
  priority: number;
  timestamp: number;
}

interface RequestMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgResponseTime: number;
  lastRequestTime: number;
}

class AngelAPI {
  private baseURL = 'https://apiconnect.angelbroking.com';
  private isAuthenticated = false;
  private _jwtToken: string | null = null;
  private _feedToken: string | null = null;
  private refreshToken: string | null = null;
  private tokensFile = 'angel-tokens.json';

  // 🚀 PERFORMANCE OPTIMIZATION: Request batching and caching
  private requestQueue: QueuedRequest[] = [];
  private processingQueue = false;
  private requestCache: Map<string, { data: any; timestamp: number }> = new Map();
  private metrics: RequestMetrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    avgResponseTime: 0,
    lastRequestTime: 0
  };
  private readonly CACHE_TTL = 5000; // 5 seconds cache
  private readonly MAX_BATCH_SIZE = 5;
  private readonly BATCH_DELAY = 10; // 10ms between batches

  get jwtToken(): string | null {
    return this._jwtToken;
  }

  get feedToken(): string | null {
    return this._feedToken;
  }

  private generateTOTP(): string {
    try {
      const totp = speakeasy.totp({
        secret: config.angel.totpSecret,
        encoding: 'base32'
      });
      return totp;
    } catch (error) {
      logger.error('TOTP generation failed:', (error as Error).message);
      logger.error('TOTP Secret format might be invalid. Please verify with Angel Broking.');
      throw new Error('TOTP generation failed - check secret format');
    }
  }

  public async authenticate(): Promise<boolean> {
    logger.info('Authenticating with Angel One API - Real trading mode only');

    // Validate configuration before attempting authentication
    if (!this.validateConfig()) {
      logger.error('CRITICAL: Angel API configuration is incomplete - cannot proceed without valid credentials');
      throw new Error('Angel One API configuration required');
    }

    try {
      // Try loading existing tokens
      if (await this.loadStoredTokens()) {
        return true;
      }

      // Generate fresh session
      return await this.freshLogin();

    } catch (error) {
      logger.error('CRITICAL: Angel authentication failed:', (error as Error).message);

      // Provide specific guidance based on error type
      if ((error as Error).message.includes('Invalid Token') ||
        (error as Error).message.includes('AG8001')) {
        logger.error('Authentication failure - This usually indicates:');
        logger.error('1. Incorrect API credentials');
        logger.error('2. Invalid TOTP secret format');
        logger.error('3. API key not activated or expired');
        logger.error('Please verify your credentials with Angel Broking');
      }

      logger.error('CRITICAL: Cannot proceed without valid Angel One authentication');
      throw error;
    }
  }

  private validateConfig(): boolean {
    const required: (keyof typeof config.angel)[] = [
      'clientId', 'apiKey', 'apiSecret', 'password', 'totpSecret'
    ];
    const missing = required.filter(key => !config.angel[key]);

    if (missing.length > 0) {
      logger.error(`Missing Angel API configuration: ${missing.join(', ')}`);
      return false;
    }

    // Validate TOTP secret format (should be base32)
    if (config.angel.totpSecret.length < 16) {
      logger.error('TOTP secret appears too short. Should be 32+ characters in base32 format');
      return false;
    }

    return true;
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

      logger.info('✅ Loaded stored Angel tokens');
      return true;

    } catch (error) {
      return false;
    }
  }

  private async freshLogin(): Promise<boolean> {
    logger.info('🔐 Performing fresh Angel login...');

    const totp = this.generateTOTP();
    logger.info(`Generated TOTP: ${totp}`);

    try {
      const loginData = {
        clientcode: config.angel.clientId,
        password: config.angel.password,
        totp: totp
      };

      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-UserType': 'USER',
        'X-SourceID': 'WEB',
        'X-ClientLocalIP': '192.168.1.1',
        'X-ClientPublicIP': '192.168.1.1',
        'X-MACAddress': '00:00:00:00:00:00',
        'X-PrivateKey': config.angel.apiKey
      };

      logger.info('Attempting login with Angel SmartAPI...');
      logger.info('Login payload:', JSON.stringify(loginData));

      const response: AxiosResponse<AngelLoginResponse> = await axios.post(
        `${this.baseURL}/rest/auth/angelbroking/user/v1/loginByPassword`,
        loginData,
        { headers }
      );

      logger.info('Login response received:', {
        status: response.data.status,
        message: response.data.message,
        hasData: !!response.data.data
      });

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

        logger.info('✅ Fresh Angel login successful');
        logger.info(`JWT Token: ${this._jwtToken.substring(0, 20)}...`);
        return true;
      } else {
        const errorMsg = response.data.message ||
          response.data.errorMessage ||
          'Authentication failed - no error message provided';
        logger.error('Angel API Response:', response.data);
        throw new Error(errorMsg);
      }
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        logger.error('Login attempt failed:', {
          message: error.message,
          response: error.response.data,
          status: error.response.status
        });
      } else {
        logger.error('Login attempt failed:', (error as Error).message);
      }
      throw error;
    }
  }

  // 🚀 OPTIMIZED: Request batching and caching system
  private generateCacheKey(endpoint: string, method: string, data: any): string {
    return `${method}:${endpoint}:${JSON.stringify(data)}`;
  }

  private async batchProcessRequests(): Promise<void> {
    if (this.processingQueue || this.requestQueue.length === 0) return;

    this.processingQueue = true;

    // Sort by priority (higher priority first), then by timestamp (FIFO)
    this.requestQueue.sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority;
      return a.timestamp - b.timestamp;
    });

    const batch = this.requestQueue.splice(0, this.MAX_BATCH_SIZE);

    // Process batch in parallel with controlled concurrency
    await Promise.allSettled(batch.map(async ({ request, resolve, reject }) => {
      const startTime = Date.now();
      try {
        const result = await request();
        const responseTime = Date.now() - startTime;
        this.updateMetrics(true, responseTime);

        // 📊 Record API performance in global monitor
        performanceMonitor.recordApiLatency(responseTime);

        resolve(result);
      } catch (error) {
        const responseTime = Date.now() - startTime;
        this.updateMetrics(false, responseTime);

        // 📊 Record API error
        performanceMonitor.recordError('API_ERROR');

        reject(error);
      }
    }));

    this.processingQueue = false;

    // Schedule next batch if queue has items
    if (this.requestQueue.length > 0) {
      setTimeout(() => this.batchProcessRequests(), this.BATCH_DELAY);
    }
  }

  private updateMetrics(success: boolean, responseTime: number): void {
    this.metrics.totalRequests++;
    this.metrics.lastRequestTime = Date.now();

    if (success) {
      this.metrics.successfulRequests++;
    } else {
      this.metrics.failedRequests++;
    }

    // Update rolling average response time
    const totalSuccessful = this.metrics.successfulRequests;
    this.metrics.avgResponseTime =
      ((this.metrics.avgResponseTime * (totalSuccessful - 1)) + responseTime) / totalSuccessful;
  }

  public async makeRequest(
    endpoint: string,
    method: 'GET' | 'POST' = 'GET',
    data: any = null,
    priority: number = 1,
    useCache: boolean = true
  ): Promise<any> {
    if (!this.isAuthenticated) {
      throw new Error('Not authenticated');
    }

    // Check cache for GET requests
    if (method === 'GET' && useCache) {
      const cacheKey = this.generateCacheKey(endpoint, method, data);
      const cached = this.requestCache.get(cacheKey);

      if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
        logger.debug(`🚀 Cache hit: ${endpoint}`);
        return cached.data;
      }
    }

    // Create promise for queued request
    return new Promise((resolve, reject) => {
      const requestFn = async () => {
        const headers = {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-UserType': 'USER',
          'X-SourceID': 'WEB',
          'X-ClientLocalIP': this.getLocalIP(),
          'X-ClientPublicIP': this.getPublicIP(),
          'X-MACAddress': this.getMACAddress(),
          'X-PrivateKey': config.angel.apiKey,
          'Authorization': `Bearer ${this._jwtToken}`
        };

        try {
          const response = await axios({
            method,
            url: `${this.baseURL}${endpoint}`,
            headers,
            data,
            timeout: 15000  // Reduced timeout for faster failure detection
          });

          // Cache GET responses
          if (method === 'GET' && useCache) {
            const cacheKey = this.generateCacheKey(endpoint, method, data);
            this.requestCache.set(cacheKey, {
              data: response.data,
              timestamp: Date.now()
            });
          }

          return response.data;

        } catch (error) {
          if (axios.isAxiosError(error)) {
            logger.error('❌ API Error:', {
              status: error.response?.status,
              statusText: error.response?.statusText,
              data: error.response?.data,
              endpoint: endpoint
            });

            if (error.response?.status === 401) {
              this.isAuthenticated = false;
              // Re-authenticate and retry
              if (await this.authenticate()) {
                return this.makeRequest(endpoint, method, data, priority, useCache);
              }
            }
          }
          throw error;
        }
      };

      // Add to queue
      this.requestQueue.push({
        request: requestFn,
        resolve,
        reject,
        priority,
        timestamp: Date.now()
      });

      // Start processing if not already running
      this.batchProcessRequests();
    });
  }

  public getMetrics(): RequestMetrics {
    return { ...this.metrics };
  }

  public clearCache(): void {
    this.requestCache.clear();
    logger.info('🧹 API cache cleared');
  }

  // Helper methods to get actual network info
  private getLocalIP(): string {
    // For Node.js environment
    const os = require('os');
    const networkInterfaces = os.networkInterfaces();

    for (const interfaceName of Object.keys(networkInterfaces)) {
      const networkInterface = networkInterfaces[interfaceName];
      for (const network of networkInterface || []) {
        if (network.family === 'IPv4' && !network.internal) {
          return network.address;
        }
      }
    }

    return '192.168.1.100'; // Fallback
  }

  private getPublicIP(): string {
    // You might want to fetch this from an external service
    // For now, use a placeholder that's different from local IP
    return '203.192.1.100';
  }

  private getMACAddress(): string {
    // Get actual MAC address
    const os = require('os');
    const networkInterfaces = os.networkInterfaces();

    for (const interfaceName of Object.keys(networkInterfaces)) {
      const networkInterface = networkInterfaces[interfaceName];
      for (const network of networkInterface || []) {
        if (network.family === 'IPv4' && !network.internal && network.mac !== '00:00:00:00:00:00') {
          return network.mac.toUpperCase();
        }
      }
    }

    return 'AA:BB:CC:DD:EE:FF'; // Fallback
  }


  public async getProfile(): Promise<AngelProfileResponse> {
    return this.makeRequest('/rest/secure/angelbroking/user/v1/getProfile');
  }

  public async getLTP(
    exchange: string,
    tradingSymbol: string,
    symbolToken: string
  ): Promise<any> {
    // High priority for real-time price data
    return this.makeRequest('/rest/secure/angelbroking/order/v1/getLTP', 'POST', {
      exchange,
      tradingsymbol: tradingSymbol,
      symboltoken: symbolToken
    }, 3, false); // Priority 3, no cache for real-time data
  }

  // Search for option contracts
  public async searchScrips(
    exchange: string,
    searchtext: string
  ): Promise<any> {
    try {
      logger.info(`🔍 Searching scrips: exchange=${exchange}, symbol=${searchtext}`);

          const response = await this.makeRequest('/rest/secure/angelbroking/order/v1/searchScrip', 'POST', {
        exchange,
        searchscrip: searchtext
      });

      if (response) {
        logger.info(`📋 Search response:`, {
          status: response.status,
          message: response.message,
          dataCount: response.data?.length || 0,
          errorcode: response.errorcode
        });

        if (response.data && response.data.length > 0) {
          logger.info(`✅ Found ${response.data.length} matches for "${searchtext}"`);
          // Log first few matches for debugging
          response.data.slice(0, 3).forEach((item: any, index: number) => {
            logger.info(`   ${index + 1}. ${item.tradingsymbol} (${item.symboltoken}) [${item.exchange}]`);
          });
        } else {
          logger.warn(`❌ No matches found for "${searchtext}" on ${exchange}`);
        }
      }

      return response;
    } catch (error) {
      logger.error(`searchScrips failed for "${searchtext}" on ${exchange}:`, (error as Error).message);
      throw error;
    }
  }

  // Alternative search method using master data when API fails
  public async searchScripsViaManual(
    exchange: string,
    searchtext: string
  ): Promise<any> {
    try {
      logger.info(`🔄 Fallback: Searching via master data for "${searchtext}" on ${exchange}`);

      const response = await axios.get('https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json');
      const masterData = response.data;

      // Search for matching symbols
      const matches = masterData.filter((item: any) => {
        return (
          item.exch_seg === exchange &&
          item.symbol &&
          (item.symbol.includes(searchtext) || item.name?.includes(searchtext))
        );
      });

      if (matches.length > 0) {
        logger.info(`✅ Found ${matches.length} matches via master data`);

        // Convert to Angel API response format
        const formattedResponse = {
          status: true,
          message: "SUCCESS",
          errorcode: "",
          data: matches.slice(0, 20).map((item: any) => ({
            exchange: item.exch_seg,
            tradingsymbol: item.symbol,
            symboltoken: item.token
          }))
        };

        // Log some matches
        formattedResponse.data.slice(0, 3).forEach((item: any, index: number) => {
          logger.info(`   ${index + 1}. ${item.tradingsymbol} (${item.symboltoken}) [${item.exchange}]`);
        });

        return formattedResponse;
      } else {
        logger.warn(`❌ No matches found in master data for "${searchtext}"`);
        return {
          status: false,
          message: "No matches found",
          errorcode: "NO_DATA",
          data: []
        };
      }

    } catch (error) {
      logger.error(`Master data search failed for "${searchtext}":`, (error as Error).message);
      return {
        status: false,
        message: "Search failed",
        errorcode: "SEARCH_ERROR",
        data: []
      };
    }
  }

  // Get option chain data
  public async getOptionChain(
    exchange: string,
    symbolname: string,
    strikeprice: string,
    optiontype: string
  ): Promise<any> {
    return this.makeRequest('/rest/secure/angelbroking/order/v1/optionGreeks', 'POST', {
      exchange,
      symbolname,
      strikeprice,
      optiontype
    });
  }

  // 🚀 PHASE 2 ADDITION: Enhanced Options Greeks with real-time data
  public async getOptionsGreeks(
    exchange: string,
    tradingSymbol: string,
    symbolToken: string,
    strike: number,
    optionType: 'CE' | 'PE' | undefined,
    expiry: string
  ): Promise<GreeksData | null> {
    try {
      logger.info(`📊 Fetching Greeks for ${tradingSymbol} (${symbolToken})`);

      // Method 1: Try direct Greeks API if available
      const greeksResponse = await this.makeRequest(
        '/rest/secure/angelbroking/order/v1/optionGreeks',
        'POST',
        {
          exchange,
          symbolname: tradingSymbol,
          strikeprice: strike.toString(),
          optiontype: optionType
        }
      ).catch(() => null);

      if (greeksResponse?.data) {
        const greeksData = greeksResponse.data;
        logger.info(`✅ Greeks API data received for ${tradingSymbol}`);

        return {
          delta: parseFloat(greeksData.delta || '0'),
          gamma: parseFloat(greeksData.gamma || '0'),
          theta: parseFloat(greeksData.theta || '0'),
          vega: parseFloat(greeksData.vega || '0'),
          impliedVolatility: parseFloat(greeksData.iv || '0'),
          intrinsicValue: parseFloat(greeksData.intrinsicvalue || '0'),
          timeValue: parseFloat(greeksData.timevalue || '0'),
          lastUpdated: new Date(),
          confidence: 95 // High confidence for API data
        };
      }

      // Method 2: Estimate Greeks from option price and underlying price
      logger.info(`📊 Estimating Greeks for ${tradingSymbol} (API unavailable)`);
      const estimatedGreeks = await this.estimateOptionsGreeks(
        exchange,
        tradingSymbol,
        symbolToken,
        strike,
        optionType,
        expiry
      );

      return estimatedGreeks;

    } catch (error) {
      logger.error(`Failed to get Greeks for ${tradingSymbol}:`, (error as Error).message);
      return null;
    }
  }

  // Estimate Options Greeks when API data is unavailable
  private async estimateOptionsGreeks(
    exchange: string,
    tradingSymbol: string,
    symbolToken: string,
    strike: number,
    optionType: 'CE' | 'PE' | undefined,
    expiry: string
  ): Promise<GreeksData | null> {
    try {
      // Get current option price
      const optionPrice = await this.getOptionPrice(tradingSymbol, symbolToken);
      if (!optionPrice) return null;

      // Get underlying price (NIFTY or BANKNIFTY)
      const underlyingPrice = await this.getUnderlyingPrice(tradingSymbol);
      if (!underlyingPrice) return null;

      // Calculate days to expiry
      const daysToExpiry = this.calculateDaysToExpiry(expiry);
      const timeToExpiry = daysToExpiry / 365; // Years

      // Estimate Greeks using simplified Black-Scholes approximations
      const isCall = optionType === 'CE';
      const moneyness = underlyingPrice / strike;

      // Simplified Delta estimation
      let delta = 0;
      if (isCall) {
        delta = moneyness > 1 ? 0.7 : moneyness > 0.95 ? 0.5 : 0.3;
      } else {
        delta = moneyness < 1 ? -0.7 : moneyness < 1.05 ? -0.5 : -0.3;
      }

      // Simplified Gamma estimation (highest for ATM options)
      const gamma = Math.max(0, 0.02 * (1 - Math.abs(moneyness - 1) * 2));

      // Simplified Theta estimation (time decay)
      const theta = -optionPrice / (daysToExpiry || 1) * 0.3; // Rough daily decay

      // Simplified Vega estimation
      const vega = optionPrice * Math.sqrt(timeToExpiry) * 0.1;

      // Estimate IV based on option premium
      const intrinsicValue = Math.max(0, isCall ? underlyingPrice - strike : strike - underlyingPrice);
      const timeValue = Math.max(0, optionPrice - intrinsicValue);
      const impliedVolatility = timeValue > 0 ? (timeValue / underlyingPrice) * 100 : 15; // Default to 15%

      logger.info(`📊 Estimated Greeks for ${tradingSymbol}: Delta=${delta.toFixed(3)}, Gamma=${gamma.toFixed(3)}, Theta=${theta.toFixed(2)}, IV=${impliedVolatility.toFixed(1)}%`);

      return {
        delta,
        gamma,
        theta,
        vega,
        impliedVolatility,
        intrinsicValue,
        timeValue,
        lastUpdated: new Date(),
        confidence: 70 // Lower confidence for estimated data
      };

    } catch (error) {
      logger.error(`Failed to estimate Greeks:`, (error as Error).message);
      return null;
    }
  }

  // Get underlying index price
  private async getUnderlyingPrice(optionSymbol: string): Promise<number | null> {
    try {
      const isNifty = optionSymbol.includes('NIFTY') && !optionSymbol.includes('BANK');
      const isBankNifty = optionSymbol.includes('BANKNIFTY') || optionSymbol.includes('NIFTY BANK');

      let token: string;
      if (isNifty) {
        token = config.indices.NIFTY.token;
      } else if (isBankNifty) {
        token = config.indices.BANKNIFTY.token;
      } else {
        return null;
      }

      const response = await this.getQuote('NSE', isNifty ? 'NIFTY 50' : 'NIFTY BANK', token);
      return response?.ltp ? parseFloat(response.ltp) : null;

    } catch (error) {
      logger.error('Failed to get underlying price:', (error as Error).message);
      return null;
    }
  }

  // Calculate days to expiry
  private calculateDaysToExpiry(expiry: string): number {
    try {
      // Parse expiry format DDMMMYY (e.g., "12SEP24")
      const day = parseInt(expiry.substring(0, 2));
      const month = expiry.substring(2, 5);
      const year = 2000 + parseInt(expiry.substring(5, 7));

      const monthMap: { [key: string]: number } = {
        'JAN': 0, 'FEB': 1, 'MAR': 2, 'APR': 3, 'MAY': 4, 'JUN': 5,
        'JUL': 6, 'AUG': 7, 'SEP': 8, 'OCT': 9, 'NOV': 10, 'DEC': 11
      };

      const expiryDate = new Date(year, monthMap[month], day);
      const today = new Date();
      const diffTime = expiryDate.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      return Math.max(0, diffDays);

    } catch (error) {
      logger.error('Failed to calculate days to expiry:', (error as Error).message);
      return 7; // Default to 7 days
    }
  }

  public async getOptionPrice(
    tradingSymbol: string,
    symbolToken: string
  ): Promise<number | null> {
    try {
      const response = await this.getQuote('NFO', tradingSymbol, symbolToken);

      let price = 0;
      if (response) {
        price = parseFloat(
          response.ltp ||
          response.close ||
          response.last_price ||
          response.lasttradedprice ||
          0
        );
      }

      if (price > 0) {
        logger.info(`✅ Option price: ${tradingSymbol} = ₹${price.toFixed(2)}`);
        return price;
      }

      logger.error(`❌ Could not get price for ${tradingSymbol}`);
      return null;

    } catch (error) {
      logger.error(`Failed to get option price for ${tradingSymbol}:`, (error as Error).message);
      return null;
    }
  }

  public async getOptionToken(
    indexName: string,
    strike: number,
    optionType: 'CE' | 'PE' | undefined,
    expiry: string
  ): Promise<string | null> {
    try {
      // ✅ Format expiry correctly (DDMMMYY format like 12SEP24)
      const formattedExpiry = this.formatExpiryDate(expiry);

      // ✅ Use correct symbol naming based on research
      let baseSymbol = indexName;
      if (indexName === 'BANKNIFTY') {
        baseSymbol = 'BANKNIFTY'; // Keep as BANKNIFTY for options
      } else if (indexName === 'NIFTY') {
        baseSymbol = 'NIFTY'; // Keep as NIFTY for options
      }

      // ✅ Build symbol with correct format: BASEEXPIRYSTRIKETYPE
      const symbol = `${baseSymbol}${formattedExpiry}${strike}${optionType}`;
      const exchange = 'NFO';

      logger.info(`🔍 Searching for option token: ${symbol} on ${exchange}`);

      // First try direct search with constructed symbol
      let response = await this.searchScrips(exchange, symbol).catch(async (error) => {
        logger.warn(`Primary search failed, trying fallback: ${error.message}`);
        return await this.searchScripsViaManual(exchange, symbol);
      });

      logger.info(`📋 Angel API search response:`, {
        status: response?.status,
        message: response?.message,
        dataCount: response?.data?.length || 0,
        searchSymbol: symbol
      });

      if (response?.data && response.data.length > 0) {
        // Look for exact match first
        const exactMatch = response.data.find((option: any) =>
          option.tradingsymbol === symbol
        );

        if (exactMatch) {
          logger.info(`✅ Exact token match: ${exactMatch.symboltoken} for symbol: ${exactMatch.tradingsymbol}`);
          return exactMatch.symboltoken;
        }

        // If no exact match, take first result
        const token = response.data[0].symboltoken;
        const foundSymbol = response.data[0].tradingsymbol;
        logger.info(`⚠️ Using closest match: ${token} for symbol: ${foundSymbol} (searched: ${symbol})`);
        return token;
      }

      // ✅ Enhanced fallback - try different symbol variations
      logger.warn(`❌ Direct search failed for: ${symbol}, trying variations...`);

      // Try variations of the symbol format
      const variations = [
        `${baseSymbol} ${formattedExpiry} ${strike} ${optionType}`, // With spaces
        `${baseSymbol}${formattedExpiry.replace(/(\d{2})(\w{3})(\d{2})/, '$1$2$3')}${strike}${optionType}`, // Standard format
        `${baseSymbol}${formattedExpiry.replace(/(\d{2})(\w{3})(\d{2})/, '$2$1$3')}${strike}${optionType}`, // Month first
      ];

      for (const variation of variations) {
        try {
          const varResponse = await this.searchScrips(exchange, variation).catch(async (error) => {
            logger.debug(`Variation "${variation}" search failed, trying manual: ${error.message}`);
            return await this.searchScripsViaManual(exchange, variation);
          });
          if (varResponse?.data && varResponse.data.length > 0) {
            const match = varResponse.data.find((option: any) =>
              option.tradingsymbol.includes(strike.toString()) &&
              option.tradingsymbol.includes(optionType) &&
              option.tradingsymbol.includes(baseSymbol)
            );

            if (match) {
              logger.info(`✅ Found via variation "${variation}": ${match.symboltoken} for ${match.tradingsymbol}`);
              return match.symboltoken;
            }
          }
        } catch (err) {
          logger.debug(`Variation "${variation}" failed: ${(err as Error).message}`);
        }
      }

      // ✅ Final fallback - search master data directly
      logger.info(`🔄 Trying master data file search for ${baseSymbol} options...`);
      const masterToken = await this.getOptionTokenFromMaster(baseSymbol, formattedExpiry, strike, optionType);
      if (masterToken) {
        return masterToken;
      }

      logger.error(`CRITICAL: Could not find token for option: ${symbol}`);
      logger.error(`Available expiry formats might be different. Check current expiries for ${baseSymbol}.`);
      return null;

    } catch (error) {
      logger.error(`CRITICAL: Failed to get option token for ${indexName}:`, (error as Error).message);
      return null;
    }
  }

  // Format expiry date correctly
  private formatExpiryDate(expiry: string): string {
    // Convert various formats to DDMMMYY (e.g., "12SEP24")
    if (expiry.match(/^\d{2}[A-Z]{3}\d{2}$/)) {
      return expiry; // Already in correct format
    }

    // Handle formats like "2024-09-12" or "12/09/2024"
    if (expiry.includes('-') || expiry.includes('/')) {
      const date = new Date(expiry);
      const day = date.getDate().toString().padStart(2, '0');
      const month = date.toLocaleString('default', { month: 'short' }).toUpperCase();
      const year = date.getFullYear().toString().slice(-2);
      return `${day}${month}${year}`;
    }

    // Default return as-is if format unknown
    return expiry;
  }

  // Get token from master data file
  private async getOptionTokenFromMaster(
    baseSymbol: string,
    expiry: string,
    strike: number,
    optionType: 'CE' | 'PE' | undefined
  ): Promise<string | null> {
    try {
      logger.info(`📋 Fetching master data for ${baseSymbol} options...`);

      const response = await axios.get('https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json');
      const masterData = response.data;

      // Filter for the specific option
      const options = masterData.filter((item: any) => {
        return item.exch_seg === 'NFO' &&
          item.name &&
          item.name.includes(baseSymbol) &&
          item.instrumenttype === 'OPTIDX' &&
          item.name.includes(expiry) &&
          item.name.includes(strike.toString()) &&
          item.name.includes(optionType || '');
      });

      if (options.length > 0) {
        const option = options[0];
        logger.info(`✅ Found in master data: Token=${option.token}, Name=${option.name}, Symbol=${option.symbol}`);
        return option.token;
      }

      // Try partial matching
      const partialOptions = masterData.filter((item: any) => {
        return item.exch_seg === 'NFO' &&
          item.name &&
          item.name.includes(baseSymbol) &&
          item.instrumenttype === 'OPTIDX' &&
          item.name.includes(strike.toString()) &&
          item.name.includes(optionType || '');
      });

      if (partialOptions.length > 0) {
        logger.info(`📋 Found ${partialOptions.length} partial matches in master data:`);
        partialOptions.slice(0, 5).forEach((option: any, index: number) => {
          logger.info(`   ${index + 1}. ${option.name} (Token: ${option.token})`);
        });

        // Return the first reasonable match
        const bestMatch = partialOptions.find((option: any) =>
          option.name.includes(expiry)
        ) || partialOptions[0];

        logger.info(`✅ Using best match from master: ${bestMatch.token} for ${bestMatch.name}`);
        return bestMatch.token;
      }

      logger.warn(`No options found in master data for ${baseSymbol} ${expiry} ${strike} ${optionType}`);
      return null;

    } catch (error) {
      logger.error(`Master data fetch failed:`, (error as Error).message);
      return null;
    }
  }



  // Get current expiry dates
  public async getCurrentExpiries(indexName: 'NIFTY' | 'BANKNIFTY'): Promise<string[]> {
    try {
      logger.info(`📅 Fetching current expiries for ${indexName}...`);

      const response = await axios.get('https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json');
      const masterData = response.data;

      // Filter for current options
      const options = masterData.filter((item: any) => {
        return item.exch_seg === 'NFO' &&
          item.name &&
          item.name.includes(indexName) &&
          item.instrumenttype === 'OPTIDX';
      });

      // Extract unique expiries and sort them
      const expiries = [...new Set(options.map((item: any) => {
        const match = item.name.match(/(\d{2}[A-Z]{3}\d{2})/);
        return match ? match[1] : null;
      }).filter(Boolean))].sort();

      logger.info(`📅 Available ${indexName} expiries: ${expiries.join(', ')}`);
      return expiries as string[];

    } catch (error) {
      logger.error(`Failed to get expiries for ${indexName}:`, (error as Error).message);
      // Return reasonable defaults for current month
      const currentDate = new Date();
      const currentExpiry = this.formatExpiryDate(currentDate.toISOString());
      return [currentExpiry];
    }
  }



  // Get order status and details
  public async getOrderStatus(orderId: string): Promise<any> {
    try {
      const response = await this.makeRequest(
        '/rest/secure/angelbroking/order/v1/details',
        'POST',
        { orderid: orderId }
      );
      return response;
    } catch (error) {
      logger.error(`Failed to get order status for ${orderId}:`, (error as Error).message);
      throw error;
    }
  }

  // Get order book (all orders)
  public async getOrderBook(): Promise<any> {
    try {
      const response = await this.makeRequest(
        '/rest/secure/angelbroking/order/v1/orderBook'
      );
      return response;
    } catch (error) {
      logger.error('Failed to get order book:', (error as Error).message);
      throw error;
    }
  }

  // Get trade book (executed orders)
  public async getTradeBook(): Promise<any> {
    try {
      const response = await this.makeRequest(
        '/rest/secure/angelbroking/order/v1/tradeBook'
      );
      return response;
    } catch (error) {
      logger.error('Failed to get trade book:', (error as Error).message);
      throw error;
    }
  }

  // Get account balance and available funds
  public async getFunds(): Promise<any> {
    try {
      const response = await this.makeRequest(
        '/rest/secure/angelbroking/user/v1/getRMS'
      );
      return response;
    } catch (error) {
      logger.error('Failed to get account funds:', (error as Error).message);
      throw error;
    }
  }

  // Get available margin for trading
  public async getAvailableMargin(): Promise<number> {
    try {
      const fundsResponse = await this.getFunds();

      if (fundsResponse?.data?.availablecash) {
        const availableMargin = parseFloat(fundsResponse.data.availablecash);
        logger.info(`💰 Available trading margin: ₹${availableMargin.toFixed(2)}`);
        return availableMargin;
      }

      logger.warn('Could not retrieve available margin from funds response');
      return 0;
    } catch (error) {
      logger.error('Failed to get available margin:', (error as Error).message);
      return 0;
    }
  }


  // Get candlestick data with volume
  public async getCandleData(
    exchange: string,
    symboltoken: string,
    interval: string,
    fromdate: string,
    todate: string
  ): Promise<any> {
    try {
      const response = await this.makeRequest(
        '/rest/secure/angelbroking/historical/v1/getCandleData',
        'POST',
        {
          exchange,
          symboltoken,
          interval,
          fromdate,
          todate
        }
      );
      return response;
    } catch (error) {
      logger.error('Failed to get candle data:', (error as Error).message);
      return null;
    }
  }


  // Get real-time quote with volume
  public async getQuote(
    exchange: string,
    tradingSymbol: string,
    symbolToken: string,
    mode: 'LTP' | 'OHLC' | 'FULL' = 'LTP'
  ): Promise<any> {
    try {
      const response = await this.makeRequest(
        '/rest/secure/angelbroking/market/v1/quote/',
        'POST',
        {
          mode: mode,
          exchangeTokens: {
            [exchange]: [symbolToken]
          }
        }
      );

      // Log the response for debugging
      logger.debug(`Quote API response for ${tradingSymbol}:`, response);

      // Check if data was successfully fetched
      if (response?.status === true && response?.data?.fetched?.length > 0) {
        const marketData = response.data.fetched[0];
        
        // ✅ CRITICAL FIX: Ensure LTP is extracted correctly
        const ltp = parseFloat(marketData.ltp || marketData.close || marketData.last_price || 0);
        
        logger.info(`✅ Quote data received for ${tradingSymbol}: LTP=₹${ltp} (Token: ${symbolToken})`);
        
        // Return the market data with confirmed LTP
        return {
          ...marketData,
          ltp: ltp
        };
      }

      // Check for unfetched tokens with errors
      if (response?.data?.unfetched?.length > 0) {
        logger.warn(`❌ Quote not fetched for ${tradingSymbol}:`, response.data.unfetched);
      }

      return response;
    } catch (error) {
      logger.error(`Failed to get quote for ${tradingSymbol}:`, (error as Error).message);
      return null;
    }
  }


  // Get volume data for NSE indices only (NIFTY and BANKNIFTY)
  public async getVolumeData(
    indexName: 'NIFTY' | 'BANKNIFTY'
  ): Promise<{ volume: number; avgVolume: number } | null> {
    try {
      const tokenMap = {
        'NIFTY': config.indices.NIFTY.token,
        'BANKNIFTY': config.indices.BANKNIFTY.token
      };

      const exchange = 'NSE';

      logger.debug(`Fetching volume data for ${indexName} from ${exchange} exchange`);

      // Use LTP API which includes more data than getQuote
      const response = await this.makeRequest(
        '/rest/secure/angelbroking/market/v1/quote/',
        'POST',
        {
          mode: 'FULL', // Get full market data including volume
          exchangeTokens: {
            [exchange]: [tokenMap[indexName]]
          }
        }
      );

      logger.info(`${indexName} Raw API Response:`, JSON.stringify(response, null, 2));

      if (response?.data?.fetched && response.data.fetched.length > 0) {
        const marketData = response.data.fetched[0];

        // Log all available fields for debugging
        logger.info(`${indexName} Available fields:`, Object.keys(marketData));

        // Try different volume field names for NSE
        const currentVolume = parseFloat(
          marketData.volume ||
          marketData.vol ||
          marketData.totalTradedVolume ||
          marketData.totaltradedvolume ||
          marketData.ltq || // Last Traded Quantity
          marketData.totalTradedQty ||
          '0'
        );

        logger.info(`${indexName} Volume field check: volume=${marketData.volume}, vol=${marketData.vol}, totalTradedVolume=${marketData.totalTradedVolume}, ltq=${marketData.ltq}`);
        logger.info(`${indexName} Final Volume: ${currentVolume} from ${exchange}`);

        // Get historical data for average volume calculation (last 20 days)
        const toDate = new Date().toISOString().split('T')[0];
        const fromDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const candleData = await this.getCandleData(
          exchange,
          tokenMap[indexName],
          'ONE_DAY',
          fromDate,
          toDate
        );

        let avgVolume = Math.max(1000, currentVolume); // Use reasonable fallback
        if (candleData?.data && Array.isArray(candleData.data)) {
          const volumes = candleData.data.map((candle: any) => parseFloat(candle[5] || '0'));
          if (volumes.length > 0 && volumes.some((v: any) => v > 0)) {
            avgVolume = volumes.reduce((sum: number, vol: number) => sum + vol, 0) / volumes.length;
          }
        }

        logger.info(`Volume data for ${indexName}: Current=${currentVolume}, Avg=${avgVolume.toFixed(0)}`);
        return {
          volume: currentVolume,
          avgVolume: avgVolume
        };
      }

      logger.warn(`No volume data received for ${indexName} from ${exchange}`);
      return null;
    } catch (error) {
      logger.error(`Failed to get volume data for ${indexName}:`, (error as Error).message);
      return null;
    }
  }














}

export const angelAPI = new AngelAPI();