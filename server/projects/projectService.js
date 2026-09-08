/**
 * Qodo Projects — projects, membership and lifecycle.
 *
 * Routes parse and authorize; this file decides; `db.js` persists. A route in
 * this module never writes SQL and this file never reads `req` — the rule that
 * keeps `server/routes/projects/` from becoming what `server/routes/tasks.js`
 * became at 2051 lines.
 */

import { paginate, query, rows, row, transaction } from './db.js';
import * as audit from './auditService.js';
import { visibleProjectIds } from './projectAccess.js';
import { organizationOf } from '../../shared/organization.js';
import { find } from '../store.js';
import { isActiveUser } from '../../shared/permissions.js';
import { visiblePeople } from '../taskAccess.js';

/* ------------------------------------------------------------------ */
/* Reading                                                              */
/* ------------------------------------------------------------------ */

/**
 * The scopes the projects list can be asked for.
 *
 * These are the tabs, and they are a closed set on purpose: a `scope` that fell
 * through to "no filter" would be a way to ask for deleted projects by typing a
 * word the server does not recognise.
 */
const SCOPES = {
  active: 'p.archived_at IS NULL AND p.deleted_at IS NULL',
  archived: 'p.archived_at IS NOT NULL AND p.deleted_at IS NULL',
  trashed: 'p.deleted_at IS NOT NULL',
  all: 'p.deleted_at IS NULL',
};

const SORTS = {
  name: 'p.name',
  key: 'p.key',
  created: 'p.created_at',
  updated: 'p.updated_at',
  start: 'p.start_date',
  end: 'p.end_date',
};

/**
 * List projects this person may see.
 *
 * Filtering, sorting and paging all happen in SQL. That is not a preference —
 * it is the whole reason Projects has a relational schema (ADR-2). The moment
 * one of these moves into JavaScript, the endpoint starts loading every project
 * in the company to show fifty.
 */
