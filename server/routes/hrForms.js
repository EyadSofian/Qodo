/**
 * /api/hr-forms — the New Employee Form, the only HR route a stranger reaches.
 *
 * Written as though every caller is hostile: the link is a 256-bit token stored
 * only as a hash, it expires, it accepts one submission, and an unknown,
 * expired and already-used link all give the same answer so the endpoint
 * cannot be used to probe which links exist. Every route is throttled per
 * address.
 */

import { Router } from 'express';
import { publicForm, submitPublicForm } from '../hr/personnel.js';
import { fail } from './hrFail.js';

const router = Router();
const hits = new Map();
const WINDOW_MS = 10 * 60 * 1000;

function throttled(req, limit) {
  const key = `${req.ip}:${limit}`;
  const entry = hits.get(key);
  if (!entry || Date.now() - entry.first > WINDOW_MS) {
    hits.set(key, { count: 1, first: Date.now() });
    return false;
  }
  entry.count += 1;
  return entry.count > limit;
}

router.use((_req, res, next) => {
  // Personal data is typed into this form; nothing about it may be cached.
  res.setHeader('Cache-Control', 'no-store');
  next();
});

router.get('/:token', async (req, res) => {
  if (throttled(req, 60)) return res.status(429).json({ error: 'rate_limited' });
  try {
    res.json({ form: await publicForm(req.params.token) });
  } catch (error) {
    fail(res, error, 'hr.forms');
  }
});

router.post('/:token', async (req, res) => {
  if (throttled(req, 6)) return res.status(429).json({ error: 'rate_limited' });
  try {
    res.json(await submitPublicForm(req.params.token, req.body ?? {}));
  } catch (error) {
    fail(res, error, 'hr.forms');
  }
});

export default router;
