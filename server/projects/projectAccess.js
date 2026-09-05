/**
 * Qodo Projects — the authorization core.
 *
 * Everything in Projects goes through here. `server/taskAccess.js` plays the
 * same part for the workspace's own tasks, and this file deliberately follows
 * its shape — resolve a context, ask a `can…` question, get a boolean — so
 * there is one idiom in the codebase rather than two.
 *
 * The difference is what "visible" means. A workspace task is visible by
 * department; a project is visible by *membership*. That is a stronger and
 * simpler rule, and it is the one the client portal depends on: a customer is a
 * member of one project and nothing else exists for them.
 *
 * Three rules hold everywhere in this file:
 *
 *   1. **Deny by default.** Every path that is not an explicit yes is a no.
 *   2. **Never trust an id from the request.** The organization comes from the
 *      session. A project id in the URL is a *claim*, checked against
 *      membership before anything is read.
 *   3. **A missing project and a forbidden project look identical.** Both are
 *      404. A 403 tells somebody that a project they may not see exists, which
 *      is itself information about the company.
 */

import { rows, row } from './db.js';
import { organizationOf } from '../../shared/organization.js';
import { can as canWorkspace, PERMISSIONS } from '../../shared/permissions.js';
import {
  PERMISSION_SETS,
  canInProject,
  isClientSet,
  permissionsOfSet,
  visibleToClient,
} from '../../shared/projects/permissions.js';

/* ------------------------------------------------------------------ */
/* Context                                                              */
/* ------------------------------------------------------------------ */

/**
 * The permission set this user carries.
 *
 * A workspace administrator is a Projects administrator. That is not a
 * shortcut — `shared/permissions.js` gives `admin` every key in the workspace
 * precisely so that adding a permission never strands the person responsible
 * for granting it, and Projects would be the one module where that stopped
 * being true.
 *
 * Everybody else falls back to `employee` rather than to nothing, because a
 * workspace member who has never been assigned a set should be able to do their
 * job in a project they were added to — and `employee` cannot approve, cannot
 * budget, and cannot see a rate.
 */
export async function permissionSetFor(user) {
  if (!user) return null;
  if (user.role === 'admin') return PERMISSION_SETS.admin;

  const assigned = await row(
    `SELECT s.id, s.key, s.is_client, s.permissions
       FROM qodo_projects.user_permission_sets ups
       JOIN qodo_projects.permission_sets s ON s.id = ups.permission_set_id
      WHERE ups.organization_id = $1 AND ups.user_id = $2`,
    [organizationOf(user), user.id]
  );

  if (!assigned) return PERMISSION_SETS.employee;

  return {
    id: assigned.key,
    isClient: assigned.is_client,
    // A stored set carries its own explicit array — an administrator ticked
    // those boxes, and the built-in template stops applying to them from that
    // moment. Same contract as an override in shared/permissions.js.
    permissions: Array.isArray(assigned.permissions) ? assigned.permissions : undefined,
  };
}

/**
 * Load the full authorization context for one user against one project.
 *
 * Returns `null` when the project does not exist, belongs to another
 * organization, is deleted, or the user is not a member of it — four different
 * situations that the caller must treat identically. Collapsing them here,
 * rather than at each call site, is what stops one route from being more
 * talkative than the others.
 */
