import { Router } from 'express';
import * as c from '../controllers/refunds.js';
import { authenticate, requireRoles } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import { uploadRefundDocument } from '../utils/upload.js';

const router = Router();
router.use(authenticate, requireRoles('admin', 'receptionist'));

router.get('/', asyncHandler(c.listRefunds));
router.get('/:id/evidence', asyncHandler(c.downloadEvidence));
router.post('/:id/evidence', asyncHandler(c.allowEvidenceUpload), uploadRefundDocument.single('document'), asyncHandler(c.saveEvidence));
router.post('/bulk', requireRoles('admin'), asyncHandler(c.bulkApprove));
router.post('/:id/approve', requireRoles('admin'), asyncHandler(c.approve));
router.post('/:id/cash', asyncHandler(c.cashPayout));
router.post('/:id/online', asyncHandler(c.onlineSubmit));
router.post('/:id/reject', requireRoles('admin'), asyncHandler(c.reject));

export default router;
