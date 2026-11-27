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
  const prismaDir = path.resolve(process.cwd(), 'prisma');
  const migrationDir = path.join(prismaDir, 'upgrades');
  const migrations = (await fs.readdir(migrationDir)).filter((file) => /^\d+_.*\.sql$/.test(file)).sort();
  const statements = (sql: string) => sql.replace(/^\s*--.*$/gm, '')
    .split(/;\s*(?:\r?\n|$)/).map((statement) => statement.trim()).filter(Boolean);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(413209701)`;
    const [existing] = await tx.$queryRaw<Array<{ tbl: string | null }>>`
      SELECT to_regclass('public.hospital_user')::text AS tbl
    `;
    if (!existing?.tbl) {
      for (const statement of statements(await fs.readFile(path.join(prismaDir, 'init.sql'), 'utf-8'))) {
        await tx.$executeRawUnsafe(statement);
      }
    }
    for (const ddl of NON_DESTRUCTIVE_SYNC_SQL) {
      await tx.$executeRawUnsafe(ddl);
    }
    await tx.$executeRaw`CREATE TABLE IF NOT EXISTS hospital_schema_upgrade (
      filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
    )`;
    const applied = await tx.$queryRaw<Array<{ filename: string }>>`SELECT filename FROM hospital_schema_upgrade`;
    for (const filename of migrations) {
      if (applied.some((row) => row.filename === filename)) continue;
      for (const statement of statements(await fs.readFile(path.join(migrationDir, filename), 'utf-8'))) {
        await tx.$executeRawUnsafe(statement);
      }
      await tx.$executeRaw`INSERT INTO hospital_schema_upgrade (filename) VALUES (${filename})`;
    }
  }, { timeout: 120_000, maxWait: 15_000 });
}

export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
