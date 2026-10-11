/**
 * HTTP surface for the media downloader.
 *
 * Deliberately thin: validate, check ownership, delegate. The interesting logic
 * lives in services/media/* so a bug is easy to localise — a wrong URL list is
 * the probe service, a stalled transfer is the download service, a 403 is the
 * restriction detector.
 */
import { Request, Response } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { createReadStream } from 'fs';
import { MediaDownload } from '../models/MediaDownload.model';
import { MediaProbeService } from '../services/media/MediaProbeService';
import { suggestedFileName } from '../services/media/MediaDownloadService';
import { resolveProxy, ProxyConfigError } from '../services/media/proxyConfig';
import { assertInsideRoot, fileSize, removeFile, MAX_DOWNLOAD_BYTES } from '../services/media/storage';
import { assertPublicProxyUrl, assertPublicUrl, BlockedHostError } from '../services/media/netGuard';
import { addMediaJob, removeMediaJob } from '../queue/media.queue';
import { cancel as cancelActiveDownload } from '../services/media/activeDownloads';
import * as ytdlp from '../services/media/YtDlpAdapter';
import { env } from '../config/env';
import { logger } from '../utils/logger';

const probeService = new MediaProbeService();

// ─── Validation ────────────────────────────────────────────────────────────
const proxyField = z.string().trim().max(500).optional();

const probeSchema = z.object({
  url: z.string().url('Must be a valid URL'),
  proxyUrl: proxyField,
  respectRobotsTxt: z.boolean().default(true),
});

const candidateSchema = z.object({
  pageUrl: z.string().url(),
  url: z.string().url(),
  kind: z.enum(['video', 'audio', 'image']),
  source: z.enum(['ytdlp', 'dom', 'network', 'meta']),
  label: z.string().max(300),
  quality: z.string().max(60).optional(),
  formatId: z.string().max(120).optional(),
  audioOnly: z.boolean().default(false),
});

const downloadSchema = z.object({
  // Multi-select: the UI sends every checked candidate in one request.
  items: z.array(candidateSchema).min(1).max(25),
  proxyUrl: proxyField,
});

/** How many downloads a user may have in flight at once. */
const MAX_ACTIVE_DOWNLOADS = 5;

// ─── Capabilities ──────────────────────────────────────────────────────────
/**
 * Tells the UI what this install can actually do, so it can explain a missing
 * yt-dlp binary up front instead of failing on the first YouTube URL.
 */
export async function getCapabilities(_req: Request, res: Response): Promise<void> {
  const yt = await ytdlp.isAvailable();
  res.json({
    success: true,
    data: {
      ytdlp: yt,
      proxyConfigured: Boolean(env.MEDIA_PROXY_URL),
      cookiesConfigured: ytdlp.hasCookies(),
      maxDownloadBytes: MAX_DOWNLOAD_BYTES,
      maxActiveDownloads: MAX_ACTIVE_DOWNLOADS,
    },
  });
}

// ─── Probe ─────────────────────────────────────────────────────────────────
export async function probeUrl(req: Request, res: Response): Promise<void> {
  try {
    const body = probeSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ success: false, errors: body.error.flatten().fieldErrors });
      return;
    }

    if (await rejectBlocked(res, () => checkUserProxy(body.data.proxyUrl))) return;

    let proxy;
    try {
      proxy = resolveProxy(body.data.proxyUrl);
    } catch (err) {
      if (err instanceof ProxyConfigError) {
        res.status(400).json({ success: false, message: err.message });
        return;
      }
      throw err;
    }

    const outcome = await probeService.probe({
      url: body.data.url,
      proxy,
      respectRobotsTxt: body.data.respectRobotsTxt,
    });

    res.json({ success: true, data: outcome });
  } catch (err) {
    logger.error('Media probe failed:', err);
    res.status(500).json({ success: false, message: 'Failed to inspect that page.' });
  }
}

// ─── Start downloads ───────────────────────────────────────────────────────
export async function startDownloads(req: Request, res: Response): Promise<void> {
  try {
    const body = downloadSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ success: false, errors: body.error.flatten().fieldErrors });
      return;
    }

    const blocked = await rejectBlocked(res, async () => {
      await checkUserProxy(body.data.proxyUrl);
      for (const item of body.data.items) {
        await assertPublicUrl(item.url);
        await assertPublicUrl(item.pageUrl);
      }
    });
    if (blocked) return;

    let proxy;
    try {
      proxy = resolveProxy(body.data.proxyUrl);
    } catch (err) {
      if (err instanceof ProxyConfigError) {
        res.status(400).json({ success: false, message: err.message });
        return;
      }
      throw err;
    }

    const userId = req.user!.userId;

    const activeCount = await MediaDownload.countDocuments({
      userId,
      status: { $in: ['pending', 'queued', 'downloading'] },
    });

    const room = MAX_ACTIVE_DOWNLOADS - activeCount;
    if (room <= 0) {
      res.status(429).json({
        success: false,
        message: `You already have ${MAX_ACTIVE_DOWNLOADS} downloads running. Wait for one to finish.`,
      });
      return;
    }

    // Take what fits rather than rejecting the whole batch, and say so.
    const accepted = body.data.items.slice(0, room);
    const skipped = body.data.items.length - accepted.length;

    const created = [];
    for (const item of accepted) {
      const record = await MediaDownload.create({
        userId,
        pageUrl: item.pageUrl,
        sourceUrl: item.url,
        kind: item.kind,
        source: item.source,
        label: item.label,
        quality: item.quality,
        formatId: item.formatId,
        audioOnly: item.audioOnly,
        status: 'queued',
        usedProxy: proxy !== null,
        proxyLabel: proxy?.safeLabel,
      });

      await addMediaJob({
        downloadId: record._id.toString(),
        userId,
        proxyUrl: body.data.proxyUrl,
      });

      created.push(record.toJSON());
    }

    res.status(201).json({
      success: true,
      data: { downloads: created, skipped },
      message: skipped
        ? `Queued ${created.length}; ${skipped} skipped (concurrent download limit).`
        : `Queued ${created.length} download(s).`,
    });
  } catch (err) {
    logger.error('Failed to queue media downloads:', err);
    res.status(500).json({ success: false, message: 'Failed to queue downloads.' });
  }
}