export async function list(user, options = {}) {
  const organizationId = organizationOf(user);
  const scope = SCOPES[options.scope] ? options.scope : 'active';
  const { limit, offset } = paginate(options);

  // Membership first, always. Everything below filters *within* what this
  // person may see; nothing widens it.
  //
  // The archived and trashed tabs have to widen what membership *considers*,
  // not what it permits: a deleted project is still only visible to the people
  // who could see it before it was deleted, and asking for the recycle bin must
  // not be a way to see somebody else's.
  const allowed = await visibleProjectIds(user, {
    includeArchived: scope !== 'active',
    includeDeleted: scope === 'trashed' || scope === 'all',
  });
  if (allowed.length === 0) return { projects: [], total: 0, limit, offset };

  const params = [organizationId, allowed];
  const conditions = [
    'p.organization_id = $1',
    'p.id = ANY($2::uuid[])',
    SCOPES[scope],
  ];

  if (options.groupId) {
    params.push(options.groupId);
    conditions.push(`p.group_id = $${params.length}`);
  }
  if (options.customerId) {
    params.push(options.customerId);
    conditions.push(`p.customer_id = $${params.length}`);
  }
  if (options.statusId) {
    params.push(options.statusId);
    conditions.push(`p.status_id = $${params.length}`);
  }
  if (options.ownerId) {
    params.push(options.ownerId);
    conditions.push(`p.owner_id = $${params.length}`);
  }
  if (options.search) {
    params.push(`%${String(options.search).trim().toLowerCase()}%`);
    conditions.push(`(lower(p.name) LIKE $${params.length} OR lower(p.key) LIKE $${params.length})`);
  }
  if (options.favoritesOf) {
    params.push(options.favoritesOf);
    conditions.push(
      `EXISTS (SELECT 1 FROM qodo_projects.project_favorites f
                WHERE f.project_id = p.id AND f.user_id = $${params.length})`
    );
  }
  if (options.memberOf) {
    params.push(options.memberOf);
    conditions.push(
      `EXISTS (SELECT 1 FROM qodo_projects.project_members m
                WHERE m.project_id = p.id AND m.user_id = $${params.length})`
    );
  }

  const orderColumn = SORTS[options.sort] ?? SORTS.updated;
  const direction = options.direction === 'asc' ? 'ASC' : 'DESC';
  const whereClause = conditions.join(' AND ');

  params.push(limit, offset);

  /**
   * The row, plus what it takes to know how the project is *doing*.
   *
   * The status label and the progress roll-up are joined here rather than
   * fetched per card by the browser. The alternative the list started with was
   * a card that could show a name and a date and nothing else, so every reader
   * had to open a project to find out whether it was in trouble — which is the
   * one question a list of forty projects exists to answer.
   *
   * `LEFT JOIN LATERAL` rather than four correlated subqueries in the SELECT:
   * one pass over each project's tasks instead of four, and the aggregate is
   * computed after `LIMIT` has already narrowed the driving table to a page.
   * The columns are additive — nothing that read this endpoint before reads
   * anything different now.
   */
  const found = await rows(
    `SELECT p.id, p.key, p.name, p.description, p.owner_id, p.customer_id,
            p.group_id, p.status_id, p.start_date, p.end_date, p.access,
            p.currency, p.billing_method, p.color, p.archived_at, p.deleted_at,
            p.created_at, p.updated_at,
            c.name AS customer_name,
            g.name_ar AS group_name_ar, g.name_en AS group_name_en,
            s.key AS status_key, s.label_ar AS status_label_ar,
            s.label_en AS status_label_en, s.color AS status_color,
            s.category AS status_category,
            (SELECT count(*) FROM qodo_projects.project_members m WHERE m.project_id = p.id) AS member_count,
            roll.task_count, roll.done_count, roll.overdue_count, roll.progress,
            EXISTS (SELECT 1 FROM qodo_projects.demo_seeds d
                     WHERE d.entity_type = 'project' AND d.entity_id = p.id::text) AS is_demo,
            (SELECT count(*) FROM qodo_projects.issues i
              WHERE i.project_id = p.id AND i.deleted_at IS NULL
                AND COALESCE((SELECT s2.category FROM qodo_projects.statuses s2 WHERE s2.id = i.status_id),
                             'open') NOT IN ('done', 'cancelled')) AS open_issues
       FROM qodo_projects.projects p
       LEFT JOIN qodo_projects.customers c ON c.id = p.customer_id
       LEFT JOIN qodo_projects.project_groups g ON g.id = p.group_id
       LEFT JOIN qodo_projects.statuses s ON s.id = p.status_id
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS task_count,
                count(*) FILTER (WHERE ts.category = 'done')::int AS done_count,
                count(*) FILTER (
                  WHERE t.end_date < CURRENT_DATE
                    AND COALESCE(ts.category, 'active') NOT IN ('done', 'cancelled')
                )::int AS overdue_count,
                avg(t.progress) AS progress
           FROM qodo_projects.project_task_extensions t
           LEFT JOIN qodo_projects.statuses ts ON ts.id = t.status_id
          WHERE t.project_id = p.id AND t.deleted_at IS NULL
       ) roll ON true
      WHERE ${whereClause}
      ORDER BY ${orderColumn} ${direction} NULLS LAST
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const counted = await row(
    `SELECT count(*)::int AS total FROM qodo_projects.projects p WHERE ${whereClause}`,
    params.slice(0, params.length - 2)
  );

  return {
    projects: found.map(toProject),
    total: counted?.total ?? 0,
    limit,
    offset,
  };
}

function toProject(record) {
  return {
    id: record.id,
    key: record.key,
    name: record.name,
    description: record.description,
    ownerId: record.owner_id,
    customerId: record.customer_id,
    customerName: record.customer_name ?? null,
    groupId: record.group_id,
    groupName: record.group_name_ar
      ? { ar: record.group_name_ar, en: record.group_name_en }
      : null,
    statusId: record.status_id,
    startDate: record.start_date,
    endDate: record.end_date,
    access: record.access,
    currency: record.currency,
    billingMethod: record.billing_method,
    color: record.color,
    memberCount: Number(record.member_count ?? 0),
    archivedAt: record.archived_at,
    deletedAt: record.deleted_at,
    createdAt: record.created_at,
    updatedAt: record.updated_at,

    /**
     * The health half. Only present on a listing — `contextFor` reads a
     * narrower row and does not join any of this, and a shape that sometimes
     * carries a number and sometimes carries nothing is worse than one that
     * says `null` on purpose.
     */
    status: record.status_key
      ? {
          key: record.status_key,
          label: { ar: record.status_label_ar, en: record.status_label_en },
          color: record.status_color,
          category: record.status_category,
        }
      : null,
    taskCount: record.task_count === undefined ? null : Number(record.task_count ?? 0),
    doneCount: record.done_count === undefined ? null : Number(record.done_count ?? 0),
    overdueTasks: record.overdue_count === undefined ? null : Number(record.overdue_count ?? 0),
    openIssues: record.open_issues === undefined ? null : Number(record.open_issues ?? 0),
    // `avg` over no rows is null, and null is the right answer: a project with
    // no tasks has no progress, which is a different statement from 0%.
    progress: record.progress === null || record.progress === undefined ? null : Math.round(Number(record.progress)),

    /**
     * Whether this project came from the demo loader.
     *
     * Read straight from the manifest rather than from a column on `projects`,
     * so it cannot drift: a project is demo exactly as long as the row that
     * would delete it still exists. The interface uses it for one thing —
     * a small badge — and that badge is the honest answer to "why is there a
     * shop launch project in my workspace".
     */
    isDemo: record.is_demo === undefined ? false : Boolean(record.is_demo),
  };
}

export async function get(context) {
  if (!context) return null;
  return context.project;
}

/* ------------------------------------------------------------------ */
/* Writing                                                              */
/* ------------------------------------------------------------------ */

/**
 * The project key — the readable prefix that ends up in `ENG-42`, in exports
 * and in mail subjects.
 *
 * Derived from the name when the caller does not supply one, and always
 * uppercased and stripped to letters and digits. It is unique per organization
 * and never changes afterwards: it is embedded in every reference that has
 * already left the system, so a rename would orphan them.
 */
export function deriveKey(name, fallback = 'PRJ') {
  // Punctuation separates words, it does not vanish: "Al-Rehab / Phase 2" is
  // four words, and deleting the hyphen instead of splitting on it silently
  // dropped "Rehab" from the abbreviation.
  const cleaned = String(name ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
  if (!cleaned) return fallback;

  const words = cleaned.split(/\s+/).filter(Boolean);
  // One word gives its first four letters; several give their initials. Both
  // read as a deliberate abbreviation rather than as a truncation.
  const candidate = words.length === 1 ? words[0].slice(0, 4) : words.map((w) => w[0]).join('').slice(0, 5);
  return candidate || fallback;
}

async function uniqueKey(organizationId, desired, tx) {
  const base = String(desired).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || 'PRJ';
  // Ask the database rather than guessing: the loop is bounded and the UNIQUE
  // constraint is still the thing that decides, so two concurrent creates
  // cannot both win — the loser retries.
  for (let suffix = 0; suffix < 100; suffix += 1) {
    const candidate = suffix === 0 ? base : `${base}${suffix}`;
    const clash = await tx.row(
      'SELECT 1 FROM qodo_projects.projects WHERE organization_id = $1 AND key = $2',
      [organizationId, candidate]
    );
    if (!clash) return candidate;
  }
  throw Object.assign(new Error('key_exhausted'), {
    status: 409,
    body: { error: 'key_exhausted', hint: 'Choose a different project key.' },
  });
}

/**
 * Create a project.
 *
 * One transaction, because a project without its owner's membership row is not
 * a slow request — it is a project nobody can open, including the person who
 * just made it.
 */
export async function create(user, input) {
  const organizationId = organizationOf(user);

  const name = String(input?.name ?? '').trim();
  if (!name) {
    throw Object.assign(new Error('name_required'), {
      status: 400,
      body: { error: 'name_required' },
    });
  }
  if (input?.startDate && input?.endDate && input.endDate < input.startDate) {
    throw Object.assign(new Error('end_before_start'), {
      status: 400,
      body: { error: 'end_before_start' },
    });
  }

  return transaction(async (tx) => {
    const key = await uniqueKey(organizationId, input?.key || deriveKey(name), tx);

    // Without this a new project has no status, and every board and report
    // shows one unlabelled pile. The default is data (migration 002), so an
    // organization that renamed or reordered its statuses gets its own.
    let statusId = input?.statusId ?? null;
    if (!statusId) {
      const fallback = await tx.row(
        `SELECT s.id FROM qodo_projects.statuses s
           JOIN qodo_projects.modules m ON m.id = s.module_id
          WHERE s.organization_id = $1 AND m.key = 'project' AND s.is_default
          LIMIT 1`,
        [organizationId]
      );
      statusId = fallback?.id ?? null;
    }

    const created = await tx.row(
      `INSERT INTO qodo_projects.projects
         (organization_id, key, name, description, owner_id, customer_id, group_id,
          calendar_id, status_id, start_date, end_date, access, currency,
          billing_method, color, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)
       RETURNING *`,
      [
        organizationId,
        key,
        name,
        String(input?.description ?? ''),
        input?.ownerId || user.id,
        input?.customerId ?? null,
        input?.groupId ?? null,
        input?.calendarId ?? null,
        statusId,
        input?.startDate ?? null,
        input?.endDate ?? null,
        input?.access === 'portal' ? 'portal' : 'private',
        String(input?.currency ?? 'EGP').toUpperCase().slice(0, 3),
        input?.billingMethod ?? 'none',
        input?.color ?? '#1D6FB8',
        user.id,
      ]
    );

    // The owner is a member with the owner role, always. Not a convenience —
    // membership is the authorization join, so an owner who is not in it cannot
    // open their own project.
    await tx.query(
      `INSERT INTO qodo_projects.project_members
         (organization_id, project_id, user_id, role, is_client, added_by)
       VALUES ($1, $2, $3, 'owner', false, $4)`,
      [organizationId, created.id, created.owner_id, user.id]
    );

    // Whoever created it, if that is somebody other than the owner. `ON
    // CONFLICT DO NOTHING` rather than a branch, because the common case is
    // that they are the same person.
    await tx.query(
      `INSERT INTO qodo_projects.project_members
         (organization_id, project_id, user_id, role, is_client, added_by)
       VALUES ($1, $2, $3, 'manager', false, $3)
       ON CONFLICT (project_id, user_id) DO NOTHING`,
      [organizationId, created.id, user.id]
    );

    await audit.record({
      actor: user,
      organizationId,
      projectId: created.id,
      entityType: 'project',
      entityId: created.id,
      action: 'project.create',
      after: { name: created.name, key: created.key, access: created.access },
      tx,
    });

    return toProject(created);
  });
}

