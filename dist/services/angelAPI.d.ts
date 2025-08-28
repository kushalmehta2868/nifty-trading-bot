import { AngelProfileResponse } from '../types';
declare class AngelAPI {
    private baseURL;
    private isAuthenticated;
    private _jwtToken;
    private _feedToken;
    private refreshToken;
    private tokensFile;
    get jwtToken(): string | null;
    get feedToken(): string | null;
    private generateTOTP;
    authenticate(): Promise<boolean>;
    private validateConfig;
    private loadStoredTokens;
    private freshLogin;
    makeRequest(endpoint: string, method?: 'GET' | 'POST', data?: any): Promise<any>;
    getProfile(): Promise<AngelProfileResponse>;
    getLTP(exchange: string, tradingSymbol: string, symbolToken: string): Promise<any>;
}
export declare const angelAPI: AngelAPI;
export {};
