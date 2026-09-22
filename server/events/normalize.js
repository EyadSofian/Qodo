/**
 * Raw Odoo rows → the canonical training-schedule row.
 *
 * Everything in this file is pure: no Odoo, no cache, no clock except the `now`
 * passed in. That is deliberate — the spreadsheet this replaces had a dozen
 * spellings of "Sunday" and three meanings of "Type", and the only way to be
 * sure the normalisation is right is to test it against those inputs directly.
 *
 * Two rules run through all of it:
 *
 * - **Instants, not wall clocks.** Odoo's naive UTC strings are stamped with a
 *   `Z` once (`asInstant`) and travel as real instants. KSA appears only where
 *   the operations sheet literally says "KSA" — `startTimeKsa`, weekdays — and
 *   is computed from the instant, never stored instead of it.
 * - **Missing is null.** An empty capacity is not zero seats, an absent
 *   coordinator field is not "no coordinator". Anything Odoo did not supply
 *   stays `null` and the UI says "—".
 */

export const KSA_TZ = 'Asia/Riyadh';

/** Odoo hands back naive UTC; anything downstream deserves a real instant. */
export const asInstant = (value) =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(value)
    ? `${value.slice(0, 19).replace(' ', 'T')}Z`
    : null;

/** `[id, "Name"]` is Odoo's many2one shape, and `false` is its null. */
export const nameOf = (pair) => (Array.isArray(pair) ? pair[1] ?? null : null);
export const idOf = (pair) => (Array.isArray(pair) ? pair[0] ?? null : null);
export const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const positive = (value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null);

/**
 * The link somebody actually clicks to get into the lecture.
 *
 * `active_join_live_url` is Odoo's own answer and is preferred, but it resolves
 * through `join_live_url_source` to a field that is frequently blank — a track
 * can carry a perfectly good `zoom_join_link` while the source points at an
 * empty `meeting_url`. So the raw fields are the fallback, in the order the
 * integration fills them.
 *
 * The protocol is checked because this ends up in an `href`: a `javascript:`
 * value arriving from an upstream system is the same stored XSS as one typed by
 * a user, and "it came from Odoo" is not a security boundary.
 */
export function joinUrl(row) {
  const candidates = [row.active_join_live_url, row.zoom_join_link, row.meeting_url, row.zoom_link];
  for (const value of candidates) {
    if (typeof value !== 'string' || !value.trim()) continue;
    try {
      const url = new URL(value.trim());
      if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
    } catch {
      // Not a URL at all — try the next field.
    }
  }
  return null;
}

/** Odoo's Html fields arrive as markup; a table cell wants the words. */
export function plainText(value) {
  const raw = text(value);
  if (!raw) return null;
  const stripped = raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return stripped || null;
}

/* ── KSA wall-clock parts ────────────────────────────────────────── */

const ksaFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: KSA_TZ,
  weekday: 'short',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * One instant, read off a clock in Riyadh. Used for the columns the sheet
 * labels "KSA" and for weekday derivation — never to replace the instant.
 */
export function ksaParts(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(ksaFormatter.formatToParts(date).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);
  return {
    weekday: parts.weekday.slice(0, 3).toUpperCase(),
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hhmm: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    minutes: hour * 60 + minute,
  };
}

/* ── weekdays ────────────────────────────────────────────────────── */

/** The operations week starts on Saturday, the way every sheet writes it. */
export const WEEKDAYS = ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI'];

const WEEKDAY_TOKENS = [
  ['SAT', /^(sat|satur|saturday|saturdy|السبت|سبت)$/],
  ['SUN', /^(sun|sunday|الأحد|الاحد|احد)$/],
  ['MON', /^(mon|monday|الاثنين|الإثنين|اثنين)$/],
  ['TUE', /^(tue|tues|tus|teus|tuesday|tusday|الثلاثاء|ثلاثاء)$/],
  ['WED', /^(wed|wen|web|wednesday|الأربعاء|الاربعاء|اربعاء)$/],
  ['THU', /^(thu|thur|thurs|thursday|الخميس|خميس)$/],
  ['FRI', /^(fri|friday|الجمعة|الجمعه|جمعة)$/],
];

