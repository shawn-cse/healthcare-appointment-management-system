import { Router } from 'express';
import * as auth from '../controllers/auth.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import { uploadAvatar } from '../utils/upload.js';

const router = Router();

router.post('/register', asyncHandler(auth.register));
router.post('/login', asyncHandler(auth.login));
router.get('/check-username', asyncHandler(auth.checkUsername));
router.get('/me', authenticate, asyncHandler(auth.me));
router.put(
  '/profile',
  authenticate,
  uploadAvatar.single('avatar'),
  asyncHandler(auth.updateProfile)
);
router.post('/change-password', authenticate, asyncHandler(auth.changePassword));

export default router;
