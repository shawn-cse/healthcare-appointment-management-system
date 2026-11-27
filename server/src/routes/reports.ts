import { Router } from 'express';
import * as c from '../controllers/reports.js';
import { listPayments } from '../controllers/payments.js';
import { getSettings, updateSettings } from '../controllers/settings.js';
import { authenticate, requireRoles } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';

const router = Router();
router.use(authenticate);

router.get('/dashboard', asyncHandler(c.dashboard));
router.get('/payments', requireRoles('admin', 'receptionist', 'patient'), asyncHandler(listPayments));
router.get('/system/settings', requireRoles('admin'), asyncHandler(getSettings));
router.put('/system/settings', requireRoles('admin'), asyncHandler(updateSettings));
router.get('/reports', requireRoles('admin', 'doctor'), asyncHandler(c.reports));
router.get('/reports/excel', requireRoles('admin', 'doctor'), asyncHandler(c.exportExcel));
router.get('/audit', requireRoles('admin'), asyncHandler(c.auditLog));
router.get('/audit/csv', requireRoles('admin'), asyncHandler(c.exportAuditCsv));

export default router;