export async function contextFor(user, projectId) {
  if (!user || !projectId) return null;
  const organizationId = organizationOf(user);

  const found = await row(
    `SELECT p.id, p.organization_id, p.key, p.name, p.owner_id, p.access,
            p.status_id, p.customer_id, p.group_id, p.calendar_id, p.currency,
            p.start_date, p.end_date, p.archived_at, p.color,
            m.role AS member_role, m.is_client AS member_is_client,
            m.allocation_percent
       FROM qodo_projects.projects p
       LEFT JOIN qodo_projects.project_members m
              ON m.project_id = p.id AND m.user_id = $3
      WHERE p.id = $1
        AND p.organization_id = $2
        AND p.deleted_at IS NULL`,
    [projectId, organizationId, user.id]
  );

  if (!found) return null;

  const permissionSet = await permissionSetFor(user);
  let membership = found.member_role
    ? { role: found.member_role, isClient: found.member_is_client, allocation: found.allocation_percent }
    : null;

  if (!membership) {
    // Two ways to reach a project you were never added to, and neither of them
    // is a back door:
    //
    //   • the project is `portal` access, meaning the organization chose to
    //     make it readable to its own staff — but a *client* is not staff, so
    //     they get nothing from it;
    //   • the user administers the whole workspace, and locking an
    //     administrator out of a project they are responsible for would just
    //     mean they add themselves as a member first, with the same result and
    //     a worse audit trail.
    if (found.access === 'portal' && !isClientSet(permissionSet)) {
      membership = { role: 'viewer', isClient: false, allocation: 0, implicit: 'portal' };
    } else if (canWorkspace(user, PERMISSIONS.TASKS_VIEW_ALL) && user.role === 'admin') {
      membership = { role: 'manager', isClient: false, allocation: 0, implicit: 'admin' };
    } else {
      return null;
    }
  }

  return {
    user,
    organizationId,
    project: {
      id: found.id,
      key: found.key,
      name: found.name,
      ownerId: found.owner_id,
      access: found.access,
      statusId: found.status_id,
      customerId: found.customer_id,
      groupId: found.group_id,
      calendarId: found.calendar_id,
      currency: found.currency,
      startDate: found.start_date,
      endDate: found.end_date,
      archivedAt: found.archived_at,
      color: found.color,
    },
    permissionSet,
    membership,
    isClient: Boolean(membership.isClient) || isClientSet(permissionSet),
  };
}

/* ------------------------------------------------------------------ */
/* Questions                                                            */
/* ------------------------------------------------------------------ */

/**
 * The one authorization question. Everything else in Projects is a wrapper.
 *
 * `context` is what `contextFor` returned; `null` — which is what it returns
 * for a project you may not see — is a refusal, so a caller that forgets to
 * check gets a denial rather than a crash or, worse, an allow.
 */
export function may(context, permission) {
  if (!context) return false;
  return canInProject(context, permission);
}

/**
 * Same question, but it throws the shape the routes translate into HTTP.
 *
 * Written as a throw rather than a boolean because the failure has to be
 * unmissable: a route that forgets to check a boolean return still returns
 * data, while a route that forgets to call this one never gets past it.
 *
 * Not named `require` — that word already means something else to every reader
 * of a Node file, and a module-scope binding that shadows it is a trap.
 */
export function requireInProject(context, permission) {
  if (!context) throw notFound();
  if (!canInProject(context, permission)) {
    throw Object.assign(new Error('forbidden'), {
      status: 403,
      body: { error: 'forbidden', missing: permission },
    });
  }
}

export function notFound() {
  return Object.assign(new Error('not_found'), {
    status: 404,
    body: { error: 'not_found' },
  });
}

/**
 * Which projects this person may see, as ids.
 *
 * This is the query that every list endpoint starts from, and the reason
 * `project_members (user_id, organization_id)` is the hottest index in the
 * schema. It returns ids rather than rows on purpose: callers then filter their
 * own table with `= ANY($1)`, which stays an index scan, instead of joining
 * membership into every query and hoping the planner cooperates.
 */
