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

  public async makeRequest(
    endpoint: string,
    method: 'GET' | 'POST' = 'GET',
    data: any = null
  ): Promise<any> {
    if (!this.isAuthenticated) {
      throw new Error('Not authenticated');
    }

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-UserType': 'USER',
      'X-SourceID': 'WEB',
      'X-ClientLocalIP': '192.168.1.1',
      'X-ClientPublicIP': '192.168.1.1',
      'X-MACAddress': '00:00:00:00:00:00',
      'X-PrivateKey': config.angel.apiKey,
      'Authorization': `Bearer ${this._jwtToken}`
    };

    try {
      const response = await axios({
        method,
        url: `${this.baseURL}${endpoint}`,
        headers,
        data
      });

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        // Token expired, try to refresh
        this.isAuthenticated = false;
        if (await this.authenticate()) {
          // Retry the request
          return this.makeRequest(endpoint, method, data);
        }
      }
      throw error;
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
      tradingSymbol,
      symbolToken
    });
  }

  // Search for option contracts
  public async searchScrips(
    exchange: string,
    searchtext: string
  ): Promise<any> {
    return this.makeRequest('/rest/secure/angelbroking/order/v1/searchScrip', 'POST', {
      exchange,
      searchtext
    });
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
      const response = await this.getLTP('NFO', tradingSymbol, symbolToken);

      if (response && response.data && response.data.ltp) {
        return parseFloat(response.data.ltp);
      }

      logger.warn(`Could not fetch option price for ${tradingSymbol}`);
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
      const symbol = `${indexName}${expiry}${strike}${optionType}`;
      const exchange = 'NFO';

      logger.info(`🔍 Searching for option token: ${symbol} on ${exchange}`);
      
      const response = await this.searchScrips(exchange, symbol);
      
      // Enhanced debug logging
      logger.info(`📋 Angel API search response:`, {
        status: response?.status,
        message: response?.message,
        dataCount: response?.data?.length || 0,
        searchSymbol: symbol
      });

      if (response && response.data && response.data.length > 0) {
        const token = response.data[0].symboltoken;
        const foundSymbol = response.data[0].tradingsymbol;
        
        logger.info(`✅ Token found: ${token} for symbol: ${foundSymbol}`);
        return token;
      }

      // If exact match fails, try variations
      logger.warn(`❌ Exact match failed for: ${symbol}, trying variations...`);
      
      // Try searching with just the base part to see available options
      const baseSearch = `${indexName}${expiry}`;
      const baseResponse = await this.searchScrips(exchange, baseSearch);
      
      if (baseResponse?.data && baseResponse.data.length > 0) {
        logger.info(`📋 Available options for ${baseSearch}:`);
        baseResponse.data.slice(0, 10).forEach((option: any, index: number) => {
          logger.info(`   ${index + 1}. ${option.tradingsymbol} (Token: ${option.symboltoken})`);
        });
        
        // Try to find a match in the results
        const exactMatch = baseResponse.data.find((option: any) => 
          option.tradingsymbol === symbol
        );
        
        if (exactMatch) {
          logger.info(`✅ Found exact match in base search: ${exactMatch.symboltoken}`);
          return exactMatch.symboltoken;
        }
      }

      logger.error(`CRITICAL: Could not find token for option: ${symbol}`);
      logger.error(`Please check if the option symbol format is correct for Angel SmartAPI`);
      return null;
    } catch (error) {
      logger.error(`CRITICAL: Failed to get option token for ${indexName}:`, (error as Error).message);
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
    symbolToken: string
  ): Promise<any> {
    try {
      const response = await this.makeRequest(
        '/rest/secure/angelbroking/order/v1/getQuote',
        'POST',
        {
          exchange,
          tradingsymbol: tradingSymbol,
          symboltoken: symbolToken
        }
      );
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