/** Fields a project update is allowed to touch, and how each is normalised. */
const UPDATABLE = {
  name: (v) => String(v).trim(),
  description: (v) => String(v ?? ''),
  ownerId: (v) => String(v),
  customerId: (v) => v || null,
  groupId: (v) => v || null,
  calendarId: (v) => v || null,
  statusId: (v) => v || null,
  startDate: (v) => v || null,
  endDate: (v) => v || null,
  access: (v) => (v === 'portal' ? 'portal' : 'private'),
  currency: (v) => String(v).toUpperCase().slice(0, 3),
  billingMethod: (v) => String(v),
  color: (v) => String(v),
};

const COLUMN_OF = {
  name: 'name',
  description: 'description',
  ownerId: 'owner_id',
  customerId: 'customer_id',
  groupId: 'group_id',
  calendarId: 'calendar_id',
  statusId: 'status_id',
  startDate: 'start_date',
  endDate: 'end_date',
  access: 'access',
  currency: 'currency',
  billingMethod: 'billing_method',
  color: 'color',
};

/**
 * Update a project.
 *
 * `key` is deliberately absent from `UPDATABLE`. A whitelist rather than a
 * blacklist, so a column added to the table later is not silently writable from
 * the API the moment it exists.
 */
export async function update(context, input) {
  const { user, project, organizationId } = context;

  const patch = {};
  for (const [field, normalise] of Object.entries(UPDATABLE)) {
    if (input?.[field] === undefined) continue;
    patch[field] = normalise(input[field]);
  }
  if (Object.keys(patch).length === 0) return project;

  const startDate = patch.startDate ?? project.startDate;
  const endDate = patch.endDate ?? project.endDate;
  if (startDate && endDate && endDate < startDate) {
    throw Object.assign(new Error('end_before_start'), {
      status: 400,
      body: { error: 'end_before_start' },
    });
  }

  const assignments = [];
  const params = [project.id, organizationId, user.id];
  for (const [field, value] of Object.entries(patch)) {
    params.push(value);
    assignments.push(`${COLUMN_OF[field]} = $${params.length}`);
  }

  const updated = await row(
    `UPDATE qodo_projects.projects
        SET ${assignments.join(', ')}, updated_by = $3
      WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
      RETURNING *`,
    params
  );
  if (!updated) return null;

  await audit.record({
    actor: user,
    organizationId,
    projectId: project.id,
    entityType: 'project',
    entityId: project.id,
    action: 'project.update',
    before: pick(project, Object.keys(patch)),
    after: patch,
  });

  return toProject(updated);
}

