/**
 * Performs one download and keeps its DB record and socket progress in sync.
 *
 * Two transports, chosen per asset:
 *   - **Direct stream** (axios) for a plain file URL — an .mp4, .mp3, .jpg. No
 *     external binary needed, and we can enforce the size cap mid-stream.
 *   - **yt-dlp** for anything with a format id or an HLS/DASH manifest, since
 *     those are playlists that must be fetched segment-by-segment and muxed.
 *
 * Every failure path writes a reason onto the record: either a `restriction`
 * (explained to the user, never circumvented) or an `errorMessage`.
 */
import axios from 'axios';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import path from 'path';
import type { Readable } from 'stream';
import { MediaDownload, type IMediaDownload } from '../../models/MediaDownload.model';
import { logger } from '../../utils/logger';
import { emitToUser } from '../socketService';
import * as ytdlp from './YtDlpAdapter';
import { proxyAgents, resolveProxy } from './proxyConfig';
import { assertPublicUrl, BlockedHostError } from './netGuard';
import { detectFromStatus } from './RestrictionDetector';
import { MAX_DOWNLOAD_BYTES, findByStem, fileSize, removeFile, safeFilename, userDir } from './storage';
import type { ProxyConfig, Restriction } from './types';

/** How often progress is written to Mongo (socket updates are more frequent). */
const DB_PROGRESS_INTERVAL_MS = 1_500;

const EXT_BY_MIME: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/flac': 'flac',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

export class MediaDownloadService {
  /**
   * Runs the download identified by `downloadId`.
   *
   * @param proxyUrl the raw proxy the user chose at request time; the worker
   *        re-resolves it rather than persisting it, so credentials never touch
   *        the database.
   */
  async run(downloadId: string, proxyUrl?: string | null): Promise<void> {
    const record = await MediaDownload.findById(downloadId);
    if (!record) {
      logger.warn(`Media download ${downloadId} vanished before processing`);
      return;
    }

    if (record.status === 'cancelled') {
      logger.debug(`Media download ${downloadId} was cancelled before it started`);
      return;
    }

    let proxy: ProxyConfig | null = null;
    try {
      proxy = resolveProxy(proxyUrl);
    } catch (err) {
      await this.fail(record, (err as Error).message);
      return;
    }

    record.status = 'downloading';
    record.startedAt = new Date();
    record.usedProxy = proxy !== null;
    record.proxyLabel = proxy?.safeLabel;
    await record.save();
    this.emit(record, 'media:started');

    try {
      const useYtDlp = record.source === 'ytdlp' || record.audioOnly || this.isManifest(record.sourceUrl);
      const outcome = useYtDlp
        ? await this.viaYtDlp(record, proxy)
        : await this.viaDirectStream(record, proxy);

      if (outcome.restriction) {
        await this.block(record, outcome.restriction);
        return;
      }
      if (!outcome.filePath) {
        await this.fail(record, outcome.errorMessage ?? 'The download produced no file.');
        return;
      }

      record.status = 'completed';
      record.progress = 100;
      record.filePath = outcome.filePath;
      record.fileName = path.basename(outcome.filePath);
      record.sizeBytes = (await fileSize(outcome.filePath)) ?? record.downloadedBytes;
      record.downloadedBytes = record.sizeBytes ?? 0;
      record.completedAt = new Date();
      await record.save();

      logger.info(`Media download completed: ${record._id} (${record.sizeBytes} bytes)`);
      this.emit(record, 'media:completed');
    } catch (err) {
      logger.error(`Media download ${downloadId} threw:`, err);
      await this.fail(record, (err as Error).message);
    }
  }

