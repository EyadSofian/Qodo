/**
 * Join paid invoice products to operational training records without inventing
 * a relationship that is not stored in Odoo.
 *
 * Accounting lines currently do not carry a dependable event/channel id.  The
 * only safe bridge available to this dashboard is the course name.  We remove
 * presentation-only words and numeric batch codes, then require the remaining
 * token set to match exactly.  There is deliberately no fuzzy fallback: a row
 * left on one side is more useful than a confident-looking wrong comparison.
 */

const STOP_WORDS = new Set([
  'ar',
  'arabic',
  'attendance',
  'batch',
  'course',
  'en',
  'english',
  'event',
  'for',
  'in',
  'of',
  'offline',
  'online',
  'recorded',
  'riyadh',
  'the',
  'training',
]);

const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

export function canonicalTrainingName(value) {
  const normalized = String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^\s*\[[^\]]+\]\s*/, '')
    .toLowerCase()
    .replace(/\bauto\s+cad\b/g, 'autocad')
    .replace(/\b3d\s+max\b/g, '3ds max');
  const tokens = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(tokens.filter((token) => !/^\d+$/.test(token) && !STOP_WORDS.has(token)))]
    .sort()
    .join('|');
}

function financialByCourse(products) {
  const groups = new Map();
  for (const product of Array.isArray(products) ? products : []) {
    const key = canonicalTrainingName(product?.name);
    if (!key) continue;
    const group = groups.get(key) ?? {
      key,
      name: String(product?.name || 'بدون اسم'),
      paidAmount: 0,
      financialProducts: 0,
    };
    group.paidAmount += number(product?.amount);
    group.financialProducts += 1;
    groups.set(key, group);
  }
  return groups;
}

function statusFor({ paidAmount, primary, secondary }) {
  if (paidAmount > 0 && primary > 0) return 'paid_and_active';
  if (paidAmount > 0 && secondary > 0) return 'paid_and_interest';
  if (paidAmount > 0) return 'paid_only';
  if (primary > 0) return 'active_only';
  if (secondary > 0) return 'interest_only';
  return 'no_demand';
}

function comparisonRows(products, operational, shapeOperational) {
  const financial = financialByCourse(products);
  const operations = new Map();
  for (const raw of Array.isArray(operational) ? operational : []) {
    const item = shapeOperational(raw);
    const key = canonicalTrainingName(item.name);
    if (!key) continue;
    const group = operations.get(key) ?? {
      key,
      name: item.name,
      primary: 0,
      secondary: 0,
      operationalRecords: 0,
      recordIds: [],
    };
    group.primary += item.primary;
    group.secondary += item.secondary;
    group.operationalRecords += 1;
    if (item.id) group.recordIds.push(item.id);
    operations.set(key, group);
  }

  return [...new Set([...financial.keys(), ...operations.keys()])]
    .map((key) => {
      const money = financial.get(key);
      const activity = operations.get(key);
      const paidAmount = money?.paidAmount ?? 0;
      const primary = activity?.primary ?? 0;
      const secondary = activity?.secondary ?? 0;
      return {
        key,
        name: activity?.name || money?.name || 'بدون اسم',
        paidAmount: Math.round((paidAmount + Number.EPSILON) * 100) / 100,
        primary,
        secondary,
        operationalRecords: activity?.operationalRecords ?? 0,
        recordIds: activity?.recordIds ?? [],
        matchBasis: money && activity ? 'canonical_name' : money ? 'financial_only' : 'operational_only',
        status: statusFor({ paidAmount, primary, secondary }),
      };
    })
    .sort((left, right) => {
      const statusRank = {
        paid_and_active: 0,
        paid_and_interest: 1,
        active_only: 2,
        paid_only: 3,
        interest_only: 4,
        no_demand: 5,
      };
      return (
        statusRank[left.status] - statusRank[right.status] ||
        right.primary - left.primary ||
        right.secondary - left.secondary ||
        right.paidAmount - left.paidAmount ||
        left.name.localeCompare(right.name, 'en')
      );
    });
}

export function buildEventCourseComparison(products, events) {
  return comparisonRows(products, events, (event) => ({
    id: number(event?.id),
    name: String(event?.name || 'بدون اسم'),
    primary: number(event?.bookings),
    secondary: number(event?.interested),
  })).map((row) => ({ ...row, kind: 'events' }));
}

export function buildElearningCourseComparison(products, courses) {
  return comparisonRows(products, courses, (course) => ({
    id: number(course?.id),
    name: String(course?.name || 'بدون اسم'),
    primary: number(course?.enrollments),
    secondary: number(course?.invited),
  })).map((row) => ({ ...row, kind: 'elearning' }));
}
