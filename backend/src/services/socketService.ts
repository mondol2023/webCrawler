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
