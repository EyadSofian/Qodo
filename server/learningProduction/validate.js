/**
 * Request validation for E-Learning Production.
 *
 * The repository has no schema library, and this module does not add one for
 * a dozen field shapes. Each helper either returns a clean value or throws a
 * `VALIDATION_FAILED` refusal naming the field — so the form that sent it can
 * put the message under the right input.
 */

import { validation, notFound } from './errors.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A path id. A malformed one is "not found" — it cannot name anything that exists. */
export function pathId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw notFound();
  return value.toLowerCase();
}

export function isUuid(value) {
  return typeof value === 'string' && UUID.test(value);
}

/** An id in a body. Malformed is a validation error, `null`/empty is allowed when optional. */
export function bodyId(value, field, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw validation(field, 'required');
    return null;
  }
  if (!isUuid(value)) throw validation(field, 'invalid');
  return value.toLowerCase();
}

export function text(value, field, { required = false, max = 200, trim = true } = {}) {
  if (value === undefined || value === null) {
    if (required) throw validation(field, 'required');
    return required ? '' : null;
  }
  if (typeof value !== 'string') throw validation(field, 'invalid');
  const clean = trim ? value.trim() : value;
  if (required && clean.length === 0) throw validation(field, 'required');
  if (clean.length > max) throw validation(field, 'too_long', { max });
  return clean;
}

export function optionalText(value, field, max = 200) {
  const clean = text(value, field, { max });
  return clean ? clean : null;
}

export function isoDate(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !DATE.test(value)) throw validation(field, 'invalid_date');
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw validation(field, 'invalid_date');
  }
  return value;
}

export function oneOf(value, list, field, { required = false, fallback = null } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw validation(field, 'required');
    return fallback;
  }
  if (!list.includes(value)) throw validation(field, 'invalid');
  return value;
}

export function integer(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER, required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw validation(field, 'required');
    return null;
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw validation(field, 'out_of_range', { min, max });
  return number;
}

export function seconds(value, field, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw validation(field, 'required');
    return null;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 86_400) throw validation(field, 'out_of_range');
  return Math.round(number * 1000) / 1000;
}

/** A non-empty list of ids from a body, de-duplicated. */
export function idList(value, field, max = 1000) {
  if (!Array.isArray(value) || value.length === 0) throw validation(field, 'required');
  if (value.length > max) throw validation(field, 'too_many', { max });
  if (!value.every(isUuid)) throw validation(field, 'invalid');
  return [...new Set(value.map((id) => id.toLowerCase()))];
}

export function bool(value) {
  return value === true || value === 'true' || value === '1' || value === 1;
}

export function plainObject(value, field) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw validation(field, 'invalid');
  return value;
}

/** A date range where the end may not come first. */
export function dateOrder(start, end, field) {
  if (start && end && end < start) throw validation(field, 'before_start');
}

/** Only https links are stored — an http link in a review tool is a mixed-content warning waiting to happen. */
export function httpsUrl(value, field) {
  const clean = text(value, field, { required: true, max: 2000 });
  let parsed;
  try {
    parsed = new URL(clean);
  } catch {
    throw validation(field, 'invalid_url');
  }
  if (parsed.protocol !== 'https:') throw validation(field, 'invalid_url');
  return parsed.toString();
}
