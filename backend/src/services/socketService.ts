import type { Server as SocketServer } from 'socket.io';
import mongoose from 'mongoose';
import { parse as parseCookie } from 'cookie';
import { CrawlJob } from '../models/CrawlJob.model';
import { verifyAccessToken, type JwtPayload } from '../utils/jwt';
import { logger } from '../utils/logger';

/**
 * Thin wrapper around the Socket.io server so that any module (queue worker,
 * crawler orchestrator, controllers) can emit realtime events without importing
 * the Express app — avoiding circular dependencies and inverting the dependency
 * on the transport layer.
 */
let ioRef: SocketServer | null = null;

/**
 * Resolves the caller from the handshake: the httpOnly `accessToken` cookie the
 * browser sends with the upgrade, else an explicit `auth.token`. Returns null
 * when neither carries a valid access token.
 */
export function authenticateHandshake(
  cookieHeader: string | undefined,
  authToken: unknown
): JwtPayload | null {
  const fromCookie = cookieHeader ? parseCookie(cookieHeader).accessToken : undefined;
  const token = fromCookie || (typeof authToken === 'string' ? authToken : undefined);
  if (!token) return null;
  try {
    return verifyAccessToken(token);
  } catch {
    return null;
  }
}

export function initSocket(io: SocketServer): void {
  ioRef = io;

  io.use((socket, next) => {
    const user = authenticateHandshake(socket.handshake.headers.cookie, socket.handshake.auth?.token);
    if (!user) return next(new Error('unauthorized'));
    socket.data.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as JwtPayload;
    logger.debug(`Socket connected: ${socket.id}`);

    // Media progress is per-user; the server joins the room so a client can
    // never subscribe to someone else's. Runs on every (re)connect.
    socket.join(`user:${user.userId}`);

    socket.on('join:job', async (jobId: unknown) => {
      try {
        if (typeof jobId !== 'string' || !mongoose.isValidObjectId(jobId)) return;
        if (!(await CrawlJob.exists({ _id: jobId, userId: user.userId }))) return;
        socket.join(`job:${jobId}`);
        logger.debug(`Socket ${socket.id} joined job:${jobId}`);
      } catch (err) {
        logger.error(`join:job failed for socket ${socket.id}:`, err);
      }
    });

    socket.on('leave:job', (jobId: unknown) => {
      if (typeof jobId === 'string') socket.leave(`job:${jobId}`);
    });

    socket.on('disconnect', () => {
      logger.debug(`Socket disconnected: ${socket.id}`);
    });
  });
}

/** Emit an event to every client watching a specific job room. */
export function emitToJob(jobId: string, event: string, payload: unknown): void {
  if (!ioRef) {
    logger.warn(`emitToJob called before socket init (event: ${event})`);
    return;
  }
  ioRef.to(`job:${jobId}`).emit(event, payload);
}

/** Emit an event to every socket the given user has open (media progress). */
export function emitToUser(userId: string, event: string, payload: unknown): void {
  if (!ioRef) {
    logger.warn(`emitToUser called before socket init (event: ${event})`);
    return;
  }
  ioRef.to(`user:${userId}`).emit(event, payload);
}
