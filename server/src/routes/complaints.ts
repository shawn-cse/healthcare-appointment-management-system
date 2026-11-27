import { Router } from 'express';
import * as c from '../controllers/complaints.js';
import { authenticate, authenticateSupport, requireRoles } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import { uploadAdminComplaintFile, uploadComplaintFile } from '../utils/upload.js';

const router = Router();
router.use(authenticateSupport);

router.get('/', asyncHandler(c.listComplaints));
router.get('/recipients', requireRoles('admin', 'doctor', 'receptionist'), asyncHandler(c.listRecipients));
router.get('/:id/attachments/:kind', asyncHandler(c.downloadAttachment));
router.post(
  '/',
  requireRoles('patient', 'doctor', 'receptionist'),
  uploadComplaintFile.single('attachment'),
  asyncHandler(c.createComplaint)
);
router.post(
  '/bulk',
  authenticate,
  requireRoles('admin', 'receptionist', 'doctor'),
  asyncHandler(c.bulkComplaints)
);
router.get('/:id', asyncHandler(c.getComplaint));
router.post(
  '/:id/reply',
  requireRoles('patient', 'doctor', 'receptionist', 'admin'),
  asyncHandler(c.replyComplaint)
);
router.put(
  '/:id',
  authenticate,
  requireRoles('admin', 'receptionist', 'doctor'),
  uploadAdminComplaintFile.single('admin_attachment'),
  asyncHandler(c.updateComplaint)
);

export default router;
