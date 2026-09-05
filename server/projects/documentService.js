/**
 * Qodo Projects — documents.
 *
 * Metadata in PostgreSQL, bytes behind the workspace's existing blob store, and
 * **nothing served from a guessable URL** (ADR-5). Access is always
 * authorize → mint a short-lived token → stream, so a document link that leaks
 * out of an email stops working rather than becoming a permanent back door into
 * the project.
 *
 * Versioning is the other half. One logical document is N versions and the
 * current one is a pointer, so restoring an old version changes which row is
 * current rather than moving bytes around — and nothing is ever overwritten.
 */

import crypto from 'node:crypto';
import { paginate, rows, row, transaction } from './db.js';
import { getBlob, putBlob, removeBlob } from '../store.js';
import * as audit from './auditService.js';

/** How large one document version may be. */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

/**
 * Media types a project document may be.
 *
 * An allowlist rather than a blocklist: a blocklist is a list of the attacks
 * somebody thought of, and the interesting ones are always the others. Anything
 * not here is refused, and adding a type is a deliberate decision.
 */
const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
  'application/json',
  'text/plain',
  'text/csv',
  'text/markdown',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/acad',
  'image/vnd.dwg',
  'application/octet-stream',
]);

export function isAllowedMime(type) {
  return ALLOWED_MIME.has(String(type ?? '').toLowerCase().split(';')[0].trim());
}

/**
 * A filename that cannot escape anywhere.
 *
 * The stored key is a generated id and never this, so the sanitised name is
 * only ever a label — but a label carrying a path separator or a control
 * character still ends up in a Content-Disposition header, and that header is
 * parsed by somebody. The control range is written as escapes rather than
 * literal bytes so this line stays readable and greppable.
 */
export function safeName(name) {
  return (
    String(name ?? 'file')
      .replace(/[\u0000-\u001F\u007F]/g, '')
      .replace(/[/\\]/g, '_')
      .replace(/^\.+/, '')
      .trim()
      .slice(0, 180) || 'file'
  );
}

/* ------------------------------------------------------------------ */
/* Folders                                                              */
/* ------------------------------------------------------------------ */

export async function folders(context) {
  return (
    await rows(
      `SELECT id, parent_id, name, is_external, created_at
         FROM qodo_projects.document_folders
        WHERE project_id = $1 AND organization_id = $2 AND deleted_at IS NULL
          ${context.isClient ? 'AND is_external = true' : ''}
        ORDER BY name`,
      [context.project.id, context.organizationId]
    )
  ).map((record) => ({
    id: record.id,
    parentId: record.parent_id,
    name: record.name,
    isExternal: record.is_external,
  }));
}

