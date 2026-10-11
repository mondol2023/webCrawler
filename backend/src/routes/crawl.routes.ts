import { Router } from 'express';
import {
  submitCrawlJob,
  listCrawlJobs,
  getCrawlJob,
  getJobResults,
  getResultDetail,
  setResultVisibility,
  cancelCrawlJob,
} from '../controllers/crawl.controller';
import { authenticate } from '../middleware/auth.middleware';
import { crawlLimiter } from '../middleware/rateLimit.middleware';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

// All crawl routes require authentication
router.use(authenticate);

router.post('/', crawlLimiter, asyncHandler(submitCrawlJob));
router.get('/', asyncHandler(listCrawlJobs));
router.get('/:jobId', asyncHandler(getCrawlJob));
router.get('/:jobId/results', asyncHandler(getJobResults));
router.get('/:jobId/results/:resultId', asyncHandler(getResultDetail));
router.patch('/:jobId/results/:resultId/visibility', asyncHandler(setResultVisibility));
router.patch('/:jobId/cancel', asyncHandler(cancelCrawlJob));

export default router;