import { Router } from 'express';
import * as c from '../controllers/appointments.js';
import { authenticate, requireRoles } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';

const router = Router();
router.use(authenticate);

router.get('/', asyncHandler(c.listAppointments));
router.post('/', requireRoles('patient', 'doctor', 'receptionist', 'admin'), asyncHandler(c.bookAppointment));
router.post('/bulk', requireRoles('doctor', 'receptionist', 'admin'), asyncHandler(c.bulkAppointments));
router.get('/patient-lookup', requireRoles('receptionist', 'doctor', 'admin'), asyncHandler(c.patientLookup));
router.get('/:id', asyncHandler(c.getAppointment));
router.post('/:id/quick-update', requireRoles('doctor', 'receptionist', 'admin'), asyncHandler(c.quickUpdateAppointment));
router.post('/:id/collect', requireRoles('doctor', 'receptionist', 'admin'), asyncHandler(c.collectPayment));
router.post('/:id/cancel', asyncHandler(c.cancelAppt));
router.post('/:id/status', requireRoles('doctor', 'receptionist', 'admin'), asyncHandler(c.setStatus));
router.post('/:id/link', requireRoles('receptionist', 'admin'), asyncHandler(c.linkPatient));
router.post('/:id/pay-online', requireRoles('patient'), asyncHandler(c.startPayment));

export default router;
