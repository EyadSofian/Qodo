/**
 * Qodo Projects — comments, forums and pages.
 *
 * The one rule that runs through all of it: **internal content never reaches a
 * client.** A comment defaults to internal, a client can only ever read the
 * ones explicitly marked otherwise, and the filter lives in the SQL of every
 * listing rather than in the component. "Let's pad the estimate" written under
 * a shared deliverable is exactly the sentence that must not travel, and it is
 * not a sentence anybody thinks to hide.
 */

import { paginate, query, rows, row, transaction } from './db.js';
import * as audit from './auditService.js';
import { may } from './projectAccess.js';
import { mentionedIds } from '../../shared/mentions.js';
import { find } from '../store.js';
import { isActiveUser } from '../../shared/permissions.js';

/**
 * Who a body names.
 *
 * `shared/mentions.js` reads the mention out of the text itself rather than
 * taking a list beside it, which is what stops the two from drifting when
 * somebody edits the sentence. It needs the roster to match names against, so
 * that is loaded here — scoped to the organization, because a name matched
 * against another tenant's staff is a name that should not resolve.
 */
async function mentionsIn(body, organizationId) {
  const people = await find(
    'users',
    (person) => isActiveUser(person) && (person.organizationId ?? 'engosoft') === organizationId
  );
  return mentionedIds(body, people);
}

/* ------------------------------------------------------------------ */
/* Comments                                                             */
/* ------------------------------------------------------------------ */

export async function comments(context, entityType, entityId, options = {}) {
  const { limit, offset } = paginate({ limit: options.limit ?? 100 });

  const found = await rows(
    `SELECT c.*, COALESCE(r.reactions, '[]'::json) AS reactions
       FROM qodo_projects.comments c
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object('emoji', emoji, 'userId', user_id)) AS reactions
           FROM qodo_projects.comment_reactions WHERE comment_id = c.id
       ) r ON true
      WHERE c.entity_type = $1
        AND c.entity_id = $2
        AND c.organization_id = $3
        AND c.deleted_at IS NULL
        ${context.isClient ? 'AND c.is_internal = false' : ''}
      ORDER BY c.created_at
      LIMIT $4 OFFSET $5`,
    [entityType, String(entityId), context.organizationId, limit, offset]
  );

  return found.map(toComment);
}

function toComment(record) {
  return {
    id: record.id,
    entityType: record.entity_type,
    entityId: record.entity_id,
    authorId: record.author_id,
    body: record.body,
    parentId: record.parent_id,
    isInternal: record.is_internal,
    mentionIds: record.mention_ids ?? [],
    reactions: record.reactions ?? [],
    editedAt: record.edited_at,
    createdAt: record.created_at,
  };
}

/**
 * Post a comment.
 *
 * A client's comment is always client-visible — otherwise a customer writes
 * something and it disappears — and staff comments default to internal unless
 * somebody with `comment.internal` deliberately shares one.
 */
