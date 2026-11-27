import { Router } from 'express';
import * as c from '../controllers/staff.js';
import { authenticate, requireRoles } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import { uploadAvatar } from '../utils/upload.js';

const router = Router();
router.use(authenticate);

router.get('/', requireRoles('admin', 'doctor', 'receptionist'), asyncHandler(c.listStaff));
router.get('/meta', requireRoles('admin'), asyncHandler(c.getStaffMeta));
router.post('/', requireRoles('admin'), uploadAvatar.single('avatar'), asyncHandler(c.createStaff));
router.get('/:id', requireRoles('admin'), asyncHandler(c.getStaffMember));
router.put('/:id', requireRoles('admin'), uploadAvatar.single('avatar'), asyncHandler(c.updateStaff));
router.post('/:id/toggle-active', requireRoles('admin'), asyncHandler(c.toggleStaffActive));
router.put('/:id/login-permission', requireRoles('admin'), asyncHandler(c.setLoginPermission));
router.get('/doctor/:id/rules', requireRoles('doctor', 'admin'), asyncHandler(c.getDoctorRules));
router.put('/doctor/:id/rules', requireRoles('doctor', 'admin'), asyncHandler(c.updateDoctorRules));

export default router;
