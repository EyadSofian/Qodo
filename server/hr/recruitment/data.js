/**
 * Recruitment persistence helpers — thin, so every service reads and writes
 * the same way. The request is the only mutable document; everything else here
 * appends a row and never edits one.
 */

import crypto from 'node:crypto';
import { create, createIfAbsent, find, findOne, getStore } from '../../store.js';
import { organizationOf } from '../../../shared/organization.js';

export const stableId = (prefix, ...parts) =>
  `${prefix}-${crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 24)}`;

export async function requestsFor(organizationId) {
  return find('recruitmentRequests', (request) => organizationOf(request) === organizationId);
}

export async function requestById(organizationId, id) {
  return findOne('recruitmentRequests', (request) => request.id === String(id) && organizationOf(request) === organizationId);
}

export async function saveRequest(id, patch) {
  return (await getStore()).update('recruitmentRequests', id, patch);
}

export async function rowsFor(collection, requestId) {
  return (await find(collection, (row) => row.requestId === requestId))
    .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
}

export async function appendActivity({ organizationId, requestId, type, actorId = null, meta = null }) {
  return create('recruitmentActivity', { organizationId, requestId, type, actorId, meta });
}

export async function appendApproval({ organizationId, requestId, stage, action, decision, fromStatus, toStatus, actorId, actorName, comment, selfReviewed = false }) {
  return create('recruitmentApprovals', {
    organizationId,
    requestId,
    stage,
    action,
    decision,
    fromStatus,
    toStatus,
    actorId,
    actorName,
    comment: comment ?? '',
    selfReviewed: Boolean(selfReviewed),
  });
}

/** Confirmed request → Odoo job links, keyed by request id. */
export async function odooLinksFor(organizationId) {
  const rows = await find('recruitmentOdooLinks', (row) => organizationOf(row) === organizationId && row.odooJobId);
  return new Map(rows.map((row) => [row.requestId, row]));
}

export const odooLinkId = (requestId) => `rol-${requestId}`;

export async function setOdooLink({ organizationId, requestId, odooJobId, odooJobName, matchType, actorId }) {
  const id = odooLinkId(requestId);
  const store = await getStore();
  const existing = await findOne('recruitmentOdooLinks', (row) => row.id === id);
  if (odooJobId === null) {
    if (existing) await store.remove('recruitmentOdooLinks', id);
    return null;
  }
  const document = { organizationId, requestId, odooJobId, odooJobName: odooJobName ?? '', matchType, linkedBy: actorId, linkedAt: new Date().toISOString() };
  if (existing) return store.update('recruitmentOdooLinks', id, document);
  return create('recruitmentOdooLinks', { id, ...document });
}

export { createIfAbsent };
