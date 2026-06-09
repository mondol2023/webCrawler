import { Request, Response } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { User } from '../models/User.model';
import { CrawlJob } from '../models/CrawlJob.model';
import { CrawlResult } from '../models/CrawlResult.model';
import { logger } from '../utils/logger';

// ─── Platform Stats ────────────────────────────────────────────────────────
export async function getPlatformStats(req: Request, res: Response): Promise<void> {
  try {
    const [
      totalUsers,
      activeUsers,
      totalJobs,
      runningJobs,
      completedJobs,
      failedJobs,
      totalResults,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ isActive: true }),
      CrawlJob.countDocuments(),
      CrawlJob.countDocuments({ status: 'running' }),
      CrawlJob.countDocuments({ status: 'completed' }),
      CrawlJob.countDocuments({ status: 'failed' }),
      CrawlResult.countDocuments(),
    ]);

    // Jobs per day (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const jobsPerDay = await CrawlJob.aggregate([
      { $match: { createdAt: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    res.json({
      success: true,
      data: {
        users: { total: totalUsers, active: activeUsers },
        jobs: { total: totalJobs, running: runningJobs, completed: completedJobs, failed: failedJobs },
        results: { total: totalResults },
        jobsPerDay,
      },
    });
  } catch (error) {
    logger.error('Platform stats error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch stats' });
  }
}

// ─── List All Users ────────────────────────────────────────────────────────
export async function listUsers(req: Request, res: Response): Promise<void> {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const search = req.query.search as string | undefined;

    const filter: Record<string, unknown> = {};
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    const [users, total] = await Promise.all([
      User.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: {
        users,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      },
    });
  } catch (error) {
    logger.error('List users error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch users' });
  }
}

// ─── Toggle User Active Status ─────────────────────────────────────────────
export async function toggleUserStatus(req: Request, res: Response): Promise<void> {
  try {
    const { userId } = req.params;

    if (!mongoose.isValidObjectId(userId)) {
      res.status(400).json({ success: false, message: 'Invalid user ID' });
      return;
    }

    // Prevent admin from deactivating themselves
    if (userId === req.user?.userId) {
      res.status(400).json({ success: false, message: 'Cannot deactivate your own account' });
      return;
    }

    const user = await User.findById(userId);
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    user.isActive = !user.isActive;
    await user.save();

    res.json({
      success: true,
      message: `User ${user.isActive ? 'activated' : 'deactivated'}`,
      data: { user },
    });
  } catch (error) {
    logger.error('Toggle user status error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
}

// ─── Update User Crawl Limit ───────────────────────────────────────────────
const crawlLimitSchema = z.object({
  crawlLimit: z.number().int().min(1).max(50),
});

export async function updateUserCrawlLimit(req: Request, res: Response): Promise<void> {
  try {
    const { userId } = req.params;
    const body = crawlLimitSchema.safeParse(req.body);

    if (!body.success) {
      res.status(400).json({ success: false, errors: body.error.flatten().fieldErrors });
      return;
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { crawlLimit: body.data.crawlLimit },
      { new: true }
    );

    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    res.json({ success: true, data: { user } });
  } catch (error) {
    logger.error('Update crawl limit error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
}

// ─── List All Jobs (admin view) ────────────────────────────────────────────
export async function listAllJobs(req: Request, res: Response): Promise<void> {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const status = req.query.status as string | undefined;

    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;

    const [jobs, total] = await Promise.all([
      CrawlJob.find(filter)
        .populate('userId', 'name email')
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
    logger.error('List all jobs error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch jobs' });
  }
}