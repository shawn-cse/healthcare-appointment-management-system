import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { env } from '../config/env.js';
import { HttpError } from '../middleware/error.js';

const ALLOWED_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.pdf',
  '.doc',
  '.docx',
  '.txt',
]);

const ALLOWED_AVATAR_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

function makeDiskStorage(subdir: string, allowedExts: Set<string>) {
  const targetDir = path.join(env.mediaRoot, subdir);
  fs.mkdirSync(targetDir, { recursive: true });

  const storage = multer.diskStorage({
    destination(_req, _file, cb) {
      fs.mkdirSync(targetDir, { recursive: true });
      cb(null, targetDir);
    },
    filename(_req, file, cb) {
      const ext = path.extname(file.originalname || '').toLowerCase();
      const base = path
        .basename(file.originalname || 'file', ext)
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .slice(0, 40);
      const unique = crypto.randomBytes(4).toString('hex');
      cb(null, `${base || 'upload'}_${unique}${ext}`);
    },
  });

  return multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter(_req, file, cb) {
      const ext = path.extname(file.originalname || '').toLowerCase();
      if (!allowedExts.has(ext)) {
        cb(new HttpError(400, `Unsupported file type "${ext || 'unknown'}". Allowed: ${[...allowedExts].join(', ')}`));
        return;
      }
      cb(null, true);
    },
  });
}

export const uploadAvatar = makeDiskStorage('profiles', ALLOWED_AVATAR_EXT);
export const uploadComplaintFile = makeDiskStorage('complaints/patient', ALLOWED_EXTENSIONS);
export const uploadAdminComplaintFile = makeDiskStorage('complaints/admin', ALLOWED_EXTENSIONS);
export const uploadRefundDocument = makeDiskStorage('refunds', new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp']));

export function toRelativeMediaPath(subdir: string, filename: string): string {
  return `${subdir}/${filename}`;
}

export function mediaUrl(relPath: string | null | undefined): string | null {
  if (!relPath) return null;
  const clean = relPath.replace(/^\/+/, '');
  return `/media/${clean}`;
}