// ─── List / detail ─────────────────────────────────────────────────────────
export async function listDownloads(req: Request, res: Response): Promise<void> {
  try {
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10) || 20));
    const filter: Record<string, unknown> = { userId: req.user!.userId };

    if (typeof req.query.status === 'string' && req.query.status) {
      filter.status = req.query.status;
    }

    const [downloads, total] = await Promise.all([
      MediaDownload.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      MediaDownload.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: {
        downloads: downloads.map((d) => d.toJSON()),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      },
    });
  } catch (err) {
    logger.error('Failed to list media downloads:', err);
    res.status(500).json({ success: false, message: 'Failed to load downloads.' });
  }
}

export async function getDownload(req: Request, res: Response): Promise<void> {
  const record = await findOwned(req, res);
  if (!record) return;
  res.json({ success: true, data: { download: record.toJSON() } });
}

/**
 * RFC 6266 header: an ASCII `filename` for old clients plus a UTF-8 `filename*`
 * so names like "日本語.mp4" survive intact.
 */
export function contentDisposition(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]|"/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

// ─── File ──────────────────────────────────────────────────────────────────
export async function downloadFile(req: Request, res: Response): Promise<void> {
  const record = await findOwned(req, res);
  if (!record) return;

  if (record.status !== 'completed' || !record.filePath) {
    res.status(409).json({ success: false, message: 'That download is not ready yet.' });
    return;
  }

  let resolved: string;
  try {
    resolved = assertInsideRoot(record.filePath);
  } catch {
    logger.error(`Refused to serve out-of-root path for download ${record._id}`);
    res.status(500).json({ success: false, message: 'File is unavailable.' });
    return;
  }

  const size = await fileSize(resolved);
  if (size === undefined) {
    res.status(410).json({ success: false, message: 'The file is no longer on the server.' });
    return;
  }

  res.setHeader('Content-Type', record.mimeType || 'application/octet-stream');
  res.setHeader('Content-Length', String(size));
  res.setHeader('Content-Disposition', contentDisposition(suggestedFileName(record)));

  const stream = createReadStream(resolved);
  stream.on('error', (err) => {
    logger.error(`Failed streaming media file ${record._id}:`, err);
    if (!res.headersSent) res.status(500).end();
    else res.destroy();
  });
  stream.pipe(res);
}

// ─── Cancel / delete ───────────────────────────────────────────────────────
export async function deleteDownload(req: Request, res: Response): Promise<void> {
  const record = await findOwned(req, res);
  if (!record) return;

  // Stop a transfer running in this process (it removes its own partial
  // files), then pull the job from the queue so no worker picks it up.
  cancelActiveDownload(record._id.toString());
  await removeMediaJob(record._id.toString());

  if (record.filePath) {
    await removeFile(record.filePath).catch((err) =>
      logger.warn(`Could not delete media file for ${record._id}: ${err.message}`)
    );
  }

  if (['pending', 'queued', 'downloading'].includes(record.status)) {
    // Mark cancelled before removal so an in-flight run stops at its next check.
    record.status = 'cancelled';
    await record.save();
  }

  await record.deleteOne();
  res.json({ success: true, message: 'Download removed.' });
}

// ─── Helpers ───────────────────────────────────────────────────────────────
/**
 * Only a user-supplied proxy is checked: the operator's MEDIA_PROXY_URL is
 * trusted and may legitimately live on a private network.
 */
async function checkUserProxy(proxyUrl: string | undefined): Promise<void> {
  if (proxyUrl) await assertPublicProxyUrl(proxyUrl);
}

/** Runs `check`; on a BlockedHostError answers 400 and returns true. */
async function rejectBlocked(res: Response, check: () => Promise<void>): Promise<boolean> {
  try {
    await check();
    return false;
  } catch (err) {
    if (err instanceof BlockedHostError) {
      res.status(400).json({ success: false, message: err.message });
      return true;
    }
    throw err;
  }
}

/** Loads a download and 404s unless it belongs to the caller. */
async function findOwned(req: Request, res: Response) {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ success: false, message: 'Invalid download id.' });
    return null;
  }

  const record = await MediaDownload.findOne({ _id: id, userId: req.user!.userId });
  if (!record) {
    res.status(404).json({ success: false, message: 'Download not found.' });
    return null;
  }
  return record;
}