export async function addComment(context, entityType, entityId, input) {
  const { user, project, organizationId } = context;

  const body = String(input?.body ?? '').trim();
  if (!body) throw badRequest('body_required');

  // Somebody without `comment.internal` cannot write an internal comment — a
  // contractor's note belongs to the conversation they are part of.
  const wantsInternal = input?.isInternal !== false;
  const isInternal = context.isClient ? false : wantsInternal && may(context, 'comment.internal');

  const mentions = await mentionsIn(body, organizationId);

  const created = await row(
    `INSERT INTO qodo_projects.comments
       (organization_id, project_id, entity_type, entity_id, author_id, body,
        parent_id, is_internal, mention_ids)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [
      organizationId,
      project.id,
      entityType,
      String(entityId),
      user.id,
      body,
      input?.parentId ?? null,
      isInternal,
      JSON.stringify(mentions),
    ]
  );

  await audit.record({
    actor: user,
    organizationId,
    projectId: project.id,
    entityType: 'comment',
    entityId: created.id,
    action: 'comment.create',
    after: { on: `${entityType}:${entityId}`, isInternal, mentions: mentions.length },
  });

  return toComment(created);
}

/**
 * Edit a comment.
 *
 * Only the author, and only the body — visibility is not editable after the
 * fact. Flipping an internal comment to client-visible a week later is a way to
 * publish something that was written in confidence, and flipping the other way
 * does not un-send it.
 */
export async function editComment(context, commentId, body) {
  const trimmed = String(body ?? '').trim();
  if (!trimmed) throw badRequest('body_required');

  const updated = await row(
    `UPDATE qodo_projects.comments
        SET body = $3, mention_ids = $4, edited_at = now()
      WHERE id = $1 AND author_id = $2 AND organization_id = $5 AND deleted_at IS NULL
      RETURNING *`,
    [commentId, context.user.id, trimmed, JSON.stringify(await mentionsIn(trimmed, context.organizationId)), context.organizationId]
  );
  return updated ? toComment(updated) : null;
}

export async function deleteComment(context, commentId) {
  const current = await row(
    'SELECT * FROM qodo_projects.comments WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL',
    [commentId, context.organizationId]
  );
  if (!current) return false;

  if (current.author_id !== context.user.id && !may(context, 'comment.delete_any')) {
    throw forbidden('comment.delete_any');
  }

  // Soft, so a thread does not develop holes where replies point at nothing.
  await query(
    'UPDATE qodo_projects.comments SET deleted_at = now(), deleted_by = $2 WHERE id = $1',
    [commentId, context.user.id]
  );

  await audit.record({
    actor: context.user,
    organizationId: context.organizationId,
    projectId: current.project_id,
    entityType: 'comment',
    entityId: commentId,
    action: 'comment.delete',
    before: { authorId: current.author_id },
    after: null,
  });

  return true;
}

/** Toggle a reaction. Pressing the same one twice takes it off. */
export async function react(context, commentId, emoji) {
  const clean = String(emoji ?? '').slice(0, 8);
  if (!clean) throw badRequest('emoji_required');

  const { rowCount } = await query(
    'DELETE FROM qodo_projects.comment_reactions WHERE comment_id = $1 AND user_id = $2 AND emoji = $3',
    [commentId, context.user.id, clean]
  );
  if (rowCount > 0) return { added: false };

  await query(
    `INSERT INTO qodo_projects.comment_reactions (comment_id, organization_id, user_id, emoji)
     VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
    [commentId, context.organizationId, context.user.id, clean]
  );
  return { added: true };
}

/* ------------------------------------------------------------------ */
/* Forums                                                               */
/* ------------------------------------------------------------------ */

export async function topics(context, options = {}) {
  const { limit, offset } = paginate(options);

  const found = await rows(
    `SELECT t.*, c.name AS category_name
       FROM qodo_projects.forum_topics t
       LEFT JOIN qodo_projects.forum_categories c ON c.id = t.category_id
      WHERE t.project_id = $1 AND t.organization_id = $2 AND t.deleted_at IS NULL
        ${context.isClient ? 'AND t.is_external = true' : ''}
      ORDER BY t.is_pinned DESC, COALESCE(t.last_reply_at, t.created_at) DESC
      LIMIT $3 OFFSET $4`,
    [context.project.id, context.organizationId, limit, offset]
  );

  return found.map(toTopic);
}

function toTopic(record) {
  return {
    id: record.id,
    categoryId: record.category_id,
    categoryName: record.category_name ?? null,
    title: record.title,
    body: record.body,
    authorId: record.author_id,
    isExternal: record.is_external,
    isPinned: record.is_pinned,
    isLocked: record.is_locked,
    replyCount: record.reply_count,
    lastReplyAt: record.last_reply_at,
    createdAt: record.created_at,
  };
}