function pick(source, fields) {
  const out = {};
  for (const field of fields) out[field] = source?.[field] ?? null;
  return out;
}

/**
 * Archive and unarchive.
 *
 * Archiving takes a project off the active list without taking its history
 * with it — the same distinction `server/taskAccess.js` already draws between
 * archiving a task and deleting it, and worth keeping identical so the two
 * modules do not teach different meanings for the same word.
 */
export async function setArchived(context, archived) {
  const { user, project, organizationId } = context;

  const updated = await row(
    `UPDATE qodo_projects.projects
        SET archived_at = $3, archived_by = $4, updated_by = $4
      WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
      RETURNING *`,
    [project.id, organizationId, archived ? new Date().toISOString() : null, user.id]
  );
  if (!updated) return null;

  await audit.record({
    actor: user,
    organizationId,
    projectId: project.id,
    entityType: 'project',
    entityId: project.id,
    action: archived ? 'project.archive' : 'project.unarchive',
    before: { archivedAt: project.archivedAt },
    after: { archivedAt: updated.archived_at },
  });

  return toProject(updated);
}

/**
 * Soft delete — the recycle bin (§65).
 *
 * Every child is stamped with the same `deleted_batch_id`, and that is the
 * whole trick behind restore: reversing the batch restores exactly what this
 * delete took, and leaves alone anything that had already been deleted
 * separately beforehand. Without the batch id, restore has to guess, and it
 * guesses wrong the first time somebody deletes a phase and then the project.
 *
 * Phase 1 stamps only the project. Migration 003 adds the children, and the
 * batch column is here from the start so that adding them is one `UPDATE …
 * WHERE project_id = $1` and not a schema change.
 */
