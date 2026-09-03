/**
 * Engosoft Workspace — API + static host.
 *
 * In development Vite serves the UI on :5174 and proxies /api here.
 * In production this process serves both: `npm run build && npm start`.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import express from 'express';
import cookieParser from 'cookie-parser';

import { attachUser } from './auth.js';
import { seed } from './seed.js';
import { getStore } from './store.js';
import { initPush } from './push.js';
import { startScheduler } from './scheduler.js';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import inviteRoutes from './routes/invites.js';
import appRoutes from './routes/apps.js';
import taskRoutes from './routes/tasks.js';
import hrOperationsRoutes from './routes/hrOperations.js';
import hrRoutes from './routes/hr.js';
import kpiRoutes from './routes/kpi.js';
import notificationRoutes from './routes/notifications.js';
import searchRoutes from './routes/search.js';
import assistantRoutes from './routes/assistant.js';
import managementRoutes from './routes/management.js';
import pushRoutes from './routes/push.js';
import eventRoutes from './routes/events.js';
import mailRoutes from './routes/mail.js';
import calendarRoutes from './routes/calendar.js';
import officeRoutes from './routes/offices.js';
import bookingRoutes from './routes/booking.js';
import publicBookingRoutes from './routes/publicBooking.js';
import priceRoutes from './routes/prices.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '..', 'dist');
const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // Railway terminates TLS in front of us.

app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // The hub frames sibling apps; nothing is allowed to frame the hub itself.
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

app.use('/api', attachUser);
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
// Two of these are public by design — the join page has no session yet.
app.use('/api/invites', inviteRoutes);
app.use('/api/apps', appRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/hr-operations', hrOperationsRoutes);
app.use('/api/hr', hrRoutes);
app.use('/api/kpi', kpiRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/assistant', assistantRoutes);
// The two webhook routes inside are the only unauthenticated ones — a Telegram
// bot has no session. They carry a shared secret instead.
app.use('/api/management', managementRoutes);
app.use('/api/push', pushRoutes);
// Courses, read out of Odoo. Read-only and optional — see server/odoo.js.
app.use('/api/events', eventRoutes);
app.use('/api/mail', mailRoutes);
// Meetings and appointments. Every member has one; what an entry reaches is
// decided per entry, not by role.
app.use('/api/calendar', calendarRoutes);
// The seating plan. Reading it needs a session and nothing more; moving anyone
// needs `offices.manage`, which belongs to no role.
app.use('/api/offices', officeRoutes);
// Publishing a booking page and reading who took an hour — behind
// `calendar.booking`, which an administrator grants one person at a time.
app.use('/api/booking', bookingRoutes);
// The only router in this app a stranger can reach. Every handler inside is
// throttled per address and answers with nothing that identifies an employee
// beyond the name they chose to publish — see routes/publicBooking.js.
app.use('/api/book', publicBookingRoutes);
// The price a seller may quote, proxied from the Insights Hub — see routes/prices.js.
app.use('/api/prices', priceRoutes);

app.get('/api/health', async (_req, res) => {
  const store = await getStore();
  res.json({ ok: true, storage: store.kind, uptime: Math.round(process.uptime()) });
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity.
app.use((err, _req, res, _next) => {
  console.error('[api]', err);
  res.status(500).json({ error: 'server_error' });
});

if (fs.existsSync(DIST)) {
  app.use(
    express.static(DIST, {
      setHeaders: (res, filePath) => {
        // Hashed bundles are immutable; index.html must never be cached or a
        // deploy leaves people on the old app.
        if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
        else if (/\.[0-9a-f]{8,}\./.test(filePath)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    })
  );
  app.get('*', (_req, res) => res.sendFile(path.join(DIST, 'index.html')));
} else {
  app.get('*', (_req, res) =>
    res
      .status(503)
      .type('text/plain; charset=utf-8')
      .send('لسه مفيش build. شغّل: npm run build  (أو npm run dev للتطوير)')
  );
}

const store = await seed();
await initPush();
startScheduler();
app.listen(PORT, () => {
  console.log(`[engosoft-workspace] API on :${PORT} — storage: ${store.kind}`);
  if (!fs.existsSync(DIST)) console.log('[engosoft-workspace] no dist/ yet — dev mode');
});
