import { Router } from 'express';
import * as appts from '../controllers/appointments.js';
import * as catalog from '../controllers/catalog.js';
import { checkDatabaseHealth } from '../config/db.js';
import { authenticate, requireRoles } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import authRoutes from './auth.js';
import catalogRoutes from './catalog.js';
import appointmentRoutes from './appointments.js';
import complaintRoutes from './complaints.js';
import refundRoutes from './refunds.js';
import staffRoutes from './staff.js';
import reportRoutes from './reports.js';

const router = Router();

router.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const ok = await checkDatabaseHealth();
    if (ok) {
      res.json({ status: 'ok', db: 'connected' });
      return;
    }
    res.status(503).json({ status: 'error', db: 'unavailable' });
  })
);

router.get(
  '/slots',
  authenticate,
  requireRoles('receptionist', 'doctor', 'admin'),
  asyncHandler(catalog.staffSlotsApi)
);
router.get(
  '/patients/lookup',
  authenticate,
  requireRoles('receptionist', 'doctor', 'admin'),
  asyncHandler(appts.patientLookup)
);
router.post('/payments/callback/:result', asyncHandler(appts.paymentCallback));

router.use('/auth', authRoutes);
router.use('/catalog', catalogRoutes);
router.use('/appointments', appointmentRoutes);
router.use('/complaints', complaintRoutes);
router.use('/refunds', refundRoutes);
router.use('/staff', staffRoutes);
router.use('/', reportRoutes);

export default router;
