/**
 * One project, loaded once for every tab inside it.
 *
 * The detail shell fetches it and passes it down through an outlet context, so
 * switching from Tasks to Phases does not re-ask the server who you are and
 * what you may do — the answer cannot change between two clicks, and asking
 * again would make every tab switch flash a spinner.
 */

import { useOutletContext } from 'react-router-dom';
import type { ProjectDetail } from './types';

export interface ProjectOutletContext {
  detail: ProjectDetail;
  /** Re-fetch the project — after an edit, or after membership changes. */
  reload: () => Promise<void>;
  /**
   * What this person may do here. Presentation only: every endpoint re-checks,
   * and a `true` from this is a reason to draw a button, never a reason to
   * believe the request will succeed.
   */
  can: (permission: string) => boolean;
}

export function useProject(): ProjectOutletContext {
  return useOutletContext<ProjectOutletContext>();
}
