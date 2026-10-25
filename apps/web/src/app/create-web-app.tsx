import React from 'react';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v6';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { handleNoteQueryError } from '../lib/use-note-queries.js';
import { I18nProvider } from '../lib/i18n/index.js';
import { KeyboardRoot } from '../lib/keyboard/KeyboardDispatcher.js';
import { WorkspaceGate } from '../components/WorkspaceSetup.js';
import { ConnectionState } from '../components/AuthControls.js';
import { PanelProvider } from '../lib/panel-context.js';
import { UpdateNotice } from '../components/UpdateNotice.js';
import { registerServiceWorker } from '../pwa/register.js';
import '../index.css';
import '../workspace.css';
import '../ui-buttons.css';
import '../mermaid.css';
import 'katex/dist/katex.min.css';
import '../math.css';
import '../directives/general-containers.css';
import '../directives/character-stat-blocks.css';
import '../directives/document-cards.css';
import '../directives/parallel-quotes.css';
import '../directives/embedded-cards.css';
import '../directives/infographics.css';
import '../directives/argument-maps.css';
import '../directives/presentation.css';
import '../directives/inline.css';
import '../directives/mdx-components.css';
import '../directives/live-editor-toolbar.css';
import '../directives/infographic-editor.css';
import '../directives/mobile-adaptations.css';

import { type WebFeature, WebFeaturesProvider } from '../lib/web-features.js';
import { DEMO_BASE, DemoProvider, parseDemoPath } from '../lib/demo.js';
import { expireDemoData } from '../lib/demo-storage.js';

// The workspace (editor, math, study, drag and drop) is its own chunk, fetched as soon as the entry runs: the sign-in
// gate paints without waiting for it, and a signed-in visitor downloads it while the session probe is in flight.
const workspaceChunk = import('../App.js');
workspaceChunk.catch(() => {/* The lazy boundary below reports a failed load when it renders. */});
const AppContent = React.lazy(() => workspaceChunk.then(module => ({ default: module.AppContent })));

/** The sign-in gate, then the workspace once its chunk arrives; `WebApp` provides the language. */
function App() {
  return (
    <WorkspaceGate>
      <React.Suspense fallback={<ConnectionState loading error='' onRetry={() => {}} />}>
        <KeyboardRoot>
          <AppContent />
        </KeyboardRoot>
      </React.Suspense>
    </WorkspaceGate>
  );
}

// A visitor's demo data older than 24 hours is removed at every boot, on any route, before anything renders.
try {
  expireDemoData();
} catch { /* Storage may be unavailable; nothing was kept then. */ }

export interface WebAppOptions {
  /** What another edition adds; the community edition passes none. */
  features?: readonly WebFeature[];
}

/** The whole web app: data, routing and panels, with any edition features registered. */
export function WebApp({ features = [] }: WebAppOptions) {
  // Note answers are addressed by workspace revision, so they never go stale on their own; a
  // failed query surfaces its error instead of retrying behind the user's back.
  // The demo lives under /demo: the router's basename keeps in-app navigation, reloads and shared links there.
  const [demo] = React.useState(() => parseDemoPath(location.pathname));
  const [queryClient] = React.useState(() => new QueryClient({ queryCache: new QueryCache({ onError: (error, query) => handleNoteQueryError(error, query) }), defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchOnWindowFocus: false } } }));
  return (
    <QueryClientProvider client={queryClient}>
      <WebFeaturesProvider features={features}>
        <I18nProvider>
          <UpdateNotice />
          <NuqsAdapter>
            <BrowserRouter {...demo ? { basename: DEMO_BASE } : {}}>
              <PanelProvider>
                <DemoProvider value={demo}>
                  <Routes>
                    <Route path='/' element={<App />} />
                    <Route path='/notes' element={<App />} />
                    <Route path='/index.html' element={<App />} />
                    <Route path='/notebooks' element={<App />} />
                    <Route path='/notebooks/:notebook' element={<App />} />
                    <Route path='/notebooks/:notebook/folders/*' element={<App />} />
                    <Route path='/notebooks/:notebook/notes/*' element={<App />} />
                    <Route path='/assets' element={<App />} />
                    <Route path='/agent' element={<App />} />
                    <Route path='/settings' element={<App />} />
                    {demo && <Route path='/:scenario' element={<App />} />}
                    {features.flatMap(feature => feature.routes ?? []).map(route => <Route key={route.path} path={route.path} element={route.element} />)}
                    <Route path='*' element={<App />} />
                  </Routes>
                </DemoProvider>
              </PanelProvider>
            </BrowserRouter>
          </NuqsAdapter>
        </I18nProvider>
      </WebFeaturesProvider>
    </QueryClientProvider>
  );
}

/** Renders the web app into `root`; an edition's entry calls it with its features. */
export function createWebApp(root: HTMLElement, options: WebAppOptions = {}) {
  registerServiceWorker();
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <WebApp {...options} />
    </React.StrictMode>,
  );
}
