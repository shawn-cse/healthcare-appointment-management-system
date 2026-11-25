import fs from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import './env.js';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

const NON_DESTRUCTIVE_SYNC_SQL = [
  `ALTER TABLE hospital_user ADD COLUMN IF NOT EXISTS chamber_id BIGINT NULL REFERENCES hospital_chamber(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED`,
  `CREATE INDEX IF NOT EXISTS hospital_user_chamber_id_idx ON hospital_user (chamber_id)`,
  `ALTER TABLE hospital_user DROP CONSTRAINT IF EXISTS hospital_user_phone_key`,
  `DROP INDEX IF EXISTS hospital_user_phone_key`,
  `CREATE UNIQUE INDEX IF NOT EXISTS unique_patient_phone_idx ON hospital_user (phone) WHERE (role = 'patient' AND phone IS NOT NULL AND phone <> '')`,
  `ALTER TABLE hospital_doctorprofile ALTER COLUMN department_id DROP NOT NULL`,
];

export async function ensureDatabaseSchema(): Promise<void> {
  const existing = await prisma.$queryRaw<Array<{ tbl: string | null }>>`
    SELECT to_regclass('public.hospital_user')::text AS tbl
  `;

  if (!existing[0]?.tbl) {
    const sqlPath = path.resolve(process.cwd(), 'prisma', 'init.sql');
    const sql = await fs.readFile(sqlPath, 'utf-8');
    const cleanedSql = sql.replace(/^\s*--.*$/gm, '');
    const statements = cleanedSql
      .split(/;\s*(?:\r?\n|$)/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    await prisma.$transaction(async (tx) => {
      for (const stmt of statements) {
        await tx.$executeRawUnsafe(stmt);
      }
    });
  }

  // Always apply idempotent non-destructive schema alignments (room on any staff, optional doctor dept, patient-scoped unique phone)
  await prisma.$transaction(async (tx) => {
    for (const ddl of NON_DESTRUCTIVE_SYNC_SQL) {
      await tx.$executeRawUnsafe(ddl);
    }
  });
}

export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
