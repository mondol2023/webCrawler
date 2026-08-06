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

const router = Router();

// Every media route requires a signed-in user — probes fetch arbitrary URLs
// from the server, so this must never be anonymous.
router.use(authenticate);

router.get('/capabilities', getCapabilities);
router.post('/probe', mediaProbeLimiter, probeUrl);
router.post('/downloads', mediaDownloadLimiter, startDownloads);
router.get('/downloads', listDownloads);
router.get('/downloads/:id', getDownload);
router.get('/downloads/:id/file', downloadFile);
router.delete('/downloads/:id', deleteDownload);

export default router;
