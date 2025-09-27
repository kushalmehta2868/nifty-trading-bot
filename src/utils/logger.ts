import winston from 'winston';
import { randomUUID } from 'crypto';

// 🚀 P1 OPTIMIZATION: Structured logging with request IDs and contextual metadata
export interface LogContext {
  requestId?: string;
  tradeId?: string;
  strategy?: string;
  symbol?: string;
  indexName?: string;
  component?: string;
  operation?: string;
  userId?: string;
  sessionId?: string;
  reason?: string;
  signal?: any;
  cooldown?: any;
  performance?: {
    duration: number;
    memory: number;
  };
  metadata?: Record<string, any>;
}

// Thread-local storage simulation for request context
class RequestContext {
  private contexts: Map<string, LogContext> = new Map();
  private currentContext: LogContext | null = null;

  public setContext(context: LogContext): void {
    this.currentContext = { ...context };
    if (context.requestId) {
      this.contexts.set(context.requestId, { ...context });
    }
  }

  public getContext(): LogContext | null {
    return this.currentContext;
  }

  public clearContext(): void {
    this.currentContext = null;
  }

  public createRequestId(): string {
    return randomUUID().substring(0, 8); // Short UUID for readability
  }
}

export const requestContext = new RequestContext();

// Enhanced timestamp format that shows IST time in logs
const istTimestamp = winston.format((info) => {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30
  const istDate = new Date(now.getTime() + istOffset);
  info.timestamp = istDate.toISOString().replace('T', ' ').substring(0, 19) + ' IST';
  return info;
});

// Custom format that includes contextual metadata
const contextualFormat = winston.format((info) => {
  const context = requestContext.getContext();
  if (context) {
    // Merge context into log info while preserving original structure
    Object.assign(info, {
      requestId: context.requestId,
      tradeId: context.tradeId,
      strategy: context.strategy,
      symbol: context.symbol,
      indexName: context.indexName,
      component: context.component,
      operation: context.operation,
      ...context.metadata
    });
  }
  return info;
});

// Enhanced logger with structured output
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    istTimestamp(),
    contextualFormat(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    // Console transport with colorized, human-readable format
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, requestId, tradeId, strategy, symbol, indexName, component, operation, ...meta }) => {
          // Build context string
          const contextParts = [];
          if (requestId) contextParts.push(`req:${requestId}`);
          if (tradeId) contextParts.push(`trade:${tradeId}`);
          if (strategy) contextParts.push(`strategy:${strategy}`);
          if (symbol) contextParts.push(`symbol:${symbol}`);
          if (indexName) contextParts.push(`index:${indexName}`);
          if (component) contextParts.push(`component:${component}`);
          if (operation) contextParts.push(`op:${operation}`);

          const contextStr = contextParts.length > 0 ? `[${contextParts.join('|')}] ` : '';

          // Filter out already displayed metadata
          const filteredMeta = { ...meta };
          delete filteredMeta.timestamp;
          delete filteredMeta.level;
          delete filteredMeta.message;
          delete filteredMeta.requestId;
          delete filteredMeta.tradeId;
          delete filteredMeta.strategy;
          delete filteredMeta.symbol;
          delete filteredMeta.indexName;
          delete filteredMeta.component;
          delete filteredMeta.operation;

          const metaStr = Object.keys(filteredMeta).length ? ` ${JSON.stringify(filteredMeta)}` : '';

          return `${timestamp} [${level}]: ${contextStr}${message}${metaStr}`;
        })
      )
    }),

    // File transport with full JSON structure for analysis
    new winston.transports.File({
      filename: 'trading-bot.log',
      format: winston.format.combine(
        winston.format.json(),
        winston.format.prettyPrint()
      )
    }),

    // Error file for critical issues
    new winston.transports.File({
      filename: 'trading-bot-errors.log',
      level: 'error',
      format: winston.format.combine(
        winston.format.json(),
        winston.format.prettyPrint()
      )
    })
  ]
});

// 🎯 CONTEXTUAL LOGGER FACTORY: Creates loggers with preset context
export const createContextualLogger = (baseContext: LogContext) => {
  return {
    info: (message: string, additionalContext?: Partial<LogContext>) => {
      requestContext.setContext({ ...baseContext, ...additionalContext });
      logger.info(message);
    },

    warn: (message: string, additionalContext?: Partial<LogContext>) => {
      requestContext.setContext({ ...baseContext, ...additionalContext });
      logger.warn(message);
    },

    error: (message: string, error?: Error, additionalContext?: Partial<LogContext>) => {
      requestContext.setContext({
        ...baseContext,
        ...additionalContext,
        metadata: {
          ...baseContext.metadata,
          ...additionalContext?.metadata,
          error: error?.message,
          stack: error?.stack
        }
      });
      logger.error(message);
    },

    debug: (message: string, additionalContext?: Partial<LogContext>) => {
      requestContext.setContext({ ...baseContext, ...additionalContext });
      logger.debug(message);
    },

    // Performance logging with automatic duration calculation
    performance: (operation: string, startTime: number, additionalContext?: Partial<LogContext>) => {
      const duration = Date.now() - startTime;
      const memoryUsage = process.memoryUsage();

      requestContext.setContext({
        ...baseContext,
        ...additionalContext,
        operation,
        performance: {
          duration,
          memory: Math.round(memoryUsage.rss / 1024 / 1024) // MB
        }
      });

      logger.info(`Performance: ${operation} completed in ${duration}ms`);
    },

    // Trading-specific logging
    trade: (action: string, signal?: any, additionalContext?: Partial<LogContext>) => {
      const tradeId = requestContext.createRequestId();

      requestContext.setContext({
        ...baseContext,
        ...additionalContext,
        tradeId,
        operation: action,
        metadata: {
          ...baseContext.metadata,
          ...additionalContext?.metadata,
          signal: signal ? {
            indexName: signal.indexName,
            direction: signal.direction,
            confidence: signal.confidence,
            optionType: signal.optionType
          } : undefined
        }
      });

      logger.info(`Trade ${action}`);
      return tradeId;
    }
  };
};

// 🚀 SPECIALIZED LOGGERS for different components
export const apiLogger = createContextualLogger({ component: 'API' });
export const strategyLogger = createContextualLogger({ component: 'STRATEGY' });
export const orderLogger = createContextualLogger({ component: 'ORDERS' });
export const riskLogger = createContextualLogger({ component: 'RISK' });
export const performanceLogger = createContextualLogger({ component: 'PERFORMANCE' });

// Utility function to create request-scoped logger
export const withRequestId = (requestId?: string) => {
  const id = requestId || requestContext.createRequestId();
  return createContextualLogger({ requestId: id });
};