/**
 * What this Odoo's `event.event` actually has, asked of the live database.
 *
 * The training customisation (`lms_event_integration`) is somebody else's
 * module and has already been a version ahead of its own source once
 * (`is_zoom_meet`). Asking for a field that does not exist fails the whole
 * `search_read`, not one column — so nothing here hard-codes a custom field
 * name. The confirmed core fields are intersected with `fields_get`, and the
 * spreadsheet concepts Odoo may or may not model (department, package,
 * coordinator, comments, work days, minimum capacity) are *discovered* by
 * technical name and by label. Whatever is not found stays unmapped and the
 * schedule reports it as `null`, never as a guess.
 *
 * Only stored fields qualify. A computed, non-stored field is evaluated per
 * row in Python — `seats_taken` cost eighteen seconds for fifteen courses — and
 * a bulk schedule read cannot afford one.
 *
 * `ODOO_EVENT_FIELD_MAP` (JSON, e.g. `{"coordinator":"x_coordinator_id"}`)
 * pins a concept to a specific field when discovery picks the wrong one or
 * cannot see it. Pins are validated against the live schema too.
 */

import { fieldsOf } from '../odoo.js';
import { makeCache } from '../cache.js';
import { WEEKDAYS } from './normalize.js';

/** Fields the existing reader has used in production against this database. */
export const CORE_EVENT_FIELDS = [
  'name',
  'code',
  'date_begin',
  'date_end',
  'stage_id',
  'event_type',
  'attendance_method',
  'if_offline',
  'headquarter',
  'instructor_id',
  'total_lectures_number',
  'session_duration',
  // `seats_taken` is deliberately absent: computed and non-stored. Registration
  // counts come from a grouped read on `event.registration` instead.
  'seats_max',
  'address_id',
];

export const CORE_TRACK_FIELDS = ['name', 'date', 'duration', 'event_id'];
/** Stored in Odoo 17, but read only when this database confirms it. */
export const OPTIONAL_TRACK_FIELDS = ['date_end'];
/** Computed join-link fields: fine for today's two dozen rows, never in bulk. */
export const ZOOM_TRACK_FIELDS = ['active_join_live_url', 'zoom_join_link', 'meeting_url', 'zoom_link', 'zoom_status'];

/**
 * Spreadsheet concept → how to recognise it. `primary` patterns on the technical
 * name outrank `secondary` ones, which outrank a label match; a relation hint
 * (package → `training.package`) outranks all of them.
 */
export const CONCEPTS = {
  department: {
    types: ['many2one', 'char', 'selection'],
    primary: /(^|_)(department|dept)(_id)?$/,
    secondary: /department/,
    label: /\bdepartment\b|\bdept\b|القسم|الإدارة|الادارة/i,
  },
  section: {
    types: ['many2one', 'char', 'selection'],
    primary: /(^|_)section(_id)?$/,
    secondary: /section/,
    label: /\bsection\b/i,
  },
  package: {
    types: ['many2one', 'char', 'many2many'],
    primary: /(^|_)(package|training_package)(_ids?)?$/,
    secondary: /package|bundle/,
    label: /\bpackages?\b|باق[ةه]|الباق[ةه]/i,
    relation: /^training\.package$/,
  },
  // The cohort an event belongs to ("Evening Group September 2026"), and the
  // only route to its package: training.package.group.package_id.
  packageGroup: {
    types: ['many2one'],
    primary: /(^|_)(related_group|package_group|group)(_id)?$/,
    secondary: /group/,
    label: /\bgroup\b|مجموعة/i,
    relation: /^training\.package\.group$/,
  },
  coordinator: {
    types: ['many2one', 'char'],
    primary: /(^|_)coordinator(_id)?$/,
    secondary: /coordinat/,
    label: /coordinator|منسق|المنسق/i,
  },
  comments: {
    types: ['text', 'char', 'html'],
    primary: /(^|_)comments?$/,
    secondary: /comment|remark|(^|_)notes?$/,
    label: /comment|remark|\bnotes?\b|ملاحظ|تعليق/i,
  },
  workDays: {
    types: ['many2many', 'char', 'selection', 'text'],
    primary: /(^|_)(work|week|lecture|session|training|class)_?days?(_ids?)?$/,
    secondary: /days?_of_week|(^|_)days?(_ids?)?$/,
    label: /work ?days|week ?days|days of (the )?week|lecture days|training days|أيام/i,
  },
  minimumCapacity: {
    types: ['integer', 'float'],
    primary: /(^|_)min(imum)?_(seats|capacity|attendees|trainees|students|participants|registrations?)$/,
    secondary: /min(imum)?_?(seat|capacit|attend|trainee|student|particip)/,
    label: /min(imum)?\.?\s*(seats|capacity|attendees|trainees|students|participants)|الحد الأدنى|الحد الادنى/i,
  },
  // Standard Odoo 17 fields, used only as category labels for the department
  // tabs and only when this database has them.
  // Odoo's standard "Responsible". Not a coordinator field, but on this
  // database it is the person who owns the event operationally, and the
  // workbook's Coordinator column has no other home. Reported as such.
  responsible: { types: ['many2one'], exact: 'user_id' },
  template: { types: ['many2one'], exact: 'event_type_id' },
  tags: { types: ['many2many'], exact: 'tag_ids' },
};

