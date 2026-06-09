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

const router = Router();

// All admin routes require auth + admin role
router.use(authenticate, authorize('admin'));

router.get('/stats', getPlatformStats);
router.get('/users', listUsers);
router.patch('/users/:userId/toggle-status', toggleUserStatus);
router.patch('/users/:userId/crawl-limit', updateUserCrawlLimit);
router.get('/jobs', listAllJobs);

export default router;