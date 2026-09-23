/**
 * The Events (training schedule) and eLearning HTTP surface.
 *
 * Read-only towards Odoo, and gated on the app tile rather than a new permission: an
 * administrator already decides who sees "الإيفينتات" from the Allowed apps
 * checkboxes on the user form, and inventing a second place to answer the same
 * question is how the two end up disagreeing. The one exception is schema
 * diagnostics, which describes the integration rather than the courses and is
 * for whoever administers the workspace — and the schedule layout, which is
 * Qodo configuration (never Odoo data) and changes only with
 * `events.manage_layout`.
 */

import { Router } from 'express';
import { logActivity, requireAuth } from '../auth.js';
import { PERMISSIONS, can, canOpenApp } from '../../shared/permissions.js';
import { clearEventsCache, eventsAnalytics } from '../events.js';
import {
  eventDetail,
  scheduleDiagnostics,
  todaySessions,
  trainingArchive,
  trainingSchedule,
} from '../events/schedule.js';
import {
  clearElearningCache,
  elearningAnalytics,
  elearningOverview,
} from '../elearning.js';
import { OdooError, odooConfigured, odooMissingConfig } from '../odoo.js';
import { LayoutConflictError, LayoutRequestError, readLayout, resetLayout, saveLayout, searchLayoutCourses, staleReferences } from '../events/layout.js';
import { LayoutValidationError, arrangeSchedule } from '../../shared/eventsLayout.js';
import { refreshInsightsRevenueSource } from '../insightsRevenue.js';

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

/** Codes the page knows how to explain; anything else from Odoo is summarised. */
const ODOO_CODES = {
  odoo_not_configured: 503,
  odoo_timeout: 504,
  odoo_unreachable: 502,
  odoo_bad_response: 502,
  odoo_schema_changed: 502,
  invalid_course: 400,
  course_not_found: 404,
};

/**
 * Odoo errors, translated for the browser.
 *
 * Two things matter here. Odoo rejecting *our* API key must not travel as a
 * 401: the workspace client reads any 401 as "your Qodo session expired" and
 * signs the person out, which is the wrong fix for somebody else's credential.
 * And Odoo's own error text — which can quote SQL or model internals — is
 * logged, not forwarded.
 */
export function failureFor(error) {
  if (error instanceof OdooError) {
    if (error.message === 'odoo_auth_failed') return { status: 502, error: 'odoo_auth_failed' };
    if (/^odoo_http_\d+$/.test(error.message)) return { status: 502, error: 'odoo_unreachable' };
    if (Object.hasOwn(ODOO_CODES, error.message)) return { status: ODOO_CODES[error.message], error: error.message };
    console.error('[events] odoo:', error.message);
    const denied = /access|not allowed|permission/i.test(error.message);
    return { status: 502, error: denied ? 'odoo_access_denied' : 'odoo_error' };
  }
  if (Number.isInteger(error?.status) && error.status >= 400 && error.status < 500) {
    return { status: error.status, error: error.message };
  }
  console.error('[events]', error);
  return { status: 500, error: 'server_error' };
}

function fail(res, error) {
  const { status, error: code } = failureFor(error);
  return res.status(status).json({ error: code });
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
    const [overview, insightsSync] = await Promise.all([
      elearningOverview(),
      refreshInsightsRevenueSource().catch((error) => ({
        ok: false,
        warning: error?.message || 'insights_refresh_failed',
      })),
    ]);
    res.json({ ...overview, insightsSync });
  } catch (error) {
    fail(res, error);
  }
});

/* ── events ──────────────────────────────────────────────────────── */

router.use(gate(EVENTS_APP_ID));

const handle = (load) => async (req, res) => {
  try {
    res.json(await load(req));
  } catch (error) {
    fail(res, error);
  }
};

router.get('/analytics', handle((req) => eventsAnalytics({ from: req.query.from, to: req.query.to })));

/** `?from=YYYY-MM-DD&to=YYYY-MM-DD` — at most 186 days; defaults to the next 90. */
router.get('/schedule', handle((req) => trainingSchedule({ from: req.query.from, to: req.query.to })));

/** `?year=2026` or `?from&to` (≤ 366 days), `&page=0`, `&q=` name/code search. */
router.get(
  '/archive',
  handle((req) =>
    trainingArchive({
      year: req.query.year,
      from: req.query.from,
      to: req.query.to,
      page: req.query.page,
      q: req.query.q,
    })
  )
);

router.get('/today', handle(() => todaySessions()));

