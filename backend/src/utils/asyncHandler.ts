import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Express 4 ignores the promise an async handler returns, so a rejection
 * becomes an unhandled rejection instead of a 500. Wrap every async
 * controller so the error reaches the central error handler.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
