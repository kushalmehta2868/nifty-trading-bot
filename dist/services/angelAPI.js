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
        if (config_1.config.trading.useMockData) {
            logger_1.logger.info('Using mock data, skipping Angel authentication');
            return true;
        }
        // Validate configuration before attempting authentication
        if (!this.validateConfig()) {
            logger_1.logger.error('Angel API configuration is incomplete');
            config_1.config.trading.useMockData = true;
            return false;
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
            logger_1.logger.error('Angel authentication failed:', error.message);
            // Provide specific guidance based on error type
            if (error.message.includes('Invalid Token') ||
                error.message.includes('AG8001')) {
                logger_1.logger.error('This usually indicates:');
                logger_1.logger.error('1. Incorrect API credentials');
                logger_1.logger.error('2. Invalid TOTP secret format');
                logger_1.logger.error('3. API key not activated or expired');
                logger_1.logger.error('Please verify your credentials with Angel Broking');
            }
            logger_1.logger.warn('Falling back to mock data');
            config_1.config.trading.useMockData = true;
            return false;
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
}
exports.angelAPI = new AngelAPI();
//# sourceMappingURL=angelAPI.js.map