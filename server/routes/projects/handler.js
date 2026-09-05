/**
 * Async route plumbing for Qodo Projects.
 *
 * Its own module rather than a helper inside the router root, because the
 * router root imports the routers and the routers need this: a cycle that ESM
 * happens to survive today only because function declarations hoist. That is
 * not a property worth depending on.
 */

import { unavailable } from '../../projects/db.js';

/**
 * Turn a thrown error into the right response.
 *
 * Services throw `{ status, body }` for everything they meant to refuse.
 * Anything else is a bug, and becomes a bare 500: an unplanned error message is
 * exactly the sort of thing that hands a table name or a fragment of a query to
 * somebody probing the API.
 */
export function handler(fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (error) {
      if (error?.status && error?.body) return res.status(error.status).json(error.body);
      if (error?.code === 'projects_storage_unavailable') {
        return res.status(503).json(unavailable());
      }
      console.error('[projects]', req.method, req.originalUrl, error);
      res.status(500).json({ error: 'server_error' });
    }
  };
}
