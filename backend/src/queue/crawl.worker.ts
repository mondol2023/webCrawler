import { Worker, Job } from 'bullmq';
import { createBullMQConnection } from '../config/redis';
import { CRAWL_QUEUE_NAME, CrawlJobPayload } from './crawl.queue';
import { CrawlOrchestrator } from '../services/crawler/CrawlOrchestrator';
import { CrawlJob } from '../models/CrawlJob.model';
import { logger } from '../utils/logger';
import { emitToJob } from '../services/socketService';
import { isFinalAttempt } from './attempts';
import { isCrawlCancelRequested, clearCrawlCancel } from './crawlCancelFlag';

const CONCURRENCY = 3; // max parallel crawl jobs
const CANCEL_POLL_MS = 1000;

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

/**
 * Ends a crawl that the orchestrator returned from. A crawl that finished on
 * its own is only marked completed while still `running`: if a cancel request
 * landed in the meantime (status `cancelling`), the user's intent wins.
 */
export async function finalizeCrawl(
  jobId: string,
  cancelled: boolean
): Promise<'completed' | 'cancelled'> {
  if (!cancelled) {
    const done = await CrawlJob.findOneAndUpdate(
      { _id: jobId, status: 'running' },
      { status: 'completed', progress: 100, completedAt: new Date() }
    );
    if (done) return 'completed';
  }
  // Partial results and progress stay as they were when the crawl stopped.
  await CrawlJob.findByIdAndUpdate(jobId, { status: 'cancelled', completedAt: new Date() });
  return 'cancelled';
}

/**
 * Bridges the Redis cancel flag to an AbortSignal for the orchestrator. Polls
 * (checking once straight away, then every second) so a cancel stops the crawl
 * within ~1s. Call `dispose()` when the crawl ends.
 */
export function watchCancel(jobId: string): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  let checking = false;
  const check = async () => {
    if (checking || controller.signal.aborted) return;
    checking = true;
    try {
      if (await isCrawlCancelRequested(jobId)) controller.abort();
    } catch (err) {
      // A Redis blip must not kill the crawl; the next tick tries again.
      logger.warn(`Cancel poll failed for crawl ${jobId}: ${(err as Error).message}`);
    } finally {
      checking = false;
    }
  };
  void check();
  const timer = setInterval(check, CANCEL_POLL_MS);
  return { signal: controller.signal, dispose: () => clearInterval(timer) };
}

export function startCrawlWorker(): Worker<CrawlJobPayload> {
  const worker = new Worker<CrawlJobPayload>(
    CRAWL_QUEUE_NAME,
    async (job: Job<CrawlJobPayload>) => {
      const { jobId, ...options } = job.data;
      logger.info(`Worker processing crawl job: ${jobId}`);

      if (!(await claimCrawlJob(jobId, job.id, job.attemptsMade))) {
        logger.info(`Crawl worker skipping cancelled/claimed job: ${jobId}`);
        // A retry of a job the user cancelled mid-run would otherwise stay
        // `cancelling` forever: nothing is left to finish the transition.
        await CrawlJob.updateOne(
          { _id: jobId, status: 'cancelling' },
          { status: 'cancelled', completedAt: new Date() }
        );
        return;
      }

      emitToJob(jobId, 'job:started', { jobId });

      const cancel = watchCancel(jobId);
      try {
        const orchestrator = new CrawlOrchestrator();
        const outcome = await orchestrator.run({ jobId, ...options, signal: cancel.signal });

        const finalStatus = await finalizeCrawl(jobId, outcome.cancelled);
        emitToJob(jobId, finalStatus === 'cancelled' ? 'job:cancelled' : 'job:completed', { jobId });
        logger.info(`Crawl job ${finalStatus}: ${jobId}`);
      } catch (err) {
        // A throw caused by the cancel itself is still a cancel, not a failure.
        if (!cancel.signal.aborted) throw err;
        await finalizeCrawl(jobId, true);
        emitToJob(jobId, 'job:cancelled', { jobId });
        logger.info(`Crawl job cancelled: ${jobId}`);
      } finally {
        cancel.dispose();
        await clearCrawlCancel(jobId).catch(() => undefined);
      }
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