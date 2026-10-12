/**
 * Cross-process cancel flag for running crawls. The API sets it; the worker
 * running the job polls it (see watchCancel in crawl.worker). Redis rather than
 * in-memory state so it works once the worker is a separate process.
 */
import { redis } from '../config/redis';

/** Safety net so a flag for a job that never ran can't linger forever. */
const FLAG_TTL_SECONDS = 24 * 60 * 60;

const key = (jobId: string) => `crawl:cancel:${jobId}`;

export async function requestCrawlCancel(jobId: string): Promise<void> {
  await redis.set(key(jobId), '1', 'EX', FLAG_TTL_SECONDS);
}

export async function isCrawlCancelRequested(jobId: string): Promise<boolean> {
  return (await redis.exists(key(jobId))) === 1;
}

export async function clearCrawlCancel(jobId: string): Promise<void> {
  await redis.del(key(jobId));
}
