import { useEffect } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { RESERVED_SCENARIOS, scenarioNotebook, useDemo } from '../lib/demo.js';
import { setDemoScenarioNotice } from '../lib/demo-storage.js';
import { notebookRoute } from '../lib/routes.js';
import type { WorkspaceConfig } from '../lib/types.js';

/**
 * In the demo, `/demo/<scenario>` names a notebook of the demo repository rather than a page of the app: once the
 * workspace is loaded the address is replaced by that notebook's route. An unknown scenario opens the default notebook
 * and the banner says so. Does nothing outside the demo or for the app's own paths.
 */
export function useDemoScenario({ config, loading, pathname, navigate }: { config: WorkspaceConfig | null; loading: boolean; pathname: string; navigate: NavigateFunction; }) {
  const demo = useDemo();
  useEffect(() => {
    if (!demo || loading || !config) return;
    const slug = /^\/([^/]+)\/?$/.exec(pathname)?.[1];
    if (!slug || RESERVED_SCENARIOS.includes(slug)) return;
    const key = scenarioNotebook(config.notebooks.map(notebook => notebook.id), slug);
    if (key) {
      navigate(notebookRoute(key), { replace: true });
      return;
    }
    const fallback = config.notebooks.find(notebook => notebook.id === config.workspace.default_notebook) ?? config.notebooks[0];
    setDemoScenarioNotice({ slug, title: fallback?.title ?? '' });
    navigate(fallback ? notebookRoute(fallback.id) : '/', { replace: true });
  }, [demo, loading, config, pathname, navigate]);
}
