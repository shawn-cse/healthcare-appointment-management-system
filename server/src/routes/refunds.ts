import { Router } from 'express';
import * as c from '../controllers/refunds.js';
import { authenticate, requireRoles } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';

const router = Router();
router.use(authenticate, requireRoles('admin', 'receptionist'));

router.get('/', asyncHandler(c.listRefunds));
router.post('/bulk', asyncHandler(c.bulkApprove));
router.post('/:id/approve', asyncHandler(c.approve));
router.post('/:id/cash', asyncHandler(c.cashPayout));
router.post('/:id/online', asyncHandler(c.onlineSubmit));
router.post('/:id/reject', asyncHandler(c.reject));

export default router;
