import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../src/queue/crawl.queue', () => ({ crawlQueue: {} }));

import { checkReadiness, liveness, readinessHandler } from '../src/controllers/health.controller';

function stubRes() {
  const res = { statusCode: 200, body: undefined as unknown } as {
    statusCode: number;
    body: unknown;
    status: (c: number) => typeof res;
    json: (b: unknown) => typeof res;
  };
  res.status = (c) => ((res.statusCode = c), res);
  res.json = (b) => ((res.body = b), res);
  return res;
}

const ok = () => Promise.resolve();
const fail = () => Promise.reject(new Error('down'));
const hang = () => new Promise<void>(() => undefined);

describe('checkReadiness', () => {
  it('is ready when every dependency answers', async () => {
    const result = await checkReadiness({ mongo: ok, redis: ok });
    expect(result).toEqual({ ready: true, checks: { mongo: 'ok', redis: 'ok' } });
  });

  it('is not ready when a dependency rejects', async () => {
    const result = await checkReadiness({ mongo: ok, redis: fail });
    expect(result).toEqual({ ready: false, checks: { mongo: 'ok', redis: 'fail' } });
  });

  it('treats a dependency that never answers as failed', async () => {
    const result = await checkReadiness({ mongo: hang, redis: ok }, 20);
    expect(result).toEqual({ ready: false, checks: { mongo: 'fail', redis: 'ok' } });
  });
});

describe('health handlers', () => {
  it('liveness always answers 200', () => {
    const res = stubRes();
    liveness({} as Request, res as unknown as Response);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok' });
  });

  it('readiness answers 503 when a dependency is down', async () => {
    const res = stubRes();
    await readinessHandler({ mongo: fail, redis: ok })({} as Request, res as unknown as Response);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ status: 'not_ready', checks: { mongo: 'fail', redis: 'ok' } });
  });

  it('readiness answers 200 when all dependencies are up', async () => {
    const res = stubRes();
    await readinessHandler({ mongo: ok, redis: ok })({} as Request, res as unknown as Response);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ status: 'ready' });
  });
});
