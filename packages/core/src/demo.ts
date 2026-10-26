import type { WorkspaceConfig } from './types.js';

/** The path prefix the demo lives under; the web app's router uses it as its basename while the demo is shown. */
export const DEMO_BASE = '/demo';
/** The cookie the web app writes on a `/demo` page; it carries only the language of the public demo content. */
export const DEMO_COOKIE = 'mygitnotes_demo';
/** The languages a demo repository keeps its scenarios in, as the cookie spells them. */
export const DEMO_LANGUAGES = ['en', 'zh-tw'] as const;
export type DemoLanguage = (typeof DEMO_LANGUAGES)[number];

/** The language the request's demo cookie asks for; undefined without a cookie or when its value is not a known language. */
export function demoLanguage(request: { headers: Record<string, string | string[] | undefined>; }): DemoLanguage | undefined {
  const header = request.headers.cookie;
  const text = Array.isArray(header) ? header.join(';') : header ?? '';
  for (const part of text.split(';')) {
    const at = part.indexOf('=');
    if (at < 0 || part.slice(0, at).trim() !== DEMO_COOKIE) continue;
    const value = part.slice(at + 1).trim().toLowerCase();
    return (DEMO_LANGUAGES as readonly string[]).includes(value) ? value as DemoLanguage : undefined;
  }
  return undefined;
}

/**
 * Whether the request was made by a page of the demo: its `Referer` is an http(s) address whose path is `/demo` or under
 * `/demo/`. A browser sends the `Referer` on every request a page makes (fetch, images, event streams, downloads), so this
 * names the page a request comes from and not the browser. Only the path counts, never the origin: a request that wrongly
 * matches loses its credentials (see `demoPageCredentials`), so a forged or foreign `Referer` can only reduce authority.
 */
export function demoPageRequest(request: { headers: Record<string, string | string[] | undefined>; }): boolean {
  const referer = request.headers.referer;
  if (typeof referer !== 'string') return false;
  let page: URL;
  try {
    page = new URL(referer);
  } catch {
    return false;
  }
  return (page.protocol === 'https:' || page.protocol === 'http:') && (page.pathname === DEMO_BASE || page.pathname.startsWith(`${DEMO_BASE}/`));
}

/** A notebook id split into its scenario and language: `trpg-zh-tw` is scenario `trpg`; an id without a language suffix has none. */
export function demoScenarioOf(localId: string): { scenario: string; language?: DemoLanguage; } {
  const lower = localId.toLowerCase();
  for (const language of DEMO_LANGUAGES) {
    const suffix = `-${language}`;
    if (lower.endsWith(suffix) && localId.length > suffix.length) return { scenario: localId.slice(0, -suffix.length), language };
  }
  return { scenario: localId };
}

/**
 * The manifest a demo visitor sees: for each scenario the notebook in the asked language, else its `-en` twin, else the
 * first one; notebooks without a language suffix stay. The default notebook moves to the kept twin of its scenario.
 */
export function demoNotebooks(config: WorkspaceConfig, language: DemoLanguage): WorkspaceConfig {
  const groups = new Map<string, WorkspaceConfig['notebooks']>();
  for (const notebook of config.notebooks) {
    const { scenario, language: own } = demoScenarioOf(notebook.id);
    const key = own ? scenario : notebook.id;
    groups.set(key, [...groups.get(key) ?? [], notebook]);
  }
  const kept = new Map<string, WorkspaceConfig['notebooks'][number]>();
  for (const [key, notebooks] of groups) {
    const pick = notebooks.find(notebook => demoScenarioOf(notebook.id).language === language) ?? notebooks.find(notebook => demoScenarioOf(notebook.id).language === 'en') ?? notebooks[0]!;
    kept.set(key, pick);
  }
  const keptIds = new Set([...kept.values()].map(notebook => notebook.id));
  const notebooks = config.notebooks.filter(notebook => keptIds.has(notebook.id));
  const original = config.workspace.default_notebook;
  const defaultTwin = kept.get(demoScenarioOf(original).language ? demoScenarioOf(original).scenario : original);
  const fallback = notebooks.some(notebook => notebook.id === original) ? original : defaultTwin?.id ?? notebooks[0]?.id ?? original;
  return { ...config, workspace: { ...config.workspace, default_notebook: fallback }, notebooks };
}
