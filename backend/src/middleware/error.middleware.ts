import { NextFunction, Request, Response } from 'express';
import { logger } from '../utils/logger';

/** The fields http-errors (used by body-parser) sets on client errors. */
interface HttpError extends Error {
  status?: number;
  expose?: boolean;
}

/**
 * Central error handler, the last resort for anything that slips past
 * controllers. Client errors raised by middleware (oversized or malformed
 * bodies) keep their 4xx status; everything else becomes a generic 500 so
 * internals never leak to the client.
 */
export function errorHandler(
  err: HttpError,
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  // A streaming response (e.g. a file download) may already be under way;
  // let Express close the connection instead of writing a second response.
  if (res.headersSent) return next(err);

  const status = err.status;
  if (err.expose && typeof status === 'number' && status >= 400 && status < 500) {
    logger.warn(`Client error ${status}: ${err.message}`);
    res.status(status).json({ success: false, message: err.message });
    return;
  }

  logger.error('Unhandled error:', err);
  res.status(500).json({ success: false, message: 'Internal server error' });
}
