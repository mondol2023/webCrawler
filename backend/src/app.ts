import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';

import { env } from './config/env';
import { connectDB } from './config/db';
import { logger } from './utils/logger';
import { globalLimiter } from './middleware/rateLimit.middleware';

// Routes
import authRoutes from './routes/auth.routes';

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

io.on('connection', (socket) => {
  logger.debug(`Socket connected: ${socket.id}`);

  socket.on('join:job', (jobId: string) => {
    socket.join(`job:${jobId}`);
    logger.debug(`Socket ${socket.id} joined job:${jobId}`);
  });

  socket.on('leave:job', (jobId: string) => {
    socket.leave(`job:${jobId}`);
  });

  socket.on('disconnect', () => {
    logger.debug(`Socket disconnected: ${socket.id}`);
  });
});

// ─── Middleware ────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(globalLimiter);

// ─── Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404
app.use((_req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// ─── Start ─────────────────────────────────────────────────────────────────
async function bootstrap(): Promise<void> {
  await connectDB();

  const port = parseInt(env.PORT, 10);
  httpServer.listen(port, () => 
    logger.info(`🚀 Server running on http://localhost:${port}`);
    logger.info(`🌍 Environment: ${env.NODE_ENV}`);
  });
}

bootstrap().catch((err) => {
  logger.error('Bootstrap failed:', err);
  process.exit(1);
});