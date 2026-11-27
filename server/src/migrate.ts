import { ensureDatabaseSchema, prisma } from './config/db.js';

try {
  await ensureDatabaseSchema();
  console.log('Green Hospital database is up to date.');
} catch (error) {
  console.error('Green Hospital database migration failed:', error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
