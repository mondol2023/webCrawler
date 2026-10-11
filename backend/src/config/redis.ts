import IORedis from 'ioredis';
import type { ConnectionOptions } from 'bullmq';
import { env } from './env';
import { logger } from '../utils/logger';

class RedisClient {
  private static instance: IORedis;

  static getInstance(): IORedis {
    if (!RedisClient.instance) {
      RedisClient.instance = new IORedis(env.REDIS_URL, {
        maxRetriesPerRequest: null, // Required for BullMQ
        enableReadyCheck: false,
        // Never give up: a Redis restart should not leave the API permanently disconnected.
        retryStrategy: (times: number) => Math.min(times * 200, 5000),
      });

      RedisClient.instance.on('connect', () => logger.info('✅ Redis connected'));
      RedisClient.instance.on('error', (err) => logger.error('Redis error:', err));
      RedisClient.instance.on('reconnecting', () => logger.warn('Redis reconnecting...'));
    }

    return RedisClient.instance;
  }
}

export const redis = RedisClient.getInstance();

// Separate connection for BullMQ (must have maxRetriesPerRequest: null).
// BullMQ bundles its own copy of ioredis, so the instance types don't line up
// nominally even though they are runtime-compatible — cast in this one spot.
export function createBullMQConnection(): ConnectionOptions {
  return new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  }) as unknown as ConnectionOptions;
}
