/**
 * Odoo employees, joined to the HR database, and their real photos.
 *
 * The HR database is keyed by employee code. Odoo carries the same code in
 * `hr.employee.registration_number`: production discovery (2026-09-25) found
 * 308 employees joined that way with not one disagreement against the e-mail
 * or the name join. So the join is, in order: the code, the work e-mail equal
 * to the HR company e-mail, or an identical and unique full English name.
 * Anything looser — a first name, a fuzzy spelling — can put one person's
 * photo on another person's card, which is worse than showing initials.
 *
 * Photos come from `hr.employee.image_128` / `image_512` only. Those fields
 * are empty when nobody uploaded a picture; `avatar_*` would instead hand back
 * Odoo's generated placeholder, and a placeholder presented as a photo is
 * exactly the fake face this module must never show. SVG is refused outright
 * for the same reason (and because an SVG can carry script).
 */

import { existingFields, odooConfigured, odooRecordUrl, searchRead } from '../odoo.js';

const INDEX_TTL_MS = 30 * 60 * 1000;
const PHOTO_TTL_MS = 6 * 60 * 60 * 1000;
const PHOTO_SIZES = { 128: { field: 'image_128', maxBytes: 256 * 1024 }, 512: { field: 'image_512', maxBytes: 1024 * 1024 } };

let index = null;
let indexPromise = null;
const photos = new Map();
const photoLoads = new Map();

export function comparableEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