/** Mixins every model carries; none of them is ever a scheduling concept. */
const IGNORED = /^(message_|activity_|website_|seo_|is_seo|__|access_|rating_|image|avatar)/;

const WEEKDAY_BOOLEANS = {
  SAT: /^(x_)?(sat|saturday)$/,
  SUN: /^(x_)?(sun|sunday)$/,
  MON: /^(x_)?(mon|monday)$/,
  TUE: /^(x_)?(tue|tuesday)$/,
  WED: /^(x_)?(wed|wednesday)$/,
  THU: /^(x_)?(thu|thursday)$/,
  FRI: /^(x_)?(fri|friday)$/,
};

const stored = (meta) => meta && meta.store !== false;

function describe(name, meta) {
  return {
    field: name,
    label: meta.string ?? name,
    type: meta.type,
    relation: meta.relation ?? null,
    store: meta.store !== false,
    selection: Array.isArray(meta.selection) ? Object.fromEntries(meta.selection) : null,
  };
}

function scoreField(name, meta, concept) {
  if (!concept.types.includes(meta.type)) return 0;
  if (concept.exact) return name === concept.exact ? 10 : 0;
  let score = 0;
  if (concept.relation && meta.relation && concept.relation.test(meta.relation)) score += 8;
  if (concept.primary.test(name)) score += 4;
  else if (concept.secondary.test(name)) score += 2;
  if (concept.label.test(meta.string ?? '')) score += 1;
  return score;
}

export function parseFieldOverride(raw) {
  if (!raw) return { map: {}, error: null };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    const map = {};
    for (const [concept, field] of Object.entries(parsed)) {
      if (Object.hasOwn(CONCEPTS, concept) && typeof field === 'string' && field) map[concept] = field;
    }
    return { map, error: null };
  } catch {
    return { map: {}, error: 'ODOO_EVENT_FIELD_MAP is not valid JSON' };
  }
}

/**
 * `fields_get` output → the schema the schedule reader works from. Pure, so the
 * discovery rules are tested against invented schemas rather than trusted.
 */
