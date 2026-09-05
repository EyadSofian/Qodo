/**
 * The criteria language.
 *
 * One evaluator for custom views, layout rules, SLA policies, workflow rules
 * and business rules. Five copies would be five places for a bug in `not_in`
 * to live, and four of them would be found by a customer.
 *
 * **Nothing here is executable.** Fields are names, operators are a closed set,
 * values are data. There is no expression to parse, no template to render and
 * no function to reach. That is the line between configuration and a scripting
 * hole, and it is drawn here on purpose.
 */

/** Every comparison the product understands. */
export const OPERATORS = [
  'eq',
  'ne',
  'in',
  'not_in',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'not_contains',
  'starts_with',
  'is_empty',
  'is_not_empty',
  'changed',
  'changed_to',
  'changed_from',
];

/**
 * Read a field off a record.
 *
 * Dotted paths are supported one level deep — `status.category` is a real thing
 * a rule wants to match on. Deeper than that and a criterion becomes a query,
 * which is a different feature.
 */
function valueOf(record, field) {
  if (!record || !field) return undefined;
  const [head, tail] = String(field).split('.');
  const first = record[head];
  return tail ? first?.[tail] : first;
}

const lower = (value) => String(value ?? '').toLowerCase();

/**
 * One condition against one record.
 *
 * `previous` is the record as it was before the change, and only the `changed*`
 * operators look at it — those are what let a rule fire on "priority became
 * urgent" rather than on "priority is urgent", which is the difference between
 * an alert and a nightly flood.
 *
 * An operator we do not recognise returns **false**, never true. A criterion
 * nobody can evaluate must not match everything.
 */
export function test(condition, record, previous = null) {
  const actual = valueOf(record, condition?.field);
  const expected = condition?.value;

  switch (condition?.operator) {
    case 'eq':
      return actual === expected;
    case 'ne':
      return actual !== expected;
    case 'in':
      return Array.isArray(expected) && expected.includes(actual);
    case 'not_in':
      return Array.isArray(expected) && !expected.includes(actual);
    case 'gt':
      return actual !== null && actual !== undefined && actual > expected;
    case 'gte':
      return actual !== null && actual !== undefined && actual >= expected;
    case 'lt':
      return actual !== null && actual !== undefined && actual < expected;
    case 'lte':
      return actual !== null && actual !== undefined && actual <= expected;
    case 'contains':
      return lower(actual).includes(lower(expected));
    case 'not_contains':
      return !lower(actual).includes(lower(expected));
    case 'starts_with':
      return lower(actual).startsWith(lower(expected));
    case 'is_empty':
      return actual === null || actual === undefined || actual === '' ||
        (Array.isArray(actual) && actual.length === 0);
    case 'is_not_empty':
      return !(actual === null || actual === undefined || actual === '' ||
        (Array.isArray(actual) && actual.length === 0));
    case 'changed':
      // No previous state means no change to speak of — a created record has
      // not "changed" its priority, it arrived with one.
      return previous !== null && valueOf(previous, condition.field) !== actual;
    case 'changed_to':
      return previous !== null && valueOf(previous, condition.field) !== actual && actual === expected;
    case 'changed_from':
      return previous !== null && valueOf(previous, condition.field) === expected && actual !== expected;
    default:
      return false;
  }
}

/**
 * A whole criteria set.
 *
 * Empty matches everything, which is what "a rule with no conditions" means: it
 * applies to the module. `match` is `all` or `any`; anything else is read as
 * `all`, the narrower reading.
 */
export function matches(record, criteria, match = 'all', previous = null) {
  const conditions = Array.isArray(criteria) ? criteria : [];
  if (conditions.length === 0) return true;
  return match === 'any'
    ? conditions.some((condition) => test(condition, record, previous))
    : conditions.every((condition) => test(condition, record, previous));
}

/**
 * Is this criteria set something we can actually evaluate?
 *
 * Called when a rule is saved, so an administrator learns about a typo at the
 * moment they make it rather than the first time the rule silently fails to
 * fire. Returns the problems, so the message can name the field.
 */
export function validate(criteria) {
  const problems = [];
  const conditions = Array.isArray(criteria) ? criteria : [];

  for (const [index, condition] of conditions.entries()) {
    if (!condition?.field || typeof condition.field !== 'string') {
      problems.push({ index, error: 'field_required' });
      continue;
    }
    if (!OPERATORS.includes(condition.operator)) {
      problems.push({ index, error: 'operator_unknown', operator: condition.operator });
      continue;
    }
    if (['in', 'not_in'].includes(condition.operator) && !Array.isArray(condition.value)) {
      problems.push({ index, error: 'value_must_be_a_list' });
    }
  }

  return problems;
}

/**
 * Relative date ranges, resolved at read time.
 *
 * A saved view that says "last 7 days" has to keep meaning that. Storing the
 * dates it resolved to on the day it was saved would freeze it into a view of
 * one particular week — which is what a *saved* view is precisely not.
 */
export const RELATIVE_RANGES = {
  today: () => [today(), today()],
  yesterday: () => [shift(today(), -1), shift(today(), -1)],
  last_7_days: () => [shift(today(), -6), today()],
  last_30_days: () => [shift(today(), -29), today()],
  next_7_days: () => [today(), shift(today(), 6)],
  this_month: () => [monthStart(0), monthEnd(0)],
  last_month: () => [monthStart(-1), monthEnd(-1)],
  this_quarter: () => quarter(0),
  overdue: () => [null, shift(today(), -1)],
};

export function resolveRange(key) {
  const resolver = RELATIVE_RANGES[key];
  return resolver ? resolver() : null;
}

const today = () => new Date().toISOString().slice(0, 10);

function shift(date, days) {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function monthStart(offset) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1))
    .toISOString()
    .slice(0, 10);
}

function monthEnd(offset) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 0))
    .toISOString()
    .slice(0, 10);
}

function quarter(offset) {
  const now = new Date();
  const startMonth = Math.floor(now.getUTCMonth() / 3) * 3 + offset * 3;
  return [
    new Date(Date.UTC(now.getUTCFullYear(), startMonth, 1)).toISOString().slice(0, 10),
    new Date(Date.UTC(now.getUTCFullYear(), startMonth + 3, 0)).toISOString().slice(0, 10),
  ];
}