/** "ENG.Taha Aref" and "Taha Aref" are the same name; "Miss.Dina" is "Dina". */
export function comparableName(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^\s*(eng|engineer|mr|mrs|miss|ms|dr)\s*\.?\s*/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function comparableCode(value) {
  const code = String(value ?? '').trim();
  return /^\d{1,8}$/.test(code) ? String(Number(code)) : code.toLowerCase();
}

/**
 * A key → row map where a key held by two people joins nobody — unless exactly
 * one of them is still active, because a rehire leaves the old record behind.
 */
function uniqueMap(rows, keyOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const map = new Map();
  for (const [key, group] of groups) {
    if (group.length === 1) map.set(key, group[0]);
    else {
      const active = group.filter((row) => row.active);
      map.set(key, active.length === 1 ? active[0] : null);
    }
  }
  return map;
}

const DEPARTMENT_FIELDS = ['name', 'parent_id', 'manager_id', 'color', 'active'];

async function loadIndex() {
  const wanted = ['name', 'work_email', 'registration_number', 'department_id', 'job_id', 'job_title', 'parent_id', 'coach_id', 'leave_manager_id', 'user_id', 'active', 'work_location_id', 'address_id', 'work_phone', 'mobile_phone', 'employee_type', 'first_contract_date', 'departure_date'];
  const [fields, departmentFields] = await Promise.all([existingFields('hr.employee', wanted), existingFields('hr.department', DEPARTMENT_FIELDS)]);
  const [rows, departments] = await Promise.all([
    searchRead('hr.employee', [], fields, { limit: 5000, context: { active_test: false } }),
    searchRead('hr.department', [], departmentFields, { limit: 1000, context: { active_test: false } }).catch(() => []),
  ]);
  return {
    at: Date.now(),
    rows,
    byId: new Map(rows.map((row) => [row.id, row])),
    byCode: uniqueMap(rows, (row) => (row.registration_number ? comparableCode(row.registration_number) : '')),
    byEmail: uniqueMap(rows, (row) => comparableEmail(row.work_email)),
    byName: uniqueMap(rows, (row) => comparableName(row.name)),
    departments: new Map(departments.map((row) => [row.id, row])),
  };
}

/**
 * The cached index, refreshed in the background once stale. Never throws.
 * `timeoutMs` bounds the wait: a page render will not sit behind a 30-second
 * Odoo, it takes the last good index (or none) and the next render catches up.
 */
export async function odooEmployeeIndex({ wait = true, timeoutMs = null } = {}) {
  if (!odooConfigured()) return null;
  const fresh = index && Date.now() - index.at < INDEX_TTL_MS;
  if (fresh) return index;
  if (!indexPromise) {
    indexPromise = loadIndex()
      .then((value) => {
        index = value;
        // Learn who has a photo in the background, so a page can put real faces first.
        void warmActivePhotos(value);
        return value;
      })
      .catch((error) => {
        console.warn('[hr] Odoo employee index unavailable:', error?.message ?? error);
        return index;
      })
      .finally(() => {
        indexPromise = null;
      });
  }
  if (!wait) return index;
  if (!timeoutMs) return indexPromise;
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(index), timeoutMs);
  });
  try {
    return await Promise.race([indexPromise ?? Promise.resolve(index), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** The Odoo employee for one HR profile, or null: by code, then e-mail, then a unique name. */
export function odooEmployeeFor(profile, currentIndex = index) {
  if (!currentIndex || !profile) return null;
  const viaCode = profile.employeeCode ? currentIndex.byCode?.get(comparableCode(profile.employeeCode)) : null;
  if (viaCode) return viaCode;
  const email = comparableEmail(profile.companyEmail);
  const viaEmail = email ? currentIndex.byEmail.get(email) : null;
  if (viaEmail) return viaEmail;
  const name = comparableName(profile.nameEnglish);
  return name ? currentIndex.byName.get(name) ?? null : null;
}

/**
 * Every HR profile's Odoo match, and the active Odoo employees nobody in the
 * HR file claims — the people HR has not added to its own records yet.
 */
export function matchOdooEmployees(profiles, currentIndex = index) {
  const byCode = new Map();
  const matched = new Set();
  if (!currentIndex) return { byCode, odooOnly: [] };
  for (const profile of profiles) {
    const row = odooEmployeeFor(profile, currentIndex);
    if (!row) continue;
    byCode.set(profile.employeeCode, row);
    matched.add(row.id);
  }
  const odooOnly = currentIndex.rows.filter((row) => row.active && !matched.has(row.id));
  return { byCode, odooOnly };
}

/** The key an Odoo-only employee is addressed by: their code when Odoo has one, else `o<id>`. */
export function odooOnlyCode(row) {
  return row?.registration_number ? comparableCode(row.registration_number) : `o${row?.id}`;
}

/** Resolve `o<id>` or a code that only Odoo knows. */
export function odooEmployeeByKey(key, currentIndex = index) {
  if (!currentIndex) return null;
  const text = String(key ?? '').trim();
  const direct = /^o(\d+)$/i.exec(text);
  if (direct) return currentIndex.byId.get(Number(direct[1])) ?? null;
  return currentIndex.byCode.get(comparableCode(text)) ?? null;
}

export function odooDepartmentName(row) {
  return Array.isArray(row?.department_id) ? String(row.department_id[1] ?? '') : '';
}

export function odooWorkLocation(row) {
  if (Array.isArray(row?.work_location_id)) return String(row.work_location_id[1] ?? '');
  if (Array.isArray(row?.address_id)) return String(row.address_id[1] ?? '');
  return '';
}

const many2one = (value) => (Array.isArray(value) ? { id: value[0], name: String(value[1] ?? '') } : null);

/**
 * What HR may show about an Odoo employee. Private e-mail, birthday, ID
 * numbers and the mobile phone stay in Odoo; the work phone and e-mail are the
 * company's. `codeFor` turns an Odoo id into the HR code the page links to.
 */
export function publicOdooEmployee(row, { codeFor = () => null } = {}) {
  if (!row) return null;
  const manager = many2one(row.parent_id);
  const coach = many2one(row.coach_id);
  return {
    odooId: row.id,
    name: String(row.name ?? ''),
    jobTitle: String(row.job_title || (Array.isArray(row.job_id) ? row.job_id[1] : '') || ''),
    department: odooDepartmentName(row),
    departmentId: Array.isArray(row.department_id) ? row.department_id[0] : null,
    manager: manager ? { ...manager, code: codeFor(manager.id) } : null,
    coach: coach ? { ...coach, code: codeFor(coach.id) } : null,
    leaveApprover: many2one(row.leave_manager_id)?.name ?? '',
    workEmail: String(row.work_email || ''),
    workPhone: String(row.work_phone || ''),
    workLocation: odooWorkLocation(row),
    employeeType: String(row.employee_type || ''),
    since: row.first_contract_date || null,
    active: Boolean(row.active),
    url: odooRecordUrl('hr.employee', row.id),
  };
}

function sniff(bytes) {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length > 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length > 6 && bytes.toString('ascii', 0, 3) === 'GIF') return 'image/gif';
  return null;
}

const photoKey = (id, size) => `${id}:${size}`;

async function loadPhotos(ids, size) {
  const { field, maxBytes } = PHOTO_SIZES[size];
  const rows = await searchRead('hr.employee', [['id', 'in', ids]], [field], { context: { active_test: false } });
  const stamp = Date.now();
  for (const id of ids) {
    const row = rows.find((item) => item.id === id);
    let photo = null;
    if (row?.[field]) {
      const bytes = Buffer.from(String(row[field]), 'base64');
      const type = sniff(bytes);
      if (type && bytes.length <= maxBytes) photo = { bytes, type };
    }
    photos.set(photoKey(id, size), { at: stamp, photo });
  }
}

/**
 * One employee's photo, or null. Asking for one warms every id passed in
 * `warm` in the same Odoo round trip, because a card row asks for several at
 * once and this Odoo is slow enough that sequential reads are noticeable.
 * `size` is 128 (cards, rows) or 512 (a profile banner).
 */
export async function odooPhoto(odooId, { warm = [], size = 128 } = {}) {
  const pixels = PHOTO_SIZES[size] ? size : 128;
  const fresh = (id) => {
    const entry = photos.get(photoKey(id, pixels));
    return entry && Date.now() - entry.at < PHOTO_TTL_MS;
  };
  if (fresh(odooId)) return photos.get(photoKey(odooId, pixels)).photo;
  const ids = [...new Set([odooId, ...warm])].filter((id) => Number.isInteger(id) && !fresh(id) && !photoLoads.has(photoKey(id, pixels)));
  if (ids.length) {
    const load = loadPhotos(ids, pixels).catch((error) => {
      console.warn('[hr] Odoo photo read failed:', error?.message ?? error);
    });
    for (const id of ids) photoLoads.set(photoKey(id, pixels), load);
    try {
      await load;
    } finally {
      for (const id of ids) photoLoads.delete(photoKey(id, pixels));
    }
  } else if (photoLoads.has(photoKey(odooId, pixels))) {
    await photoLoads.get(photoKey(odooId, pixels));
  }
  return photos.get(photoKey(odooId, pixels))?.photo ?? null;
}

let warming = false;
async function warmActivePhotos(currentIndex) {
  if (warming) return;
  warming = true;
  try {
    const ids = currentIndex.rows.filter((row) => row.active).map((row) => row.id);
    for (let start = 0; start < ids.length; start += 40) {
      const batch = ids.slice(start, start + 40);
      await odooPhoto(batch[0], { warm: batch.slice(1) });
    }
  } catch (error) {
    console.warn('[hr] Odoo photo warm-up stopped:', error?.message ?? error);
  } finally {
    warming = false;
  }
}

/** Whether a 128px photo is known to exist: true, false, or null when not yet read. */
export function knownPhoto(odooId) {
  const entry = photos.get(photoKey(odooId, 128));
  return entry ? Boolean(entry.photo) : null;
}

export const __test = { comparableName, comparableCode, uniqueMap, sniff, reset: () => { index = null; photos.clear(); } };