export async function softDelete(context) {
  const { user, project, organizationId } = context;

  return transaction(async (tx) => {
    const batch = await tx.row('SELECT gen_random_uuid() AS id');
    const deleted = await tx.row(
      `UPDATE qodo_projects.projects
          SET deleted_at = now(), deleted_by = $3, deleted_batch_id = $4
        WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
        RETURNING *`,
      [project.id, organizationId, user.id, batch.id]
    );
    if (!deleted) return null;

    await audit.record({
      actor: user,
      organizationId,
      projectId: project.id,
      entityType: 'project',
      entityId: project.id,
      action: 'project.delete',
      before: { deletedAt: null },
      after: { deletedAt: deleted.deleted_at, batch: batch.id },
      tx,
    });

    return toProject(deleted);
  });
}

export async function restore(user, projectId) {
  const organizationId = organizationOf(user);

  return transaction(async (tx) => {
    const found = await tx.row(
      `SELECT * FROM qodo_projects.projects
        WHERE id = $1 AND organization_id = $2 AND deleted_at IS NOT NULL`,
      [projectId, organizationId]
    );
    if (!found) return null;

    const restored = await tx.row(
      `UPDATE qodo_projects.projects
          SET deleted_at = NULL, deleted_by = NULL, deleted_batch_id = NULL, updated_by = $3
        WHERE id = $1 AND organization_id = $2
        RETURNING *`,
      [projectId, organizationId, user.id]
    );

    await audit.record({
      actor: user,
      organizationId,
      projectId,
      entityType: 'project',
      entityId: projectId,
      action: 'project.restore',
      before: { deletedAt: found.deleted_at },
      after: { deletedAt: null },
      tx,
    });

    return toProject(restored);
  });
}

