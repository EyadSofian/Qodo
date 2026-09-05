/**
 * The two guards every project route uses.
 *
 * Their own module because `projects.js`, `phases.js`, `taskLists.js` and
 * `tasks.js` all need them, and a copy per router is four places for the
 * authorization check to drift.
 */

import * as access from '../../projects/projectAccess.js';
import { handler } from './handler.js';

/**
 * Resolve `:projectId` into a full authorization context.
 *
 * The 404 is the single most important line in the routing layer.
 * `contextFor` returns null for a project that does not exist, one belonging to
 * another organization, one that is deleted, and one this person is not a
 * member of. A 403 for the last case would confirm to a stranger that a project
 * with that id exists, which is itself information about the company. All four
 * are "not found".
 */
export async function withProject(req, res, next) {
  const context = await access.contextFor(req.user, req.params.projectId);
  if (!context) return res.status(404).json({ error: 'not_found' });
  req.projectContext = context;
  next();
}

/** Require one Projects permission inside the already-resolved project. */
export function permit(permission) {
  return (req, res, next) => {
    if (!access.may(req.projectContext, permission)) {
      return res.status(403).json({ error: 'forbidden', missing: permission });
    }
    next();
  };
}

/**
 * Require an organization-level permission, for routes with no project yet.
 *
 * Reads the Projects permission set rather than the workspace role, because
 * "may create projects" is a Projects question and a workspace administrator is
 * not automatically anything here — except by holding every key, which the set
 * resolution already grants them.
 */
export function permitPortal(permission) {
  return handler(async (req, res, next) => {
    const set = await access.permissionSetFor(req.user);
    if (!access.permissionsOfSet(set).includes(permission)) {
      return res.status(403).json({ error: 'forbidden', missing: permission });
    }
    next();
  });
}
