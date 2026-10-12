import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import mongoose from 'mongoose';

import { env } from './config/env';
import { connectDB } from './config/db';
import { logger } from './utils/logger';
import { globalLimiter } from './middleware/rateLimit.middleware';
import { errorHandler } from './middleware/error.middleware';
import { initSocket } from './services/socketService';
import { startCrawlWorker } from './queue/crawl.worker';
import { startMediaWorker } from './queue/media.worker';
import { crawlQueue } from './queue/crawl.queue';
import { mediaQueue } from './queue/media.queue';
import { closeBrowser } from './services/crawler/PlaywrightCrawler';

// Routes
import authRoutes from './routes/auth.routes';
import crawlRoutes from './routes/crawl.routes';
import mediaRoutes from './routes/media.routes';
import adminRoutes from './routes/admin.routes';
import publicRoutes from './routes/public.routes';
import healthRoutes from './routes/health.routes';

// ─── App Setup ─────────────────────────────────────────────────────────────
const app = express();
const httpServer = createServer(app);

// ─── Socket.io ────────────────────────────────────────────────────────────
export const io = new SocketServer(httpServer, {
  cors: {
    origin: env.CLIENT_URL,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

initSocket(io);

// ─── Middleware ────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
// No endpoint takes large bodies; a small cap keeps oversized payloads out cheaply.
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(cookieParser());

// Health probes sit ahead of the rate limiter so frequent polling by a load
// balancer never eats into (or gets blocked by) the request budget.
app.use('/api/health', healthRoutes);

app.use(globalLimiter);

// ─── Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/crawl', crawlRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/public', publicRoutes);

// 404
app.use((_req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// Central error handler (last resort for anything that slips past controllers)
app.use(errorHandler);

// ─── Start ─────────────────────────────────────────────────────────────────
async function bootstrap(): Promise<void> {
  // Log stray promise rejections instead of letting Node terminate the process.
  process.on('unhandledRejection', (reason) => logger.error('Unhandled rejection:', reason));

  // Bind the port first so the API (and the Vite dev proxy) stays up even when
  // Mongo is unreachable — connectDB retries in the background.
  const port = parseInt(env.PORT, 10);
  httpServer.listen(port, () => {
    logger.info(`🚀 Server running on http://localhost:${port}`);
    logger.info(`🌍 Environment: ${env.NODE_ENV}`);
  });

  await connectDB();

  // Start the BullMQ workers that process jobs in-process. Separate queues so
  // a long media download never blocks a crawl.
  const worker = startCrawlWorker();
  const mediaWorker = startMediaWorker();

  // ─── Graceful shutdown ───────────────────────────────────────────────────
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    // A second Ctrl+C must not start a parallel teardown.
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received, shutting down gracefully...`);
    try {
      httpServer.close();
      await worker.close();
      await mediaWorker.close();
      await crawlQueue.close();
      await mediaQueue.close();
      await closeBrowser();
      await mongoose.connection.close();
    } catch (err) {
      logger.error('Error during shutdown:', err);
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  logger.error('Bootstrap failed:', err);
  process.exit(1);
});
