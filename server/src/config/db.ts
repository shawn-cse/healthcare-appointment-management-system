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

export async function ensureDatabaseSchema(): Promise<void> {
  const existing = await prisma.$queryRaw<Array<{ tbl: string | null }>>`
    SELECT to_regclass('public.hospital_user')::text AS tbl
  `;
  if (existing[0]?.tbl) {
    return;
  }

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

export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