export async function createTopic(context, input) {
  const { user, project, organizationId } = context;

  const title = String(input?.title ?? '').trim();
  if (!title) throw badRequest('title_required');

  const created = await row(
    `INSERT INTO qodo_projects.forum_topics
       (organization_id, project_id, category_id, title, body, author_id, is_external)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [
      organizationId,
      project.id,
      input?.categoryId ?? null,
      title,
      String(input?.body ?? ''),
      user.id,
      // A topic a client starts is visible to them, for the same reason their
      // comments are: otherwise they post and it vanishes.
      context.isClient ? true : Boolean(input?.isExternal),
    ]
  );

  await audit.record({
    actor: user,
    organizationId,
    projectId: project.id,
    entityType: 'forum_topic',
    entityId: created.id,
    action: 'forum.topic.create',
    after: { title, isExternal: created.is_external },
  });

  return toTopic(created);
}

export async function topicWithPosts(context, topicId) {
  const topic = await row(
    `SELECT * FROM qodo_projects.forum_topics
      WHERE id = $1 AND project_id = $2 AND organization_id = $3 AND deleted_at IS NULL`,
    [topicId, context.project.id, context.organizationId]
  );
  if (!topic) return null;
  if (context.isClient && topic.is_external !== true) return null;

  const posts = await rows(
    `SELECT * FROM qodo_projects.forum_posts
      WHERE topic_id = $1 AND deleted_at IS NULL ORDER BY created_at`,
    [topicId]
  );

  return {
    ...toTopic(topic),
    posts: posts.map((post) => ({
      id: post.id,
      authorId: post.author_id,
      body: post.body,
      mentionIds: post.mention_ids ?? [],
      editedAt: post.edited_at,
      createdAt: post.created_at,
    })),
  };
}

export async function reply(context, topicId, body) {
  const trimmed = String(body ?? '').trim();
  if (!trimmed) throw badRequest('body_required');

  const topic = await topicWithPosts(context, topicId);
  if (!topic) return null;
  if (topic.isLocked && !may(context, 'forum.moderate')) throw conflict('topic_locked');

  return transaction(async (tx) => {
    const post = await tx.row(
      `INSERT INTO qodo_projects.forum_posts
         (organization_id, topic_id, author_id, body, mention_ids)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [context.organizationId, topicId, context.user.id, trimmed, JSON.stringify(await mentionsIn(trimmed, context.organizationId))]
    );

    // The counters are denormalised so a topic list does not need a subquery
    // per row, and they are written in the same transaction as the post so the
    // two can never disagree.
    await tx.query(
      `UPDATE qodo_projects.forum_topics
          SET reply_count = reply_count + 1, last_reply_at = now()
        WHERE id = $1`,
      [topicId]
    );

    return {
      id: post.id,
      authorId: post.author_id,
      body: post.body,
      createdAt: post.created_at,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Pages                                                                */
/* ------------------------------------------------------------------ */

export async function pages(context) {
  return (
    await rows(
      `SELECT id, parent_id, title, is_external, order_index, revision_no, updated_at, updated_by
         FROM qodo_projects.project_pages
        WHERE project_id = $1 AND organization_id = $2 AND deleted_at IS NULL
          ${context.isClient ? 'AND is_external = true' : ''}
        ORDER BY order_index, title`,
      [context.project.id, context.organizationId]
    )
  ).map((record) => ({
    id: record.id,
    parentId: record.parent_id,
    title: record.title,
    isExternal: record.is_external,
    orderIndex: record.order_index,
    revisionNo: record.revision_no,
    updatedAt: record.updated_at,
    updatedBy: record.updated_by,
  }));
}

export async function page(context, pageId) {
  const found = await row(
    `SELECT * FROM qodo_projects.project_pages
      WHERE id = $1 AND project_id = $2 AND organization_id = $3 AND deleted_at IS NULL`,
    [pageId, context.project.id, context.organizationId]
  );
  if (!found) return null;
  if (context.isClient && found.is_external !== true) return null;

  return {
    id: found.id,
    parentId: found.parent_id,
    title: found.title,
    body: found.body,
    isExternal: found.is_external,
    revisionNo: found.revision_no,
    updatedAt: found.updated_at,
    updatedBy: found.updated_by,
  };
}

export async function createPage(context, input) {
  const title = String(input?.title ?? '').trim();
  if (!title) throw badRequest('title_required');

  return transaction(async (tx) => {
    const created = await tx.row(
      `INSERT INTO qodo_projects.project_pages
         (organization_id, project_id, parent_id, title, body, is_external, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING *`,
      [
        context.organizationId,
        context.project.id,
        input?.parentId ?? null,
        title,
        String(input?.body ?? ''),
        Boolean(input?.isExternal),
        context.user.id,
      ]
    );

    await tx.query(
      `INSERT INTO qodo_projects.page_revisions
         (page_id, organization_id, revision_no, title, body, author_id)
       VALUES ($1,$2,1,$3,$4,$5)`,
      [created.id, context.organizationId, created.title, created.body, context.user.id]
    );

    return { id: created.id, title: created.title, revisionNo: 1 };
  });
}

/**
 * Save a page, keeping what it said before.
 *
 * Every save writes a revision, so a bad edit is one click from being undone.
 * That is the whole difference between a wiki and a text field.
 */
export async function updatePage(context, pageId, input) {
  const current = await page(context, pageId);
  if (!current) return null;

  return transaction(async (tx) => {
    const next = current.revisionNo + 1;

    const updated = await tx.row(
      `UPDATE qodo_projects.project_pages
          SET title = COALESCE($3, title),
              body = COALESCE($4, body),
              is_external = COALESCE($5, is_external),
              revision_no = $6,
              updated_by = $7
        WHERE id = $1 AND organization_id = $2
        RETURNING *`,
      [
        pageId,
        context.organizationId,
        input?.title === undefined ? null : String(input.title).trim(),
        input?.body === undefined ? null : String(input.body),
        input?.isExternal === undefined ? null : Boolean(input.isExternal),
        next,
        context.user.id,
      ]
    );

    await tx.query(
      `INSERT INTO qodo_projects.page_revisions
         (page_id, organization_id, revision_no, title, body, author_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [pageId, context.organizationId, next, updated.title, updated.body, context.user.id]
    );

    await audit.record({
      actor: context.user,
      organizationId: context.organizationId,
      projectId: context.project.id,
      entityType: 'page',
      entityId: pageId,
      action: 'page.update',
      after: { revision: next, title: updated.title },
      tx,
    });

    return { id: pageId, title: updated.title, revisionNo: next };
  });
}

export async function pageRevisions(context, pageId) {
  return rows(
    `SELECT revision_no, title, author_id, created_at
       FROM qodo_projects.page_revisions
      WHERE page_id = $1 AND organization_id = $2
      ORDER BY revision_no DESC LIMIT 50`,
    [pageId, context.organizationId]
  );
}

/**
 * Put a page back to how it read at an earlier revision.
 *
 * Writes a *new* revision rather than deleting the ones after it — the history
 * of a mistake is part of the history, and truncating it would make the page
 * look like the bad edit never happened.
 */
export async function restorePageRevision(context, pageId, revisionNo) {
  const old = await row(
    `SELECT title, body FROM qodo_projects.page_revisions
      WHERE page_id = $1 AND revision_no = $2 AND organization_id = $3`,
    [pageId, revisionNo, context.organizationId]
  );
  if (!old) return null;
  return updatePage(context, pageId, { title: old.title, body: old.body });
}

function badRequest(code) {
  return Object.assign(new Error(code), { status: 400, body: { error: code } });
}
function conflict(code) {
  return Object.assign(new Error(code), { status: 409, body: { error: code } });
}
function forbidden(permission) {
  return Object.assign(new Error('forbidden'), {
    status: 403,
    body: { error: 'forbidden', missing: permission },
  });
}
