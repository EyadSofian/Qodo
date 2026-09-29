/**
 * Expert and coach candidates — sensitive records.
 *
 * CVs, screening notes, technical-discussion scores and contracts about
 * people who are often not employees. Every read and write here requires
 * `experts.sensitive` for the course (canSeeSensitive): the expert
 * acquisition coordinator, the production manager, administrators and holders
 * of the organization-wide key. A course manager, a subject-matter expert or a
 * viewer who can open the course cannot open these — they are told the list
 * does not exist, not that they lack a permission for it.
 *
 * The history never records a candidate's name: activity says a candidate
 * moved to "Technical discussion", and only these endpoints say who.
 */

import { CANDIDATE_FILE_KINDS, CANDIDATE_SOURCES, CANDIDATE_STATUSES } from '../../../shared/learningProduction/runs.js';
import { SCHEMA as S, direct, transaction } from '../db.js';
import { canSeeSensitive } from '../access.js';
import { record } from '../activity.js';
import { badRequest, notFound, workflowRefusal } from '../errors.js';
import { mapCandidate } from '../runMappers.js';
import { integer, oneOf, plainObject, text } from '../validate.js';
import { peopleFor } from '../people.js';
import * as blobs from '../blobs.js';
import { ACCEPTED, KINDS, detectKind, safeFileName, uploadLimit } from '../fileTypes.js';
import { runContext } from './runContext.js';

const iso = (value) => (value instanceof Date ? value.toISOString() : value ?? null);

/** A 1–5 score for each thing the 15-minute call and the technical discussion assess (Experts r10, r17). */
const ASSESSMENT_KEYS = ['relevantExperience', 'teachingExperience', 'english', 'technical'];

async function sensitiveRun(actor, runId, options = {}) {
  const ctx = await runContext(actor, runId, options);
  if (!canSeeSensitive(ctx)) throw notFound();
  return ctx;
}

async function candidateContext(actor, candidateId, { db = direct, lock = false } = {}) {
  const row = await db.row(
    `SELECT * FROM ${S}.learning_expert_candidates WHERE id = $1 AND organization_id = $2 ${lock ? 'FOR UPDATE' : ''}`,
    [candidateId, actor.organizationId]
  );
  if (!row) throw notFound();
  const ctx = await sensitiveRun(actor, row.run_id, { db });
  return { ...ctx, candidate: row };
}

function readCandidate(body, { partial = false } = {}) {
  const out = {};
  if (!partial || 'fullName' in body) out.fullName = text(body.fullName, 'fullName', { required: true, max: 160 });
  if (!partial || 'email' in body) out.email = text(body.email, 'email', { max: 200 }) || null;
  if (!partial || 'phone' in body) out.phone = text(body.phone, 'phone', { max: 60 }) || null;
  if (!partial || 'source' in body) out.source = oneOf(body.source, CANDIDATE_SOURCES, 'source', { fallback: 'OTHER' });
  if (!partial || 'profileUrl' in body) out.profileUrl = text(body.profileUrl, 'profileUrl', { max: 500 }) || null;
  if (!partial || 'yearsExperience' in body) out.yearsExperience = integer(body.yearsExperience, 'yearsExperience', { min: 0, max: 80 });
  if (!partial || 'notes' in body) out.notes = text(body.notes, 'notes', { max: 5000 }) ?? '';
  if ('status' in body) out.status = oneOf(body.status, CANDIDATE_STATUSES, 'status', { required: true });
  if ('assessment' in body) {
    const source = plainObject(body.assessment, 'assessment');
    out.assessment = {};
    for (const key of ASSESSMENT_KEYS) {
      const value = integer(source[key], `assessment.${key}`, { min: 1, max: 5 });
      if (value !== null) out.assessment[key] = value;
    }
  }
  return out;
}

export async function listCandidates(actor, runId) {
  const ctx = await sensitiveRun(actor, runId);
  const [rows, files] = await Promise.all([
    direct.rows(`SELECT * FROM ${S}.learning_expert_candidates WHERE run_id = $1 ORDER BY updated_at DESC`, [runId]),
    direct.rows(
      `SELECT f.id, f.candidate_id, f.kind, f.file_name, f.mime_type, f.file_size, f.created_by, f.created_at
         FROM ${S}.learning_candidate_files f
         JOIN ${S}.learning_expert_candidates c ON c.id = f.candidate_id
        WHERE c.run_id = $1 ORDER BY f.created_at`,
      [runId]
    ),
  ]);
  const byCandidate = new Map();
  for (const file of files) {
    byCandidate.set(file.candidate_id, [
      ...(byCandidate.get(file.candidate_id) ?? []),
      { id: file.id, kind: file.kind, fileName: file.file_name, mimeType: file.mime_type, fileSize: Number(file.file_size), createdBy: file.created_by, createdAt: iso(file.created_at) },
    ]);
  }
  const candidates = rows.map((row) => ({ ...mapCandidate(row), files: byCandidate.get(row.id) ?? [] }));
  return {
    candidates,
    canEdit: ctx.runOpen,
    upload: { maxBytes: uploadLimit('EVIDENCE'), accepted: ACCEPTED.EVIDENCE.map((kind) => KINDS[kind].label) },
    people: await peopleFor([...rows.map((row) => row.created_by), ...files.map((file) => file.created_by)]),
  };
}

