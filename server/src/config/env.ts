import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config();

function buildDatabaseUrl(): string {
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim()) {
    return process.env.DATABASE_URL.trim();
  }
  const user = encodeURIComponent(process.env.DATABASE_USER || 'green_user');
  const password = encodeURIComponent(process.env.DATABASE_PASSWORD || '');
  const host = process.env.DATABASE_HOST || 'localhost';
  const port = process.env.DATABASE_PORT || '5432';
  const db = encodeURIComponent(process.env.DATABASE_NAME || 'green_hospital');
  const url = `postgresql://${user}:${password}@${host}:${port}/${db}?schema=public`;
  process.env.DATABASE_URL = url;
  return url;
}

const databaseUrl = buildDatabaseUrl();
const nodeEnv = process.env.NODE_ENV || 'development';
const configuredJwt = process.env.JWT_SECRET || process.env.DJANGO_SECRET_KEY;
if (nodeEnv === 'production' && (!configuredJwt || configuredJwt.length < 32 || /change.in.production|change.this/i.test(configuredJwt))) {
  throw new Error('Set a production JWT_SECRET of at least 32 characters.');
}

export const env = {
  nodeEnv,
  port: Number(process.env.PORT || 5000),
  databaseUrl,
  jwtSecret:
    configuredJwt ||
    'green-hospital-dev-jwt-secret-change-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  timeZone: process.env.TIME_ZONE || 'Asia/Dhaka',
  hospitalName: process.env.HOSPITAL_NAME || 'Green Hospital',
  hospitalPhone: process.env.HOSPITAL_PHONE || '+88096100016211',
  hospitalAddress: process.env.HOSPITAL_ADDRESS || 'Mirpur, Dhaka, Bangladesh',
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || 'http://localhost:8000').replace(/\/+$/, ''),
  sslcommerzStoreId: process.env.SSLCOMMERZ_STORE_ID || '',
  sslcommerzStorePassword: process.env.SSLCOMMERZ_STORE_PASSWORD || '',
  sslcommerzLive: process.env.SSLCOMMERZ_LIVE === '1' || process.env.SSLCOMMERZ_LIVE === 'true',
  seedStarterAccounts: process.env.SEED_STARTER_ACCOUNTS === '1',
  mediaRoot: path.resolve(process.env.MEDIA_ROOT || path.resolve(process.cwd(), 'media')),
  clientUrl: process.env.CLIENT_URL || '',
};
