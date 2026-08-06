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

const router = Router();

// All crawl routes require authentication
router.use(authenticate);

router.post('/', crawlLimiter, submitCrawlJob);
router.get('/', listCrawlJobs);
router.get('/:jobId', getCrawlJob);
router.get('/:jobId/results', getJobResults);
router.get('/:jobId/results/:resultId', getResultDetail);
router.patch('/:jobId/results/:resultId/visibility', setResultVisibility);
router.patch('/:jobId/cancel', cancelCrawlJob);

export default router;