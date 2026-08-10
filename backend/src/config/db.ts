import mongoose from 'mongoose';
import { env } from './env';
import { logger } from '../utils/logger';

const RETRY_DELAY_MS = 5000;

/**
 * Connects to MongoDB and keeps retrying in the background if the cluster is
 * unreachable. It deliberately never exits the process: a DB outage should not
 * take down the HTTP server, Redis, or the queue workers with it.
 */
export async function connectDB(): Promise<void> {
  mongoose.set('strictQuery', true);

  mongoose.connection.on('error', (err) => {
    logger.error('MongoDB connection error:', err);
  });

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected. Driver will attempt to reconnect...');
  });

  const attempt = async (): Promise<void> => {
    try {
      await mongoose.connect(env.MONGO_URI, {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      });
      logger.info('MongoDB connected');
    } catch (error) {
      logger.error(
        `MongoDB connection failed, retrying in ${RETRY_DELAY_MS / 1000}s:`,
        error
      );
      setTimeout(() => void attempt(), RETRY_DELAY_MS).unref();
    }
  };

  await attempt();
}