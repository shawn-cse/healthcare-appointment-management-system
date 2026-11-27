import app from './app.js';
import { ensureDatabaseSchema, prisma } from './config/db.js';
import { env } from './config/env.js';
import { seedDatabase } from './seed/seed.js';
import { hashPassword, validatePasswordStrength } from './utils/password.js';

async function start(): Promise<void> {
  await ensureDatabaseSchema();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (password && !await prisma.user.count({ where: { role: 'admin' } })) {
    const error = validatePasswordStrength(password);
    if (error || password.length < 12) throw new Error('Set a bootstrap password with at least 12 characters, including letters and digits.');
    const hash = await hashPassword(password);
    await prisma.user.create({ data: {
      username: process.env.BOOTSTRAP_ADMIN_USERNAME || 'hospital_admin',
      firstName: 'Hospital Administrator',
      email: (process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase(),
      password: hash, role: 'admin', isStaff: true, isSuperuser: true,
    } });
  }
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
