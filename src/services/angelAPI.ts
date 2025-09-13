import axios, { AxiosResponse } from 'axios';
import * as speakeasy from 'speakeasy';
import * as fs from 'fs';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import {
  AngelTokens,
  AngelLoginResponse,
  AngelProfileResponse
} from '../types';

class AngelAPI {
  private baseURL = 'https://apiconnect.angelbroking.com';
  private isAuthenticated = false;
  private _jwtToken: string | null = null;
  private _feedToken: string | null = null;
  private refreshToken: string | null = null;
  private tokensFile = 'angel-tokens.json';

  // Enhanced authentication management
  private authRetryQueue: Array<{resolve: Function, reject: Function}> = [];
  private isAuthenticating = false;
  private lastAuthAttempt = 0;
  private authFailureCount = 0;
  private readonly MAX_AUTH_FAILURES = 5;
  private readonly AUTH_COOLDOWN = 300000; // 5 minutes

  // Option token caching system
  private optionTokenCache = new Map<string, { token: string; expiry: number; strike: number; type: string; }>();
  private masterDataCache: any[] | null = null;
  private masterDataExpiry = 0;
  private readonly CACHE_DURATION = 4 * 60 * 60 * 1000; // 4 hours
  private readonly MASTER_DATA_DURATION = 24 * 60 * 60 * 1000; // 24 hours

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
    return new Promise((resolve, reject) => {
      this.authRetryQueue.push({resolve, reject});
      this.processAuthQueue();
    });
  }

  private async processAuthQueue(): Promise<void> {
    if (this.isAuthenticating) return;

    this.isAuthenticating = true;

    try {
      const success = await this.authenticateWithRetry();

      // Resolve all queued requests
      this.authRetryQueue.forEach(({resolve}) => resolve(success));
      this.authRetryQueue = [];

    } catch (error) {
      // Reject all queued requests
      this.authRetryQueue.forEach(({reject}) => reject(error));
      this.authRetryQueue = [];

    } finally {
      this.isAuthenticating = false;
    }
  }

  private async authenticateWithRetry(): Promise<boolean> {
    logger.info('🔐 Enhanced authentication with Angel One API starting...');

    // Check if we're in cooldown period after failures
    if (this.authFailureCount >= this.MAX_AUTH_FAILURES) {
      const timeSinceLastAttempt = Date.now() - this.lastAuthAttempt;
      if (timeSinceLastAttempt < this.AUTH_COOLDOWN) {
        const remainingCooldown = Math.ceil((this.AUTH_COOLDOWN - timeSinceLastAttempt) / 1000);
        throw new Error(`Authentication in cooldown. Try again in ${remainingCooldown} seconds`);
      } else {
        // Reset failure count after cooldown
        this.authFailureCount = 0;
        logger.info('🔄 Authentication cooldown period ended, resetting failure count');
      }
    }

    // Validate configuration before attempting authentication
    if (!this.validateConfig()) {
      logger.error('CRITICAL: Angel API configuration is incomplete');
      throw new Error('Angel One API configuration required');
    }

    try {
      // Try loading existing tokens first
      if (await this.loadStoredTokens()) {
        logger.info('✅ Using cached authentication tokens');
        this.authFailureCount = 0; // Reset on success
        return true;
      }

      // Attempt fresh login with exponential backoff
      const success = await this.freshLoginWithRetry();

      if (success) {
        this.authFailureCount = 0; // Reset on success
        logger.info('✅ Fresh authentication successful');
        return true;
      }

      throw new Error('Authentication failed after all retries');

    } catch (error) {
      this.lastAuthAttempt = Date.now();
      this.authFailureCount++;

      logger.error(`CRITICAL: Angel authentication failed (attempt ${this.authFailureCount}/${this.MAX_AUTH_FAILURES}):`, (error as Error).message);

      // Provide specific guidance based on error type
      if ((error as Error).message.includes('Invalid Token') ||
        (error as Error).message.includes('AG8001')) {
        logger.error('Authentication failure - This usually indicates:');
        logger.error('1. Incorrect API credentials');
        logger.error('2. Invalid TOTP secret format');
        logger.error('3. API key not activated or expired');
        logger.error('Please verify your credentials with Angel Broking');
      }

      if (this.authFailureCount >= this.MAX_AUTH_FAILURES) {
        logger.error(`🚨 Maximum authentication failures reached. Entering cooldown for ${this.AUTH_COOLDOWN/1000} seconds`);
      }

      throw error;
    }
  }

  private async freshLoginWithRetry(maxRetries: number = 3): Promise<boolean> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info(`🔐 Fresh login attempt ${attempt}/${maxRetries}...`);
        return await this.freshLogin();

      } catch (error) {
        const isLastAttempt = attempt === maxRetries;

        if (isLastAttempt) {
          logger.error(`❌ Fresh login failed after ${maxRetries} attempts`);
          throw error;
        }

        // Calculate exponential backoff delay
        const baseDelay = 2000; // 2 seconds
        const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), 30000); // Max 30 seconds

        logger.warn(`⏳ Fresh login attempt ${attempt} failed, retrying in ${delay}ms: ${(error as Error).message}`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    return false;
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

  public async makeRequest(
    endpoint: string,
    method: 'GET' | 'POST' = 'GET',
    data: any = null,
    retryCount: number = 0
  ): Promise<any> {
    const maxRetries = 3;

    if (!this.isAuthenticated && retryCount === 0) {
      logger.info('🔐 Not authenticated, attempting authentication...');
      await this.authenticate();
    }

    if (!this.isAuthenticated) {
      throw new Error('Authentication failed - cannot make API request');
    }

    // ✅ FIXED: Dynamic IP resolution and proper headers
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-UserType': 'USER',
      'X-SourceID': 'WEB',
      'X-ClientLocalIP': await this.getActualLocalIP(),
      'X-ClientPublicIP': await this.getActualPublicIP(),
      'X-MACAddress': this.getActualMACAddress(),
      'X-PrivateKey': config.angel.apiKey,
      'Authorization': `Bearer ${this._jwtToken}`
    };

    try {
      logger.debug(`📡 API Request: ${method} ${endpoint}`);

      const response = await axios({
        method,
        url: `${this.baseURL}${endpoint}`,
        headers,
        data,
        timeout: 30000
      });

      // ✅ FIXED: Validate response structure
      if (!response.data) {
        throw new Error('Empty response from Angel API');
      }

      // Log successful response
      logger.debug(`✅ API Response: ${endpoint} - Status: ${response.data.status}`);
      return response.data;

    } catch (error) {
      if (axios.isAxiosError(error)) {
        const statusCode = error.response?.status;
        const errorData = error.response?.data;

        logger.error('❌ API Error:', {
          endpoint,
          status: statusCode,
          statusText: error.response?.statusText,
          data: errorData,
          message: error.message
        });

        // ✅ FIXED: Enhanced error handling with automatic token refresh
        if (statusCode === 401 || (errorData && errorData.message && errorData.message.includes('Invalid Token'))) {
          logger.warn('🔐 Token expired, attempting to refresh...');
          this.isAuthenticated = false;

          if (retryCount < maxRetries) {
            logger.info(`🔄 Retrying authentication (attempt ${retryCount + 1}/${maxRetries})...`);
            await this.authenticate();
            return this.makeRequest(endpoint, method, data, retryCount + 1);
          } else {
            throw new Error(`Authentication failed after ${maxRetries} attempts`);
          }
        }

        // ✅ FIXED: Proper error propagation with Angel-specific error codes
        if (errorData && errorData.errorcode) {
          throw new Error(`Angel API Error ${errorData.errorcode}: ${errorData.message || 'Unknown error'}`);
        }
      }

      // ✅ FIXED: Retry logic for network errors
      if (retryCount < maxRetries && (error as Error).message.includes('timeout')) {
        logger.warn(`⏱️ Request timeout, retrying (${retryCount + 1}/${maxRetries})...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1))); // Progressive delay
        return this.makeRequest(endpoint, method, data, retryCount + 1);
      }

      throw error;
    }
  }

  // ✅ FIXED: Enhanced network info methods with proper async support
  private async getActualLocalIP(): Promise<string> {
    try {
      const os = require('os');
      const networkInterfaces = os.networkInterfaces();

      for (const interfaceName of Object.keys(networkInterfaces)) {
        const networkInterface = networkInterfaces[interfaceName];
        for (const network of networkInterface || []) {
          if (network.family === 'IPv4' && !network.internal && network.address !== '127.0.0.1') {
            logger.debug(`🌐 Using local IP: ${network.address} (${interfaceName})`);
            return network.address;
          }
        }
      }

      logger.warn('⚠️ No external network interface found, using fallback IP');
      return '192.168.1.100'; // Fallback
    } catch (error) {
      logger.error('Failed to get local IP:', (error as Error).message);
      return '192.168.1.100';
    }
  }

  private async getActualPublicIP(): Promise<string> {
    try {
      // ✅ FIXED: Try to get actual public IP from reliable service
      const response = await axios.get('https://api.ipify.org?format=json', {
        timeout: 5000,
        headers: { 'User-Agent': 'TradingBot/1.0' }
      });

      if (response.data && response.data.ip) {
        logger.debug(`🌐 Using public IP: ${response.data.ip}`);
        return response.data.ip;
      }

      throw new Error('Invalid response from IP service');
    } catch (error) {
      logger.warn(`⚠️ Failed to get public IP: ${(error as Error).message}, using fallback`);
      // Use local IP as fallback - Angel One may accept this
      return await this.getActualLocalIP();
    }
  }

  private getActualMACAddress(): string {
    try {
      const os = require('os');
      const networkInterfaces = os.networkInterfaces();

      for (const interfaceName of Object.keys(networkInterfaces)) {
        const networkInterface = networkInterfaces[interfaceName];
        if (!networkInterface) continue;

        for (const network of networkInterface) {
          if (network.family === 'IPv4' &&
              !network.internal &&
              network.mac &&
              network.mac !== '00:00:00:00:00:00') {
            const macAddress = network.mac.toUpperCase().replace(/:/g, ':');
            logger.debug(`🌐 Using MAC address: ${macAddress} (${interfaceName})`);
            return macAddress;
          }
        }
      }

      logger.warn('⚠️ No valid MAC address found, using fallback');
      return 'AA:BB:CC:DD:EE:FF'; // Fallback
    } catch (error) {
      logger.error('Failed to get MAC address:', (error as Error).message);
      return 'AA:BB:CC:DD:EE:FF';
    }
  }

  // ✅ ADDED: Automatic token refresh mechanism
  private async refreshTokenIfNeeded(): Promise<void> {
    if (!this._jwtToken) return;

    try {
      // Check if tokens are stored and their age
      if (fs.existsSync(this.tokensFile)) {
        const tokens = JSON.parse(fs.readFileSync(this.tokensFile, 'utf8'));
        const tokenAge = Date.now() - tokens.timestamp;
        const maxAge = 18 * 60 * 60 * 1000; // 18 hours (refresh before 24h expiry)

        if (tokenAge > maxAge) {
          logger.info('🔄 Token approaching expiry, refreshing...');
          await this.authenticate();
        }
      }
    } catch (error) {
      logger.warn('Token refresh check failed:', (error as Error).message);
    }
  }


  public async getProfile(): Promise<AngelProfileResponse> {
    return this.makeRequest('/rest/secure/angelbroking/user/v1/getProfile');
  }

  public async getLTP(
    exchange: string,
    tradingSymbol: string,
    symbolToken: string
  ): Promise<any> {
    return this.makeRequest('/rest/secure/angelbroking/order/v1/getLTP', 'POST', {
      exchange,
      tradingsymbol: tradingSymbol,
      symboltoken: symbolToken
    });
  }

  // Search for option contracts
  public async searchScrips(
    exchange: string,
    searchtext: string
  ): Promise<any> {
    try {
      logger.info(`🔍 Searching scrips: exchange=${exchange}, symbol=${searchtext}`);

      // ✅ Fixed parameter name from 'searchtext' to 'searchscrip'
      const response = await this.makeRequest('/rest/secure/angelbroking/order/v1/searchScrip', 'POST', {
        exchange,
        searchscrip: searchtext // Correct parameter name as per Angel One API docs
      });

      // ✅ Enhanced response logging
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

  // ✅ Alternative search method using master data when API fails
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

  // Get real-time option price using symbol token
  public async getOptionPrice(
    tradingSymbol: string,
    symbolToken: string
  ): Promise<number | null> {
    try {
      const response = await this.getQuote('NFO', tradingSymbol, symbolToken);
      logger.debug("Quote response for price extraction:", response);
      
      // ✅ CRITICAL FIX: Multiple fallbacks for price extraction
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
        logger.info(`✅ Option price extracted: ${tradingSymbol} = ₹${price.toFixed(2)}`);
        return price;
      }

      // Enhanced error logging
      logger.error(`❌ Could not extract valid price for ${tradingSymbol}`);
      logger.error(`Available fields in response:`, Object.keys(response || {}));
      return null;
      
    } catch (error) {
      logger.error(`Failed to get option price for ${tradingSymbol}:`, (error as Error).message);
      return null;
    }
  }

  // ✅ ENHANCED: Cached option token resolution with robust fallbacks
  public async getOptionToken(
    indexName: string,
    strike: number,
    optionType: 'CE' | 'PE' | undefined,
    expiry: string
  ): Promise<string | null> {
    try {
      // ✅ STEP 1: Check cache first
      const cacheKey = `${indexName}-${strike}-${optionType}-${expiry}`;
      const cachedToken = this.getTokenFromCache(cacheKey);

      if (cachedToken) {
        logger.info(`✅ Using cached token: ${cachedToken} for ${indexName} ${strike} ${optionType}`);
        return cachedToken;
      }

      logger.info(`🔍 Starting fresh option token lookup: ${indexName} ${strike} ${optionType} ${expiry}`);

      // ✅ STEP 2: Get current expiries with caching
      const availableExpiries = await this.getCurrentExpiriesCached(indexName as 'NIFTY' | 'BANKNIFTY');
      logger.info(`📅 Available expiries for ${indexName}: ${availableExpiries.join(', ')}`);

      // ✅ STEP 3: Use the closest available expiry if provided expiry doesn't exist
      let targetExpiry = expiry;
      if (!availableExpiries.includes(expiry)) {
        if (availableExpiries.length > 0) {
          targetExpiry = availableExpiries[0]; // Use nearest expiry
          logger.warn(`⚠️ Requested expiry ${expiry} not available, using ${targetExpiry}`);
        } else {
          logger.error(`❌ No expiries available for ${indexName}`);
          return null;
        }
      }

      // ✅ STEP 4: Try multiple resolution strategies with caching
      const strategies = [
        () => this.getOptionTokenFromMasterCached(indexName, targetExpiry, strike, optionType),
        () => this.searchMultipleOptionFormatsWithCache(indexName, strike, optionType, targetExpiry),
        () => this.findNearbyStrikeTokenCached(indexName, strike, optionType, targetExpiry)
      ];

      for (const [index, strategy] of strategies.entries()) {
        try {
          const result = await strategy();
          if (result) {
            const strategyNames = ['Master Data', 'API Search', 'Nearby Strike'];
            logger.info(`✅ Token found via ${strategyNames[index]}: ${result}`);

            // Cache the successful result
            this.cacheToken(cacheKey, result, targetExpiry, strike, optionType || 'CE');
            return result;
          }
        } catch (strategyError) {
          logger.debug(`Strategy ${index + 1} failed: ${(strategyError as Error).message}`);
        }
      }

      logger.error(`❌ CRITICAL: All token lookup strategies failed for ${indexName} ${strike} ${optionType} ${targetExpiry}`);
      return null;

    } catch (error) {
      logger.error(`❌ Option token lookup failed for ${indexName}:`, (error as Error).message);
      return null;
    }
  }

  // Cache management methods
  private getTokenFromCache(cacheKey: string): string | null {
    const cached = this.optionTokenCache.get(cacheKey);
    if (cached && Date.now() < cached.expiry) {
      return cached.token;
    }

    if (cached && Date.now() >= cached.expiry) {
      this.optionTokenCache.delete(cacheKey);
    }

    return null;
  }

  private cacheToken(cacheKey: string, token: string, expiry: string, strike: number, optionType: string): void {
    const expiryTime = Date.now() + this.CACHE_DURATION;
    this.optionTokenCache.set(cacheKey, {
      token,
      expiry: expiryTime,
      strike,
      type: optionType
    });

    logger.debug(`📦 Cached option token: ${cacheKey} -> ${token}`);
  }

  // Enhanced master data with caching
  private async getMasterDataCached(): Promise<any[]> {
    if (this.masterDataCache && Date.now() < this.masterDataExpiry) {
      logger.debug('📦 Using cached master data');
      return this.masterDataCache;
    }

    try {
      logger.info('📋 Fetching fresh master data from Angel One...');
      const response = await axios.get('https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json', {
        timeout: 30000,
        headers: {
          'User-Agent': 'TradingBot/1.0'
        }
      });

      this.masterDataCache = response.data;
      this.masterDataExpiry = Date.now() + this.MASTER_DATA_DURATION;

      logger.info(`✅ Master data cached: ${this.masterDataCache?.length || 0} instruments`);
      return this.masterDataCache || [];

    } catch (error) {
      logger.error('❌ Failed to fetch master data:', (error as Error).message);

      // Return stale cache if available
      if (this.masterDataCache) {
        logger.warn('⚠️ Using stale master data cache');
        return this.masterDataCache;
      }

      throw error;
    }
  }

  private async getCurrentExpiriesCached(indexName: 'NIFTY' | 'BANKNIFTY'): Promise<string[]> {
    try {
      const masterData = await this.getMasterDataCached();

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

      logger.info(`📅 Cached expiries for ${indexName}: ${expiries.join(', ')}`);
      return expiries as string[];

    } catch (error) {
      logger.error(`Failed to get cached expiries for ${indexName}:`, (error as Error).message);
      return await this.getCurrentExpiries(indexName); // Fallback to non-cached
    }
  }

  private async getOptionTokenFromMasterCached(
    baseSymbol: string,
    expiry: string,
    strike: number,
    optionType: 'CE' | 'PE' | undefined
  ): Promise<string | null> {
    try {
      const masterData = await this.getMasterDataCached();

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
        logger.info(`✅ Found in cached master data: Token=${option.token}, Name=${option.name}`);
        return option.token;
      }

      return null;

    } catch (error) {
      logger.error(`Cached master data search failed:`, (error as Error).message);
      return await this.getOptionTokenFromMaster(baseSymbol, expiry, strike, optionType);
    }
  }

  private async searchMultipleOptionFormatsWithCache(
    indexName: string,
    strike: number,
    optionType: 'CE' | 'PE' | undefined,
    expiry: string
  ): Promise<string | null> {
    const searchResults = await this.searchMultipleOptionFormats(indexName, strike, optionType, expiry);

    if (searchResults && searchResults.length > 0) {
      const bestMatch = this.findBestOptionMatch(searchResults, indexName, strike, optionType, expiry);
      return bestMatch?.symboltoken || null;
    }

    return null;
  }

  private async findNearbyStrikeTokenCached(
    indexName: string,
    targetStrike: number,
    optionType: 'CE' | 'PE' | undefined,
    expiry: string
  ): Promise<string | null> {
    return await this.findNearbyStrikeToken(indexName, targetStrike, optionType, expiry);
  }

  // Cache cleanup method
  public clearExpiredTokens(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, cached] of this.optionTokenCache.entries()) {
      if (now >= cached.expiry) {
        this.optionTokenCache.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.info(`🧹 Cleaned ${cleanedCount} expired option tokens from cache`);
    }
  }

  // ✅ ADDED: Search multiple option symbol formats
  private async searchMultipleOptionFormats(
    indexName: string,
    strike: number,
    optionType: 'CE' | 'PE' | undefined,
    expiry: string
  ): Promise<any[]> {
    const exchange = 'NFO';
    const allResults: any[] = [];

    // Generate multiple symbol format variations
    const symbolFormats = [
      `${indexName}${expiry}${strike}${optionType}`,           // NIFTY12SEP2425000CE
      `${indexName} ${expiry} ${strike} ${optionType}`,        // NIFTY 12SEP24 25000 CE
      `${indexName}${expiry.replace(/(\d{2})(\w{3})(\d{2})/, '$1-$2-$3')}${strike}${optionType}`, // Date variations
      `${indexName}_${expiry}_${strike}_${optionType}`,        // Underscore format
      `${indexName}${expiry}C${strike}`,                       // Simplified CE format (only for CE)
      `${indexName}${expiry}P${strike}`,                       // Simplified PE format (only for PE)
    ];

    logger.info(`🔍 Trying ${symbolFormats.length} symbol format variations...`);

    for (const symbolFormat of symbolFormats) {
      try {
        logger.debug(`   Searching: ${symbolFormat}`);

        const response = await this.searchScrips(exchange, symbolFormat).catch(async (error) => {
          // Fallback to manual search
          return await this.searchScripsViaManual(exchange, symbolFormat);
        });

        if (response?.data && Array.isArray(response.data) && response.data.length > 0) {
          logger.info(`✅ Found ${response.data.length} matches for format: ${symbolFormat}`);
          allResults.push(...response.data);
        }
      } catch (error) {
        logger.debug(`   Search failed for format ${symbolFormat}: ${(error as Error).message}`);
      }
    }

    // Remove duplicates based on symbol token
    const uniqueResults = allResults.filter((result, index, self) =>
      index === self.findIndex(r => r.symboltoken === result.symboltoken)
    );

    logger.info(`📊 Total unique options found: ${uniqueResults.length}`);
    return uniqueResults;
  }

  // ✅ ADDED: Find best matching option from search results
  private findBestOptionMatch(
    results: any[],
    indexName: string,
    strike: number,
    optionType: 'CE' | 'PE' | undefined,
    expiry: string
  ): any | null {
    if (!results || results.length === 0) return null;

    // Score each result based on match quality
    const scoredResults = results.map(result => {
      let score = 0;
      const symbol = result.tradingsymbol || result.symbol || '';

      // Perfect symbol match
      if (symbol === `${indexName}${expiry}${strike}${optionType}`) {
        score += 100;
      }

      // Component matches
      if (symbol.includes(indexName)) score += 30;
      if (symbol.includes(expiry)) score += 25;
      if (symbol.includes(strike.toString())) score += 25;
      if (symbol.includes(optionType || '')) score += 20;

      // Exchange match
      if (result.exchange === 'NFO') score += 10;

      return { ...result, matchScore: score };
    });

    // Sort by match score (highest first)
    scoredResults.sort((a, b) => b.matchScore - a.matchScore);

    const bestMatch = scoredResults[0];
    if (bestMatch && bestMatch.matchScore >= 70) { // Require minimum 70% match
      logger.info(`🎯 Best match: ${bestMatch.tradingsymbol} (Score: ${bestMatch.matchScore})`);
      return bestMatch;
    }

    logger.warn(`⚠️ No good matches found (best score: ${bestMatch?.matchScore || 0})`);
    return null;
  }

  // ✅ ADDED: Find nearby strike tokens as fallback
  private async findNearbyStrikeToken(
    indexName: string,
    targetStrike: number,
    optionType: 'CE' | 'PE' | undefined,
    expiry: string
  ): Promise<string | null> {
    const strikeInterval = indexName === 'BANKNIFTY' ? 500 : 50;
    const searchRange = 5; // Check 5 strikes above and below

    for (let i = 1; i <= searchRange; i++) {
      // Try strikes both above and below target
      const strikeAbove = targetStrike + (i * strikeInterval);
      const strikeBelow = targetStrike - (i * strikeInterval);

      for (const strike of [strikeAbove, strikeBelow]) {
        try {
          const token = await this.getOptionTokenFromMaster(indexName, expiry, strike, optionType);
          if (token) {
            logger.info(`✅ Found nearby strike: ${strike} (target was ${targetStrike})`);
            return token;
          }
        } catch (error) {
          // Continue searching
        }
      }
    }

    return null;
  }

  // ✅ Helper method to format expiry date correctly
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

  // ✅ New method to get token from master data file
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

  public async debugAngelFormats(): Promise<void> {
    try {
      logger.info('🔍 Debug: Testing Angel One option formats...');

      // ✅ Test current expiry options
      const currentDate = new Date();
      const currentExpiry = this.formatExpiryDate(currentDate.toISOString());

      logger.info(`📅 Using current expiry format: ${currentExpiry}`);

      // Test BANKNIFTY options search
      const bankNiftySearch = await this.searchScrips('NFO', 'BANKNIFTY');
      if (bankNiftySearch?.data && bankNiftySearch.data.length > 0) {
        logger.info('📋 BANKNIFTY options found via search:');
        bankNiftySearch.data.slice(0, 10).forEach((option: any, index: number) => {
          logger.info(`   ${index + 1}. ${option.tradingsymbol} (Token: ${option.symboltoken})`);
        });
      }

      // Test NIFTY options search
      const niftySearch = await this.searchScrips('NFO', 'NIFTY');
      if (niftySearch?.data && niftySearch.data.length > 0) {
        logger.info('📋 NIFTY options found via search:');
        niftySearch.data.slice(0, 10).forEach((option: any, index: number) => {
          logger.info(`   ${index + 1}. ${option.tradingsymbol} (Token: ${option.symboltoken})`);
        });
      }

      // ✅ Test master data file access
      await this.debugMasterDataOptions();

    } catch (error) {
      logger.error('Debug failed:', (error as Error).message);
    }
  }

  // ✅ New comprehensive debug method for master data
  public async debugMasterDataOptions(): Promise<void> {
    try {
      logger.info('📋 Fetching Angel One master data for option debugging...');

      const response = await axios.get('https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json');
      const masterData = response.data;

      // ✅ Find current NIFTY options
      const niftyOptions = masterData.filter((item: any) => {
        return item.exch_seg === 'NFO' &&
          item.name &&
          item.name.includes('NIFTY') &&
          item.instrumenttype === 'OPTIDX' &&
          !item.name.includes('BANK'); // Exclude BANKNIFTY
      });

      // ✅ Find current BANKNIFTY options
      const bankniftyOptions = masterData.filter((item: any) => {
        return item.exch_seg === 'NFO' &&
          item.name &&
          (item.name.includes('BANKNIFTY') || item.name.includes('NIFTY BANK')) &&
          item.instrumenttype === 'OPTIDX';
      });

      logger.info(`📊 Master Data Summary:`);
      logger.info(`   NIFTY Options: ${niftyOptions.length} contracts`);
      logger.info(`   BANKNIFTY Options: ${bankniftyOptions.length} contracts`);

      // Show sample NIFTY options
      if (niftyOptions.length > 0) {
        logger.info('📋 Sample NIFTY option formats:');
        niftyOptions.slice(0, 5).forEach((option: any, index: number) => {
          logger.info(`   ${index + 1}. Name: ${option.name} | Symbol: ${option.symbol} | Token: ${option.token}`);
        });
      }

      // Show sample BANKNIFTY options
      if (bankniftyOptions.length > 0) {
        logger.info('📋 Sample BANKNIFTY option formats:');
        bankniftyOptions.slice(0, 5).forEach((option: any, index: number) => {
          logger.info(`   ${index + 1}. Name: ${option.name} | Symbol: ${option.symbol} | Token: ${option.token}`);
        });
      }

      // ✅ Find unique expiry formats
      const niftyExpiries = [...new Set(niftyOptions.slice(0, 50).map((item: any) => {
        const match = item.name.match(/(\d{2}[A-Z]{3}\d{2})/);
        return match ? match[1] : null;
      }).filter(Boolean))];

      const bankniftyExpiries = [...new Set(bankniftyOptions.slice(0, 50).map((item: any) => {
        const match = item.name.match(/(\d{2}[A-Z]{3}\d{2})/);
        return match ? match[1] : null;
      }).filter(Boolean))];

      logger.info(`📅 Available expiry formats:`);
      logger.info(`   NIFTY: ${niftyExpiries.slice(0, 5).join(', ')}`);
      logger.info(`   BANKNIFTY: ${bankniftyExpiries.slice(0, 5).join(', ')}`);

      // ✅ Test a specific option token fetch
      if (bankniftyExpiries.length > 0 && bankniftyOptions.length > 0) {
        const testExpiry = bankniftyExpiries[0];
        logger.info(`🧪 Testing token fetch for BANKNIFTY ${testExpiry} options...`);

        // Extract strike from a real option
        const testOption = bankniftyOptions.find((opt: any) => opt.name.includes(testExpiry));
        if (testOption) {
          const strikeMatch = testOption.name.match(/(\d+)(CE|PE)/);
          if (strikeMatch) {
            const testStrike = parseInt(strikeMatch[1]);
            const testType = strikeMatch[2] as 'CE' | 'PE';

            logger.info(`🧪 Testing: BANKNIFTY ${testStrike} ${testType} ${testExpiry}`);
            const token = await this.getOptionToken('BANKNIFTY', testStrike, testType, testExpiry as string);
            logger.info(`🧪 Result: ${token ? `✅ Token: ${token}` : '❌ Failed'}`);
          }
        }
      }

    } catch (error) {
      logger.error('Master data debug failed:', (error as Error).message);
    }
  }

  // ✅ Helper method to get current and next expiry dates
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

  // ✅ Get ATM strike price for an index
  public async getATMStrike(indexName: 'NIFTY' | 'BANKNIFTY', currentPrice: number): Promise<number> {
    const roundTo = indexName === 'NIFTY' ? 50 : 500; // NIFTY rounds to 50, BANKNIFTY to 500
    return Math.round(currentPrice / roundTo) * roundTo;
  }

  // ✅ Comprehensive option token fetching with smart fallbacks
  public async getOptionTokenSmart(
    indexName: 'NIFTY' | 'BANKNIFTY',
    strike: number,
    optionType: 'CE' | 'PE',
    expiry?: string
  ): Promise<string | null> {
    try {
      // If no expiry provided, get the nearest expiry
      if (!expiry) {
        const expiries = await this.getCurrentExpiries(indexName);
        if (expiries.length === 0) {
          logger.error(`No expiries found for ${indexName}`);
          return null;
        }
        expiry = expiries[0]; // Use nearest expiry
        logger.info(`📅 Using nearest expiry: ${expiry} for ${indexName}`);
      }

      // Use the improved getOptionToken method
      return await this.getOptionToken(indexName, strike, optionType, expiry);

    } catch (error) {
      logger.error(`Smart option token fetch failed for ${indexName}:`, (error as Error).message);
      return null;
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

  // Get market depth with volume data
  public async getMarketDepth(
    exchange: string,
    tradingSymbol: string,
    symbolToken: string
  ): Promise<any> {
    try {
      const response = await this.makeRequest(
        '/rest/secure/angelbroking/order/v1/getMarketData',
        'POST',
        {
          exchange,
          tradingsymbol: tradingSymbol,
          symboltoken: symbolToken
        }
      );
      return response;
    } catch (error) {
      logger.error(`Failed to get market depth for ${tradingSymbol}:`, (error as Error).message);
      return null;
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

  // Get option Greeks and IV data
  public async getOptionGreeks(
    exchange: string = 'NFO',
    symbolname: string,
    strikeprice: string,
    optiontype: 'CE' | 'PE'
  ): Promise<any> {
    try {
      const response = await this.makeRequest(
        '/rest/secure/angelbroking/order/v1/optionGreeks',
        'POST',
        {
          exchange,
          symbolname,
          strikeprice,
          optiontype
        }
      );
      return response;
    } catch (error) {
      logger.error('Failed to get option Greeks:', (error as Error).message);
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


  public async debugTokens(): Promise<void> {
    logger.info('🔍 Debug Token Information:');
    logger.info(`JWT Token: ${this._jwtToken ? this._jwtToken.substring(0, 20) + '...' : 'NULL'}`);
    logger.info(`Feed Token: ${this._feedToken ? this._feedToken.substring(0, 20) + '...' : 'NULL'}`);
    logger.info(`Authentication Status: ${this.isAuthenticated}`);

    // Test with a simple profile call
    try {
      const profile = await this.getProfile();
      logger.info('✅ API authentication working - profile retrieved');
    } catch (error) {
      logger.error('❌ API authentication failed:', (error as Error).message);
    }
  }




  // Fetch NSE master data for tokens
  public async getMasterData(): Promise<void> {
    try {
      logger.info('🔍 Fetching Angel One master data for NSE tokens...');

      const response = await axios.get('https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json');
      const masterData = response.data;

      // Find NIFTY contracts
      const niftyContracts = masterData.filter((item: any) =>
        item.name && item.name.includes('NIFTY') && item.exch_seg === 'NSE' && item.symbol === 'NIFTY 50'
      );

      const bankniftyContracts = masterData.filter((item: any) =>
        item.name && item.name.includes('NIFTY') && item.exch_seg === 'NSE' && item.symbol === 'NIFTY BANK'
      );

      logger.info('🔍 NSE Contracts found:');

      if (niftyContracts.length > 0) {
        logger.info(`📈 NIFTY: Token=${niftyContracts[0].token}, Symbol=${niftyContracts[0].symbol}`);
      }

      if (bankniftyContracts.length > 0) {
        logger.info(`📈 BANKNIFTY: Token=${bankniftyContracts[0].token}, Symbol=${bankniftyContracts[0].symbol}`);
      }

    } catch (error) {
      logger.error('Failed to fetch master data:', (error as Error).message);
    }
  }

  public async testTokenLTP(): Promise<void> {
    const tokens = [
      { name: 'NIFTY', token: config.indices.NIFTY.token, exchange: 'NSE' },
      { name: 'BANKNIFTY', token: config.indices.BANKNIFTY.token, exchange: 'NSE' }
    ];

    for (const item of tokens) {
      try {
        // ✅ CORRECT API endpoint and format
        const response = await this.makeRequest(
          '/rest/secure/angelbroking/market/v1/quote/',
          'POST',
          {
            mode: 'LTP',
            exchangeTokens: {
              [item.exchange]: [item.token]
            }
          }
        );

        if (response?.data?.fetched && response.data.fetched.length > 0) {
          const ltp = response.data.fetched[0].ltp;
          logger.info(`✅ ${item.name}: ₹${ltp} (Token: ${item.token})`);
        } else if (response?.data?.unfetched && response.data.unfetched.length > 0) {
          logger.warn(`❌ ${item.name}: ${response.data.unfetched[0].message} (Token: ${item.token})`);
        } else {
          logger.warn(`❌ ${item.name}: No data returned (Token: ${item.token})`);
          logger.warn(`   Response:`, JSON.stringify(response, null, 2));
        }
      } catch (error) {
        logger.error(`❌ ${item.name} LTP failed:`, (error as Error).message);
      }
    }
  }



  public async getMasterTokens(): Promise<void> {
    try {
      logger.info('📋 Fetching Angel One NSE master contract file...');

      const response = await axios.get('https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json');
      const masterData = response.data;

      // Find NIFTY tokens
      const niftyContracts = masterData.filter((item: any) =>
        item.name && item.name.includes('NIFTY') && item.exch_seg === 'NSE' && item.symbol === 'NIFTY 50'
      );

      const bankniftyContracts = masterData.filter((item: any) =>
        item.name && item.name.includes('NIFTY') && item.exch_seg === 'NSE' && item.symbol === 'NIFTY BANK'
      );

      logger.info('🔍 NSE Contracts found:');

      if (niftyContracts.length > 0) {
        logger.info(`📈 NIFTY: Token=${niftyContracts[0].token}, Symbol=${niftyContracts[0].symbol}`);
      }

      if (bankniftyContracts.length > 0) {
        logger.info(`📈 BANKNIFTY: Token=${bankniftyContracts[0].token}, Symbol=${bankniftyContracts[0].symbol}`);
      }

    } catch (error) {
      logger.error('Failed to fetch master tokens:', (error as Error).message);
    }
  }

  // Debug method to find BANKNIFTY option symbol format
  public async debugBankNiftyOptions(expiry: string = '30SEP25'): Promise<void> {
    try {
      logger.info('🔍 Debugging BANKNIFTY option symbol formats...');

      const response = await axios.get('https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json');
      const masterData = response.data;

      // Find BANKNIFTY options for the specific expiry
      const bankniftyOptions = masterData.filter((item: any) => {
        return item.exch_seg === 'NFO' &&
          item.name &&
          (item.name.includes('BANKNIFTY') || item.name.includes('BANKN')) &&
          item.name.includes(expiry);
      });

      logger.info(`📋 Found ${bankniftyOptions.length} BANKNIFTY options for expiry ${expiry}:`);

      bankniftyOptions.slice(0, 20).forEach((option: any, index: number) => {
        logger.info(`   ${index + 1}. Name: ${option.name} | Symbol: ${option.symbol} | Token: ${option.token}`);
      });

      // Also try searching without specific expiry
      const allBankNiftyOptions = masterData.filter((item: any) => {
        return item.exch_seg === 'NFO' &&
          item.name &&
          (item.name.includes('BANKNIFTY') || item.name.includes('BANKN'));
      });

      logger.info(`📋 Total BANKNIFTY options in master file: ${allBankNiftyOptions.length}`);

      // Show some examples
      const uniqueFormats = [...new Set(allBankNiftyOptions.slice(0, 10).map((item: any) => item.name))];
      logger.info('📋 Sample BANKNIFTY option name formats:');
      uniqueFormats.forEach((format, index) => {
        logger.info(`   ${index + 1}. ${format}`);
      });

    } catch (error) {
      logger.error('Failed to debug BANKNIFTY options:', (error as Error).message);
    }
  }



}

export const angelAPI = new AngelAPI();