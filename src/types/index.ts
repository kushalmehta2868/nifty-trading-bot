// Configuration Types
export interface AngelConfig {
  clientId: string;
  apiKey: string;
  apiSecret: string;
  password: string;
  totpSecret: string;
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export interface TradingConfig {
  useWebSocket: boolean;
  useMockData: boolean;
  autoTrade: boolean;
  paperTrading: boolean;
  maxPositions: number;
  signalCooldown: number;
}

export interface StrategyConfig {
  emaPeriod: number;
  rsiPeriod: number;
  confidenceThreshold: number;
  breakoutThreshold: number;
}

export interface IndexConfig {
  name: string;
  token: string;
  lotSize: number;
  basePrice: number;
  symbol?: string;
}

export interface Config {
  angel: AngelConfig;
  telegram: TelegramConfig;
  trading: TradingConfig;
  strategy: StrategyConfig;
  indices: {
    NIFTY: IndexConfig;
    BANKNIFTY: IndexConfig;
  };
}

// Angel API Types
export interface AngelTokens {
  jwtToken: string;
  feedToken: string;
  refreshToken: string;
  timestamp: number;
}

export interface AngelLoginResponse {
  status: boolean;
  message?: string;
  errorMessage?: string;
  data?: {
    jwtToken: string;
    feedToken: string;
    refreshToken: string;
  };
}

export interface AngelProfileResponse {
  status: boolean;
  data?: {
    clientcode: string;
    name: string;
    email: string;
    mobileno: string;
  };
}

// Trading Signal Types
export interface TechnicalIndicators {
  ema: number;
  rsi: number;
  priceChange: number;
  vwap?: number;
}

export interface TradingSignal {
  indexName: 'NIFTY' | 'BANKNIFTY';
  direction: 'UP' | 'DOWN';
  optionSymbol: string;
  optionType?: 'CE' | 'PE';
  entryPrice: number;
  target: number;
  stopLoss: number;
  spotPrice: number;
  confidence: number;
  timestamp: Date;
  technicals: TechnicalIndicators;
}

// Price Data Types
export interface PriceUpdate {
  price: number;
  timestamp: Date;
  source: 'WebSocket' | 'Mock' | 'API';
}

export interface PriceData {
  prices: number[];
  volumes?: number[];
  currentPrice: number;
  currentVolume?: number;
  lastUpdate: number;
}

export interface MarketData {
  NIFTY: PriceData;
  BANKNIFTY: PriceData;
}

// WebSocket Types
export interface WebSocketMessage {
  token?: string;
  ltp?: string | number;
  volume?: string | number;
  action?: number;
  mode?: number;
}

export interface SubscriptionMessage {
  action: number;
  mode: number;
  tokenList: Array<{
    exchangeType: number;
    tokens: string[];
  }>;
}

// Order Types
export interface OrderDetails {
  variety: string;
  tradingsymbol: string;
  symboltoken: string;
  transactiontype: 'BUY' | 'SELL';
  exchange: string;
  ordertype: 'MARKET' | 'LIMIT';
  producttype: string;
  duration: string;
  price: string;
  squareoff: string;
  stoploss: string;
  quantity: string;
}

export interface OrderResponse {
  status: boolean;
  message?: string;
  data?: {
    orderid: string;
  };
}

// Statistics Types
export interface TradingStats {
  signals: number;
  successful: number;
  winRate?: number;
  avgConfidence?: number;
  bestSignal?: string;
  peakTime?: string;
}

// Event Types
export type PriceSubscriber = (indexName: string, priceUpdate: PriceUpdate) => void;
export type SignalHandler = (signal: TradingSignal) => void;

// Utility Types
export type IndexName = 'NIFTY' | 'BANKNIFTY';
export type Direction = 'UP' | 'DOWN';
export type OptionType = 'CE' | 'PE';