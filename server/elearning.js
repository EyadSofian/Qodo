/**
 * The self-paced side: Odoo's eLearning (`slide.channel`), extended in-house by
 * `elearning_path`.
 *
 * Kept apart from `events.js` on purpose, because they are different things
 * wearing the same word. An `event.event` is training with a date, a room and a
 * register — somebody turns up at seven. A `slide.channel` is a bundle of
 * recorded content somebody works through whenever they like. Merging them into
 * one "courses" list would mean every column is meaningless for half the rows:
 * a video has no attendance, and a lecture has no completion percentage.
 *
 * **This reader is deliberately defensive, and that is not paranoia.** The Zoom
 * integration taught it: `is_zoom_meet` is in the customisation's source and is
 * not on the server, and asking Odoo for a field it does not have fails the
 * whole query rather than one column. So every field list here is intersected
 * with what the live database reports before anything is requested. The page
 * then works against a stock Odoo, against the customisation, and against
 * whatever the two become next year.
 */

import { OdooError, existingFields, odooConfigured, readGroup, searchRead } from './odoo.js';

import { makeCache } from './cache.js';

const cache = makeCache(5 * 60_000);
const cached = (key, load) => cache.get(key, load);

const nameOf = (pair) => (Array.isArray(pair) ? pair[1] : null);
const text = (value) => (typeof value === 'string' && value ? value : null);

/**
 * Everything worth showing, and nothing that must be there.
 *
 * `name` is the only field assumed to exist — it is on every Odoo model. The
 * rest are asked for only if the server reports them, and the shaping below
 * treats each as optional.
 */
const CHANNEL_WISHLIST = [
  'name',
  'description_short',
  'channel_type',
  'total_slides',
  'total_time',
  'total_views',
  'members_count',
  // Odoo 17 names these `members_*`, not `completed_count`. Getting it wrong is
  // what the probe below is meant to catch — and it did, silently, by leaving
  // every completion at zero until somebody looked at the page and said so.
  'members_completed_count',
  'members_engaged_count',
  'is_published',
  'user_id',
  'visibility',
  'enroll',
];

let channelFieldsCache = null;
async function channelFields() {
  if (!channelFieldsCache) channelFieldsCache = await existingFields('slide.channel', CHANNEL_WISHLIST);
  return channelFieldsCache;
}

function shapeChannel(row) {
  const members = row.members_count ?? 0;
  const completed = row.members_completed_count ?? 0;
  return {
    id: row.id,
    name: text(row.name) ?? 'بدون اسم',
    summary: text(row.description_short),
    // `documentation` is a reference library, `training` is a course with a
    // path through it — different enough to be worth saying.
    kind: text(row.channel_type),
    lessons: row.total_slides ?? 0,
    // Odoo keeps this in hours as a float.
    hours: Number(row.total_time ?? 0),
    views: row.total_views ?? 0,
    // Enrolled and actually doing something, which on this data is most of them
    // — the gap that matters here is engaged→completed, not enrolled→engaged.
    engaged: row.members_engaged_count ?? 0,
    members,
    completed,
    completionRate: members > 0 ? Math.round((completed / members) * 100) : null,
    published: row.is_published !== false,
    owner: nameOf(row.user_id),
  };
}

/** The list the page opens on: every course, busiest first. */
export async function elearningOverview() {
  if (!odooConfigured()) throw new OdooError('odoo_not_configured', 503);

  return cached('overview', async () => {
    const fields = await channelFields();
    const rows = await searchRead('slide.channel', [], fields, { limit: 200 });
    const courses = rows.map(shapeChannel).sort((a, b) => b.members - a.members);

    return {
      courses,
      // Reported so the page can say "this Odoo does not expose completion"
      // rather than silently drawing a chart of zeroes.
      available: fields,
      fetchedAt: new Date().toISOString(),
    };
  });
}

export async function elearningAnalytics() {
  if (!odooConfigured()) throw new OdooError('odoo_not_configured', 503);

  return cached('analytics', async () => {
    const { courses, available } = await elearningOverview();
    const has = (field) => available.includes(field);

    const published = courses.filter((course) => course.published);
    const members = courses.reduce((sum, course) => sum + course.members, 0);
    const completed = courses.reduce((sum, course) => sum + course.completed, 0);
    const lessons = courses.reduce((sum, course) => sum + course.lessons, 0);
    const hours = courses.reduce((sum, course) => sum + course.hours, 0);

    // Grouped by Odoo where the field exists, so an unusual `channel_type`
    // configuration is reported rather than assumed.
    let byKind = [];
    if (has('channel_type')) {
      const groups = await readGroup('slide.channel', [], ['channel_type']);
      byKind = groups.map((row) => ({
        label:
          row.channel_type === 'training'
            ? 'مسار تدريبي'
            : row.channel_type === 'documentation'
              ? 'مكتبة محتوى'
              : 'مش محدد',
        value: row.__count ?? 0,
      }));
    }

    return {
      totals: {
        courses: courses.length,
        published: published.length,
        draft: courses.length - published.length,
        members,
        completed,
        lessons,
        hours: Math.round(hours),
        engaged: courses.reduce((sum, course) => sum + course.engaged, 0),
        completionRate:
          // Only a rate when the number behind it exists. Reporting 0% because a
          // field is missing is worse than reporting nothing: one is a fact
          // about the courses and the other is a fact about the integration.
          has('members_completed_count') && members > 0
            ? Math.round((completed / members) * 100)
            : null,
      },
      byKind,
      topByMembers: courses
        .filter((course) => course.members > 0)
        .slice(0, 8)
        .map((course) => ({ label: course.name, value: course.members })),
      // Only courses with enough enrolment for a percentage to mean anything —
      // one member who finished is not a 100% completion rate.
      topByCompletion: courses
        .filter((course) => course.members >= 5 && course.completionRate !== null)
        .sort((a, b) => (b.completionRate ?? 0) - (a.completionRate ?? 0))
        .slice(0, 8)
        .map((course) => ({
          label: course.name,
          value: course.completionRate ?? 0,
          display: `${course.completionRate}٪`,
        })),
      biggest: courses
        .filter((course) => course.lessons > 0)
        .sort((a, b) => b.lessons - a.lessons)
        .slice(0, 8)
        .map((course) => ({ label: course.name, value: course.lessons })),
      available,
    };
  });
}

export function clearElearningCache() {
  cache.clear();
  channelFieldsCache = null;
}
