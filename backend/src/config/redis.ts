import IORedis from 'ioredis';
import { env } from './env';
import { logger } from '../utils/logger';

class RedisClient {
  private static instance: IORedis;

  static getInstance(): IORedis {
    if (!RedisClient.instance) {
      RedisClient.instance = new IORedis(env.REDIS_URL, {
        maxRetriesPerRequest: null, // Required for BullMQ
        enableReadyCheck: false,
        retryStrategy: (times: number) => {
          if (times > 10) {
            logger.error('Redis: too many retries, giving up');
            return null;
          }
          return Math.min(times * 200, 2000);
        },
      });

      RedisClient.instance.on('connect', () => logger.info('✅ Redis connected'));
      RedisClient.instance.on('error', (err) => logger.error('Redis error:', err));
      RedisClient.instance.on('reconnecting', () => logger.warn('Redis reconnecting...'));
    }

    return RedisClient.instance;
  }
}

export const redis = RedisClient.getInstance();

// Separate connection for BullMQ (must have maxRetriesPerRequest: null)
export function createBullMQConnection(): IORedis {
  return new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}