export function resolveEventSchema(eventFields, trackFields = {}, override = { map: {}, error: null }) {
  const warnings = override.error ? [override.error] : [];
  const coreSet = new Set(CORE_EVENT_FIELDS);
  const corePresent = CORE_EVENT_FIELDS.filter((name) => Object.hasOwn(eventFields, name));
  const coreMissing = CORE_EVENT_FIELDS.filter((name) => !Object.hasOwn(eventFields, name));

  const concepts = {};
  const candidates = {};
  for (const [concept, rule] of Object.entries(CONCEPTS)) {
    const scored = Object.entries(eventFields)
      .filter(([name, meta]) => !coreSet.has(name) && !IGNORED.test(name) && stored(meta))
      .map(([name, meta]) => ({ name, meta, score: scoreField(name, meta, rule) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    candidates[concept] = scored.map(({ name, meta, score }) => ({ ...describe(name, meta), score }));

    const pinned = override.map[concept];
    if (pinned) {
      const meta = eventFields[pinned];
      if (!meta) warnings.push(`${concept}: pinned field "${pinned}" does not exist on event.event`);
      else if (!stored(meta)) warnings.push(`${concept}: pinned field "${pinned}" is computed and not stored`);
      else {
        concepts[concept] = { ...describe(pinned, meta), source: 'override' };
        continue;
      }
    }
    // A bare label match (score 1) is too weak to act on — "Notes" on some
    // unrelated technical field is not the operations comment column.
    const best = scored[0];
    concepts[concept] = best && best.score >= 2 ? { ...describe(best.name, best.meta), source: 'discovered' } : null;
  }

  // Work days are sometimes seven booleans rather than one field.
  if (!concepts.workDays) {
    const booleans = WEEKDAYS.map((day) => {
      const hit = Object.entries(eventFields).find(
        ([name, meta]) => meta.type === 'boolean' && stored(meta) && WEEKDAY_BOOLEANS[day].test(name)
      );
      return hit ? { day, field: hit[0] } : null;
    }).filter(Boolean);
    if (booleans.length >= 5) {
      concepts.workDays = { type: 'boolean_set', fields: booleans, field: null, label: 'weekday flags', source: 'discovered' };
    }
  }

  const conceptFields = Object.values(concepts)
    .filter(Boolean)
    .flatMap((concept) => (concept.type === 'boolean_set' ? concept.fields.map((f) => f.field) : [concept.field]));

  const trackPresent = CORE_TRACK_FIELDS.filter((name) => Object.hasOwn(trackFields, name));
  const trackOptional = OPTIONAL_TRACK_FIELDS.filter((name) => stored(trackFields[name]));
  const zoomFields = ZOOM_TRACK_FIELDS.filter((name) => Object.hasOwn(trackFields, name));

  const selection = (name) =>
    Array.isArray(eventFields[name]?.selection) ? Object.fromEntries(eventFields[name].selection) : {};

  return {
    eventReadFields: [...new Set([...corePresent, ...conceptFields])],
    trackReadFields: [...trackPresent, ...trackOptional],
    zoomFields,
    coreMissing,
    trackMissing: CORE_TRACK_FIELDS.filter((name) => !Object.hasOwn(trackFields, name)),
    concepts,
    candidates,
    selections: {
      event_type: selection('event_type'),
      attendance_method: selection('attendance_method'),
      if_offline: selection('if_offline'),
      headquarter: selection('headquarter'),
    },
    warnings,
  };
}

/** Many2many concepts whose ids need one name lookup per schedule load. */
export function relationModels(schema) {
  return [
    ...new Set(
      Object.values(schema.concepts)
        .filter((concept) => concept?.type === 'many2many' && concept.relation)
        .map((concept) => concept.relation)
    ),
  ];
}

// The schema changes when somebody upgrades a module, not by the minute.
const schemaCache = makeCache(6 * 60 * 60_000);

export async function eventSchema(client = { fieldsOf }) {
  return schemaCache.get('event-schema', async () => {
    const [eventFields, trackFields] = await Promise.all([
      client.fieldsOf('event.event'),
      client.fieldsOf('event.track'),
    ]);
    return resolveEventSchema(eventFields, trackFields, parseFieldOverride(process.env.ODOO_EVENT_FIELD_MAP));
  });
}

export function clearSchemaCache() {
  schemaCache.clear();
}
