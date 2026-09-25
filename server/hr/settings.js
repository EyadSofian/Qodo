/**
 * The HR settings document — one per organization, revisioned.
 *
 * Only what an administrator changed is stored; `resolveHRSettings` lays it
 * over the approved defaults on every read. Saving carries the revision the
 * editor started from, so two people editing Settings at once get a conflict
 * rather than the later save silently erasing the earlier one.
 */

import { create, findOne, getStore } from '../store.js';
import { resolveHRSettings, validateHRSettings } from '../../shared/recruitment/settings.js';
import { HRError } from './errors.js';

export const settingsDocumentId = (organizationId) => `hr-settings:${organizationId}`;

const SECTIONS = ['recruitment', 'kpi', 'performance', 'personnel'];

export async function hrSettingsDocument(organizationId) {
  return findOne('hrSettings', (document) => document.id === settingsDocumentId(organizationId));
}

export async function hrSettingsFor(organizationId) {
  const stored = await hrSettingsDocument(organizationId);
  return { settings: resolveHRSettings(stored), revision: stored?.revision ?? 0, updatedAt: stored?.updatedAt ?? null, updatedBy: stored?.updatedBy ?? null };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeStored(base, patch) {
  const result = { ...(base ?? {}) };
  for (const [key, value] of Object.entries(patch ?? {})) {
    result[key] = isPlainObject(value) && isPlainObject(result[key]) ? mergeStored(result[key], value) : value;
  }
  return result;
}

/**
 * Apply a partial patch. `patch` is `{ recruitment?: {...}, kpi?: {...}, ... }`;
 * nested objects merge, arrays replace. The *resolved* result is validated, so
 * a patch can never leave another section in a state its rules reject.
 */
export async function updateHRSettings({ organizationId, patch, revision, actorId }) {
  if (!isPlainObject(patch) || !Object.keys(patch).length) throw new HRError('hr_settings_patch_invalid');
  const unknown = Object.keys(patch).filter((key) => !SECTIONS.includes(key));
  if (unknown.length) throw new HRError('hr_settings_patch_invalid', 400, { unknown });

  const current = await hrSettingsDocument(organizationId);
  const currentRevision = current?.revision ?? 0;
  if (revision !== undefined && revision !== null && Number(revision) !== currentRevision) {
    throw new HRError('hr_settings_conflict', 409, { revision: currentRevision });
  }
  const { id: _id, organizationId: _org, revision: _rev, createdAt: _c, updatedAt: _u, updatedBy: _b, ...storedValues } = current ?? {};
  const nextValues = mergeStored(storedValues, patch);
  const problem = validateHRSettings(resolveHRSettings(nextValues));
  if (problem) throw new HRError(problem.code, 400, { path: problem.path });

  const document = { ...nextValues, organizationId, revision: currentRevision + 1, updatedBy: actorId };
  const id = settingsDocumentId(organizationId);
  // Sections are written whole, so an update's shallow merge cannot leave a
  // stale nested value behind. Resetting an override is done by saving the
  // default value (or `null` for a rule override), never by deleting a key.
  if (current) await (await getStore()).update('hrSettings', id, document);
  else await create('hrSettings', { id, ...document });
  return hrSettingsFor(organizationId);
}
