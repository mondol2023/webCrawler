import { Router } from 'express';
import { getPublicResult } from '../controllers/crawl.controller';

// Unauthenticated, read-only access to results their owners have made public.
const router = Router();

router.get('/results/:resultId', getPublicResult);

export default router;