function weekdayToken(token) {
  const clean = token.toLowerCase().replace(/[^a-z؀-ۿ]/g, '');
  if (!clean) return null;
  for (const [day, pattern] of WEEKDAY_TOKENS) if (pattern.test(clean)) return day;
  return null;
}

export const sortWeekdays = (days) =>
  [...new Set(days)].filter((day) => WEEKDAYS.includes(day)).sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b));

/**
 * A free-text weekday pattern, as the sheets and custom fields write them:
 * "SAT - MON - WED", "Sun / Tue", "Sat-Wed-Mon", "sun/ tus/ wed", "from SUN To
 * WED". A dash between days is a list, not a range — "SAT - TUE" is two days —
 * so a range is expanded only when it is spelled "from … to …".
 */
export function parseWeekdayText(value) {
  const raw = text(value);
  if (!raw) return [];
  const range = raw.match(/from\s+([a-z؀-ۿ]+)\s+to\s+([a-z؀-ۿ]+)/i);
  if (range) {
    const start = weekdayToken(range[1]);
    const end = weekdayToken(range[2]);
    if (start && end) {
      const days = [];
      for (let i = WEEKDAYS.indexOf(start); ; i = (i + 1) % 7) {
        days.push(WEEKDAYS[i]);
        if (WEEKDAYS[i] === end || days.length > 7) break;
      }
      return sortWeekdays(days);
    }
  }
  return sortWeekdays(raw.split(/[\s,/\-–—&+|،]+/).map(weekdayToken).filter(Boolean));
}

/* ── day part ────────────────────────────────────────────────────── */

/**
 * Morning / afternoon / evening / night from the course's usual KSA start time.
 * One fixed definition, so "Day / Night" means the same thing on every row:
 *
 *   morning   05:00–11:59
 *   afternoon 12:00–16:59
 *   evening   17:00–20:59
 *   night     21:00–04:59
 */
export function dayPartOf(minutes) {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes)) return null;
  if (minutes >= 300 && minutes < 720) return 'morning';
  if (minutes >= 720 && minutes < 1020) return 'afternoon';
  if (minutes >= 1020 && minutes < 1260) return 'evening';
  return 'night';
}

/* ── status ──────────────────────────────────────────────────────── */

export const ARCHIVE_STATUSES = new Set(['finished', 'canceled', 'refused', 'hold']);

/**
 * Odoo's stage is the authority; this only files it under one of the words the
 * operations team uses. The stage's own flags win over its name where they say
 * something (`inprogress`, `pipe_end`) — except that a cancelled stage is often
 * also flagged as an end stage, so cancellation is read from the name first.
 * A stage nobody anticipated maps to `null` and the UI shows its Odoo name.
 */
export function canonicalStatus(stage) {
  if (!stage) return null;
  const name = String(stage.name ?? '').trim().toLowerCase();
  if (/cancel|ملغ|اتلغ/.test(name)) return 'canceled';
  if (/refus|reject|مرفوض/.test(name)) return 'refused';
  if (/hold|delay|postpon|pause|suspend|مؤجل|معلق/.test(name)) return 'hold';
  if (stage.running || /progress|running|ongoing|started|شغال|جاري/.test(name)) return 'in_progress';
  if (stage.finished || /finish|done|closed|ended|complete|انتهى|خلص/.test(name)) return 'finished';
  if (/plan|new|draft|book|announc|open|confirm|upcoming|registration|scheduled|مخطط/.test(name)) return 'planned';
  return null;
}

/* ── training type ───────────────────────────────────────────────── */

/**
 * `event_type` × `attendance_method` → what the sheet calls "Type".
 *
 * `event_type` is a selection whose live values are `individual`, `company`
 * and `private` (the ones the existing analytics already count). The sheets
 * call an individual-registration course a "Group" course — the 2023–25
 * archives wrote the same thing as "Inv." — so `individual` reads as Group.
 * Anything else falls back to Odoo's own label for the value, never a guess.
 */
const CATEGORY_OF = { individual: 'group', company: 'company', private: 'private', public: 'public' };
const CATEGORY_LABEL = { group: 'Group', company: 'Company', private: 'Private', public: 'Public' };

