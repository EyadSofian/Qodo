/**
 * The drill-down filter every HR report headline carries.
 *
 *   { eq: { outcome: 'met' } }            field equals a value
 *   { in: { outcome: ['met', 'missed'] } } field is one of the values
 *   { gte: { completed: 1 } }             field is at least a number
 *   { lt: { percent: 70 } }               field is a number below the bound
 *   { prefix: { hiringDate: '2026-09' } } field starts with the text
 *   { present: ['completed'] }            field has a value
 *
 * The server counts a headline with this function and the page filters the
 * rows with the same one, so "7 missed" always opens exactly seven rows.
 */

const has = (value) => value !== null && value !== undefined && value !== '';

export function matchesReportFilter(row, filter) {
  if (!filter) return true;
  for (const [key, value] of Object.entries(filter.eq ?? {})) if (row[key] !== value) return false;
  for (const [key, values] of Object.entries(filter.in ?? {})) if (!values.includes(row[key])) return false;
  for (const [key, min] of Object.entries(filter.gte ?? {})) if (!has(row[key]) || !(Number(row[key]) >= min)) return false;
  for (const [key, max] of Object.entries(filter.lt ?? {})) if (!has(row[key]) || !(Number(row[key]) < max)) return false;
  for (const [key, start] of Object.entries(filter.prefix ?? {})) if (!String(row[key] ?? '').startsWith(start)) return false;
  for (const key of filter.present ?? []) if (!has(row[key])) return false;
  return true;
}

export function countReportRows(rows, filter) {
  return rows.filter((row) => matchesReportFilter(row, filter)).length;
}
