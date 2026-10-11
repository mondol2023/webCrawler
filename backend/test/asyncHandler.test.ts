import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { asyncHandler } from '../src/utils/asyncHandler';

const req = {} as Request;
const res = {} as Response;

describe('asyncHandler', () => {
  it('forwards a rejected controller to next(err)', async () => {
    const next = vi.fn();
    asyncHandler(async () => {
      throw new Error('boom');
    })(req, res, next);
    await new Promise(setImmediate);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(next.mock.calls[0][0].message).toBe('boom');
  });

  it('does not call next when the controller resolves', async () => {
    const next = vi.fn();
    const fn = vi.fn().mockResolvedValue(undefined);
    asyncHandler(fn)(req, res, next);
    await new Promise(setImmediate);
    expect(fn).toHaveBeenCalledWith(req, res, next);
    expect(next).not.toHaveBeenCalled();
  });
});
