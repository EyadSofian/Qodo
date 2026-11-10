import { hrWorkspaceOnly } from '../shared/permissions.js';

/** A module allowlist, checked before any router (including routes open to all
 * ordinary employees). Shared identity and notification services remain usable.
 */
export function hrWorkspaceAccess(req, res, next) {
  if (!hrWorkspaceOnly(req.user)) return next();
  const pathname = req.path;
  const allowed = ['/hr', '/kpi', '/offices', '/hr-forms', '/notifications', '/push']
    .some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
    || ['/auth/me', '/auth/logout', '/auth/password', '/auth/change-password', '/auth/directory', '/auth/google/config', '/apps', '/health'].includes(pathname);
  return allowed ? next() : res.status(403).json({ error: 'app_not_allowed' });
}
