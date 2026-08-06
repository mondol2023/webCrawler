/**
 * Consumes the media-download queue.
 *
 * All the real work (transport choice, progress, restriction handling) lives in
 * MediaDownloadService — this file only owns the queue lifecycle so a failure
 * here is obviously a queue problem, not a download problem.
 */
import { Worker, Job } from 'bullmq';
import { createBullMQConnection } from '../config/redis';
import { MEDIA_QUEUE_NAME, MediaJobPayload } from './media.queue';
import { MediaDownloadService } from '../services/media/MediaDownloadService';
import { MediaDownload } from '../models/MediaDownload.model';
import { logger } from '../utils/logger';
import { emitToUser } from '../services/socketService';

// Downloads are network-bound, so a few in parallel is fine; keep it modest so
// yt-dlp processes don't pile up.
const CONCURRENCY = 2;

export function startMediaWorker(): Worker<MediaJobPayload> {
  const service = new MediaDownloadService();

  const worker = new Worker<MediaJobPayload>(
    MEDIA_QUEUE_NAME,
    async (job: Job<MediaJobPayload>) => {
      const { downloadId, proxyUrl } = job.data;
      logger.info(`Worker processing media download: ${downloadId}`);

      await MediaDownload.findByIdAndUpdate(downloadId, { bullJobId: job.id });
      await service.run(downloadId, proxyUrl);
    },
    {
      connection: createBullMQConnection(),
      concurrency: CONCURRENCY,
    }
  );

  worker.on('failed', async (job, err) => {
    const downloadId = job?.data?.downloadId;
    logger.error(`Media download failed [${downloadId}]:`, err);
    if (!downloadId) return;

    // The service marks its own terminal states; this only catches throws that
    // escaped it (e.g. the DB went away mid-run).
    const record = await MediaDownload.findById(downloadId);
    if (!record || ['completed', 'blocked', 'cancelled'].includes(record.status)) return;

    record.status = 'failed';
    record.errorMessage = err.message.slice(0, 500);
    record.completedAt = new Date();
    await record.save();

    emitToUser(record.userId.toString(), 'media:failed', { download: record.toJSON() });
  });

  worker.on('error', (err) => {
    logger.error('Media worker error:', err);
  });

  logger.info(`✅ Media worker started (concurrency: ${CONCURRENCY})`);
  return worker;
}