export function normalizeType(eventType, attendanceMethod, selectionLabels = {}) {
  const raw = text(eventType);
  const category = raw ? CATEGORY_OF[raw] ?? null : null;
  const deliveryMode = attendanceMethod === 'online' || attendanceMethod === 'offline' ? attendanceMethod : null;
  const modeLabel = deliveryMode ? (deliveryMode === 'online' ? 'Online' : 'Offline') : null;
  const categoryLabel = category ? CATEGORY_LABEL[category] : raw ? text(selectionLabels[raw]) ?? raw : null;
  const displayLabel = [categoryLabel, modeLabel].filter(Boolean).join(' ') || null;
  return { category, deliveryMode, displayLabel };
}

/* ── department ──────────────────────────────────────────────────── */

/**
 * The schedule's department tabs, in the order the workbook has them.
 *
 * `strong` terms are a discipline's own name and are safe on a category label
 * (package, section, template, tag). `course` terms are course names that belong
 * to exactly one discipline in this company's catalogue — HVAC is mechanical,
 * PMP is development. Deliberately absent: Revit, BIM, AutoCAD, Photoshop and
 * anything else taught in more than one department, which stay unclassified
 * rather than being filed somewhere plausible and wrong.
 */
export const DEPARTMENTS = [
  {
    key: 'webinar',
    label: 'Webinar',
    strong: /\b(webinars?|seminars?)\b|ويبينار|ندوة/i,
    course: /\b(webinars?|seminars?)\b|ويبينار|ندوة/i,
  },
  {
    key: 'english',
    label: 'English',
    strong: /\benglish\b|انجليزي|إنجليزي/i,
    course: /\b(english|ielts|toefl|starter|elementary|pre-?\s?intermediate|upper-?\s?intermediate|intermediate)\b/i,
  },
  {
    key: 'arch',
    label: 'Arch & Decor',
    strong: /\b(arch|archi|architecture|architectural|interior|decor|décor)\b/i,
    course: /\b(architecture|architectural|interior|decor|3d\s?s?\s?max|lumion|sketch\s?up|v-?ray|enscape|revit\s+arch\w*)\b/i,
  },
  {
    key: 'mechanical',
    label: 'Mechanical',
    strong: /\b(mechanical|mechnical|mep|automotive)\b/i,
    course: /\b(mechanical|hvac|fire\s?fighting|plumbing|automotive|refrigeration|chillers?|revit\s+(mep|mechanical))\b/i,
  },
  {
    key: 'electrical',
    label: 'Electrical',
    strong: /\belectrical\b/i,
    course: /\b(electrical|lighting|light\s+current|low\s+current|power\s+(system|distribution)s?|switchgear|etap|dialux|revit\s+electrical)\b/i,
  },
  {
    key: 'civil',
    label: 'Civil',
    strong: /\b(civil|structure|structural|steel|road|roads|infra\s?structure|infrastructure)\b/i,
    course: /\b(civil|structural|steel\s+design|concrete|etabs|sap\s?2000|road\s+construction\w*|infra\s?structure|tekla|revit\s+structure)\b/i,
  },
  {
    key: 'development',
    label: 'Development',
    strong: /\b(management|development|marketing)\b/i,
    course: /\b(pmp|pmi-?\w*|capm|primavera|cmrp|cfm|project\s+management|management|digital\s+marketing)\b/i,
  },
];

const DEPARTMENT_BY_KEY = Object.fromEntries(DEPARTMENTS.map((d) => [d.key, d]));

/**
 * Which department tab a course belongs on.
 *
 * An Odoo field that names the department is authoritative. Otherwise a
 * category label (package, section, template, tag) that contains a discipline's
 * own name is used, and last the course name itself. Webinar and English are
 * checked first because a "PMP Webinar" is a webinar before it is management.
 * Two engineering disciplines matching at the same level is ambiguous, and
 * ambiguous is `null` — never a coin toss.
 */
export function classifyDepartment({ field, categories = [], courseName }) {
  const explicit = text(field);
  if (explicit) {
    const known = matchDepartment([explicit], 'strong');
    return { department: known ?? explicit, source: 'odoo' };
  }
  const fromCategory = matchDepartment(categories.filter(Boolean), 'strong');
  if (fromCategory) return { department: fromCategory, source: 'category' };
  const fromName = matchDepartment([courseName].filter(Boolean), 'course');
  if (fromName) return { department: fromName, source: 'course_name' };
  return { department: null, source: null };
}

