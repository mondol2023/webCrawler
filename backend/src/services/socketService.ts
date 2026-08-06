import type { Server as SocketServer } from 'socket.io';
import { logger } from '../utils/logger';

/**
 * Thin wrapper around the Socket.io server so that any module (queue worker,
 * crawler orchestrator, controllers) can emit realtime events without importing
 * the Express app — avoiding circular dependencies and inverting the dependency
 * on the transport layer.
 */
let ioRef: SocketServer | null = null;

export function initSocket(io: SocketServer): void {
  ioRef = io;

  io.on('connection', (socket) => {
    logger.debug(`Socket connected: ${socket.id}`);

    socket.on('join:job', (jobId: string) => {
      socket.join(`job:${jobId}`);
      logger.debug(`Socket ${socket.id} joined job:${jobId}`);
    });

    socket.on('leave:job', (jobId: string) => {
      socket.leave(`job:${jobId}`);
    });

    // Media downloads are per-user rather than per-job, so clients subscribe
    // to their own room to receive progress for every download they started.
    socket.on('join:user', (userId: string) => {
      socket.join(`user:${userId}`);
      logger.debug(`Socket ${socket.id} joined user:${userId}`);
    });

    socket.on('leave:user', (userId: string) => {
      socket.leave(`user:${userId}`);
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