export async function visibleProjectIds(user, options = {}) {
  if (!user) return [];
  const organizationId = organizationOf(user);
  const permissionSet = await permissionSetFor(user);

  // Client-ness has two sources and this has to honour both, exactly as
  // `canInProject` does. The permission set is the portal-level statement "this
  // person is a customer"; a membership row with `role = 'client'` is the
  // per-project one. Reading only the set was a real leak: an administrator who
  // adds a customer to a project but forgets to assign them the client
  // permission set would have had that customer listed every `portal` project
  // in the company.
  //
  // Somebody who is a client *anywhere* is an external person, so any client
  // membership is enough. The asymmetry is deliberate: a staff member wrongly
  // marked as a client loses sight of some open projects, which is visible and
  // reversible, while the other reading shows a customer the company's internal
  // work.
  const clientMembership = await row(
    `SELECT 1 FROM qodo_projects.project_members
      WHERE user_id = $1 AND organization_id = $2 AND is_client = true
      LIMIT 1`,
    [user.id, organizationId]
  );
  const client = isClientSet(permissionSet) || Boolean(clientMembership);

  // A client sees exactly the projects they were added to. No portal access, no
  // administrator fallback, no exceptions — this is the line the whole client
  // portal rests on, and it is one branch so it cannot be half-applied.
  if (client) {
    const memberships = await rows(
      `SELECT p.id
         FROM qodo_projects.project_members m
         JOIN qodo_projects.projects p ON p.id = m.project_id
        WHERE m.user_id = $1
          AND m.organization_id = $2
          ${options.includeDeleted ? '' : 'AND p.deleted_at IS NULL'}
          ${options.includeArchived ? '' : 'AND p.archived_at IS NULL'}`,
      [user.id, organizationId]
    );
    return memberships.map((r) => r.id);
  }

  const found = await rows(
    `SELECT p.id
       FROM qodo_projects.projects p
       LEFT JOIN qodo_projects.project_members m
              ON m.project_id = p.id AND m.user_id = $2
      WHERE p.organization_id = $1
        ${options.includeDeleted ? '' : 'AND p.deleted_at IS NULL'}
        ${options.includeArchived ? '' : 'AND p.archived_at IS NULL'}
        AND (m.user_id IS NOT NULL OR p.access = 'portal' OR $3)`,
    [organizationId, user.id, user.role === 'admin']
  );
  return found.map((r) => r.id);
}

/**
 * Is this record something the current context may be shown?
 *
 * Phases, task lists, folders and comments each carry an internal/external
 * flag. A client must never be shown an internal one, and — this is the part
 * that is easy to get wrong — this check belongs in the SQL of every listing,
 * not only here. This function is the last line, for single-record reads and
 * for anything a future refactor routes around.
 */
export function maySee(context, record) {
  if (!context) return false;
  if (!context.isClient) return true;
  return visibleToClient(record);
}

/**
 * The SQL fragment that keeps internal rows out of a client's listing.
 *
 * Returned as a string to interpolate because it contains no user input — it is
 * either a constant condition or nothing. Any function here that took a value
 * would be a parameter, never a concatenation.
 */
export function clientVisibilitySql(context, column = 'is_external') {
  if (!context?.isClient) return '';
  return ` AND ${column} = true`;
}

/**
 * Strip fields this context may not read.
 *
 * §60 requires field-level permissions and §49 requires rates to be
 * restricted. Doing it here — one projection, applied on the way out — is what
 * keeps a rate from leaking through a report, an export or an AI answer that
 * nobody remembered to gate. The list is the sensitive columns, not every
 * column, because a default-deny projection would silently empty a response the
 * first time somebody added a field.
 */
const RATE_FIELDS = ['bill_rate', 'cost_rate', 'billRate', 'costRate', 'hourlyRate', 'plannedCost', 'actualCost'];

export function projectFields(context, record) {
  if (!record) return record;
  if (may(context, 'rate.view')) return record;

  const projected = { ...record };
  for (const field of RATE_FIELDS) {
    if (field in projected) delete projected[field];
  }
  return projected;
}

export function projectAll(context, records) {
  return records.map((record) => projectFields(context, record));
}

/** Exported so the permission tests can assert the rate list has not shrunk. */
export const RESTRICTED_RATE_FIELDS = RATE_FIELDS;

export { permissionsOfSet };
