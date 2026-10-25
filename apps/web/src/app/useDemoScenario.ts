import { useEffect, useRef } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { RESERVED_SCENARIOS, scenarioNotebook, useDemo } from '../lib/demo.js';
import { setDemoScenarioNotice } from '../lib/demo-storage.js';
import { notebookRoute, noteRoute } from '../lib/routes.js';
import type { WorkspaceConfig } from '../lib/types.js';

/**
 * In the demo, `/demo/<scenario>` names a notebook of the demo repository rather than a page of the app: once the
 * workspace is loaded the address is replaced by that notebook's `index.md` when it has one (the guide with its "What
 * to try" list), else by the notebook's route. A visitor whose Focus view for the notebook is restored (`hasRestoredView`)
 * gets the notebook's route, which shows that view. An unknown scenario opens the default notebook and the banner says
 * so. Does nothing outside the demo or for the app's own paths; an address that already names a note never matches.
 */
export function useDemoScenario({ config, loading, pathname, navigate, hasGuide, hasRestoredView }: {
  config: WorkspaceConfig | null;
  loading: boolean;
  pathname: string;
  navigate: NavigateFunction;
  /** Whether the notebook holds a note at the repository path. */
  hasGuide: (notebookId: string, path: string) => Promise<boolean>;
  hasRestoredView: (notebookKey: string) => boolean;
}) {
  const demo = useDemo();
  const guide = useRef({ hasGuide, hasRestoredView });
  useEffect(() => {
    guide.current = { hasGuide, hasRestoredView };
  });
  useEffect(() => {
    if (!demo || loading || !config) return;
    const slug = /^\/([^/]+)\/?$/.exec(pathname)?.[1];
    if (!slug || RESERVED_SCENARIOS.includes(slug)) return;
    const key = scenarioNotebook(config.notebooks.map(notebook => notebook.id), slug);
    if (!key) {
      const fallback = config.notebooks.find(notebook => notebook.id === config.workspace.default_notebook) ?? config.notebooks[0];
      setDemoScenarioNotice({ slug, title: fallback?.title ?? '' });
      navigate(fallback ? notebookRoute(fallback.id) : '/', { replace: true });
      return;
    }
    if (guide.current.hasRestoredView(key)) {
      navigate(notebookRoute(key), { replace: true });
      return;
    }
    let current = true;
    const root = config.notebooks.find(notebook => notebook.id === key)?.root.replace(/\/$/, '') ?? '';
    guide.current.hasGuide(key, root ? `${root}/index.md` : 'index.md').catch(() => false).then(found => {
      if (current) navigate(found ? noteRoute(key, 'index.md') : notebookRoute(key), { replace: true });
    });
    return () => {
      current = false;
    };
  }, [demo, loading, config, pathname, navigate]);
}
