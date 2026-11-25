import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

const COMMON_PASSWORDS = new Set([
  'password',
  '12345678',
  '123456789',
  'qwerty123',
  'password123',
  'admin123',
  'letmein1',
  'welcome1',
]);

export function validatePasswordStrength(password: string): string | null {
  if (!password || password.length < 6) {
    return 'Password must contain at least 6 characters.';
  }
  if (/^\d+$/.test(password)) {
    return 'This password cannot be entirely numeric.';
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return 'This password is too common.';
  }
  return null;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

function verifyDjangoPbkdf2Sha256(plain: string, encoded: string): boolean {
  const parts = encoded.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') {
    return false;
  }
  const iterations = Number(parts[1]);
  const salt = parts[2];
  const expectedBase64 = parts[3];
  if (!Number.isFinite(iterations) || iterations <= 0 || !salt || !expectedBase64) {
    return false;
  }
  const derived = crypto.pbkdf2Sync(plain, salt, iterations, 32, 'sha256');
  const expected = Buffer.from(expectedBase64, 'base64');
  if (derived.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(derived, expected);
}

export async function verifyPassword(plain: string, encoded: string): Promise<boolean> {
  if (!plain || !encoded) return false;
  if (encoded.startsWith('pbkdf2_sha256$')) {
    return verifyDjangoPbkdf2Sha256(plain, encoded);
  }
  if (encoded.startsWith('$2a$') || encoded.startsWith('$2b$') || encoded.startsWith('$2y$')) {
    return bcrypt.compare(plain, encoded);
  }
  return false;
}
