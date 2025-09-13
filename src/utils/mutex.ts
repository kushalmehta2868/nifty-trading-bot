import { logger } from './logger';

interface MutexTask<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  task: () => Promise<T>;
  timeout?: NodeJS.Timeout;
}

export class Mutex {
  private isLocked = false;
  private queue: MutexTask<any>[] = [];
  private readonly maxWaitTime: number;

  constructor(maxWaitTimeMs: number = 10000) {
    this.maxWaitTime = maxWaitTimeMs;
  }

  public async acquire<T>(task: () => Promise<T>, timeoutMs?: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const actualTimeout = timeoutMs || this.maxWaitTime;

      // Set up timeout for this task
      const timeout = setTimeout(() => {
        this.removeFromQueue(mutexTask);
        reject(new Error(`Mutex timeout after ${actualTimeout}ms`));
      }, actualTimeout);

      const mutexTask: MutexTask<T> = {
        resolve,
        reject,
        task,
        timeout
      };

      this.queue.push(mutexTask);
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.isLocked || this.queue.length === 0) {
      return;
    }

    this.isLocked = true;
    const mutexTask = this.queue.shift();

    if (!mutexTask) {
      this.isLocked = false;
      return;
    }

    try {
      // Clear the timeout since we're processing now
      if (mutexTask.timeout) {
        clearTimeout(mutexTask.timeout);
      }

      const result = await mutexTask.task();
      mutexTask.resolve(result);
    } catch (error) {
      mutexTask.reject(error as Error);
    } finally {
      this.isLocked = false;
      // Process next item in queue
      setImmediate(() => this.processQueue());
    }
  }

  private removeFromQueue(taskToRemove: MutexTask<any>): void {
    const index = this.queue.indexOf(taskToRemove);
    if (index > -1) {
      this.queue.splice(index, 1);
      if (taskToRemove.timeout) {
        clearTimeout(taskToRemove.timeout);
      }
    }
  }

  public getQueueLength(): number {
    return this.queue.length;
  }

  public isCurrentlyLocked(): boolean {
    return this.isLocked;
  }

  // Utility method for debugging
  public getStatus(): { locked: boolean; queueLength: number } {
    return {
      locked: this.isLocked,
      queueLength: this.queue.length
    };
  }
}

// Singleton mutex instances for different operations
export const signalProcessingMutex = new Mutex(15000); // 15 second timeout
export const positionManagementMutex = new Mutex(5000); // 5 second timeout
export const orderPlacementMutex = new Mutex(30000); // 30 second timeout for API calls