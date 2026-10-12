import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { errorHandler } from '../src/middleware/error.middleware';

function stubRes(headersSent = false) {
  const res = { statusCode: 200, body: undefined as unknown, headersSent } as {
    statusCode: number;
    body: unknown;
    headersSent: boolean;
    status: (c: number) => typeof res;
    json: (b: unknown) => typeof res;
  };
  res.status = (c) => ((res.statusCode = c), res);
  res.json = (b) => ((res.body = b), res);
  return res;
}

const req = {} as Request;

/** Shaped like the http-errors objects body-parser throws. */
function clientError(status: number, message: string) {
  return Object.assign(new Error(message), { status, expose: true });
}

describe('errorHandler', () => {
  it('passes through body-parser 413 for an oversized body', () => {
    const res = stubRes();
    errorHandler(clientError(413, 'request entity too large'), req, res as unknown as Response, vi.fn());
    expect(res.statusCode).toBe(413);
    expect(res.body).toEqual({ success: false, message: 'request entity too large' });
  });

  it('passes through 400 for malformed JSON', () => {
    const res = stubRes();
    errorHandler(clientError(400, 'Unexpected token'), req, res as unknown as Response, vi.fn());
    expect(res.statusCode).toBe(400);
  });

  it('hides unexpected errors behind a generic 500', () => {
    const res = stubRes();
    errorHandler(new Error('db password is hunter2'), req, res as unknown as Response, vi.fn());
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ success: false, message: 'Internal server error' });
  });

  it('does not expose a 5xx even when it carries a status', () => {
    const res = stubRes();
    const err = Object.assign(new Error('upstream detail'), { status: 502, expose: false });
    errorHandler(err, req, res as unknown as Response, vi.fn());
    expect(res.statusCode).toBe(500);
  });

  it('defers to Express when headers were already sent', () => {
    const res = stubRes(true);
    const next = vi.fn();
    const err = new Error('mid-stream');
    errorHandler(err, req, res as unknown as Response, next);
    expect(next).toHaveBeenCalledWith(err);
    expect(res.body).toBeUndefined();
  });
});
