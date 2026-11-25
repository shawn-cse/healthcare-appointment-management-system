import app from './app.js';
import { ensureDatabaseSchema, prisma } from './config/db.js';
import { env } from './config/env.js';
import { seedDatabase } from './seed/seed.js';

async function start(): Promise<void> {
  await ensureDatabaseSchema();
  if (env.seedStarterAccounts) {
    await seedDatabase();
  }
  const server = app.listen(env.port, () => {
    console.log(`[server] Green Hospital API listening on http://localhost:${env.port}`);
  });

  const shutdown = async () => {
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch(async (err) => {
  console.error('[server] Startup failed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
