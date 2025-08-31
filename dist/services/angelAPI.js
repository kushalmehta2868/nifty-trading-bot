"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.angelAPI = void 0;
const axios_1 = __importDefault(require("axios"));
const speakeasy = __importStar(require("speakeasy"));
const fs = __importStar(require("fs"));
const config_1 = require("../config/config");
const logger_1 = require("../utils/logger");
class AngelAPI {
    constructor() {
        this.baseURL = 'https://apiconnect.angelbroking.com';
        this.isAuthenticated = false;
        this._jwtToken = null;
        this._feedToken = null;
        this.refreshToken = null;
        this.tokensFile = 'angel-tokens.json';
    }
    get jwtToken() {
        return this._jwtToken;
    }
    get feedToken() {
        return this._feedToken;
    }
    generateTOTP() {
        try {
            const totp = speakeasy.totp({
                secret: config_1.config.angel.totpSecret,
                encoding: 'base32'
            });
            return totp;
        }
        catch (error) {
            logger_1.logger.error('TOTP generation failed:', error.message);
            logger_1.logger.error('TOTP Secret format might be invalid. Please verify with Angel Broking.');
            throw new Error('TOTP generation failed - check secret format');
        }
    }
    async authenticate() {
        logger_1.logger.info('Authenticating with Angel One API - Real trading mode only');
        // Validate configuration before attempting authentication
        if (!this.validateConfig()) {
            logger_1.logger.error('CRITICAL: Angel API configuration is incomplete - cannot proceed without valid credentials');
            throw new Error('Angel One API configuration required');
        }
        try {
            // Try loading existing tokens
            if (await this.loadStoredTokens()) {
                return true;
            }
            // Generate fresh session
            return await this.freshLogin();
        }
        catch (error) {
            logger_1.logger.error('CRITICAL: Angel authentication failed:', error.message);
            // Provide specific guidance based on error type
            if (error.message.includes('Invalid Token') ||
                error.message.includes('AG8001')) {
                logger_1.logger.error('Authentication failure - This usually indicates:');
                logger_1.logger.error('1. Incorrect API credentials');
                logger_1.logger.error('2. Invalid TOTP secret format');
                logger_1.logger.error('3. API key not activated or expired');
                logger_1.logger.error('Please verify your credentials with Angel Broking');
            }
            logger_1.logger.error('CRITICAL: Cannot proceed without valid Angel One authentication');
            throw error;
        }
    }
    validateConfig() {
        const required = [
            'clientId', 'apiKey', 'apiSecret', 'password', 'totpSecret'
        ];
        const missing = required.filter(key => !config_1.config.angel[key]);
        if (missing.length > 0) {
            logger_1.logger.error(`Missing Angel API configuration: ${missing.join(', ')}`);
            return false;
        }
        // Validate TOTP secret format (should be base32)
        if (config_1.config.angel.totpSecret.length < 16) {
            logger_1.logger.error('TOTP secret appears too short. Should be 32+ characters in base32 format');
            return false;
        }
        return true;
    }
    async loadStoredTokens() {
        try {
            if (!fs.existsSync(this.tokensFile)) {
                return false;
            }
            const tokens = JSON.parse(fs.readFileSync(this.tokensFile, 'utf8'));
            const age = Date.now() - tokens.timestamp;
            if (age > 20 * 60 * 60 * 1000) { // 20 hours
                return false;
            }
            this._jwtToken = tokens.jwtToken;
            this._feedToken = tokens.feedToken;
            this.refreshToken = tokens.refreshToken;
            this.isAuthenticated = true;
            logger_1.logger.info('✅ Loaded stored Angel tokens');
            return true;
        }
        catch (error) {
            return false;
        }
    }
    async freshLogin() {
        logger_1.logger.info('🔐 Performing fresh Angel login...');
        const totp = this.generateTOTP();
        logger_1.logger.info(`Generated TOTP: ${totp}`);
        try {
            const loginData = {
                clientcode: config_1.config.angel.clientId,
                password: config_1.config.angel.password,
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
                'X-PrivateKey': config_1.config.angel.apiKey
            };
            logger_1.logger.info('Attempting login with Angel SmartAPI...');
            logger_1.logger.info('Login payload:', JSON.stringify(loginData));
            const response = await axios_1.default.post(`${this.baseURL}/rest/auth/angelbroking/user/v1/loginByPassword`, loginData, { headers });
            logger_1.logger.info('Login response received:', {
                status: response.data.status,
                message: response.data.message,
                hasData: !!response.data.data
            });
            if (response.data.status && response.data.data) {
                this._jwtToken = response.data.data.jwtToken;
                this._feedToken = response.data.data.feedToken;
                this.refreshToken = response.data.data.refreshToken;
                const tokens = {
                    jwtToken: this._jwtToken,
                    feedToken: this._feedToken,
                    refreshToken: this.refreshToken,
                    timestamp: Date.now()
                };
                fs.writeFileSync(this.tokensFile, JSON.stringify(tokens, null, 2));
                this.isAuthenticated = true;
                logger_1.logger.info('✅ Fresh Angel login successful');
                logger_1.logger.info(`JWT Token: ${this._jwtToken.substring(0, 20)}...`);
                return true;
            }
            else {
                const errorMsg = response.data.message ||
                    response.data.errorMessage ||
                    'Authentication failed - no error message provided';
                logger_1.logger.error('Angel API Response:', response.data);
                throw new Error(errorMsg);
            }
        }
        catch (error) {
            if (axios_1.default.isAxiosError(error) && error.response) {
                logger_1.logger.error('Login attempt failed:', {
                    message: error.message,
                    response: error.response.data,
                    status: error.response.status
                });
            }
            else {
                logger_1.logger.error('Login attempt failed:', error.message);
            }
            throw error;
        }
    }
    async makeRequest(endpoint, method = 'GET', data = null) {
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
            'X-PrivateKey': config_1.config.angel.apiKey,
            'Authorization': `Bearer ${this._jwtToken}`
        };
        try {
            const response = await (0, axios_1.default)({
                method,
                url: `${this.baseURL}${endpoint}`,
                headers,
                data
            });
            return response.data;
        }
        catch (error) {
            if (axios_1.default.isAxiosError(error) && error.response?.status === 401) {
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
    async getProfile() {
        return this.makeRequest('/rest/secure/angelbroking/user/v1/getProfile');
    }
    async getLTP(exchange, tradingSymbol, symbolToken) {
        return this.makeRequest('/rest/secure/angelbroking/order/v1/getLTP', 'POST', {
            exchange,
            tradingSymbol,
            symbolToken
        });
    }
    // Search for option contracts
    async searchScrips(exchange, searchtext) {
        return this.makeRequest('/rest/secure/angelbroking/order/v1/searchScrip', 'POST', {
            exchange,
            searchtext
        });
    }
    // Get option chain data
    async getOptionChain(exchange, symbolname, strikeprice, optiontype) {
        return this.makeRequest('/rest/secure/angelbroking/order/v1/optionGreeks', 'POST', {
            exchange,
            symbolname,
            strikeprice,
            optiontype
        });
    }
    // Get real-time option price using symbol token
    async getOptionPrice(tradingSymbol, symbolToken) {
        try {
            const response = await this.getLTP('NFO', tradingSymbol, symbolToken);
            if (response && response.data && response.data.ltp) {
                return parseFloat(response.data.ltp);
            }
            logger_1.logger.warn(`Could not fetch option price for ${tradingSymbol}`);
            return null;
        }
        catch (error) {
            logger_1.logger.error(`Failed to get option price for ${tradingSymbol}:`, error.message);
            return null;
        }
    }
    async getOptionToken(indexName, strike, optionType, expiry) {
        try {
            const symbol = `${indexName}${expiry}${strike}${optionType}`;
            const exchange = 'NFO';
            const response = await this.searchScrips(exchange, symbol);
            if (response && response.data && response.data.length > 0) {
                return response.data[0].symboltoken;
            }
            logger_1.logger.warn(`Could not find token for option: ${symbol}`);
            return null;
        }
        catch (error) {
            logger_1.logger.error(`Failed to get option token:`, error.message);
            return null;
        }
    }
    // Get order status and details
    async getOrderStatus(orderId) {
        try {
            const response = await this.makeRequest('/rest/secure/angelbroking/order/v1/details', 'POST', { orderid: orderId });
            return response;
        }
        catch (error) {
            logger_1.logger.error(`Failed to get order status for ${orderId}:`, error.message);
            throw error;
        }
    }
    // Get order book (all orders)
    async getOrderBook() {
        try {
            const response = await this.makeRequest('/rest/secure/angelbroking/order/v1/orderBook');
            return response;
        }
        catch (error) {
            logger_1.logger.error('Failed to get order book:', error.message);
            throw error;
        }
    }
    // Get trade book (executed orders)
    async getTradeBook() {
        try {
            const response = await this.makeRequest('/rest/secure/angelbroking/order/v1/tradeBook');
            return response;
        }
        catch (error) {
            logger_1.logger.error('Failed to get trade book:', error.message);
            throw error;
        }
    }
    // Get account balance and available funds
    async getFunds() {
        try {
            const response = await this.makeRequest('/rest/secure/angelbroking/user/v1/getRMS');
            return response;
        }
        catch (error) {
            logger_1.logger.error('Failed to get account funds:', error.message);
            throw error;
        }
    }
    // Get available margin for trading
    async getAvailableMargin() {
        try {
            const fundsResponse = await this.getFunds();
            if (fundsResponse?.data?.availablecash) {
                const availableMargin = parseFloat(fundsResponse.data.availablecash);
                logger_1.logger.info(`💰 Available trading margin: ₹${availableMargin.toFixed(2)}`);
                return availableMargin;
            }
            logger_1.logger.warn('Could not retrieve available margin from funds response');
            return 0;
        }
        catch (error) {
            logger_1.logger.error('Failed to get available margin:', error.message);
            return 0;
        }
    }
    // Get market depth with volume data
    async getMarketDepth(exchange, tradingSymbol, symbolToken) {
        try {
            const response = await this.makeRequest('/rest/secure/angelbroking/order/v1/getMarketData', 'POST', {
                exchange,
                tradingsymbol: tradingSymbol,
                symboltoken: symbolToken
            });
            return response;
        }
        catch (error) {
            logger_1.logger.error(`Failed to get market depth for ${tradingSymbol}:`, error.message);
            return null;
        }
    }
    // Get candlestick data with volume
    async getCandleData(exchange, symboltoken, interval, fromdate, todate) {
        try {
            const response = await this.makeRequest('/rest/secure/angelbroking/historical/v1/getCandleData', 'POST', {
                exchange,
                symboltoken,
                interval,
                fromdate,
                todate
            });
            return response;
        }
        catch (error) {
            logger_1.logger.error('Failed to get candle data:', error.message);
            return null;
        }
    }
    // Get option Greeks and IV data
    async getOptionGreeks(exchange = 'NFO', symbolname, strikeprice, optiontype) {
        try {
            const response = await this.makeRequest('/rest/secure/angelbroking/order/v1/optionGreeks', 'POST', {
                exchange,
                symbolname,
                strikeprice,
                optiontype
            });
            return response;
        }
        catch (error) {
            logger_1.logger.error('Failed to get option Greeks:', error.message);
            return null;
        }
    }
    // Get real-time quote with volume
    async getQuote(exchange, tradingSymbol, symbolToken) {
        try {
            const response = await this.makeRequest('/rest/secure/angelbroking/order/v1/getQuote', 'POST', {
                exchange,
                tradingsymbol: tradingSymbol,
                symboltoken: symbolToken
            });
            return response;
        }
        catch (error) {
            logger_1.logger.error(`Failed to get quote for ${tradingSymbol}:`, error.message);
            return null;
        }
    }
    // Get volume data for NSE indices only (NIFTY and BANKNIFTY)
    async getVolumeData(indexName) {
        try {
            const tokenMap = {
                'NIFTY': config_1.config.indices.NIFTY.token,
                'BANKNIFTY': config_1.config.indices.BANKNIFTY.token
            };
            const exchange = 'NSE';
            logger_1.logger.debug(`Fetching volume data for ${indexName} from ${exchange} exchange`);
            // Use LTP API which includes more data than getQuote
            const response = await this.makeRequest('/rest/secure/angelbroking/market/v1/quote/', 'POST', {
                mode: 'FULL', // Get full market data including volume
                exchangeTokens: {
                    [exchange]: [tokenMap[indexName]]
                }
            });
            logger_1.logger.info(`${indexName} Raw API Response:`, JSON.stringify(response, null, 2));
            if (response?.data?.fetched && response.data.fetched.length > 0) {
                const marketData = response.data.fetched[0];
                // Log all available fields for debugging
                logger_1.logger.info(`${indexName} Available fields:`, Object.keys(marketData));
                // Try different volume field names for NSE
                const currentVolume = parseFloat(marketData.volume ||
                    marketData.vol ||
                    marketData.totalTradedVolume ||
                    marketData.totaltradedvolume ||
                    marketData.ltq || // Last Traded Quantity
                    marketData.totalTradedQty ||
                    '0');
                logger_1.logger.info(`${indexName} Volume field check: volume=${marketData.volume}, vol=${marketData.vol}, totalTradedVolume=${marketData.totalTradedVolume}, ltq=${marketData.ltq}`);
                logger_1.logger.info(`${indexName} Final Volume: ${currentVolume} from ${exchange}`);
                // Get historical data for average volume calculation (last 20 days)
                const toDate = new Date().toISOString().split('T')[0];
                const fromDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                const candleData = await this.getCandleData(exchange, tokenMap[indexName], 'ONE_DAY', fromDate, toDate);
                let avgVolume = Math.max(1000, currentVolume); // Use reasonable fallback
                if (candleData?.data && Array.isArray(candleData.data)) {
                    const volumes = candleData.data.map((candle) => parseFloat(candle[5] || '0'));
                    if (volumes.length > 0 && volumes.some((v) => v > 0)) {
                        avgVolume = volumes.reduce((sum, vol) => sum + vol, 0) / volumes.length;
                    }
                }
                logger_1.logger.info(`Volume data for ${indexName}: Current=${currentVolume}, Avg=${avgVolume.toFixed(0)}`);
                return {
                    volume: currentVolume,
                    avgVolume: avgVolume
                };
            }
            logger_1.logger.warn(`No volume data received for ${indexName} from ${exchange}`);
            return null;
        }
        catch (error) {
            logger_1.logger.error(`Failed to get volume data for ${indexName}:`, error.message);
            return null;
        }
    }
    async debugTokens() {
        logger_1.logger.info('🔍 Debug Token Information:');
        logger_1.logger.info(`JWT Token: ${this._jwtToken ? this._jwtToken.substring(0, 20) + '...' : 'NULL'}`);
        logger_1.logger.info(`Feed Token: ${this._feedToken ? this._feedToken.substring(0, 20) + '...' : 'NULL'}`);
        logger_1.logger.info(`Authentication Status: ${this.isAuthenticated}`);
        // Test with a simple profile call
        try {
            const profile = await this.getProfile();
            logger_1.logger.info('✅ API authentication working - profile retrieved');
        }
        catch (error) {
            logger_1.logger.error('❌ API authentication failed:', error.message);
        }
    }
    // Fetch NSE master data for tokens
    async getMasterData() {
        try {
            logger_1.logger.info('🔍 Fetching Angel One master data for NSE tokens...');
            const response = await axios_1.default.get('https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json');
            const masterData = response.data;
            // Find NIFTY contracts
            const niftyContracts = masterData.filter((item) => item.name && item.name.includes('NIFTY') && item.exch_seg === 'NSE' && item.symbol === 'NIFTY 50');
            const bankniftyContracts = masterData.filter((item) => item.name && item.name.includes('NIFTY') && item.exch_seg === 'NSE' && item.symbol === 'NIFTY BANK');
            logger_1.logger.info('🔍 NSE Contracts found:');
            if (niftyContracts.length > 0) {
                logger_1.logger.info(`📈 NIFTY: Token=${niftyContracts[0].token}, Symbol=${niftyContracts[0].symbol}`);
            }
            if (bankniftyContracts.length > 0) {
                logger_1.logger.info(`📈 BANKNIFTY: Token=${bankniftyContracts[0].token}, Symbol=${bankniftyContracts[0].symbol}`);
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to fetch master data:', error.message);
        }
    }
    async testTokenLTP() {
        const tokens = [
            { name: 'NIFTY', token: config_1.config.indices.NIFTY.token, exchange: 'NSE' },
            { name: 'BANKNIFTY', token: config_1.config.indices.BANKNIFTY.token, exchange: 'NSE' }
        ];
        for (const item of tokens) {
            try {
                // ✅ CORRECT API endpoint and format
                const response = await this.makeRequest('/rest/secure/angelbroking/market/v1/quote/', 'POST', {
                    mode: 'LTP',
                    exchangeTokens: {
                        [item.exchange]: [item.token]
                    }
                });
                if (response?.data?.fetched && response.data.fetched.length > 0) {
                    const ltp = response.data.fetched[0].ltp;
                    logger_1.logger.info(`✅ ${item.name}: ₹${ltp} (Token: ${item.token})`);
                }
                else if (response?.data?.unfetched && response.data.unfetched.length > 0) {
                    logger_1.logger.warn(`❌ ${item.name}: ${response.data.unfetched[0].message} (Token: ${item.token})`);
                }
                else {
                    logger_1.logger.warn(`❌ ${item.name}: No data returned (Token: ${item.token})`);
                    logger_1.logger.warn(`   Response:`, JSON.stringify(response, null, 2));
                }
            }
            catch (error) {
                logger_1.logger.error(`❌ ${item.name} LTP failed:`, error.message);
            }
        }
    }
    async getMasterTokens() {
        try {
            logger_1.logger.info('📋 Fetching Angel One NSE master contract file...');
            const response = await axios_1.default.get('https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json');
            const masterData = response.data;
            // Find NIFTY tokens
            const niftyContracts = masterData.filter((item) => item.name && item.name.includes('NIFTY') && item.exch_seg === 'NSE' && item.symbol === 'NIFTY 50');
            const bankniftyContracts = masterData.filter((item) => item.name && item.name.includes('NIFTY') && item.exch_seg === 'NSE' && item.symbol === 'NIFTY BANK');
            logger_1.logger.info('🔍 NSE Contracts found:');
            if (niftyContracts.length > 0) {
                logger_1.logger.info(`📈 NIFTY: Token=${niftyContracts[0].token}, Symbol=${niftyContracts[0].symbol}`);
            }
            if (bankniftyContracts.length > 0) {
                logger_1.logger.info(`📈 BANKNIFTY: Token=${bankniftyContracts[0].token}, Symbol=${bankniftyContracts[0].symbol}`);
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to fetch master tokens:', error.message);
        }
    }
}
exports.angelAPI = new AngelAPI();
//# sourceMappingURL=angelAPI.js.map