router.get('/diagnostics', (req, res, next) => {
  if (!can(req.user, PERMISSIONS.SETTINGS_MANAGE)) return res.status(403).json({ error: 'forbidden' });
  next();
}, handle(() => scheduleDiagnostics()));

/* ── schedule layout ─────────────────────────────────────────────── */

/**
 * How Qodo arranges Odoo's courses into packages and levels. Everybody with the
 * Events tile reads it; only `events.manage_layout` changes it, and the check
 * is here, not just a hidden button. None of these routes write to Odoo.
 */
const manageLayout = (req, res, next) => {
  if (!can(req.user, PERMISSIONS.EVENTS_MANAGE_LAYOUT)) {
    return res.status(403).json({ error: 'forbidden', missing: PERMISSIONS.EVENTS_MANAGE_LAYOUT });
  }
  next();
};

function failLayout(res, error) {
  if (error instanceof LayoutConflictError) return res.status(409).json({ error: 'layout_conflict', current: error.current });
  if (error instanceof LayoutValidationError || error instanceof LayoutRequestError) {
    return res.status(400).json({ error: error.message, detail: error.detail ?? null });
  }
  return fail(res, error);
}

const auditLayout = (req) => ({ organizationId, revision, departments, reset }) =>
  logActivity({
    actorId: req.user.id,
    organizationId,
    action: 'events.layout_updated',
    subject: 'eventLayout',
    subjectId: `${organizationId}:schedule`,
    meta: { revision, departments, reset },
  });

router.get('/layout', async (req, res) => {
  try {
    const layout = await readLayout(req.user);
    res.json({ ...layout, canManage: can(req.user, PERMISSIONS.EVENTS_MANAGE_LAYOUT) });
  } catch (error) {
    failLayout(res, error);
  }
});

/** Body: `{ layout, expectedRevision }`. 409 with `current` when somebody saved in between. */
router.put('/layout', manageLayout, async (req, res) => {
  try {
    res.json(await saveLayout(req.user, req.body, { audit: auditLayout(req) }));
  } catch (error) {
    failLayout(res, error);
  }
});

/** Body: `{ expectedRevision }`. Restores the workbook structure; Odoo is untouched. */
router.post('/layout/reset', manageLayout, async (req, res) => {
  try {
    res.json(await resetLayout(req.user, req.body, { audit: auditLayout(req) }));
  } catch (error) {
    failLayout(res, error);
  }
});

/** Layout references Odoo no longer has — shown as "Unavailable in Odoo" in the editor. */
router.get('/layout/references', manageLayout, handle((req) => staleReferences(req.user)));

/** The course picker, beyond the loaded date range: `?q=` name or code. */
router.get('/layout/search', manageLayout, handle((req) => searchLayoutCourses(req.query.q)));

/** Courses in `?from&to` that the layout does not place yet (new in Odoo, or removed from a package). */
router.get(
  '/layout/unassigned',
  manageLayout,
  handle(async (req) => {
    const [schedule, { layout }] = await Promise.all([
      trainingSchedule({ from: req.query.from, to: req.query.to }),
      readLayout(req.user),
    ]);
    const { unassigned } = arrangeSchedule(schedule.rows, layout);
    return {
      rows: unassigned.map(({ id, courseName, courseCode, instructor, department, trainingType, startsAt, endsAt, statusCanonical }) => ({
        id,
        courseName,
        courseCode,
        instructor,
        department,
        trainingType,
        startsAt,
        endsAt,
        statusCanonical,
      })),
      fetchedAt: schedule.fetchedAt,
    };
  })
);

router.get('/:id', handle((req) => eventDetail(req.params.id)));

/**
 * The Sync button. Expires every Events cache (keeping the last good answer
 * for a failure), fetches the schedule the page is looking at again, and asks
 * Insights Hub to refresh its revenue source — the same side effect the old
 * refresh had, so the analysis tab's money figures move with it.
 */
router.post('/refresh', async (req, res) => {
  clearEventsCache();
  try {
    const range = { from: req.body?.from ?? req.query.from, to: req.body?.to ?? req.query.to };
    const [schedule, insightsSync] = await Promise.all([
      trainingSchedule(range),
      refreshInsightsRevenueSource().catch((error) => ({
        ok: false,
        warning: error?.message || 'insights_refresh_failed',
      })),
    ]);
    res.json({ schedule, insightsSync });
  } catch (error) {
    fail(res, error);
  }
});

export default router;
