import { Request, Response } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { CrawlJob } from '../models/CrawlJob.model';
import { CrawlResult } from '../models/CrawlResult.model';
import { User } from '../models/User.model';
import { addCrawlJob, removeCrawlJob } from '../queue/crawl.queue';
import { logger } from '../utils/logger';
import { isValidUrl } from '../utils/urlUtils';
import { assertPublicUrl, BlockedHostError } from '../services/media/netGuard';

// ─── Validation ────────────────────────────────────────────────────────────
const submitSchema = z.object({
  url: z.string().url('Must be a valid URL'),
  keywords: z.array(z.string().max(100)).max(20).default([]),
  phrases: z.array(z.string().max(200)).max(10).default([]),
  categories: z.array(z.string().max(100)).max(10).default([]),
  maxDepth: z.number().int().min(1).max(10).default(3),
  maxPages: z.number().int().min(1).max(1000).default(100),
  respectRobotsTxt: z.boolean().default(true),
});

// ─── Submit Job ────────────────────────────────────────────────────────────
export async function submitCrawlJob(req: Request, res: Response): Promise<void> {
  try {
    const body = submitSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ success: false, errors: body.error.flatten().fieldErrors });
      return;
    }

    const { url, keywords, phrases, categories, maxDepth, maxPages, respectRobotsTxt } =
      body.data;

    if (!isValidUrl(url)) {
      res.status(400).json({ success: false, message: 'Invalid URL format' });
      return;
    }

    try {
      await assertPublicUrl(url);
    } catch (err) {
      if (err instanceof BlockedHostError) {
        res.status(400).json({ success: false, message: err.message });
        return;
      }
      throw err;
    }

    // Check active job limit per user (respects the per-user configurable limit)
    const user = await User.findById(req.user!.userId).select('crawlLimit isActive');
    if (!user || !user.isActive) {
      res.status(403).json({ success: false, message: 'Account not found or deactivated' });
      return;
    }

    const activeCount = await CrawlJob.countDocuments({
      userId: req.user!.userId,
      status: { $in: ['pending', 'queued', 'running'] },
    });

    if (activeCount >= user.crawlLimit) {
      res.status(429).json({
        success: false,
        message: `You have reached your limit of ${user.crawlLimit} active crawl jobs`,
      });
      return;
    }

    // Create job record
    const job = await CrawlJob.create({
      userId: req.user!.userId,
      url,
      keywords,
      phrases,
      categories,
      maxDepth,
      maxPages,
      respectRobotsTxt,
      status: 'pending',
    });

    // Push to BullMQ
    const bullJobId = await addCrawlJob({
      jobId: job._id.toString(),
      userId: req.user!.userId,
      url,
      keywords,
      phrases,
      maxDepth,
      maxPages,
      respectRobotsTxt,
    });

    // Update status to queued
    await CrawlJob.findByIdAndUpdate(job._id, {
      status: 'queued',
      bullJobId,
    });

    res.status(201).json({
      success: true,
      message: 'Crawl job submitted',
      data: { job: { ...job.toObject(), status: 'queued' } },
    });
  } catch (error) {
    logger.error('Submit crawl job error:', error);
    res.status(500).json({ success: false, message: 'Failed to submit crawl job' });
  }
}

// ─── List Jobs ─────────────────────────────────────────────────────────────
export async function listCrawlJobs(req: Request, res: Response): Promise<void> {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
    const status = req.query.status as string | undefined;

    const filter: Record<string, unknown> = { userId: req.user!.userId };
    if (status) filter.status = status;

    const [jobs, total] = await Promise.all([
      CrawlJob.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      CrawlJob.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: {
        jobs,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      },
    });
  } catch (error) {
    logger.error('List crawl jobs error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch jobs' });
  }
}

// ─── Get Single Job ────────────────────────────────────────────────────────
export async function getCrawlJob(req: Request, res: Response): Promise<void> {
  try {
    const { jobId } = req.params;

    if (!mongoose.isValidObjectId(jobId)) {
      res.status(400).json({ success: false, message: 'Invalid job ID' });
      return;
    }

    const job = await CrawlJob.findOne({
      _id: jobId,
      userId: req.user!.userId,
    }).lean();

    if (!job) {
      res.status(404).json({ success: false, message: 'Job not found' });
      return;
    }

    res.json({ success: true, data: { job } });
  } catch (error) {
    logger.error('Get crawl job error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch job' });
  }
}

