/**
 * Queue for media downloads. Kept separate from the crawl queue so a slow
 * 2 GB video can never starve the crawler (and vice versa) — separate queue,
 * separate worker, separate concurrency budget.
 */
import { Queue } from 'bullmq';
import { createBullMQConnection } from '../config/redis';
import { logger } from '../utils/logger';

export interface MediaJobPayload {
  downloadId: string;
  userId: string;
  /**
   * Raw proxy URL chosen for this download. Deliberately *not* stored on the
   * MediaDownload document — it travels with the job in Redis and is dropped
   * when the job is removed (see removeOnComplete/removeOnFail below). Only the
   * masked label is ever persisted.
   */
  proxyUrl?: string;
}

export const MEDIA_QUEUE_NAME = 'media-downloads';

export const mediaQueue = new Queue<MediaJobPayload>(MEDIA_QUEUE_NAME, {
  connection: createBullMQConnection(),
  defaultJobOptions: {
    // One retry only: a half-written file is cheap to redo, but retrying a
    // blocked/restricted URL repeatedly just annoys the origin server.
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 25 },
  },
});

mediaQueue.on('error', (err) => {
  logger.error('MediaQueue error:', err);
});

export async function addMediaJob(payload: MediaJobPayload): Promise<string> {
  const job = await mediaQueue.add(`media:${payload.downloadId}`, payload, {
    jobId: payload.downloadId,
  });
  logger.info(`Queued media download: ${job.id}`);
  return job.id!;
}

/** Removes a queued (not yet started) job so a cancel actually takes effect. */
export async function removeMediaJob(downloadId: string): Promise<void> {
  const job = await mediaQueue.getJob(downloadId);
  if (job) await job.remove().catch(() => undefined);
}
