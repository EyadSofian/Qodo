/**
 * The price a seller may quote, read from the Insights Hub.
 *
 * The hub owns the price book and the rule that turns it into a number: what the
 * band is, where inside it to open, and whether a figure needs a manager. None
 * of that is re-implemented here, because a seller quoting one number while the
 * hub's own compliance report judges them by another is the failure this module
 * exists to avoid. This is a proxy with an opinion about who may ask.
 *
 * Two credentials, doing two different jobs:
 *
 *   * The workspace session says *which person* this is, and `canOpenApp` says
 *     whether they were given the tile. Gated on the tile rather than a new
 *     permission for the same reason `events.js` is: an administrator already
 *     answers "who sees prices?" from the Allowed apps checkboxes, and a second
 *     place to answer it is how the two end up disagreeing.
 *   * `INSIGHTS_INTERNAL_SECRET` proves to the hub that *this process* is the
 *     workspace. It never reaches the browser.
 *
 * So the hub's URL stays irrelevant to the people using this: their browser
 * never talks to it, and nobody needs a second account there.
 */

import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { canOpenApp } from '../../shared/permissions.js';
import { makeCache } from '../cache.js';

const router = Router();

export const PRICES_APP_ID = 'prices';

const DEFAULT_HUB = 'https://engosoft-insights-hub-production.up.railway.app';

const hubUrl = () => (process.env.INSIGHTS_HUB_URL || DEFAULT_HUB).trim().replace(/\/+$/, '');
const secret = () => (process.env.INSIGHTS_INTERNAL_SECRET || '').trim();

/**
 * The published book changes when somebody publishes one — days apart, not
 * seconds. Ten minutes of cache turns a room full of sellers searching during a
 * call into a handful of reads, and `makeCache` serves the last good answer if
 * the hub blinks, which is worth more mid-call than an error.
 */
const cache = makeCache(10 * 60 * 1000);

router.use(requireAuth);
router.use((req, res, next) => {
  if (!canOpenApp(req.user, PRICES_APP_ID)) return res.status(403).json({ error: 'forbidden' });
  next();
});

/**
 * Whether the link to the hub is set up at all, answered before any price is
 * asked for — so the page can say "the secret is not set" instead of leaving
 * somebody staring at an empty result wondering if the course simply has no
 * price.
 */
router.get('/status', (req, res) => {
  res.json({ configured: Boolean(secret()), hub: hubUrl() });
});

const FORWARDED = ['q', 'key', 'code', 'market', 'payment', 'state', 'asked', 'mode'];

router.get('/advice', async (req, res) => {
  if (!secret()) return res.status(503).json({ error: 'prices_not_configured' });

  const query = new URLSearchParams();
  for (const name of FORWARDED) {
    const value = req.query[name];
    if (typeof value === 'string' && value.trim()) query.set(name, value.trim().slice(0, 320));
  }
  if (!query.has('q') && !query.has('key') && !query.has('code')) {
    return res.status(400).json({ error: 'course_required' });
  }

  const url = `${hubUrl()}/api/prices/advice?${query}`;
  // A typed figure is a deliberate act, not a keystroke storm, and caching per
  // number would fill the map with one entry per digit somebody typed. The
  // search-as-you-type path is the one that benefits, and it is the one cached.
  const load = () => fetchAdvice(url);

  try {
    res.json(query.has('asked') ? await load() : await cache.get(url, load));
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: 'invalid_price_query' });
    console.error('[prices]', error.message);
    res.status(502).json({ error: 'prices_upstream' });
  }
});

async function fetchAdvice(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'x-service-secret': secret() },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    // A 400 is about what was typed, and belongs to whoever typed it — a figure
    // that is not a number should say so. Every other refusal is about *this
    // server's* own credential, which is an operator's problem: reporting it to
    // a salesperson as if their session had expired would send them to the wrong
    // person. Only the status travels; the hub's wording never does.
    const error = new Error(`hub returned HTTP ${response.status}`);
    if (response.status === 400) error.status = 400;
    throw error;
  }
  return response.json();
}

export default router;
