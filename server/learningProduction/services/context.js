/**
 * Loading one asset, or one version, with everything its rules need.
 *
 * Every asset action and every review read starts here, so the organization
 * check, the course visibility check and the lesson-archived check are made
 * in one place rather than remembered by each caller.
 */

import { isTextAsset } from '../../../shared/learningProduction/constants.js';
import { contentHasText, sameContent } from '../../../shared/learningProduction/review.js';
import { evaluateAsset } from '../../../shared/learningProduction/workflow.js';
import { SCHEMA as S, direct } from '../db.js';
import { courseContext } from '../access.js';
import { notFound } from '../errors.js';
import { mapAsset } from '../mappers.js';

/**
 * One asset and its course context. `lock` takes a row lock on the asset so
 * two reviewers pressing Approve at once cannot both succeed.
 */
export async function assetContext(actor, assetId, { db = direct, lock = false } = {}) {
  const found = await db.row(
    `SELECT a.*, l.name AS lesson_name, l.module_id AS lesson_module_id, l.archived_at AS lesson_archived_at,
            m.name AS module_name
       FROM ${S}.learning_assets a
       JOIN ${S}.learning_lessons l ON l.id = a.lesson_id
       LEFT JOIN ${S}.learning_course_modules m ON m.id = l.module_id
      WHERE a.id = $1 AND a.organization_id = $2
      ${lock ? 'FOR UPDATE OF a' : ''}`,
    [assetId, actor.organizationId]
  );
  if (!found || found.lesson_archived_at) throw notFound();

  const ctx = await courseContext(actor, found.course_id, { db });
  const siblings = await db.rows(`SELECT id, asset_type, status FROM ${S}.learning_assets WHERE lesson_id = $1`, [
    found.lesson_id,
  ]);

  return {
    ...ctx,
    asset: mapAsset(found),
    lesson: {
      id: found.lesson_id,
      name: found.lesson_name,
      moduleId: found.lesson_module_id ?? null,
      moduleName: found.module_name ?? null,
    },
    siblingStatuses: Object.fromEntries(siblings.map((s) => [s.asset_type, s.status])),
    siblingIds: Object.fromEntries(siblings.map((s) => [s.asset_type, s.id])),
  };
}

/** One version, with its asset's context. A version of an asset you cannot see does not exist. */
export async function versionContext(actor, versionId, { db = direct, lock = false } = {}) {
  const version = await db.row(
    `SELECT v.* FROM ${S}.learning_asset_versions v WHERE v.id = $1 AND v.organization_id = $2`,
    [versionId, actor.organizationId]
  );
  if (!version) throw notFound();
  const actx = await assetContext(actor, version.asset_id, { db, lock });
  return { ...actx, version };
}

/**
 * What there is to submit.
 *
 * `versionSinceChanges` is false when the current version already carries a
 * review decision and nothing new has been written or uploaded since — a
 * version that was sent back, or one that was approved and then reopened, is
 * not reviewed a second time unchanged.
 */
export async function contentState(db, actx) {
  const asset = actx.asset;
  const text = isTextAsset(asset.assetType);

  const current = asset.currentVersionId
    ? await db.row(
        `SELECT v.id, v.version_number, v.content_json, v.source_kind,
                EXISTS (SELECT 1 FROM ${S}.learning_asset_approvals ap
                         WHERE ap.version_id = v.id AND ap.decision <> 'PENDING') AS decided
           FROM ${S}.learning_asset_versions v WHERE v.id = $1`,
        [asset.currentVersionId]
      )
    : null;

  const draft = text
    ? await db.row(
        `SELECT content_json, revision, updated_by, updated_at FROM ${S}.learning_asset_drafts WHERE asset_id = $1`,
        [asset.id]
      )
    : null;

  const draftHasText = Boolean(text && draft && contentHasText(asset.assetType, draft.content_json));
  const draftDiffers = Boolean(
    text && draft && (!current || !sameContent(asset.assetType, draft.content_json, current.content_json))
  );

  return {
    current,
    draft,
    draftHasText,
    draftDiffers,
    hasContent: Boolean(current) || draftHasText,
    versionSinceChanges: !current?.decided || (draftHasText && draftDiffers),
  };
}

export function evaluate(actx, state) {
  return evaluateAsset({
    asset: actx.asset,
    siblingStatuses: actx.siblingStatuses,
    settings: actx.settings,
    grants: actx.grants,
    userId: actx.userId,
    hasContent: state.hasContent,
    versionSinceChanges: state.versionSinceChanges,
  });
}

/** Who may resolve and reopen feedback on this asset. */
export function canResolveComments(actx) {
  return evaluateAsset({
    asset: actx.asset,
    siblingStatuses: actx.siblingStatuses,
    settings: actx.settings,
    grants: actx.grants,
    userId: actx.userId,
  }).canResolveComments;
}
