import { Queue } from 'bullmq';
import { createBullMQConnection } from '../config/redis';
import { logger } from '../utils/logger';

export interface CrawlJobPayload {
  jobId: string;
  userId: string;
  url: string;
  keywords: string[];
  phrases: string[];
  maxDepth: number;
  maxPages: number;
  respectRobotsTxt: boolean;
}

export const CRAWL_QUEUE_NAME = 'crawl-jobs';

export const crawlQueue = new Queue<CrawlJobPayload>(CRAWL_QUEUE_NAME, {
  connection: createBullMQConnection(),
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});

crawlQueue.on('error', (err) => {
  logger.error('CrawlQueue error:', err);
});

export async function addCrawlJob(payload: CrawlJobPayload): Promise<string> {
  const job = await crawlQueue.add(`crawl:${payload.jobId}`, payload, {
    jobId: payload.jobId,
  });
  logger.info(`Queued crawl job: ${job.id}`);
  return job.id!;
}

/** Drops a crawl from the queue so a cancelled job is never picked up. */
export async function removeCrawlJob(jobId: string): Promise<void> {
  const job = await crawlQueue.getJob(jobId);
  if (job) await job.remove().catch(() => undefined);
}
