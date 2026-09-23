/**
 * The Events schedule layout — persistence, the workbook default, and the
 * rules a save has to pass.
 *
 * One document per organization in `eventLayouts`, holding the whole
 * arrangement (every department) under a single revision. One document rather
 * than one per department because "an Odoo event appears once in the layout"
 * is a rule across departments, and a move from Mechanical to Companies
 * Courses must land as one write, not two that can half-succeed.
 *
 * Until somebody saves, the layout is the default: the workbook seed
 * (shared/eventsLayoutSeed.js) with each course code resolved to an Odoo event
 * id. Nothing here writes to Odoo; the only Odoo reads are that resolution,
 * an existence check on ids a save introduces, and the course picker search.
 *
 * Concurrency is optimistic: a save names the revision it was edited from and
 * is refused with 409 if the stored revision has moved on. Saves in this
 * process are serialised, so the check and the write cannot interleave.
 */

import { OdooError, odooConfigured, searchRead } from '../odoo.js';
import { getStore } from '../store.js';
import { makeCache } from '../cache.js';
import { organizationOf } from '../../shared/organization.js';
import { EVENTS_LAYOUT_SEED } from '../../shared/eventsLayoutSeed.js';
import {
  LAYOUT_DEPARTMENTS,
  buildDefaultLayout,
  emptyLayout,
  normaliseCourseCode,
  placementIndex,
  referencedEventIds,
  validateLayout,
} from '../../shared/eventsLayout.js';

export const LAYOUT_COLLECTION = 'eventLayouts';

const odooClient = { searchRead };
/** The seed only changes with a deploy; the ids it resolves to almost never. */
const defaultCache = makeCache(6 * 3_600_000);

export class LayoutConflictError extends Error {
  constructor(current) {
    super('layout_conflict');
    this.status = 409;
    this.current = current;
  }
}

export class LayoutRequestError extends Error {
  constructor(code, detail = null, status = 400) {
    super(code);
    this.status = status;
    this.detail = detail;
  }
}

const docId = (organizationId) => `${organizationId}:schedule`;

/** Every code the seed mentions, in Odoo's spelling and ours. */
function seedCodes(seed = EVENTS_LAYOUT_SEED) {
  const codes = new Set();
  for (const department of seed.departments ?? []) {
    for (const pkg of department.packages ?? []) {
      for (const course of [...(pkg.courses ?? []), ...(pkg.groups ?? []).flatMap((group) => group.courses ?? [])]) {
        const code = normaliseCourseCode(course.code);
        if (code) codes.add(code);
      }
    }
  }
  return [...codes];
}

/**
 * The workbook default with Odoo ids. One `search_read` for every seeded
 * code. Odoo writes codes as "E0" + digits ("E05592"); both that and the bare
 * digits are asked for, and matched after normalising, so a prefix change in
 * Odoo does not silently empty the default.
 */
export async function resolveDefaultLayout({ client = odooClient, seed = EVENTS_LAYOUT_SEED } = {}) {
  const codes = seedCodes(seed);
  const spellings = [...new Set(codes.flatMap((code) => [code, `E${code.padStart(5, '0')}`, `E${code}`]))];
  const events = codes.length
    ? await client.searchRead('event.event', [['code', 'in', spellings]], ['code', 'date_begin'], {
        limit: spellings.length * 2 + 50,
        context: { active_test: false },
      })
    : [];
  const byCode = new Map();
  for (const event of events) {
    const code = normaliseCourseCode(event.code);
    if (!code) continue;
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code).push({ id: event.id, dateBegin: event.date_begin || null });
  }
  return buildDefaultLayout(seed, (code) => byCode.get(code) ?? []);
}

async function cachedDefault(client) {
  if (client === odooClient && !odooConfigured()) return { layout: emptyLayout(), unresolved: [], pending: true };
  try {
    return await defaultCache.get('default', () => resolveDefaultLayout({ client }));
  } catch (error) {
    // Odoo down and nothing resolved yet: the schedule still works, every
    // course simply shows as not yet placed. Never an error page for this.
    console.error('[events] default layout unavailable:', error?.message);
    return { layout: emptyLayout(), unresolved: [], pending: true };
  }
}

