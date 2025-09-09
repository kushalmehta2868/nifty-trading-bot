import { logger } from './logger';
import fs from 'fs';
import path from 'path';

export class StartupReset {
  private dataFiles = [
    'angel-tokens.json',
    'trading-state.json',
    'positions.json',
    'active-orders.json',
    'daily-stats.json',
    'performance-data.json'
  ];

  private logDirs = [
    'logs'
  ];

  public async performFullReset(): Promise<void> {
    logger.info('🔄 STARTUP RESET: Performing complete system reset...');
    
    try {
      // 1. Clear data files
      await this.clearDataFiles();
      
      // 2. Clear old logs (keep today's logs)
      await this.clearOldLogs();
      
      // 3. Reset memory state
      this.resetMemoryState();
      
      // 4. Force garbage collection
      this.forceGarbageCollection();
      
      logger.info('✅ STARTUP RESET COMPLETE: System is fresh and ready');
      
    } catch (error) {
      logger.error('❌ STARTUP RESET FAILED:', (error as Error).message);
      throw error;
    }
  }

  private async clearDataFiles(): Promise<void> {
    logger.info('📂 Clearing stored data files...');
    
    for (const file of this.dataFiles) {
      try {
        const filePath = path.join(process.cwd(), file);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          logger.info(`   ✅ Deleted: ${file}`);
        } else {
          logger.debug(`   ⏭️ Not found: ${file} (already clean)`);
        }
      } catch (error) {
        logger.warn(`   ⚠️ Could not delete ${file}: ${(error as Error).message}`);
      }
    }
    
    logger.info('✅ Data files cleared');
  }

  private async clearOldLogs(): Promise<void> {
    logger.info('📋 Clearing old log files (keeping today\'s logs)...');
    
    const today = new Date().toISOString().split('T')[0];
    
    for (const logDir of this.logDirs) {
      try {
        const logPath = path.join(process.cwd(), logDir);
        
        if (fs.existsSync(logPath)) {
          const files = fs.readdirSync(logPath);
          
          for (const file of files) {
            // Keep today's logs, delete others
            if (!file.includes(today) && (file.endsWith('.log') || file.endsWith('.txt'))) {
              const filePath = path.join(logPath, file);
              fs.unlinkSync(filePath);
              logger.info(`   ✅ Deleted old log: ${file}`);
            }
          }
        }
      } catch (error) {
        logger.warn(`   ⚠️ Could not clean logs in ${logDir}: ${(error as Error).message}`);
      }
    }
    
    logger.info('✅ Old logs cleared');
  }

  private resetMemoryState(): void {
    logger.info('🧠 Resetting memory state...');
    
    // Clear environment variables that might persist state
    delete process.env.LAST_SIGNAL_TIME;
    delete process.env.ACTIVE_POSITIONS;
    delete process.env.DAILY_PNL;
    delete process.env.TRADE_COUNT;
    
    // Clear any global caches
    if ((global as any).tradingCache) {
      delete (global as any).tradingCache;
    }
    
    if ((global as any).signalCache) {
      delete (global as any).signalCache;
    }
    
    logger.info('✅ Memory state reset');
  }

  private forceGarbageCollection(): void {
    logger.info('🗑️ Forcing garbage collection...');
    
    try {
      // Force garbage collection if available
      if ((global as any).gc) {
        (global as any).gc();
        logger.info('✅ Garbage collection completed');
      } else {
        logger.debug('⏭️ Garbage collection not available (run with --expose-gc for explicit GC)');
      }
    } catch (error) {
      logger.debug(`⚠️ Garbage collection warning: ${(error as Error).message}`);
    }
  }

  public async validateFreshStart(): Promise<boolean> {
    logger.info('🔍 Validating fresh start state...');
    
    let isClean = true;
    
    // Check if critical data files exist
    for (const file of this.dataFiles.slice(0, 4)) { // Check most critical files
      const filePath = path.join(process.cwd(), file);
      if (fs.existsSync(filePath)) {
        logger.warn(`⚠️ Data file still exists: ${file}`);
        isClean = false;
      }
    }
    
    // Check memory usage
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    logger.info(`💾 Memory usage: ${heapUsedMB}MB heap used`);
    
    if (isClean) {
      logger.info('✅ Fresh start validation passed');
    } else {
      logger.warn('⚠️ Fresh start validation found residual data');
    }
    
    return isClean;
  }
}

export const startupReset = new StartupReset();