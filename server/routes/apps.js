import dns from 'node:dns/promises';
import net from 'node:net';
import { Router } from 'express';
import { create, find, findOne, getStore } from '../store.js';
import { logActivity, requirePermission } from '../auth.js';
import { PERMISSIONS, can, canOpenApp } from '../../shared/permissions.js';

const router = Router();

/**
 * The tiles this user is allowed to see, already ordered for the grid.
 *
 * `?includeHidden=1` returns every app instead, for whoever manages them. The
 * settings screen needs it: hiding an app used to remove it from this response
 * too, so the row carrying the "show again" button disappeared along with it and
 * a hidden built-in module — which cannot be deleted either — was gone for good.
 */
router.get('/', async (req, res) => {
  const managing =
    ['1', 'true'].includes(String(req.query.includeHidden)) &&
    can(req.user, PERMISSIONS.APPS_MANAGE);

  const apps = await find('apps');
  const visible = (managing ? apps : apps.filter((a) => a.enabled !== false))
    .filter((a) => managing || canOpenApp(req.user, a.id))
    .filter((a) => managing || !a.requires || can(req.user, a.requires))
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  res.json({ apps: visible });
});

router.post('/', requirePermission(PERMISSIONS.APPS_MANAGE), async (req, res) => {
  const parsed = parseAppInput(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const id = slugify(req.body?.id || parsed.value.nameEn || parsed.value.nameAr);
  if (!id) return res.status(400).json({ error: 'id_required' });
  if (await findOne('apps', (a) => a.id === id)) {
    return res.status(409).json({ error: 'id_taken' });
  }

  const apps = await find('apps');
  const app = await create('apps', {
    id,
    kind: 'external',
    builtin: false,
    enabled: true,
    order: Math.max(0, ...apps.map((a) => a.order ?? 0)) + 10,
    ...parsed.value,
  });

  await logActivity({
    actorId: req.user.id,
    action: 'app.create',
    subject: 'app',
    subjectId: app.id,
    meta: { name: app.nameAr },
  });
  res.status(201).json({ app });
});

router.patch('/:id', requirePermission(PERMISSIONS.APPS_MANAGE), async (req, res) => {
  const store = await getStore();
  const app = await findOne('apps', (a) => a.id === req.params.id);
  if (!app) return res.status(404).json({ error: 'not_found' });

  const parsed = parseAppInput(req.body, { partial: true });
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const patch = { ...parsed.value };
  if (req.body?.enabled !== undefined) patch.enabled = Boolean(req.body.enabled);
  if (req.body?.order !== undefined) patch.order = Number(req.body.order) || 0;

  // Built-in modules are React routes — repointing their URL would break them.
  if (app.builtin) {
    delete patch.url;
    delete patch.embed;
  }

  const updated = await store.update('apps', app.id, patch);
  if (patch.url) embedCache.delete(app.id);
  await logActivity({
    actorId: req.user.id,
    action: 'app.update',
    subject: 'app',
    subjectId: app.id,
    meta: { fields: Object.keys(patch) },
  });
  res.json({ app: updated });
});

router.delete('/:id', requirePermission(PERMISSIONS.APPS_MANAGE), async (req, res) => {
  const store = await getStore();
  const app = await findOne('apps', (a) => a.id === req.params.id);
  if (!app) return res.status(404).json({ error: 'not_found' });
  if (app.builtin) return res.status(409).json({ error: 'builtin_app' });

  await store.remove('apps', app.id);
  await logActivity({
    actorId: req.user.id,
    action: 'app.delete',
    subject: 'app',
    subjectId: app.id,
    meta: { name: app.nameAr },
  });
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Can this app be framed?                                              */
/* ------------------------------------------------------------------ */

/**
 * `embed: 'auto'` asks the server rather than guessing: many dashboards send
 * X-Frame-Options or a CSP frame-ancestors directive, and a blocked iframe
 * renders as a blank box with only a console error. Probing once lets the UI
 * fall back to a new tab before the user sees anything broken.
 */
const embedCache = new Map();
const EMBED_TTL = 10 * 60 * 1000;

router.get('/:id/embeddable', async (req, res) => {
  const app = await findOne('apps', (a) => a.id === req.params.id);
  if (!app) return res.status(404).json({ error: 'not_found' });
  if (!canOpenApp(req.user, app.id)) return res.status(403).json({ error: 'forbidden' });
  if (app.kind === 'internal') return res.json({ embeddable: true, reason: 'internal' });
  if (app.embed === 'newtab') return res.json({ embeddable: false, reason: 'configured_newtab' });
  if (app.embed === 'iframe') return res.json({ embeddable: true, reason: 'configured_iframe' });

  const cached = embedCache.get(app.id);
  if (cached && Date.now() - cached.at < EMBED_TTL) {
    return res.json({ ...cached.result, cached: true });
  }

  const result = await probeEmbeddable(app.url);
  embedCache.set(app.id, { at: Date.now(), result });
  res.json(result);
});

async function probeEmbeddable(url) {
  let target;
  try {
    target = new URL(url);
  } catch {
    return { embeddable: false, reason: 'invalid_url' };
  }
  if (!(await isPublicHost(target.hostname))) {
    return { embeddable: false, reason: 'private_host' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(target.href, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'Engosoft-Workspace/1.0 (embed-probe)' },
    });

    const xfo = (response.headers.get('x-frame-options') || '').toLowerCase();
    if (xfo.includes('deny')) return { embeddable: false, reason: 'x-frame-options: deny' };
    if (xfo.includes('sameorigin')) {
      return { embeddable: false, reason: 'x-frame-options: sameorigin' };
    }

    const csp = (response.headers.get('content-security-policy') || '').toLowerCase();
    const ancestors = csp.match(/frame-ancestors([^;]*)/)?.[1]?.trim();
    if (ancestors !== undefined) {
      if (ancestors === "'none'" || ancestors === '') {
        return { embeddable: false, reason: 'csp frame-ancestors: none' };
      }
      if (!ancestors.includes('*')) {
        return { embeddable: 'maybe', reason: `csp frame-ancestors: ${ancestors}` };
      }
    }
    return { embeddable: true, reason: 'no framing restriction' };
  } catch (err) {
    return { embeddable: false, reason: err.name === 'AbortError' ? 'timeout' : 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The probe fetches an admin-supplied URL, so it must not become an SSRF hole
 * into the private network the container sits in. Resolve first, then refuse
 * anything that isn't a public address.
 */
async function isPublicHost(hostname) {
  let addresses = [];
  if (net.isIP(hostname)) {
    addresses = [{ address: hostname }];
  } else {
    try {
      addresses = await dns.lookup(hostname, { all: true });
    } catch {
      return false;
    }
  }
  return addresses.every(({ address }) => !isPrivateAddress(address));
}

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  const v6 = address.toLowerCase();
  if (v6 === '::1' || v6 === '::') return true;
  if (v6.startsWith('fe80') || v6.startsWith('fc') || v6.startsWith('fd')) return true;
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return false;
}

/* ------------------------------------------------------------------ */

const ICONS = [
  'gauge', 'funnel', 'people', 'chat', 'headset', 'kanban',
  'shield', 'sliders', 'grid', 'chart', 'calendar', 'folder', 'bolt', 'globe',
];

function parseAppInput(body, { partial = false } = {}) {
  const value = {};

  if (body?.nameAr !== undefined || !partial) {
    const nameAr = String(body?.nameAr || '').trim();
    if (!nameAr) return { error: 'name_required' };
    value.nameAr = nameAr;
  }
  if (body?.nameEn !== undefined) value.nameEn = String(body.nameEn || '').trim();
  if (body?.descAr !== undefined) value.descAr = String(body.descAr || '').trim();
  if (body?.repo !== undefined) value.repo = String(body.repo || '').trim() || null;
  if (body?.group !== undefined) value.group = String(body.group || 'workspace').trim();

  if (body?.url !== undefined || !partial) {
    const raw = String(body?.url || '').trim();
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      return { error: 'invalid_url' };
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) return { error: 'invalid_protocol' };
    value.url = parsed.href;
  }

  if (body?.icon !== undefined) {
    value.icon = ICONS.includes(body.icon) ? body.icon : 'grid';
  }
  if (body?.color !== undefined) {
    const color = String(body.color || '').trim();
    value.color = /^#[0-9a-f]{6}$/i.test(color) ? color : '#1D6FB8';
  }
  if (body?.embed !== undefined) {
    value.embed = ['auto', 'iframe', 'newtab'].includes(body.embed) ? body.embed : 'auto';
  }

  return { value };
}

function slugify(input) {
  return String(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export default router;
