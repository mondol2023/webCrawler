import { Worker, Job } from 'bullmq';
import { createBullMQConnection } from '../config/redis';
import { CRAWL_QUEUE_NAME, CrawlJobPayload } from './crawl.queue';
import { CrawlOrchestrator } from '../services/crawler/CrawlOrchestrator';
import { CrawlJob } from '../models/CrawlJob.model';
import { logger } from '../utils/logger';
import { emitToJob } from '../services/socketService';

const CONCURRENCY = 3; // max parallel crawl jobs

export function startCrawlWorker(): Worker<CrawlJobPayload> {
  const worker = new Worker<CrawlJobPayload>(
    CRAWL_QUEUE_NAME,
    async (job: Job<CrawlJobPayload>) => {
      const { jobId, ...options } = job.data;
      logger.info(`Worker processing crawl job: ${jobId}`);

      // Mark as running
      await CrawlJob.findByIdAndUpdate(jobId, {
        status: 'running',
        startedAt: new Date(),
        bullJobId: job.id,
      });

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
  });

  worker.on('error', (err) => {
    logger.error('Worker error:', err);
  });

  logger.info(`✅ Crawl worker started (concurrency: ${CONCURRENCY})`);
  return worker;
}