async function readDoc(organizationId) {
  const store = await getStore();
  return store.get(LAYOUT_COLLECTION, docId(organizationId));
}

function publicMeta(doc) {
  return {
    revision: doc?.revision ?? 0,
    updatedAt: doc?.updatedAt ?? null,
    updatedBy: doc?.updatedBy ?? null,
  };
}

/**
 * What the page draws with: the saved layout, or the resolved default.
 * `isDefault` says which; `defaultPending` says the default could not be
 * resolved yet (Odoo unreachable), so the page can say courses are unplaced
 * for that reason rather than because nobody organised them.
 */
export async function readLayout(user, { client = odooClient } = {}) {
  const organizationId = organizationOf(user);
  const doc = await readDoc(organizationId);
  if (doc) {
    return { layout: validateLayout(doc.layout), ...publicMeta(doc), isDefault: false, defaultPending: false };
  }
  const resolved = await cachedDefault(client);
  return {
    layout: resolved.layout,
    ...publicMeta(null),
    isDefault: true,
    defaultPending: Boolean(resolved.pending),
    unresolvedDefault: resolved.unresolved.length,
  };
}

/* ── serialised writes ───────────────────────────────────────────── */

let chain = Promise.resolve();
function exclusive(work) {
  const run = chain.then(work, work);
  chain = run.catch(() => {});
  return run;
}

/** Ids that exist in Odoo, among `ids`. Archived events count as existing. */
async function existingEventIds(client, ids) {
  if (ids.length === 0) return new Set();
  const rows = await client.searchRead('event.event', [['id', 'in', ids]], ['id'], {
    limit: ids.length,
    context: { active_test: false },
  });
  return new Set(rows.map((row) => row.id));
}

function departmentsChanged(before, after) {
  return LAYOUT_DEPARTMENTS.filter((name) => {
    const a = before.departments.find((entry) => entry.department === name);
    const b = after.departments.find((entry) => entry.department === name);
    return JSON.stringify(a) !== JSON.stringify(b);
  });
}

async function write(user, organizationId, layout, revision) {
  const store = await getStore();
  const stamp = new Date().toISOString();
  const doc = {
    id: docId(organizationId),
    organizationId,
    layout,
    revision,
    updatedAt: stamp,
    updatedBy: { id: user.id, name: user.name ?? user.email ?? null },
  };
  // The file store's insert appends, so an existing document is updated in place.
  if (await store.get(LAYOUT_COLLECTION, doc.id)) await store.update(LAYOUT_COLLECTION, doc.id, doc);
  else await store.insert(LAYOUT_COLLECTION, { createdAt: stamp, ...doc });
  return doc;
}

/**
 * Save a layout edited from `expectedRevision`.
 *
 * - The JSON is rebuilt by `validateLayout` (shape, lengths, unique ids, one
 *   placement per event); anything else is a 400.
 * - A stale `expectedRevision` is a 409 carrying who saved in between.
 * - Event ids this save *introduces* must exist in Odoo. Ids already in the
 *   layout that Odoo has since lost are kept — the editor shows them as
 *   unavailable and a manager removes them deliberately. If Odoo cannot be
 *   reached the check is skipped rather than blocking the save: every id the
 *   editor offers came from Odoo in the first place.
 */
