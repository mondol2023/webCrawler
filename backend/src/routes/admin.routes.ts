import { Router } from 'express';
import {
  getPlatformStats,
  listUsers,
  toggleUserStatus,
  updateUserCrawlLimit,
  listAllJobs,
} from '../controllers/admin.controller';
import { authenticate } from '../middleware/auth.middleware';
import { authorize } from '../middleware/rbac.middleware';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

// All admin routes require auth + admin role
router.use(authenticate, authorize('admin'));

router.get('/stats', asyncHandler(getPlatformStats));
router.get('/users', asyncHandler(listUsers));
router.patch('/users/:userId/toggle-status', asyncHandler(toggleUserStatus));
router.patch('/users/:userId/crawl-limit', asyncHandler(updateUserCrawlLimit));
router.get('/jobs', asyncHandler(listAllJobs));

export default router;