function matchDepartment(labels, level) {
  if (labels.length === 0) return null;
  const joined = labels.join(' | ');
  for (const key of ['webinar', 'english']) {
    if (DEPARTMENT_BY_KEY[key][level].test(joined)) return DEPARTMENT_BY_KEY[key].label;
  }
  const hits = DEPARTMENTS.filter((d) => d.key !== 'webinar' && d.key !== 'english' && d[level].test(joined));
  return hits.length === 1 ? hits[0].label : null;
}

/* ── sessions ────────────────────────────────────────────────────── */

/** "HVAC / Session 3" → 3. Only a hint: chronology decides the order. */
export function sessionNumberFromName(name) {
  const raw = text(name);
  if (!raw) return null;
  const match = raw.match(/(?:session|lecture|lec|محاضرة|جلسة)\s*#?\s*(\d{1,3})\b|\bS(\d{1,3})\b/i);
  const value = match ? Number(match[1] ?? match[2]) : null;
  return value && value > 0 ? value : null;
}

/**
 * `event.track` rows → numbered sessions, S1…Sn.
 *
 * Numbered by when they happen, because that is what S4 means to somebody
 * reading the sheet: the fourth lecture. The "Session N" in a track's name is
 * checked against that order and a disagreement is reported rather than
 * obeyed — a rescheduled lecture keeps its old name. Undated tracks go last.
 */
export function orderSessions(tracks) {
  const shaped = tracks.map((row) => {
    const startsAt = asInstant(row.date);
    const durationHours = typeof row.duration === 'number' && row.duration > 0 ? row.duration : 0;
    const explicitEnd = asInstant(row.date_end);
    const endsAt =
      explicitEnd ?? (startsAt && durationHours ? new Date(new Date(startsAt).getTime() + durationHours * 3_600_000).toISOString() : null);
    return {
      id: row.id,
      name: text(row.name)?.split(' / ').pop() ?? null,
      nameNumber: sessionNumberFromName(row.name),
      startsAt,
      endsAt,
      durationHours,
    };
  });

  shaped.sort((a, b) => {
    if (a.startsAt && b.startsAt && a.startsAt !== b.startsAt) return a.startsAt < b.startsAt ? -1 : 1;
    if (a.startsAt && !b.startsAt) return -1;
    if (!a.startsAt && b.startsAt) return 1;
    if (a.nameNumber !== null && b.nameNumber !== null && a.nameNumber !== b.nameNumber) return a.nameNumber - b.nameNumber;
    return a.id - b.id;
  });

  const sessions = shaped.map((session, index) => ({ ...session, number: index + 1 }));
  const named = sessions.filter((session) => session.nameNumber !== null);
  const numberingConsistent = named.length === 0 || named.every((session) => session.nameNumber === session.number);
  return { sessions, numberingConsistent };
}

function mostCommon(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/* ── the canonical row ───────────────────────────────────────────── */

/**
 * @param {object} input
 * @param {object} input.event          raw `event.event` row
 * @param {object[]} input.tracks       raw `event.track` rows for this event
 * @param {{confirmed:number,interested:number,attended:number,cancelled:number}|undefined} input.registrations
 * @param {Map<number, object>} input.stages   stage id → {name, running, finished}
 * @param {object} input.schema          resolved schema (see schema.js)
 * @param {Map<string, Map<number,string>>} [input.relationNames]  model → id → name, for many2many
 * @param {Date} [input.now]
 */
export function buildScheduleRow({
  event,
  tracks = [],
  registrations,
  stages,
  schema,
  relationNames = new Map(),
  packageGroups = new Map(),
  now = new Date(),
}) {
  const concepts = schema.concepts;
  const conceptValue = (concept) => readConcept(event, concepts[concept], relationNames);

  const stageId = idOf(event.stage_id);
  const stage = stageId !== null ? stages.get(stageId) ?? { name: nameOf(event.stage_id) } : null;
  const statusCanonical = canonicalStatus(stage);

  const type = normalizeType(event.event_type, event.attendance_method, schema.selections?.event_type);
  const { sessions, numberingConsistent } = orderSessions(tracks);

  const startsAt = asInstant(event.date_begin);
  const endsAt = asInstant(event.date_end);
  const courseName = text(event.name) ?? 'بدون اسم';

  const section = conceptValue('section');
  // This database reaches the package through the cohort group; a direct
  // package field on the event is honoured first if another one ever has it.
  const cohortId = concepts.packageGroup ? idOf(event[concepts.packageGroup.field]) : null;
  const cohort = cohortId !== null ? packageGroups.get(cohortId) ?? null : null;
  const pkg = conceptValue('package') ?? cohort?.package ?? null;
  const template = conceptValue('template');
  const tags = conceptValue('tags');
  const { department, source: departmentSource } = classifyDepartment({
    field: conceptValue('department'),
    categories: [pkg, section, template, tags],
    courseName,
  });

  // KSA wall-clock of the usual lecture, taken from the lectures themselves:
  // a course moved from 7pm to 8pm halfway through is an 8pm course now.
  const dated = sessions.filter((session) => session.startsAt);
  const startParts = dated.map((session) => ksaParts(session.startsAt)).filter(Boolean);
  const distinctStarts = new Set(startParts.map((p) => p.hhmm));
  const usualStart = mostCommon(startParts.map((p) => p.hhmm)) ?? ksaParts(startsAt)?.hhmm ?? null;
  const usualEnd =
    mostCommon(dated.map((session) => ksaParts(session.endsAt)?.hhmm).filter(Boolean)) ??
    (sessions.length === 0 ? ksaParts(endsAt)?.hhmm ?? null : null);
  const startMinutes = usualStart ? Number(usualStart.slice(0, 2)) * 60 + Number(usualStart.slice(3)) : null;

  const derivedDays = sortWeekdays(startParts.map((p) => p.weekday));
  const configuredDays = readWorkDays(event, concepts.workDays, relationNames);
  const workDays = derivedDays.length ? derivedDays : configuredDays ?? [];
  const workDaysSource = derivedDays.length ? 'sessions' : configuredDays?.length ? 'odoo' : null;

  const nowMs = now.getTime();
  const past = dated.filter((session) => new Date(session.startsAt).getTime() < nowMs);
  const upcoming = dated.filter((session) => new Date(session.startsAt).getTime() >= nowMs);
  const lectureCount = positive(event.total_lectures_number);

  const regs = registrations ?? { confirmed: 0, interested: 0, attended: 0, cancelled: 0 };
  const capacity = positive(event.seats_max);
  const ownCoordinator = conceptValue('coordinator');
  const responsible = conceptValue('responsible');
  const coordinator = ownCoordinator ?? responsible ?? null;
  const coordinatorSource = ownCoordinator ? 'coordinator' : responsible ? 'responsible' : null;

  const row = {
    id: event.id,
    odooId: event.id,
    source: 'odoo',
    courseName,
    courseCode: text(event.code),
    department,
    departmentSource,
    section,
    package: pkg,
    cohort: cohort?.name ?? null,
    instructor: nameOf(event.instructor_id),
    trainingType: type.displayLabel,
    typeCategory: type.category,
    deliveryMode: type.deliveryMode,
    location: {
      offlineKind: text(event.if_offline),
      branch: text(event.headquarter),
      venue: nameOf(event.address_id),
    },
    lectureCount,
    sessionHours: positive(event.session_duration),
    traineeCount: regs.confirmed,
    registrations: regs,
    capacity,
    minimumCapacity: positive(conceptNumber(event, concepts.minimumCapacity)),
    startsAt,
    endsAt,
    startTimeKsa: usualStart,
    endTimeKsa: usualEnd,
    dayPart: dayPartOf(startMinutes),
    status: stage?.name ?? null,
    statusCanonical,
    stageId,
    workDays,
    workDaysSource,
    configuredWorkDays: configuredDays,
    coordinator,
    coordinatorSource,
    comments: concepts.comments ? plainText(event[concepts.comments.field]) : null,
    sessions,
    sessionsTotal: sessions.length,
    sessionsPast: past.length,
    sessionsRemaining: upcoming.length,
    progress: sessions.length ? Math.round((past.length / sessions.length) * 100) : null,
    nextSession: upcoming[0] ? { number: upcoming[0].number, startsAt: upcoming[0].startsAt } : null,
    firstSessionAt: dated[0]?.startsAt ?? null,
    lastSessionAt: dated.at(-1)?.startsAt ?? null,
    qualityFlags: [],
  };

  row.qualityFlags = qualityFlags(row, {
    event,
    numberingConsistent,
    distinctStarts: distinctStarts.size,
    coordinatorKnown: Boolean(concepts.coordinator || concepts.responsible),
  });
  return row;
}

/** A discovered concept field read off one event, as display text. */
function readConcept(event, concept, relationNames) {
  if (!concept) return null;
  const value = event[concept.field];
  if (value === false || value === null || value === undefined) return null;
  if (concept.type === 'many2one') return nameOf(value);
  if (concept.type === 'many2many') {
    const names = relationNames.get(concept.relation);
    const list = Array.isArray(value) ? value.map((id) => names?.get(id)).filter(Boolean) : [];
    return list.length ? list.join(', ') : null;
  }
  if (concept.type === 'selection') {
    return text(concept.selection?.[value]) ?? text(value);
  }
  if (concept.type === 'html') return plainText(value);
  return text(typeof value === 'number' ? String(value) : value);
}

function conceptNumber(event, concept) {
  if (!concept) return null;
  const value = event[concept.field];
  return typeof value === 'number' ? value : null;
}

/** Configured weekdays, from whichever shape the custom field turned out to be. */
function readWorkDays(event, concept, relationNames) {
  if (!concept) return null;
  if (concept.type === 'boolean_set') {
    return sortWeekdays(concept.fields.filter((f) => event[f.field] === true).map((f) => f.day));
  }
  const raw = readConcept(event, concept, relationNames);
  return raw ? parseWeekdayText(raw) : [];
}

/* ── data quality ────────────────────────────────────────────────── */

/**
 * What an operations person would want to double-check before trusting a row.
 * Only facts the data can support: a missing coordinator is flagged only when
 * this Odoo actually has a coordinator field, otherwise every row would be
 * "missing" something the database never had.
 */
export function qualityFlags(row, { event, numberingConsistent, distinctStarts, coordinatorKnown }) {
  const flags = [];
  const inactive = row.statusCanonical === 'canceled' || row.statusCanonical === 'refused';
  if (!row.courseCode) flags.push('missing_code');
  if (!row.instructor) flags.push('missing_instructor');
  if (!row.startsAt) flags.push('missing_start');
  if (!row.endsAt) flags.push('missing_end');
  if (event.date_begin && !row.startsAt) flags.push('invalid_date');
  if (row.startsAt && row.endsAt && row.endsAt < row.startsAt) flags.push('end_before_start');
  if (!inactive && row.sessionsTotal === 0) flags.push('no_sessions');
  if (row.lectureCount !== null && row.sessionsTotal > 0 && row.lectureCount !== row.sessionsTotal) {
    flags.push('lecture_count_mismatch');
  }
  const startDay = ksaParts(row.startsAt)?.date;
  const endDay = ksaParts(row.endsAt)?.date;
  if (
    startDay &&
    endDay &&
    row.sessions.some((session) => {
      const day = ksaParts(session.startsAt)?.date;
      return day && (day < startDay || day > endDay);
    })
  ) {
    flags.push('session_outside_range');
  }
  if (row.capacity === null) flags.push('capacity_missing');
  if (distinctStarts > 1) flags.push('inconsistent_session_times');
  if (!numberingConsistent) flags.push('session_numbering_mismatch');
  if (
    row.workDaysSource === 'sessions' &&
    row.configuredWorkDays?.length &&
    row.configuredWorkDays.join(',') !== row.workDays.join(',')
  ) {
    flags.push('work_days_mismatch');
  }
  if (coordinatorKnown && !row.coordinator && !inactive) flags.push('missing_coordinator');
  return flags;
}

/** `event.registration` grouped by (event, state) → per-event counts. */
export function registrationCounts(groups) {
  const counts = new Map();
  for (const group of groups) {
    const eventId = idOf(group.event_id);
    if (!eventId) continue;
    const count = group.__count ?? 0;
    const current = counts.get(eventId) ?? { confirmed: 0, interested: 0, attended: 0, cancelled: 0 };
    if (group.state === 'open' || group.state === 'done') current.confirmed += count;
    if (group.state === 'draft') current.interested += count;
    if (group.state === 'done') current.attended += count;
    if (group.state === 'cancel') current.cancelled += count;
    counts.set(eventId, current);
  }
  return counts;
}
