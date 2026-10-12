import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { crawlQueue } from '../queue/crawl.queue';

/** A dependency probe: resolves when the dependency answers, rejects otherwise. */
export type Probe = () => Promise<void>;
export type ReadinessProbes = Record<string, Probe>;

const PROBE_TIMEOUT_MS = 2000;

/**
 * Bounds a probe so a hung dependency fails the check instead of hanging it.
 * BullMQ's ioredis client queues commands forever while disconnected
 * (maxRetriesPerRequest: null), so an unbounded PING would never return.
 */
function withTimeout(probe: Probe, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('probe timed out')), ms);
  });
  return Promise.race([probe(), timeout]).finally(() => clearTimeout(timer));
}

export async function checkReadiness(
  probes: ReadinessProbes,
  timeoutMs = PROBE_TIMEOUT_MS
): Promise<{ ready: boolean; checks: Record<string, 'ok' | 'fail'> }> {
  const names = Object.keys(probes);
  const results = await Promise.allSettled(names.map((n) => withTimeout(probes[n], timeoutMs)));
  const checks: Record<string, 'ok' | 'fail'> = {};
  names.forEach((name, i) => {
    checks[name] = results[i].status === 'fulfilled' ? 'ok' : 'fail';
  });
  return { ready: Object.values(checks).every((c) => c === 'ok'), checks };
}

const defaultProbes: ReadinessProbes = {
  mongo: async () => {
    if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
      throw new Error('MongoDB not connected');
    }
    await mongoose.connection.db.admin().ping();
  },
  // Round-trip through the queue's own connection: that is the Redis link jobs
  // depend on. BullMQ's client interface has no PING, so read a key instead.
  redis: async () => {
    const client = await crawlQueue.client;
    await client.get('health:probe');
  },
};

/** The process is up and serving HTTP. Never touches dependencies. */
export function liveness(_req: Request, res: Response): void {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
}

/** The process can do useful work: MongoDB and Redis both answer. */
export function readinessHandler(probes: ReadinessProbes = defaultProbes) {
  return async (_req: Request, res: Response): Promise<void> => {
    const { ready, checks } = await checkReadiness(probes);
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready',
      checks,
      timestamp: new Date().toISOString(),
    });
  };
}
