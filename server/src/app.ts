import fs from 'node:fs';
import compression from 'compression';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { checkDatabaseHealth } from './config/db.js';
import { env } from './config/env.js';
import * as appointments from './controllers/appointments.js';
import { asyncHandler, errorHandler, notFound } from './middleware/error.js';
import routes from './routes/index.js';

const app = express();

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
  })
);
app.use(compression());
app.use(cors({ origin: env.clientUrl || true, credentials: true }));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

if (env.nodeEnv !== 'test') {
  app.use(morgan('dev'));
}

fs.mkdirSync(env.mediaRoot, { recursive: true });
app.use(
  '/media',
  (req, res, next) => {
    let path: string;
    try { path = decodeURIComponent(req.path); }
    catch { res.sendStatus(400); return; }
    if (!/^\/profiles\/[A-Za-z0-9_.-]+$/.test(path)) { res.sendStatus(404); return; }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  },
  express.static(env.mediaRoot)
);

app.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const ok = await checkDatabaseHealth();
    if (ok) {
      res.json({ status: 'ok', db: 'connected' });
      return;
    }
    res.status(503).json({ status: 'error', db: 'unavailable' });
  })
);

// Direct SSLCOMMERZ callback compatibility (GET & POST redirects/IPN)
app.all('/payments/callback/:result', asyncHandler(appointments.paymentCallback));
app.all('/payments/callback/:result/', asyncHandler(appointments.paymentCallback));

app.use('/api', routes);

app.use(notFound);
app.use(errorHandler);

export default app;
