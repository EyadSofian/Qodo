import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { WorkspaceApp } from './types';

/**
 * One place that decides what "open this app" means, so the launcher grid, the
 * top-bar switcher and a search result all behave identically.
 *
 *   internal → a route in this app
 *   newtab   → a new browser tab
 *   auto /
 *   iframe   → the framed view at /app/:id, which probes the target first and
 *              offers a new tab if it refuses to be embedded
 */
export function useOpenApp() {
  const navigate = useNavigate();

  return useCallback(
    (app: WorkspaceApp) => {
      if (app.kind === 'internal') {
        navigate(app.url);
        return;
      }
      if (app.embed === 'newtab') {
        // noopener: the opened dashboard must not get a handle on window.opener.
        window.open(app.url, '_blank', 'noopener,noreferrer');
        return;
      }
      navigate(`/app/${app.id}`);
    },
    [navigate]
  );
}
