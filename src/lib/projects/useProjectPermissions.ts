/**
 * What the current person may do in Qodo Projects, for the browser.
 *
 * Loaded once and shared, because a workspace role does not imply a Projects
 * one: `admin` in `shared/permissions.js` and a Projects permission set are two
 * different grants, and guessing one from the other is how a button appears for
 * somebody the server is about to refuse.
 *
 * This is presentation only. Every endpoint re-checks — see `permitPortal` and
 * `permit` in `server/routes/projects/projects.js`.
 */

import { useEffect, useState } from 'react';
import { api } from '../api';

interface ProjectsMe {
  permissions: string[];
  isClient: boolean;
  permissionSet: string;
}

/**
 * One in-flight request for the whole app.
 *
 * Every Projects screen asks this question on mount, and without the shared
 * promise the first navigation fires it once per mounted component. The cache
 * is deliberately not invalidated on its own: a permission change signs the
 * shape of the UI, and it arrives on the next full load, like the session does.
 */
let cached: Promise<ProjectsMe> | null = null;

function fetchMe(): Promise<ProjectsMe> {
  if (!cached) {
    cached = api.get<ProjectsMe>('/projects/me').catch((error) => {
      // A failure must not be cached as "you may do nothing" forever — the most
      // common cause is the database not being configured yet, which is fixed
      // by restarting the server, not by reloading the page.
      cached = null;
      throw error;
    });
  }
  return cached;
}

export function useProjectPermissions() {
  const [state, setState] = useState<ProjectsMe | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchMe()
      .then((me) => {
        if (alive) setState(me);
      })
      .catch(() => {
        // Projects unavailable, or the session went away. Either way the right
        // rendering is "nothing is permitted", and the page's own error state
        // is what explains why.
        if (alive) setState({ permissions: [], isClient: false, permissionSet: 'none' });
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return {
    loading,
    isClient: state?.isClient ?? false,
    permissionSet: state?.permissionSet ?? null,
    can: (permission: string) => state?.permissions.includes(permission) ?? false,
  };
}
