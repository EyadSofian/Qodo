/**
 * The courses page's HTTP surface.
 *
 * Read-only, and gated on the app tile rather than a new permission: an
 * administrator already decides who sees "الكورسات" from the Allowed apps
 * checkboxes on the user form, and inventing a second place to answer the same
 * question is how the two end up disagreeing.
 */

import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { canOpenApp } from '../../shared/permissions.js';
import { clearEventsCache, courseDetail, coursesOverview } from '../events.js';
import { OdooError, odooConfigured, odooMissingConfig } from '../odoo.js';

const router = Router();

export const EVENTS_APP_ID = 'events';

router.use(requireAuth);
router.use((req, res, next) => {
  if (!canOpenApp(req.user, EVENTS_APP_ID)) return res.status(403).json({ error: 'forbidden' });
  next();
});

function fail(res, error) {
  if (error instanceof OdooError) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error('[events]', error);
  return res.status(500).json({ error: 'server_error' });
}

/**
 * Whether the connection is even set up, answered before any data is asked for.
 * A page that can say "ODOO_LOGIN is not set" saves somebody an hour of staring
 * at an empty board wondering whether there are simply no courses today.
 */
router.get('/status', (req, res) => {
  res.json({ configured: odooConfigured(), missing: odooMissingConfig() });
});

router.get('/', async (req, res) => {
  try {
    const days = Math.min(Math.max(Number(req.query.days) || 14, 1), 60);
    res.json(await coursesOverview({ days }));
  } catch (error) {
    fail(res, error);
  }
});

router.get('/:id', async (req, res) => {
  try {
    res.json({ course: await courseDetail(req.params.id) });
  } catch (error) {
    fail(res, error);
  }
});

/** The refresh button — the cache is a minute long, and sometimes that is a minute too many. */
router.post('/refresh', async (req, res) => {
  clearEventsCache();
  try {
    res.json(await coursesOverview({}));
  } catch (error) {
    fail(res, error);
  }
});

export default router;