/**
 * The permanent purge.
 *
 * Separate from delete, behind a separate permission that no built-in set
 * carries, and audited before the rows go — because after they are gone the
 * audit row is the only remaining evidence the project ever existed. Recording
 * it afterwards would mean a failed write leaves no trace at all.
 */
export async function purge(user, projectId) {
  const organizationId = organizationOf(user);

  return transaction(async (tx) => {
    const found = await tx.row(
      `SELECT * FROM qodo_projects.projects
        WHERE id = $1 AND organization_id = $2 AND deleted_at IS NOT NULL`,
      [projectId, organizationId]
    );
    if (!found) return null;

    await audit.record({
      actor: user,
      organizationId,
      projectId,
      entityType: 'project',
      entityId: projectId,
      action: 'project.purge',
      before: { name: found.name, key: found.key },
      after: null,
      tx,
    });

    await tx.query('DELETE FROM qodo_projects.projects WHERE id = $1 AND organization_id = $2', [
      projectId,
      organizationId,
    ]);
    return { id: projectId, purged: true };
  });
}

/* ------------------------------------------------------------------ */
/* Membership                                                           */
/* ------------------------------------------------------------------ */

/**
 * Who is on this project.
 *
 * Shaped into camelCase like every other reader in this module. Returning the
 * raw row was a real bug: the browser reads `userId`, the row says `user_id`,
 * and the members list rendered a row per person with no name on it — which
 * React then also complained about, because every key was undefined.
 */
export async function members(context) {
  const found = await rows(
    `SELECT user_id, role, project_role_id, is_client, allocation_percent, added_at, added_by
       FROM qodo_projects.project_members
      WHERE project_id = $1 AND organization_id = $2
      ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1
                         WHEN 'member' THEN 2 WHEN 'viewer' THEN 3 ELSE 4 END,
               added_at`,
    [context.project.id, context.organizationId]
  );

  // The membership row knows an id; a person reading the screen needs a name.
  // Resolved here rather than in the browser, because the browser would need
  // `users.view` to look one up — and being able to see who is on your own
  // project should not require permission to read the staff directory.
  const people = await find('users', (person) => found.some((member) => member.user_id === person.id));
  const byId = new Map(people.map((person) => [person.id, person]));

  return found.map((member) => {
    const person = byId.get(member.user_id);
    return {
      userId: member.user_id,
      // A member whose account was deleted keeps their row — the history of who
      // was on the project is not rewritten by somebody leaving.
      name: person?.name ?? null,
      title: person?.title ?? null,
      avatarColor: person?.avatarColor ?? null,
      role: member.role,
      projectRoleId: member.project_role_id,
      isClient: member.is_client,
      allocationPercent: member.allocation_percent,
      addedAt: member.added_at,
      addedBy: member.added_by,
    };
  });
}

const MEMBER_ROLES = new Set(['owner', 'manager', 'member', 'viewer', 'client']);

