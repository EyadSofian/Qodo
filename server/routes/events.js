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
import { clearEventsCache, courseDetail, coursesOverview, eventsAnalytics } from '../events.js';
import {
  clearElearningCache,
  elearningAnalytics,
  elearningOverview,
} from '../elearning.js';
import { OdooError, odooConfigured, odooMissingConfig } from '../odoo.js';

const router = Router();

export const EVENTS_APP_ID = 'events';
export const ELEARNING_APP_ID = 'elearning';

router.use(requireAuth);

/**
 * Two tiles, two answers. Somebody allowed to see the training calendar is not
 * automatically allowed to see who finished which video, so the eLearning
 * routes check their own app rather than riding on the events one.
 */
const gate = (appId) => (req, res, next) => {
  if (!canOpenApp(req.user, appId)) return res.status(403).json({ error: 'forbidden' });
  next();
};

function fail(res, error) {
  if (error instanceof OdooError) {
    return res.status(error.status).json({ error: error.message });
  }
  if (Number.isInteger(error?.status) && error.status >= 400 && error.status < 500) {
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

/* ── eLearning ───────────────────────────────────────────────────── */

router.get('/elearning', gate(ELEARNING_APP_ID), async (req, res) => {
  try {
    res.json(await elearningOverview());
  } catch (error) {
    fail(res, error);
  }
});

router.get('/elearning/analytics', gate(ELEARNING_APP_ID), async (req, res) => {
  try {
    res.json(await elearningAnalytics({ from: req.query.from, to: req.query.to }));
  } catch (error) {
    fail(res, error);
  }
});

router.post('/elearning/refresh', gate(ELEARNING_APP_ID), async (req, res) => {
  clearElearningCache();
  try {
    res.json(await elearningOverview());
  } catch (error) {
    fail(res, error);
  }
});

/* ── events ──────────────────────────────────────────────────────── */

router.use(gate(EVENTS_APP_ID));

router.get('/analytics', async (req, res) => {
  try {
    res.json(await eventsAnalytics({ from: req.query.from, to: req.query.to }));
  } catch (error) {
    fail(res, error);
  }
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
