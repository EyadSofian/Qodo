/**
 * The schedule's Odoo queries, and nothing else.
 *
 * Every load has the same shape, whatever the view:
 *
 *   1. `event.event`   — one bounded, capped `search_read`
 *   2. `event.track`   — one query for all of those events' lectures   ┐ in
 *   3. `event.registration` — one `read_group` by (event, state)        │ parallel
 *   4. many2many names — one read per relation model, only if a        │
 *      discovered concept (tags, work days) is a many2many             │
 *   5. training.package.group — one read, only if this database routes ┘
 *      events to a package through a cohort group
 *
 * then joined in Node. Never a query per course or per lecture: this Odoo takes
 * 4 seconds to answer `version`, and forty of those in a row is a page that
 * never loads. Independent reads run in parallel because on this server the
 * slow ones overlap instead of queueing (3.7s together, 83s one by one).
 *
 * `client` is `{ searchRead, readGroup }` — the real one from odoo.js, or a
 * counting fake in the tests.
 */

import { buildScheduleRow, canonicalStatus, idOf, nameOf, registrationCounts } from './normalize.js';
import { relationModels } from './schema.js';

export async function readStages(client) {
  const rows = await client.searchRead('event.stage', [], ['name', 'sequence', 'pipe_end', 'inprogress'], {
    order: 'sequence',
    limit: 200,
  });
  return rows.map((row) => {
    const stage = {
      id: row.id,
      name: row.name,
      running: Boolean(row.inprogress),
      finished: Boolean(row.pipe_end),
    };
    return { ...stage, canonical: canonicalStatus(stage) };
  });
}

export async function readRegistrationGroups(client, eventIds) {
  if (eventIds.length === 0) return [];
  return client.readGroup('event.registration', [['event_id', 'in', eventIds]], ['event_id', 'state']);
}

/**
 * The cohort group each event belongs to, and the package behind it.
 *
 * This database has no package field on `event.event`: the chain is
 * `related_group_id` → `training.package.group.package_id` → the package.
 * One bounded read for every group in the page, never one per course.
 */
async function readPackageGroups(client, schema, events) {
  const concept = schema.concepts?.packageGroup;
  if (!concept?.field || !concept.relation) return new Map();
  const ids = new Set();
  for (const event of events) {
    const id = idOf(event[concept.field]);
    if (id !== null) ids.add(id);
  }
  if (ids.size === 0) return new Map();
  const rows = await client.searchRead(concept.relation, [['id', 'in', [...ids]]], ['name', 'package_id'], {
    limit: ids.size,
  });
  return new Map(rows.map((row) => [row.id, { name: row.name || null, package: nameOf(row.package_id) }]));
}

async function readRelationNames(client, schema, events) {
  const names = new Map();
  await Promise.all(
    relationModels(schema).map(async (model) => {
      const ids = new Set();
      for (const concept of Object.values(schema.concepts)) {
        if (concept?.type !== 'many2many' || concept.relation !== model) continue;
        for (const event of events) for (const id of event[concept.field] || []) ids.add(id);
      }
      if (ids.size === 0) return;
      const rows = await client.searchRead(model, [['id', 'in', [...ids]]], ['display_name'], { limit: ids.size });
      names.set(model, new Map(rows.map((row) => [row.id, row.display_name])));
    })
  );
  return names;
}

/**
 * Events matching `domain`, fully assembled into canonical rows.
 *
 * `limit` + 1 is requested so the caller can tell "exactly the cap" from "more
 * than the cap" without a second counting query.
 */
export async function loadScheduleRows(
  client,
  { schema, stages, domain, limit, offset = 0, order = 'date_begin', trackLimit, trackFields, now = new Date() }
) {
  const fetched = await client.searchRead('event.event', domain, schema.eventReadFields, {
    limit: limit + 1,
    offset,
    order,
  });
  const eventsTruncated = fetched.length > limit;
  const events = eventsTruncated ? fetched.slice(0, limit) : fetched;
  const eventIds = events.map((event) => event.id);

  const [tracks, groups, relationNames, packageGroups] = await Promise.all([
    eventIds.length
      ? client.searchRead('event.track', [['event_id', 'in', eventIds]], trackFields ?? schema.trackReadFields, {
          limit: trackLimit,
          order: 'date, id',
        })
      : [],
    readRegistrationGroups(client, eventIds),
    readRelationNames(client, schema, events),
    readPackageGroups(client, schema, events),
  ]);

  const tracksByEvent = new Map();
  for (const track of tracks) {
    const eventId = idOf(track.event_id);
    if (!eventId) continue;
    if (!tracksByEvent.has(eventId)) tracksByEvent.set(eventId, []);
    tracksByEvent.get(eventId).push(track);
  }
  const registrations = registrationCounts(groups);
  const stageMap = new Map(stages.map((stage) => [stage.id, stage]));

  const rows = events.map((event) =>
    buildScheduleRow({
      event,
      tracks: tracksByEvent.get(event.id) ?? [],
      registrations: registrations.get(event.id),
      stages: stageMap,
      schema,
      relationNames,
      packageGroups,
      now,
    })
  );

  return {
    rows,
    tracksByEvent,
    eventsTruncated,
    // A capped track read that came back full may have cut some courses'
    // lectures short; the page says so rather than showing short courses.
    sessionsTruncated: typeof trackLimit === 'number' && tracks.length >= trackLimit,
  };
}
