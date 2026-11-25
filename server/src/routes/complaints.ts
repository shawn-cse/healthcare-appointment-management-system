import { Router } from 'express';
import * as c from '../controllers/complaints.js';
import { authenticate, requireRoles } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import { uploadAdminComplaintFile, uploadComplaintFile } from '../utils/upload.js';

const router = Router();
router.use(authenticate);

router.get('/', asyncHandler(c.listComplaints));
router.post(
  '/',
  requireRoles('patient', 'doctor', 'receptionist'),
  uploadComplaintFile.single('attachment'),
  asyncHandler(c.createComplaint)
);
router.post(
  '/bulk',
  requireRoles('admin', 'receptionist', 'doctor'),
  asyncHandler(c.bulkComplaints)
);
router.get('/:id', asyncHandler(c.getComplaint));
router.post(
  '/:id/reply',
  requireRoles('patient', 'doctor', 'receptionist'),
  asyncHandler(c.replyComplaint)
);
router.put(
  '/:id',
  requireRoles('admin', 'receptionist', 'doctor'),
  uploadAdminComplaintFile.single('admin_attachment'),
  asyncHandler(c.updateComplaint)
);

export default router;
