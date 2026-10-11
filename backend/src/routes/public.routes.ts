import { Router } from 'express';
import { getPublicResult } from '../controllers/crawl.controller';
import { asyncHandler } from '../utils/asyncHandler';

// Unauthenticated, read-only access to results their owners have made public.
const router = Router();

router.get('/results/:resultId', asyncHandler(getPublicResult));

export default router;