export async function addMember(context, input) {
  const { user, project, organizationId } = context;
  const userId = String(input?.userId ?? '').trim();
  if (!userId) {
    throw Object.assign(new Error('user_required'), { status: 400, body: { error: 'user_required' } });
  }

  const role = MEMBER_ROLES.has(input?.role) ? input.role : 'member';
  // The client flag follows the role and is not separately settable from the
  // API. A caller who could send `role: 'manager', isClient: false` for a
  // customer would have found the way past the client boundary.
  const isClient = role === 'client';

  const added = await row(
    `INSERT INTO qodo_projects.project_members
       (organization_id, project_id, user_id, role, is_client, allocation_percent, added_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (project_id, user_id)
       DO UPDATE SET role = EXCLUDED.role,
                     is_client = EXCLUDED.is_client,
                     allocation_percent = EXCLUDED.allocation_percent
     RETURNING *`,
    [
      organizationId,
      project.id,
      userId,
      role,
      isClient,
      Math.max(0, Math.min(100, Number(input?.allocationPercent ?? 100))),
      user.id,
    ]
  );

  await audit.record({
    actor: user,
    organizationId,
    projectId: project.id,
    entityType: 'project_member',
    entityId: `${project.id}:${userId}`,
    action: 'project.member.add',
    after: { userId, role, isClient },
  });

  return added;
}

/**
 * Remove a member.
 *
 * The owner cannot be removed, because membership is what makes a project
 * openable and removing its owner produces a project with an owner who cannot
 * see it. Changing the owner is a project update, and that is where it belongs.
 */
export async function removeMember(context, userId) {
  const { user, project, organizationId } = context;

  if (userId === project.ownerId) {
    throw Object.assign(new Error('owner_cannot_be_removed'), {
      status: 409,
      body: { error: 'owner_cannot_be_removed', hint: 'Change the project owner first.' },
    });
  }

  const { rowCount } = await query(
    `DELETE FROM qodo_projects.project_members
      WHERE project_id = $1 AND organization_id = $2 AND user_id = $3`,
    [project.id, organizationId, userId]
  );
  if (rowCount === 0) return false;

  await audit.record({
    actor: user,
    organizationId,
    projectId: project.id,
    entityType: 'project_member',
    entityId: `${project.id}:${userId}`,
    action: 'project.member.remove',
    before: { userId },
    after: null,
  });

  return true;
}

/**
 * People who could be added to this project.
 *
 * A Projects question with a Projects answer, rather than sending the caller to
 * `/api/users` — that endpoint needs `users.view`, which a project manager has
 * no particular reason to hold, and widening it so they could add a member
 * would hand them the whole staff directory including its permission columns.
 *
 * Scoped by the workspace's own `visiblePeople`, so somebody who can only see
 * their sub-team can only add from it, and trimmed to what a picker needs.
 */
export async function candidates(context) {
  const people = await find('users', (person) => isActiveUser(person));
  const existing = new Set(
    (
      await rows(
        'SELECT user_id FROM qodo_projects.project_members WHERE project_id = $1',
        [context.project.id]
      )
    ).map((member) => member.user_id)
  );

  return visiblePeople(context.user, people)
    .filter((person) => !existing.has(person.id))
    .map((person) => ({
      id: person.id,
      name: person.name,
      email: person.email,
      title: person.title ?? null,
      department: person.department,
      avatarColor: person.avatarColor,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------------ */
/* Favourites and recents                                               */
/* ------------------------------------------------------------------ */

export async function setFavorite(context, favorite) {
  const { user, project, organizationId } = context;
  if (favorite) {
    await query(
      `INSERT INTO qodo_projects.project_favorites (organization_id, project_id, user_id)
       VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [organizationId, project.id, user.id]
    );
  } else {
    await query(
      'DELETE FROM qodo_projects.project_favorites WHERE project_id = $1 AND user_id = $2',
      [project.id, user.id]
    );
  }
  return { favorite };
}

/**
 * Remember that this person opened this project.
 *
 * Deliberately fire-and-forget at the call site: a failure to record a view
 * must never fail the request that was actually asked for.
 */
export async function touchRecent(context) {
  await query(
    `INSERT INTO qodo_projects.project_recent_views (organization_id, project_id, user_id, viewed_at)
     VALUES ($1,$2,$3, now())
     ON CONFLICT (project_id, user_id) DO UPDATE SET viewed_at = now()`,
    [context.organizationId, context.project.id, context.user.id]
  );
}
