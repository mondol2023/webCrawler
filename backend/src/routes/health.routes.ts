import { Router } from 'express';
import { liveness, readinessHandler } from '../controllers/health.controller';
import { asyncHandler } from '../utils/asyncHandler';

// Unauthenticated probes for load balancers and orchestrators.
const router = Router();

router.get('/', liveness); // kept for existing callers; same as /live
router.get('/live', liveness);
router.get('/ready', asyncHandler(readinessHandler()));

export default router;