export async function createCandidate(actor, runId, input) {
  const body = readCandidate(plainObject(input, 'body'));
  await transaction(async (tx) => {
    const ctx = await sensitiveRun(actor, runId, { db: tx });
    if (!ctx.runOpen) throw workflowRefusal('RUN_CLOSED');
    const inserted = await tx.row(
      `INSERT INTO ${S}.learning_expert_candidates
         (organization_id, run_id, course_id, full_name, email, phone, source, profile_url, years_experience, status,
          assessment_json, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id, status`,
      [
        ctx.organizationId,
        runId,
        ctx.course.id,
        body.fullName,
        body.email,
        body.phone,
        body.source,
        body.profileUrl,
        body.yearsExperience,
        body.status ?? 'SOURCED',
        JSON.stringify(body.assessment ?? {}),
        body.notes,
        ctx.userId,
      ]
    );
    await record(tx, {
      organizationId: ctx.organizationId,
      courseId: ctx.course.id,
      runId,
      actorUserId: ctx.userId,
      eventType: 'CANDIDATE_ADDED',
      metadata: { candidateId: inserted.id, status: inserted.status, source: body.source },
    });
  });
  return listCandidates(actor, runId);
}

export async function updateCandidate(actor, candidateId, input) {
  const body = readCandidate(plainObject(input, 'body'), { partial: true });
  let runId;
  await transaction(async (tx) => {
    const ctx = await candidateContext(actor, candidateId, { db: tx, lock: true });
    runId = ctx.run.id;
    if (!ctx.runOpen) throw workflowRefusal('RUN_CLOSED');
    const current = ctx.candidate;
    const next = {
      full_name: body.fullName ?? current.full_name,
      email: 'email' in body ? body.email : current.email,
      phone: 'phone' in body ? body.phone : current.phone,
      source: body.source ?? current.source,
      profile_url: 'profileUrl' in body ? body.profileUrl : current.profile_url,
      years_experience: 'yearsExperience' in body ? body.yearsExperience : current.years_experience,
      status: body.status ?? current.status,
      assessment_json: body.assessment ? { ...(current.assessment_json ?? {}), ...body.assessment } : current.assessment_json,
      notes: 'notes' in body ? body.notes : current.notes,
    };
    await tx.query(
      `UPDATE ${S}.learning_expert_candidates
          SET full_name = $2, email = $3, phone = $4, source = $5, profile_url = $6, years_experience = $7, status = $8,
              assessment_json = $9, notes = $10
        WHERE id = $1`,
      [candidateId, next.full_name, next.email, next.phone, next.source, next.profile_url, next.years_experience, next.status, JSON.stringify(next.assessment_json ?? {}), next.notes]
    );
    await record(tx, {
      organizationId: ctx.organizationId,
      courseId: ctx.course.id,
      runId,
      actorUserId: ctx.userId,
      eventType: 'CANDIDATE_UPDATED',
      metadata: { candidateId, ...(next.status !== current.status ? { from: current.status, to: next.status } : {}), fields: Object.keys(body) },
    });
  });
  return listCandidates(actor, runId);
}

export async function addCandidateFile(actor, candidateId, input) {
  const probe = await candidateContext(actor, candidateId);
  if (!probe.runOpen) throw workflowRefusal('RUN_CLOSED');
  const kindOfFile = oneOf(input.kind, CANDIDATE_FILE_KINDS, 'kind', { fallback: 'OTHER' });
  const bytes = input.bytes;
  if (!bytes?.length) throw badRequest('FILE_REQUIRED');
  if (bytes.length > uploadLimit('EVIDENCE')) throw badRequest('FILE_TOO_LARGE', { maxBytes: uploadLimit('EVIDENCE') });
  const detected = detectKind(bytes, input.fileName, 'EVIDENCE');
  if (!detected || !ACCEPTED.EVIDENCE.includes(detected)) {
    throw badRequest('FILE_TYPE_NOT_ALLOWED', { accepted: ACCEPTED.EVIDENCE.map((entry) => KINDS[entry].label) });
  }
  const key = await blobs.store(bytes);
  try {
    await transaction(async (tx) => {
      const ctx = await candidateContext(actor, candidateId, { db: tx });
      const inserted = await tx.row(
        `INSERT INTO ${S}.learning_candidate_files
           (organization_id, candidate_id, kind, storage_key, file_name, mime_type, file_size, checksum, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [ctx.organizationId, candidateId, kindOfFile, key, safeFileName(input.fileName), KINDS[detected].mime, bytes.length, blobs.checksum(bytes), ctx.userId]
      );
      await record(tx, {
        organizationId: ctx.organizationId,
        courseId: ctx.course.id,
        runId: ctx.run.id,
        actorUserId: ctx.userId,
        eventType: 'CANDIDATE_FILE_ADDED',
        metadata: { candidateId, fileId: inserted.id, kind: kindOfFile },
      });
    });
  } catch (error) {
    await blobs.discard(key);
    throw error;
  }
  return listCandidates(actor, probe.run.id);
}

export async function candidateFile(actor, fileId) {
  const row = await direct.row(`SELECT * FROM ${S}.learning_candidate_files WHERE id = $1 AND organization_id = $2`, [fileId, actor.organizationId]);
  if (!row) throw notFound();
  await candidateContext(actor, row.candidate_id);
  const bytes = await blobs.load(row.storage_key);
  if (!bytes) throw notFound();
  return { bytes, mimeType: row.mime_type, fileName: row.file_name };
}
