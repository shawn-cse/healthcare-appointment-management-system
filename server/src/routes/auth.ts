import { Router } from 'express';
import * as auth from '../controllers/auth.js';
import { authenticate, authenticateSupport, requireRoles } from '../middleware/auth.js';
import { sendPhoneCode, verifyPhoneCode } from '../controllers/phoneVerification.js';
import { asyncHandler } from '../middleware/error.js';
import { uploadAvatar } from '../utils/upload.js';

const router = Router();

router.post('/register', asyncHandler(auth.register));
router.post('/login', asyncHandler(auth.login));
router.get('/check-username', asyncHandler(auth.checkUsername));
router.get('/check-email', asyncHandler(auth.checkEmail));
router.get('/check-phone', asyncHandler(auth.checkPhone));
router.get('/me', authenticateSupport, asyncHandler(auth.me));
router.put(
  '/profile',
  authenticate,
  uploadAvatar.single('avatar'),
  asyncHandler(auth.updateProfile)
);
router.post('/change-password', authenticate, asyncHandler(auth.changePassword));
router.post('/phone/send-code', authenticate, requireRoles('patient'), asyncHandler(sendPhoneCode));
router.post('/phone/verify', authenticate, requireRoles('patient'), asyncHandler(verifyPhoneCode));

export default router;
