import { Worker, Job } from 'bullmq';
import { createBullMQConnection } from '../config/redis';
import { CRAWL_QUEUE_NAME, CrawlJobPayload } from './crawl.queue';
import { CrawlOrchestrator } from '../services/crawler/CrawlOrchestrator';
import { CrawlJob } from '../models/CrawlJob.model';
import { logger } from '../utils/logger';
import { emitToJob } from '../services/socketService';
import { isFinalAttempt } from './attempts';

const CONCURRENCY = 3; // max parallel crawl jobs

/**
 * Atomically moves a job to `running`, or returns null when it was cancelled
 * (or claimed elsewhere) after being queued. A BullMQ retry finds its own job
 * still `running` from the failed attempt, so retries may reclaim that too.
 */
export async function claimCrawlJob(jobId: string, bullJobId: string | undefined, attemptsMade: number) {
  const claimable = attemptsMade > 0 ? ['pending', 'queued', 'running'] : ['pending', 'queued'];
  return CrawlJob.findOneAndUpdate(
    { _id: jobId, status: { $in: claimable } },
    { status: 'running', startedAt: new Date(), bullJobId },
    { new: true }
  );
}

export function startCrawlWorker(): Worker<CrawlJobPayload> {
  const worker = new Worker<CrawlJobPayload>(
    CRAWL_QUEUE_NAME,
    async (job: Job<CrawlJobPayload>) => {
      const { jobId, ...options } = job.data;
      logger.info(`Worker processing crawl job: ${jobId}`);

      if (!(await claimCrawlJob(jobId, job.id, job.attemptsMade))) {
        logger.info(`Crawl worker skipping cancelled/claimed job: ${jobId}`);
        return;
      }

      emitToJob(jobId, 'job:started', { jobId });

      const orchestrator = new CrawlOrchestrator();
      await orchestrator.run({ jobId, ...options });

      // Mark as completed
      await CrawlJob.findByIdAndUpdate(jobId, {
        status: 'completed',
        progress: 100,
        completedAt: new Date(),
      });

      emitToJob(jobId, 'job:completed', { jobId });
      logger.info(`Crawl job completed: ${jobId}`);
    },
    {
      connection: createBullMQConnection(),
      concurrency: CONCURRENCY,
    }
  );

  worker.on('failed', async (job, err) => {
    // BullMQ will retry; the job is still in flight, not failed.
    if (!isFinalAttempt(job)) {
      logger.warn(`Crawl job attempt ${job?.attemptsMade} failed, will retry [${job?.data?.jobId}]: ${err.message}`);
      return;
    }
    try {
      const jobId = job?.data?.jobId;
      logger.error(`Crawl job failed [${jobId}]:`, err);

      if (jobId) {
        await CrawlJob.findByIdAndUpdate(jobId, {
          status: 'failed',
          errorMessage: err.message,
          completedAt: new Date(),
        });

        emitToJob(jobId, 'job:failed', {
          jobId,
          error: err.message,
        });
      }
    } catch (e) {
      logger.error('Crawl worker failed-handler error:', e);
    }
  });

  worker.on('error', (err) => {
    logger.error('Worker error:', err);
  });

  logger.info(`✅ Crawl worker started (concurrency: ${CONCURRENCY})`);
  return worker;
}