import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';
import { isNSETradingDay } from './holidays';

interface CleanupConfig {
  dataFiles: string[];
  logFiles: string[];
  maxLogAge: number; // days
  cleanupTime: { hour: number; minute: number }; // IST time
}

class DailyCleanup {
  private config: CleanupConfig = {
    dataFiles: [
      'angel-tokens.json'
    ],
    logFiles: [
      'bot.log',
      'trading-bot.log',
      'error.log'
    ],
    maxLogAge: 7, // Keep logs for 7 days
    cleanupTime: { hour: 5, minute: 30 } // 5:30 AM IST (before market opens)
  };
  
  private cleanupInterval: NodeJS.Timeout | null = null;
  private lastCleanupDate = '';

  public initialize(): void {
    logger.info('🧹 Daily Cleanup Manager initializing...');
    
    // Schedule cleanup to run every hour and check if it's time
    this.cleanupInterval = setInterval(() => {
      this.checkAndRunCleanup();
    }, 60 * 60 * 1000); // Every hour

    // Run initial check
    this.checkAndRunCleanup();
    
    logger.info('🧹 Daily Cleanup Manager initialized - checking hourly for 5:30 AM cleanup');
  }

  private checkAndRunCleanup(): void {
    const now = new Date();
    const istTime = this.getISTTime(now);
    const currentDate = istTime.toDateString();
    
    // Check if it's cleanup time (5:30 AM IST) and we haven't cleaned today
    const currentHour = istTime.getHours();
    const currentMinute = istTime.getMinutes();
    
    const isCleanupTime = currentHour === this.config.cleanupTime.hour && 
                         currentMinute >= this.config.cleanupTime.minute &&
                         currentMinute < this.config.cleanupTime.minute + 5; // 5-minute window
    
    if (isCleanupTime && this.lastCleanupDate !== currentDate) {
      logger.info('🧹 Daily cleanup time reached - performing cleanup...');
      this.performDailyCleanup();
      this.lastCleanupDate = currentDate;
    }
  }

  private getISTTime(date: Date): Date {
    const utcTime = date.getTime() + (date.getTimezoneOffset() * 60000);
    const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30
    return new Date(utcTime + istOffset);
  }