export function saveLayout(user, body, { client = odooClient, audit = null } = {}) {
  return exclusive(async () => {
    const organizationId = organizationOf(user);
    const expected = body?.expectedRevision;
    if (!Number.isInteger(expected) || expected < 0) throw new LayoutRequestError('layout_revision_required');
    const layout = validateLayout(body?.layout);

    const doc = await readDoc(organizationId);
    const current = publicMeta(doc);
    if (current.revision !== expected) throw new LayoutConflictError(current);

    const before = doc ? validateLayout(doc.layout) : (await cachedDefault(client)).layout;
    const known = new Set(referencedEventIds(before));
    const introduced = referencedEventIds(layout).filter((id) => !known.has(id));
    if (introduced.length && (client !== odooClient || odooConfigured())) {
      let existing = null;
      try {
        existing = await existingEventIds(client, introduced);
      } catch (error) {
        if (!(error instanceof OdooError)) throw error;
      }
      const unknown = existing ? introduced.filter((id) => !existing.has(id)) : [];
      if (unknown.length) throw new LayoutRequestError('layout_unknown_event', unknown.slice(0, 20));
    }

    const saved = await write(user, organizationId, layout, current.revision + 1);
    await audit?.({ organizationId, revision: saved.revision, departments: departmentsChanged(before, layout), reset: false });
    return { layout, ...publicMeta(saved), isDefault: false, defaultPending: false };
  });
}

/**
 * Back to the workbook structure. Written as a new revision, not a delete, so
 * somebody still editing the old one gets a conflict instead of silently
 * overwriting the reset. Needs Odoo: a "default" with nothing resolved would
 * wipe the arrangement for nothing.
 */
export function resetLayout(user, body, { client = odooClient, audit = null } = {}) {
  return exclusive(async () => {
    const organizationId = organizationOf(user);
    const expected = body?.expectedRevision;
    if (!Number.isInteger(expected) || expected < 0) throw new LayoutRequestError('layout_revision_required');
    const doc = await readDoc(organizationId);
    const current = publicMeta(doc);
    if (current.revision !== expected) throw new LayoutConflictError(current);

    defaultCache.clear();
    if (client === odooClient && !odooConfigured()) throw new OdooError('odoo_not_configured', 503);
    const { layout } = await resolveDefaultLayout({ client });
    const before = doc ? validateLayout(doc.layout) : layout;
    const saved = await write(user, organizationId, validateLayout(layout), current.revision + 1);
    await audit?.({ organizationId, revision: saved.revision, departments: departmentsChanged(before, layout), reset: true });
    return { layout, ...publicMeta(saved), isDefault: false, defaultPending: false };
  });
}

/**
 * Which ids the layout references that Odoo no longer has — the editor marks
 * them "Unavailable in Odoo". One bounded read.
 */
export async function staleReferences(user, { client = odooClient } = {}) {
  const { layout } = await readLayout(user, { client });
  const ids = referencedEventIds(layout);
  if (client === odooClient && !odooConfigured()) throw new OdooError('odoo_not_configured', 503);
  const existing = await existingEventIds(client, ids);
  const index = placementIndex(layout);
  return {
    missing: ids
      .filter((id) => !existing.has(id))
      .map((id) => ({ eventId: id, code: index.get(id)?.code ?? null, packageId: index.get(id)?.packageId ?? null })),
    checked: ids.length,
  };
}

/**
 * The course picker's reach beyond the loaded date range: Odoo events by name
 * or code. Names and dates only — the page already has the full rows for
 * everything in range.
 */
export async function searchLayoutCourses(query, { client = odooClient } = {}) {
  const q = typeof query === 'string' ? query.trim().slice(0, 80) : '';
  if (q.length < 2) return { results: [] };
  if (client === odooClient && !odooConfigured()) throw new OdooError('odoo_not_configured', 503);
  const digits = normaliseCourseCode(q);
  const domain = ['|', ['name', 'ilike', q], ['code', 'ilike', digits && /^\s*[Ee]?\d+\s*$/.test(q) ? digits : q]];
  const rows = await client.searchRead('event.event', domain, ['name', 'code', 'date_begin', 'date_end'], {
    limit: 30,
    order: 'date_begin desc',
  });
  return {
    results: rows.map((row) => ({
      id: row.id,
      courseName: row.name || '',
      courseCode: row.code || null,
      startsAt: row.date_begin ? `${String(row.date_begin).replace(' ', 'T')}Z` : null,
      endsAt: row.date_end ? `${String(row.date_end).replace(' ', 'T')}Z` : null,
    })),
  };
}

/** For tests: forget the resolved default. */
export function clearLayoutCaches() {
  defaultCache.clear();
}