// ─── Get Job Results ───────────────────────────────────────────────────────
export async function getJobResults(req: Request, res: Response): Promise<void> {
  try {
    const { jobId } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const minScore = parseInt(req.query.minScore as string) || 0;

    if (!mongoose.isValidObjectId(jobId)) {
      res.status(400).json({ success: false, message: 'Invalid job ID' });
      return;
    }

    // Verify job ownership
    const job = await CrawlJob.findOne({ _id: jobId, userId: req.user!.userId });
    if (!job) {
      res.status(404).json({ success: false, message: 'Job not found' });
      return;
    }

    const filter = {
      jobId: new mongoose.Types.ObjectId(jobId),
      relevanceScore: { $gte: minScore },
    };

    const [results, total] = await Promise.all([
      CrawlResult.find(filter)
        // Primary (most-weighted) result first, then by score.
        .sort({ isPrimary: -1, relevanceScore: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        // Keep the list lean — full text/links/cache load on demand per result.
        .select('-extracted.paragraphs -extracted.links -cache')
        .lean(),
      CrawlResult.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: {
        results,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      },
    });
  } catch (error) {
    logger.error('Get job results error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch results' });
  }
}

// ─── Get Single Result (with cached snapshot) ──────────────────────────────
export async function getResultDetail(req: Request, res: Response): Promise<void> {
  try {
    const { jobId, resultId } = req.params;

    if (!mongoose.isValidObjectId(jobId) || !mongoose.isValidObjectId(resultId)) {
      res.status(400).json({ success: false, message: 'Invalid identifier' });
      return;
    }

    const result = await CrawlResult.findOne({
      _id: resultId,
      jobId,
      userId: req.user!.userId,
    }).lean();

    if (!result) {
      res.status(404).json({ success: false, message: 'Result not found' });
      return;
    }

    res.json({ success: true, data: { result } });
  } catch (error) {
    logger.error('Get result detail error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch result' });
  }
}

// ─── Toggle Result Visibility (public / private) ───────────────────────────
const visibilitySchema = z.object({ isPublic: z.boolean() });

export async function setResultVisibility(req: Request, res: Response): Promise<void> {
  try {
    const { jobId, resultId } = req.params;
    const body = visibilitySchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ success: false, message: 'isPublic (boolean) is required' });
      return;
    }

    if (!mongoose.isValidObjectId(jobId) || !mongoose.isValidObjectId(resultId)) {
      res.status(400).json({ success: false, message: 'Invalid identifier' });
      return;
    }

    const result = await CrawlResult.findOneAndUpdate(
      { _id: resultId, jobId, userId: req.user!.userId },
      { $set: { isPublic: body.data.isPublic } },
      { new: true }
    ).select('_id isPublic');

    if (!result) {
      res.status(404).json({ success: false, message: 'Result not found' });
      return;
    }

    res.json({
      success: true,
      message: body.data.isPublic ? 'Result is now public' : 'Result is now private',
      data: { result: { _id: result._id, isPublic: result.isPublic } },
    });
  } catch (error) {
    logger.error('Set result visibility error:', error);
    res.status(500).json({ success: false, message: 'Failed to update visibility' });
  }
}

// ─── Public Result (no auth; only if the owner made it public) ─────────────
export async function getPublicResult(req: Request, res: Response): Promise<void> {
  try {
    const { resultId } = req.params;

    if (!mongoose.isValidObjectId(resultId)) {
      res.status(400).json({ success: false, message: 'Invalid identifier' });
      return;
    }

    const result = await CrawlResult.findOne({ _id: resultId, isPublic: true })
      .select('-userId') // don't leak the owner
      .lean();

    if (!result) {
      // 404 for both "missing" and "private" so visibility can't be probed.
      res.status(404).json({ success: false, message: 'Result not found or not public' });
      return;
    }

    res.json({ success: true, data: { result } });
  } catch (error) {
    logger.error('Get public result error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch result' });
  }
}

// ─── Cancel Job ────────────────────────────────────────────────────────────
export async function cancelCrawlJob(req: Request, res: Response): Promise<void> {
  try {
    const { jobId } = req.params;
    if (!mongoose.isValidObjectId(jobId)) {
      res.status(400).json({ success: false, message: 'Invalid job id' });
      return;
    }

    // Atomic so a worker claiming the job at the same moment can't race us:
    // exactly one of the two status transitions wins.
    const cancelled = await CrawlJob.findOneAndUpdate(
      { _id: jobId, userId: req.user!.userId, status: { $in: ['pending', 'queued'] } },
      { status: 'cancelled', completedAt: new Date() },
      { new: true }
    );

    if (!cancelled) {
      const job = await CrawlJob.findOne({ _id: jobId, userId: req.user!.userId });
      if (!job) {
        res.status(404).json({ success: false, message: 'Job not found' });
        return;
      }
      res.status(400).json({
        success: false,
        message: `Cannot cancel a job with status '${job.status}'`,
      });
      return;
    }

    // Drop it from the queue; the worker's claim would skip it anyway.
    await removeCrawlJob(jobId);

    res.json({ success: true, message: 'Job cancelled' });
  } catch (error) {
    logger.error('Cancel job error:', error);
    res.status(500).json({ success: false, message: 'Failed to cancel job' });
  }
}