  public async performDailyCleanup(): Promise<void> {
    try {
      logger.info('🧹 Starting daily cleanup process...');
      
      let totalCleaned = 0;
      let totalErrors = 0;

      // 1. Clean data files (completely remove)
      for (const dataFile of this.config.dataFiles) {
        try {
          if (fs.existsSync(dataFile)) {
            const stats = fs.statSync(dataFile);
            const fileSizeKB = Math.round(stats.size / 1024);
            
            fs.unlinkSync(dataFile);
            totalCleaned++;
            
            logger.info(`🗑️ Removed data file: ${dataFile} (${fileSizeKB}KB)`);
          }
        } catch (error) {
          totalErrors++;
          logger.error(`❌ Failed to remove data file ${dataFile}:`, (error as Error).message);
        }
      }

      // 2. Clean old log files (keep recent ones)
      for (const logFile of this.config.logFiles) {
        try {
          if (fs.existsSync(logFile)) {
            const stats = fs.statSync(logFile);
            const ageInDays = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);
            const fileSizeKB = Math.round(stats.size / 1024);
            
            if (ageInDays > this.config.maxLogAge) {
              fs.unlinkSync(logFile);
              totalCleaned++;
              logger.info(`🗑️ Removed old log file: ${logFile} (${ageInDays.toFixed(1)} days old, ${fileSizeKB}KB)`);
            } else {
              // Truncate large log files to keep only recent entries
              if (fileSizeKB > 1000) { // If larger than 1MB
                await this.truncateLogFile(logFile);
                logger.info(`✂️ Truncated large log file: ${logFile} (was ${fileSizeKB}KB)`);
              }
            }
          }
        } catch (error) {
          totalErrors++;
          logger.error(`❌ Failed to process log file ${logFile}:`, (error as Error).message);
        }
      }

      // 3. Clear temporary cache directories if they exist
      const tempDirs = ['temp', 'cache', '.tmp'];
      for (const tempDir of tempDirs) {
        try {
          if (fs.existsSync(tempDir)) {
            const files = fs.readdirSync(tempDir);
            for (const file of files) {
              const filePath = path.join(tempDir, file);
              fs.unlinkSync(filePath);
            }
            if (files.length > 0) {
              totalCleaned += files.length;
              logger.info(`🗑️ Cleared ${files.length} temporary files from ${tempDir}/`);
            }
          }
        } catch (error) {
          totalErrors++;
          logger.error(`❌ Failed to clean temp directory ${tempDir}:`, (error as Error).message);
        }
      }

      // 4. Memory cleanup - force garbage collection if available
      if (global.gc) {
        const beforeMemory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
        global.gc();
        const afterMemory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
        const freedMemory = beforeMemory - afterMemory;
        
        if (freedMemory > 0) {
          logger.info(`♻️ Freed ${freedMemory}MB memory via garbage collection`);
        }
      }

      // 5. Reset strategy data for fresh start
      try {
        const { strategy } = await import('../services/strategy');
        strategy.performDailyReset();
        logger.info('✅ Strategy data reset for fresh start');
      } catch (error) {
        logger.error('Failed to reset strategy data:', (error as Error).message);
        totalErrors++;
      }

      // 6. Reset order service daily stats
      try {
        const { orderService } = await import('../services/orderService');
        orderService.resetDailyStats();
        logger.info('✅ Order service daily stats reset');
      } catch (error) {
        logger.error('Failed to reset order service stats:', (error as Error).message);
        totalErrors++;
      }

      // 7. Generate cleanup summary
      const summary = this.generateCleanupSummary(totalCleaned, totalErrors);
      logger.info('✅ Daily cleanup completed successfully');
      logger.info(summary);

      // Emit cleanup completion event
      (process as any).emit('dailyCleanupCompleted', {
        filesProcessed: totalCleaned,
        errors: totalErrors,
        timestamp: new Date()
      });

    } catch (error) {
      logger.error('🚨 Daily cleanup failed:', (error as Error).message);
      (process as any).emit('dailyCleanupFailed', {
        error: (error as Error).message,
        timestamp: new Date()
      });
    }
  }

  private async truncateLogFile(filePath: string): Promise<void> {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      
      // Keep only the last 500 lines
      if (lines.length > 500) {
        const recentLines = lines.slice(-500);
        const truncatedContent = recentLines.join('\n');
        
        fs.writeFileSync(filePath, truncatedContent);
      }
    } catch (error) {
      logger.error(`Failed to truncate log file ${filePath}:`, (error as Error).message);
    }
  }

  private generateCleanupSummary(filesProcessed: number, errors: number): string {
    const istTime = this.getISTTime(new Date());
    const timeString = istTime.toLocaleTimeString('en-IN', { 
      timeZone: 'Asia/Kolkata',
      hour12: true 
    });
    
    let summary = `🧹 Daily Cleanup Summary @ ${timeString}:\n`;
    summary += `   📁 Files processed: ${filesProcessed}\n`;
    
    if (errors > 0) {
      summary += `   ❌ Errors encountered: ${errors}\n`;
    } else {
      summary += `   ✅ No errors encountered\n`;
    }
    
    summary += `   💾 Memory freed: ${this.getMemoryUsage()}\n`;
    summary += `   🗓️ Next cleanup: Tomorrow 5:30 AM IST\n`;
    summary += `   🏛️ Fresh start ready for new trading day`;
    
    return summary;
  }

  private getMemoryUsage(): string {
    const usage = process.memoryUsage();
    const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024);
    const rssMB = Math.round(usage.rss / 1024 / 1024);
    return `${heapUsedMB}MB heap, ${rssMB}MB total`;
  }

  // Manual cleanup trigger (for testing or emergency cleanup)
  public async forceCleanup(): Promise<void> {
    logger.info('🧹 Manual cleanup triggered...');
    await this.performDailyCleanup();
  }

  // Get cleanup status
  public getCleanupStatus(): {
    lastCleanupDate: string;
    nextCleanupTime: string;
    dataFilesCount: number;
    logFilesCount: number;
    isScheduled: boolean;
  } {
    const nextCleanup = new Date();
    const istTime = this.getISTTime(nextCleanup);
    
    // If past cleanup time today, schedule for tomorrow
    if (istTime.getHours() > this.config.cleanupTime.hour || 
        (istTime.getHours() === this.config.cleanupTime.hour && istTime.getMinutes() >= this.config.cleanupTime.minute)) {
      nextCleanup.setDate(nextCleanup.getDate() + 1);
    }
    
    const nextISTTime = this.getISTTime(nextCleanup);
    nextISTTime.setHours(this.config.cleanupTime.hour, this.config.cleanupTime.minute, 0, 0);
    
    // Count existing files
    const dataFilesCount = this.config.dataFiles.filter(file => fs.existsSync(file)).length;
    const logFilesCount = this.config.logFiles.filter(file => fs.existsSync(file)).length;
    
    return {
      lastCleanupDate: this.lastCleanupDate || 'Never',
      nextCleanupTime: nextISTTime.toLocaleString('en-IN', { 
        timeZone: 'Asia/Kolkata',
        hour12: true 
      }),
      dataFilesCount,
      logFilesCount,
      isScheduled: this.cleanupInterval !== null
    };
  }

  public stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      logger.info('🧹 Daily Cleanup Manager stopped');
    }
  }
}

export const dailyCleanup = new DailyCleanup();