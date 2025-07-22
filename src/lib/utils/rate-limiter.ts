// RPC请求限流工具
import { useAppStore } from '@/store';

class RateLimiter {
  private queue: Array<() => Promise<unknown>> = [];
  private processing = false;
  private lastRequestTime = 0;
  private minInterval: number = 125; // 最小请求间隔(毫秒) - 默认8 RPS
  private batchSize: number = 3; // 批次大小
  private delayMs: number = 150; // 批次间延迟

  constructor(rps: number = 8, batchSize: number = 3, delayMs: number = 150) {
    this.updateConfig(rps, batchSize, delayMs);
  }

  // 更新配置
  updateConfig(rps: number, batchSize: number, delayMs: number) {
    this.minInterval = 1000 / rps; // 计算最小间隔
    this.batchSize = batchSize;
    this.delayMs = delayMs;
  }

  // 从store获取配置并更新
  updateFromStore() {
    const state = useAppStore.getState();
    const config = state.config;
    this.updateConfig(
      config.rateLimit.requestsPerSecond,
      config.rateLimit.batchSize,
      config.rateLimit.delayMs
    );
  }

  // 添加请求到队列
  async execute<T>(requestFn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await requestFn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      
      this.processQueue();
    });
  }

  // 处理队列
  private async processQueue() {
    if (this.processing || this.queue.length === 0) return;
    
    this.processing = true;
    
    while (this.queue.length > 0) {
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;
      
      // 如果距离上次请求时间不足最小间隔，则等待
      if (timeSinceLastRequest < this.minInterval) {
        const waitTime = this.minInterval - timeSinceLastRequest;
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
      
      const requestFn = this.queue.shift();
      if (requestFn) {
        this.lastRequestTime = Date.now();
        await requestFn();
      }
    }
    
    this.processing = false;
  }

  // 批量执行请求，控制并发数
  async executeBatch<T>(
    requests: Array<() => Promise<T>>,
    concurrency?: number
  ): Promise<T[]> {
    const batchSize = concurrency || this.batchSize;
    const results: T[] = [];
    const chunks = this.chunkArray(requests, batchSize);
    
    for (const chunk of chunks) {
      const chunkPromises = chunk.map(requestFn => this.execute(requestFn));
      const chunkResults = await Promise.all(chunkPromises);
      results.push(...chunkResults);
      
      // 批次间延迟
      if (this.delayMs > 0 && chunks.indexOf(chunk) < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, this.delayMs));
      }
    }
    
    return results;
  }

  // 数组分块
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  // 获取当前队列长度
  getQueueLength(): number {
    return this.queue.length;
  }

  // 获取当前配置
  getConfig() {
    return {
      requestsPerSecond: Math.round(1000 / this.minInterval),
      batchSize: this.batchSize,
      delayMs: this.delayMs,
    };
  }

  // 清空队列
  clearQueue(): void {
    this.queue = [];
  }
}

// 创建全局限流器实例
export const rpcRateLimiter = new RateLimiter(8, 3, 150); // 默认免费套餐配置

// 限流装饰器
export function rateLimited<T extends unknown[], R>(
  target: (...args: T) => Promise<R>
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    // 每次执行前更新配置
    rpcRateLimiter.updateFromStore();
    return rpcRateLimiter.execute(() => target(...args));
  };
}

// 批量RPC请求工具
export async function batchRpcRequest<T>(
  requests: Array<() => Promise<T>>,
  concurrency?: number
): Promise<T[]> {
  // 执行前更新配置
  rpcRateLimiter.updateFromStore();
  return rpcRateLimiter.executeBatch(requests, concurrency);
}

// 延迟函数
export const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms)); 