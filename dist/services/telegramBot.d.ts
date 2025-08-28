import { TradingSignal, TradingStats } from '../types';
declare class TelegramBotService {
    private bot;
    private chatId;
    private signalsToday;
    constructor();
    initialize(): Promise<void>;
    sendMessage(message: string, options?: any): Promise<void>;
    sendTradingSignal(signal: TradingSignal): Promise<void>;
    private formatTradingSignal;
    sendStartupMessage(): Promise<void>;
    sendDailySummary(stats: TradingStats): Promise<void>;
}
export declare const telegramBot: TelegramBotService;
export {};
