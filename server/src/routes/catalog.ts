import { Router } from 'express';
import * as c from '../controllers/catalog.js';
import { authenticate, optionalAuth, requireRoles } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';

const router = Router();

// Public
router.get('/home', asyncHandler(c.publicHome));
router.get('/doctors', asyncHandler(c.doctorDirectory));
router.get('/doctors/:identifier', optionalAuth, asyncHandler(c.doctorDetail));
router.get('/departments', optionalAuth, asyncHandler(c.listDepartments));
router.get('/slots', asyncHandler(c.openSlots));
router.get('/slots/:id', authenticate, asyncHandler(c.getSlotDetail));

// Staff slot capacity endpoint (/api/catalog/slots-api and /api/slots/staff)
router.get(
  '/slots-api',
  authenticate,
  requireRoles('receptionist', 'doctor', 'admin'),
  asyncHandler(c.staffSlotsApi)
);

// Admin departments & rooms
router.post('/departments', authenticate, requireRoles('admin'), asyncHandler(c.createDepartment));
router.put('/departments/:id', authenticate, requireRoles('admin'), asyncHandler(c.updateDepartment));
router.post(
  '/departments/:id/toggle',
  authenticate,
  requireRoles('admin'),
  asyncHandler(c.toggleDepartmentStatus)
);

router.get('/chambers', authenticate, requireRoles('admin', 'doctor', 'receptionist'), asyncHandler(c.listChambers));
router.post('/chambers', authenticate, requireRoles('admin'), asyncHandler(c.createChamber));
router.put('/chambers/:id', authenticate, requireRoles('admin'), asyncHandler(c.updateChamber));
router.delete('/chambers/:id', authenticate, requireRoles('admin'), asyncHandler(c.deleteChamber));

// Schedules & slots
router.get(
  '/schedules',
  authenticate,
  requireRoles('doctor', 'admin', 'receptionist'),
  asyncHandler(c.getSchedule)
);
router.post(
  '/schedules/weekly/:doctorPk',
  authenticate,
  requireRoles('doctor', 'admin'),
  asyncHandler(c.saveWeekly)
);
router.put(
  '/schedules/weekly/:doctorPk/:id',
  authenticate,
  requireRoles('doctor', 'admin'),
  asyncHandler(c.saveWeekly)
);
router.delete(
  '/schedules/weekly/:id',
  authenticate,
  requireRoles('doctor', 'admin'),
  asyncHandler(c.deleteWeekly)
);
router.post('/schedules/slot', authenticate, requireRoles('doctor', 'admin'), asyncHandler(c.saveSlot));
router.put('/schedules/slot/:id', authenticate, requireRoles('doctor', 'admin'), asyncHandler(c.saveSlot));
router.post(
  '/schedules/slot/:id/toggle',
  authenticate,
  requireRoles('doctor', 'admin'),
  asyncHandler(c.toggleSlot)
);
router.post('/schedules/copy', authenticate, requireRoles('doctor', 'admin'), asyncHandler(c.copySlots));

export default router;