  private isManifest(url: string): boolean {
    return /\.(m3u8|mpd)(\?|#|$)/i.test(url);
  }

  // ─── Transport: yt-dlp ────────────────────────────────────────────────────
  private async viaYtDlp(
    record: IMediaDownload,
    proxy: ProxyConfig | null
  ): Promise<{ filePath?: string; restriction?: Restriction; errorMessage?: string }> {
    const dir = await userDir(record.userId.toString());
    const stem = record._id.toString();

    let lastDbWrite = 0;

    // The synthetic "Audio only (MP3)" candidate carries no format id — the
    // extractor picks the best audio track itself.
    const audioOnly = record.audioOnly || (record.kind === 'audio' && !record.formatId);

    const result = await ytdlp.download({
      url: record.sourceUrl,
      formatId: record.formatId,
      audioOnly,
      mergeAudio: record.kind === 'video',
      outputTemplate: path.join(dir, stem),
      proxy,
      maxBytes: MAX_DOWNLOAD_BYTES,
      onProgress: (percent, downloaded, total) => {
        record.progress = Math.min(99, Math.round(percent));
        record.downloadedBytes = downloaded;
        record.totalBytes = total;
        this.emit(record, 'media:progress');

        const now = Date.now();
        if (now - lastDbWrite > DB_PROGRESS_INTERVAL_MS) {
          lastDbWrite = now;
          void MediaDownload.updateOne(
            { _id: record._id },
            { progress: record.progress, downloadedBytes: downloaded, totalBytes: total }
          ).catch(() => undefined);
        }
      },
    });

    if (!result.ok) {
      return result.restriction.kind !== 'none'
        ? { restriction: result.restriction }
        : { errorMessage: result.errorMessage };
    }

    // yt-dlp reports its destination, but post-processing (merge, audio
    // extraction) can rename it — trust the directory listing over the report.
    const onDisk = await findByStem(dir, stem);
    return { filePath: onDisk ?? result.filePath };
  }

  // ─── Transport: direct stream ─────────────────────────────────────────────
  private async viaDirectStream(
    record: IMediaDownload,
    proxy: ProxyConfig | null
  ): Promise<{ filePath?: string; restriction?: Restriction; errorMessage?: string }> {
    try {
      await assertPublicUrl(record.sourceUrl);
    } catch (err) {
      if (err instanceof BlockedHostError) return { errorMessage: err.message };
      throw err;
    }

    const response = await axios.get<Readable>(record.sourceUrl, {
      responseType: 'stream',
      timeout: 30_000,
      maxRedirects: 5,
      validateStatus: () => true,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        // Some CDNs 403 a media request that arrives without a same-site referer.
        Referer: record.pageUrl,
        Accept: '*/*',
      },
      ...proxyAgents(proxy),
    });

    if (response.status >= 400) {
      response.data.destroy();
      const restriction = detectFromStatus(response.status);
      return restriction.kind !== 'none'
        ? { restriction }
        : { errorMessage: `The server returned HTTP ${response.status}.` };
    }

    const headers = response.headers as Record<string, string>;
    const mimeType = (headers['content-type'] ?? '').split(';')[0].trim();
    const declared = Number(headers['content-length']);
    const total = Number.isFinite(declared) && declared > 0 ? declared : 0;

    if (total > MAX_DOWNLOAD_BYTES) {
      response.data.destroy();
      return {
        errorMessage: `File is ${Math.round(total / 1024 / 1024)} MB, over the ${Math.round(
          MAX_DOWNLOAD_BYTES / 1024 / 1024
        )} MB limit.`,
      };
    }

    record.totalBytes = total;
    record.mimeType = mimeType || undefined;

    const dir = await userDir(record.userId.toString());
    const ext = this.extensionFor(record, mimeType);
    const filePath = path.join(dir, `${record._id.toString()}.${ext}`);

    let received = 0;
    let lastDbWrite = 0;
    let overflowed = false;

    response.data.on('data', (chunk: Buffer) => {
      received += chunk.length;

      // Enforce the cap even when Content-Length lied or was absent.
      if (received > MAX_DOWNLOAD_BYTES) {
        overflowed = true;
        response.data.destroy(new Error('SIZE_LIMIT'));
        return;
      }

      record.downloadedBytes = received;
      record.progress = total > 0 ? Math.min(99, Math.round((received / total) * 100)) : 0;
      this.emit(record, 'media:progress');

      const now = Date.now();
      if (now - lastDbWrite > DB_PROGRESS_INTERVAL_MS) {
        lastDbWrite = now;
        void MediaDownload.updateOne(
          { _id: record._id },
          { progress: record.progress, downloadedBytes: received, totalBytes: total }
        ).catch(() => undefined);
      }
    });

    try {
      await pipeline(response.data, createWriteStream(filePath));
    } catch (err) {
      await removeFile(filePath).catch(() => undefined);
      if (overflowed || (err as Error).message === 'SIZE_LIMIT') {
        return {
          errorMessage: `Download exceeded the ${Math.round(
            MAX_DOWNLOAD_BYTES / 1024 / 1024
          )} MB limit and was stopped.`,
        };
      }
      return { errorMessage: `Transfer failed: ${(err as Error).message}` };
    }

    return { filePath };
  }

  /** Best-effort container extension from mime type, then URL, then kind. */
  private extensionFor(record: IMediaDownload, mimeType: string): string {
    const fromMime = EXT_BY_MIME[mimeType.toLowerCase()];
    if (fromMime) return fromMime;

    try {
      const pathname = new URL(record.sourceUrl).pathname;
      const ext = path.extname(pathname).replace('.', '').toLowerCase();
      if (ext && ext.length <= 5 && /^[a-z0-9]+$/.test(ext)) return ext;
    } catch {
      /* fall through */
    }

    return record.kind === 'video' ? 'mp4' : record.kind === 'audio' ? 'mp3' : 'jpg';
  }

  // ─── Terminal states ──────────────────────────────────────────────────────
  private async block(record: IMediaDownload, restriction: Restriction): Promise<void> {
    record.status = 'blocked';
    record.restrictionKind = restriction.kind;
    record.restrictionMessage = restriction.message;
    record.completedAt = new Date();
    await record.save();
    logger.info(`Media download blocked (${restriction.kind}): ${record._id}`);
    this.emit(record, 'media:blocked');
  }

  private async fail(record: IMediaDownload, message: string): Promise<void> {
    record.status = 'failed';
    record.errorMessage = message.slice(0, 500);
    record.completedAt = new Date();
    await record.save();
    this.emit(record, 'media:failed');
  }

  /**
   * Pushes the record's current state to the owner's socket room. Uses the
   * JSON transform so `filePath` is stripped before it leaves the server.
   */
  private emit(record: IMediaDownload, event: string): void {
    emitToUser(record.userId.toString(), event, { download: record.toJSON() });
  }
}

/** Suggested download filename for the browser, derived from the label. */
export function suggestedFileName(record: IMediaDownload): string {
  const ext = record.fileName ? path.extname(record.fileName) : '';
  return `${safeFilename(record.label, record.kind)}${ext}`;
}
