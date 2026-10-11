import { Router } from 'express';
import {
  getCapabilities,
  probeUrl,
  startDownloads,
  listDownloads,
  getDownload,
  downloadFile,
  deleteDownload,
} from '../controllers/media.controller';
import { authenticate } from '../middleware/auth.middleware';
import { mediaProbeLimiter, mediaDownloadLimiter } from '../middleware/rateLimit.middleware';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

// Every media route requires a signed-in user — probes fetch arbitrary URLs
// from the server, so this must never be anonymous.
router.use(authenticate);

router.get('/capabilities', asyncHandler(getCapabilities));
router.post('/probe', mediaProbeLimiter, asyncHandler(probeUrl));
router.post('/downloads', mediaDownloadLimiter, asyncHandler(startDownloads));
router.get('/downloads', asyncHandler(listDownloads));
router.get('/downloads/:id', asyncHandler(getDownload));
router.get('/downloads/:id/file', asyncHandler(downloadFile));
router.delete('/downloads/:id', asyncHandler(deleteDownload));

export default router;