export async function createFolder(context, input) {
  const name = String(input?.name ?? '').trim();
  if (!name) throw badRequest('name_required');

  const created = await row(
    `INSERT INTO qodo_projects.document_folders
       (organization_id, project_id, parent_id, name, is_external, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [
      context.organizationId,
      context.project.id,
      input?.parentId ?? null,
      name,
      Boolean(input?.isExternal),
      context.user.id,
    ]
  );

  return { id: created.id, name: created.name, isExternal: created.is_external };
}

/* ------------------------------------------------------------------ */
/* Files                                                                */
/* ------------------------------------------------------------------ */

export async function list(context, options = {}) {
  const { limit, offset } = paginate(options);
  const params = [context.project.id, context.organizationId];
  let folderFilter = '';

  if (options.folderId === null) {
    folderFilter = 'AND f.folder_id IS NULL';
  } else if (options.folderId) {
    params.push(options.folderId);
    folderFilter = `AND f.folder_id = $${params.length}`;
  }

  params.push(limit, offset);

  const found = await rows(
    `SELECT f.*, v.size_bytes, v.mime_type, v.uploaded_at, v.uploaded_by,
            fo.name AS folder_name
       FROM qodo_projects.document_files f
       LEFT JOIN qodo_projects.document_folders fo ON fo.id = f.folder_id
       LEFT JOIN qodo_projects.document_versions v
              ON v.file_id = f.id AND v.version_no = f.current_version
      WHERE f.project_id = $1 AND f.organization_id = $2 AND f.deleted_at IS NULL
        ${folderFilter}
        ${context.isClient ? 'AND f.is_external = true' : ''}
      ORDER BY f.updated_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return found.map(toFile);
}

function toFile(record) {
  return {
    id: record.id,
    folderId: record.folder_id,
    folderName: record.folder_name ?? null,
    name: record.name,
    description: record.description,
    isExternal: record.is_external,
    currentVersion: record.current_version,
    sizeBytes: record.size_bytes === null ? null : Number(record.size_bytes),
    mimeType: record.mime_type ?? null,
    uploadedAt: record.uploaded_at ?? record.created_at,
    uploadedBy: record.uploaded_by ?? record.created_by,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

export async function get(context, fileId) {
  const found = await row(
    `SELECT f.*, v.size_bytes, v.mime_type, v.uploaded_at, v.uploaded_by
       FROM qodo_projects.document_files f
       LEFT JOIN qodo_projects.document_versions v
              ON v.file_id = f.id AND v.version_no = f.current_version
      WHERE f.id = $1 AND f.project_id = $2 AND f.organization_id = $3 AND f.deleted_at IS NULL`,
    [fileId, context.project.id, context.organizationId]
  );
  if (!found) return null;
  if (context.isClient && found.is_external !== true) return null;

  const versions = await rows(
    `SELECT version_no, size_bytes, mime_type, uploaded_by, uploaded_at, notes
       FROM qodo_projects.document_versions
      WHERE file_id = $1 ORDER BY version_no DESC`,
    [fileId]
  );

  return {
    ...toFile(found),
    versions: versions.map((version) => ({
      versionNo: version.version_no,
      sizeBytes: Number(version.size_bytes),
      mimeType: version.mime_type,
      uploadedBy: version.uploaded_by,
      uploadedAt: version.uploaded_at,
      notes: version.notes,
    })),
  };
}

/**
 * Upload bytes as a new document, or as a new version of one.
 *
 * The blob key is generated, never derived from the filename — so a name can
 * not escape the store, which is the same rule `server/store.js` already
 * follows for task deliverables.
 */
export async function upload(context, { fileId, name, mimeType, bytes, notes, folderId, isExternal }) {
  if (!bytes || bytes.length === 0) throw badRequest('document_empty');
  if (bytes.length > MAX_DOCUMENT_BYTES) throw badRequest('document_too_large');
  if (!isAllowedMime(mimeType)) throw badRequest('file_type_not_allowed');

  const blobId = `projdoc_${crypto.randomUUID()}`;
  const checksum = crypto.createHash('sha256').update(bytes).digest('hex');

  // Bytes first. A blob with no row is invisible and reclaimable; a row with no
  // blob is a document that opens to an error.
  await putBlob(blobId, bytes);

  try {
    return await transaction(async (tx) => {
      let file;
      let versionNo;

      if (fileId) {
        file = await tx.row(
          `UPDATE qodo_projects.document_files
              SET current_version = current_version + 1
            WHERE id = $1 AND project_id = $2 AND organization_id = $3 AND deleted_at IS NULL
            RETURNING *`,
          [fileId, context.project.id, context.organizationId]
        );
        if (!file) throw badRequest('file_not_found');
        versionNo = file.current_version;
      } else {
        file = await tx.row(
          `INSERT INTO qodo_projects.document_files
             (organization_id, project_id, folder_id, name, is_external, current_version, created_by)
           VALUES ($1,$2,$3,$4,$5,1,$6) RETURNING *`,
          [
            context.organizationId,
            context.project.id,
            folderId ?? null,
            safeName(name),
            Boolean(isExternal),
            context.user.id,
          ]
        );
        versionNo = 1;
      }

      await tx.query(
        `INSERT INTO qodo_projects.document_versions
           (file_id, organization_id, version_no, blob_id, size_bytes, mime_type,
            checksum, uploaded_by, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          file.id,
          context.organizationId,
          versionNo,
          blobId,
          bytes.length,
          String(mimeType).toLowerCase().split(';')[0].trim(),
          checksum,
          context.user.id,
          String(notes ?? ''),
        ]
      );

      await audit.record({
        actor: context.user,
        organizationId: context.organizationId,
        projectId: context.project.id,
        entityType: 'document',
        entityId: file.id,
        action: fileId ? 'document.version' : 'document.upload',
        after: { name: file.name, version: versionNo, sizeBytes: bytes.length },
        tx,
      });

      return { id: file.id, name: file.name, versionNo, sizeBytes: bytes.length };
    });
  } catch (error) {
    // The row did not land, so the bytes are orphaned. Reclaim them rather than
    // leaving the store to grow with blobs nothing points at.
    await removeBlob(blobId).catch(() => {});
    throw error;
  }
}

/**
 * Put an earlier version back in front.
 *
 * Copies the old version forward as a new one rather than deleting the ones
 * after it. The history of a mistake is part of the history, and truncating it
 * would make the bad version look like it never existed.
 */
export async function restoreVersion(context, fileId, versionNo) {
  const source = await row(
    `SELECT * FROM qodo_projects.document_versions
      WHERE file_id = $1 AND version_no = $2 AND organization_id = $3`,
    [fileId, versionNo, context.organizationId]
  );
  if (!source) return null;

  return transaction(async (tx) => {
    const file = await tx.row(
      `UPDATE qodo_projects.document_files
          SET current_version = current_version + 1
        WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL
        RETURNING *`,
      [fileId, context.project.id]
    );
    if (!file) return null;

    await tx.query(
      `INSERT INTO qodo_projects.document_versions
         (file_id, organization_id, version_no, blob_id, size_bytes, mime_type,
          checksum, uploaded_by, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        fileId,
        context.organizationId,
        file.current_version,
        // The same bytes, referenced again. Copying them would double the
        // storage to say "this is what it used to be".
        source.blob_id,
        source.size_bytes,
        source.mime_type,
        source.checksum,
        context.user.id,
        `restored from v${versionNo}`,
      ]
    );

    await audit.record({
      actor: context.user,
      organizationId: context.organizationId,
      projectId: context.project.id,
      entityType: 'document',
      entityId: fileId,
      action: 'document.restore',
      after: { restoredFrom: versionNo, newVersion: file.current_version },
      tx,
    });

    return { id: fileId, versionNo: file.current_version, restoredFrom: versionNo };
  });
}

/* ------------------------------------------------------------------ */
/* Signed access                                                        */
/* ------------------------------------------------------------------ */

/**
 * How long a download link lives.
 *
 * Long enough for a browser to follow a redirect and a slow connection to
 * start; short enough that a link pasted into an email stops working before
 * anybody clicks it.
 */
const TOKEN_TTL_MS = 5 * 60 * 1000;

function signingKey() {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 16) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET is required to sign document links.');
  }
  // Same shape as `server/auth.js`: a per-boot dev key, so links stop working
  // on restart rather than requiring configuration to run locally.
  if (!globalThis.__qodoProjectsDocKey) {
    globalThis.__qodoProjectsDocKey = crypto.randomBytes(32).toString('hex');
  }
  return globalThis.__qodoProjectsDocKey;
}

/**
 * A token that says "this person may read this version, for the next five
 * minutes".
 *
 * The user id is inside it, so a token handed to somebody else does not widen
 * what they can see — verification re-checks that the session matches.
 */
export function signDownload(userId, fileId, versionNo) {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const payload = `${userId}|${fileId}|${versionNo}|${expiresAt}`;
  const signature = crypto.createHmac('sha256', signingKey()).update(payload).digest('base64url');
  return `${Buffer.from(payload).toString('base64url')}.${signature}`;
}

export function verifyDownload(token, userId) {
  const [encoded, signature] = String(token ?? '').split('.');
  if (!encoded || !signature) return null;

  const payload = Buffer.from(encoded, 'base64url').toString('utf8');
  const expected = crypto.createHmac('sha256', signingKey()).update(payload).digest('base64url');

  // Constant-time, so a wrong token cannot be refined byte by byte from timing.
  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return null;

  const [tokenUserId, fileId, versionNo, expiresAt] = payload.split('|');
  if (Number(expiresAt) < Date.now()) return null;
  // A token minted for somebody else is not a key that works in anybody's hand.
  if (tokenUserId !== userId) return null;

  return { fileId, versionNo: Number(versionNo) };
}

/**
 * The bytes, once everything has been checked.
 *
 * Authorization happens in the caller — this is the last step, and it still
 * re-reads the row rather than trusting the token's file id to be visible.
 */
export async function download(context, fileId, versionNo) {
  const file = await get(context, fileId);
  if (!file) return null;

  const version = await row(
    `SELECT blob_id, mime_type, size_bytes FROM qodo_projects.document_versions
      WHERE file_id = $1 AND version_no = $2 AND organization_id = $3`,
    [fileId, versionNo ?? file.currentVersion, context.organizationId]
  );
  if (!version) return null;

  const bytes = await getBlob(version.blob_id);
  if (!bytes) return null;

  return { bytes, mimeType: version.mime_type, name: file.name, sizeBytes: Number(version.size_bytes) };
}

export async function remove(context, fileId) {
  const removed = await row(
    `UPDATE qodo_projects.document_files
        SET deleted_at = now(), deleted_by = $4, deleted_batch_id = gen_random_uuid()
      WHERE id = $1 AND project_id = $2 AND organization_id = $3 AND deleted_at IS NULL
      RETURNING id, name`,
    [fileId, context.project.id, context.organizationId, context.user.id]
  );
  if (!removed) return false;

  // Soft only. The bytes stay until the recycle bin is purged, because a
  // document deleted by mistake is the most common thing anybody asks to have
  // back.
  await audit.record({
    actor: context.user,
    organizationId: context.organizationId,
    projectId: context.project.id,
    entityType: 'document',
    entityId: fileId,
    action: 'document.delete',
    before: { name: removed.name },
    after: null,
  });

  return true;
}

function badRequest(code) {
  return Object.assign(new Error(code), { status: 400, body: { error: code } });
}
