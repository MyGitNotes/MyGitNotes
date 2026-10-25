import { createContext, createElement, type ReactNode, useContext } from 'react';
import { DEMO_COOKIE, type DemoLanguage } from '@mygitnotes/core/demo';
import { parseNotebookKey } from '@mygitnotes/core/notebook-key';
import type { Language } from './i18n/context.js';
import { APP_ROOT_SEGMENTS } from './routes.js';

/** The path prefix the demo lives under; the router's basename while it is shown. */
export const DEMO_BASE = '/demo';
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** What `/demo`, `/demo/<scenario>` and `/demo/<scenario>/…` name; null for any other path. */
export function parseDemoPath(pathname: string): { scenario?: string; } | null {
  if (pathname === DEMO_BASE || pathname === `${DEMO_BASE}/`) return {};
  if (!pathname.startsWith(`${DEMO_BASE}/`)) return null;
  const [slug] = pathname.slice(DEMO_BASE.length + 1).split('/');
  return slug && SLUG.test(slug) ? { scenario: slug } : {};
}

/** The scenario slugs the router resolves before a notebook route: names the app's own first path segments use are not scenarios. */
export const RESERVED_SCENARIOS = [...APP_ROOT_SEGMENTS, 'index'];

/** The demo language a UI language asks for. */
export const demoLanguageOf = (language: Language): DemoLanguage => language === 'zh-TW' ? 'zh-tw' : 'en';

/** Writes the cookie the server reads to pick the demo's notebooks; it holds only the language and lives a day. */
export function writeDemoCookie(language: DemoLanguage, secure = location.protocol === 'https:') {
  document.cookie = `${DEMO_COOKIE}=${language}; Path=/; Max-Age=86400; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/** The notebook of `scenario` among `notebookKeys`: the one whose local id is the scenario or starts with `<scenario>-`. */
export function scenarioNotebook(notebookKeys: readonly string[], scenario: string): string | undefined {
  const lower = scenario.toLowerCase();
  const localId = (key: string) => parseNotebookKey(key)?.localId.toLowerCase() ?? key.toLowerCase();
  return notebookKeys.find(key => localId(key) === lower) ?? notebookKeys.find(key => localId(key).startsWith(`${lower}-`));
}

/** The scenario a notebook belongs to: its local id without a language suffix. */
export function notebookScenario(notebookKey: string): string {
  const id = parseNotebookKey(notebookKey)?.localId ?? notebookKey;
  return id.replace(/-(en|zh-tw)$/i, '').toLowerCase();
}

/**
 * The scenario the page shows: the one of the notebook in the address (`/notebooks/<key>`), else `fallback`. An address
 * whose notebook cannot be decoded (a stray `%`) names none.
 */
export function addressScenario(pathname: string, fallback?: string): string | undefined {
  const key = /\/notebooks\/([^/]+)/.exec(pathname)?.[1];
  if (!key) return fallback;
  try {
    return notebookScenario(decodeURIComponent(key));
  } catch {
    return fallback;
  }
}

/** The demo the page shows, or null outside it. */
export interface DemoContextValue {
  /** The slug in the address when the page was opened. */
  scenario?: string;
}
const DemoContext = createContext<DemoContextValue | null>(null);
export const DemoProvider = ({ value, children }: { value: DemoContextValue | null; children?: ReactNode; }) => createElement(DemoContext.Provider, { value }, children);
/** The demo context, or null when the app is not showing the demo. */
export const useDemo = () => useContext(DemoContext);
