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

  // Get option symbol token (required for price fetching)
  public async getOptionToken(
    indexName: string,
    strike: number,
    optionType: 'CE' | 'PE' | undefined,
    expiry: string
  ): Promise<string | null> {
    try {
      const symbol = `${indexName}${expiry}${strike}${optionType}`;
      const response = await this.searchScrips('NFO', symbol);

      if (response && response.data && response.data.length > 0) {
        return response.data[0].symboltoken;
      }

      logger.warn(`Could not find token for option: ${symbol}`);
      return null;
    } catch (error) {
      logger.error(`Failed to get option token:`, (error as Error).message);
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
}

export const angelAPI = new AngelAPI();