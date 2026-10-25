import type { RepositoryStatus } from '@mygitnotes/core/repository';
import { draftScope, storageId } from './workspace-repositories.js';

/** How long a visitor's demo data stays in this browser after their first change. */
export const DEMO_TTL_MS = 24 * 60 * 60 * 1000;

const RECORD_PREFIX = 'gh_notes_demo:';
/** The record of a scope whose only browser data is Focus view state (nothing the visitor changed), so no clock runs; see `noteDemoViewWrite`. */
const VIEW_RECORD_PREFIX = 'gh_notes_demo_view:';
const WORKING_PREFIX = 'gh_notes_working:';
const EDITOR_DRAFT_PREFIX = 'gh_notes_draft:';
const CONFLICT_DISMISS_PREFIX = 'gh_notes_conflict_dismissed:';
const COMMITS_PREFIX = 'gh_notes_local_commits:';
const DOCUMENT_PREFIX = 'github-notes:';
const FOCUS_VIEW_PREFIX = 'github-notes:focus-view:';
const STASH_PREFIX = 'github-notes:history-stash:';

/** The clock record of one demo scope: when its first change was kept and the repository head it was made on. */
export interface DemoRecord {
  firstWrite: number;
  base: string;
  /** The repository's storage id (`storageId`), so the sweep finds the keys that carry it and no other repository's. */
  repository: string;
  /** The alias that names the repository's notebooks by key; absent in a record made before the sweep needed it. */
  alias?: string;
}

/** A demo repository of the loaded workspace, as the storage layer needs to know it. */
export interface DemoScope {
  scope: string;
  /** The repository id the server knows. */
  repository: string;
  /** The name its browser data is kept under: `storageId` of the repository. */
  owner: string;
  alias: string;
  revision: string;
  notebooks: string[];
}

const scopes = new Map<string, DemoScope>();
let updatedNotice = false;
const listeners = new Set<() => void>();
let version = 0;
const notify = () => {
  version++;
  listeners.forEach(listener => listener());
};
/** Changes whenever the demo state does; the snapshot an external-store hook reads. */
export const demoVersion = () => version;

let scenarioNotice: { slug: string; title: string; } | null = null;
/** The demo has no scenario of the address's name: the page opened the default notebook instead. */
export const demoScenarioNotice = () => scenarioNotice;
export function setDemoScenarioNotice(notice: { slug: string; title: string; } | null) {
  scenarioNotice = notice;
  notify();
}

/** Subscribes to changes of the demo state (the update notice); returns the unsubscribe. */
export function subscribeDemo(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
/** Whether the demo content changed since the visitor's data was made, so their data was cleared. */
export const demoWasUpdated = () => updatedNotice;
export const dismissDemoUpdated = () => {
  updatedNotice = false;
  notify();
};

const storageKeys = (): string[] => {
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key) keys.push(key);
  }
  return keys;
};

/** Reads one scope's clock record; undefined when there is none or it cannot be read. */
export const readDemoRecord = (scope: string): DemoRecord | undefined => readRecord(RECORD_PREFIX + scope);
const readViewRecord = (scope: string): DemoRecord | undefined => readRecord(VIEW_RECORD_PREFIX + scope);
function readRecord(key: string): DemoRecord | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<DemoRecord> | null;
    return value && typeof value.firstWrite === 'number' && typeof value.base === 'string' && typeof value.repository === 'string' ? value as DemoRecord : undefined;
  } catch {
    return undefined;
  }
}

/** Removes every key a demo scope's changes were kept under, and its record. Other scopes and ordinary keys stay. */
export function clearDemoScope(record: DemoRecord, scope: string): void {
  const { repository, alias } = record;
  const owned = (key: string): boolean => {
    if (key === RECORD_PREFIX + scope || key === VIEW_RECORD_PREFIX + scope || key === WORKING_PREFIX + scope || key === COMMITS_PREFIX + scope) return true;
    if (key.startsWith(`${EDITOR_DRAFT_PREFIX}${scope}:`) || key.startsWith(`${CONFLICT_DISMISS_PREFIX}${scope}:`)) return true;
    if (key.startsWith(FOCUS_VIEW_PREFIX)) {
      if (key.startsWith(`${FOCUS_VIEW_PREFIX}${repository}:`)) return true;
      // A view kept before the repository was known has no owner (`focus-view::<notebook key>`): it is the demo's when the notebook is, and without an alias to tell by, any such view is.
      return key.startsWith(`${FOCUS_VIEW_PREFIX}:`) && (alias === undefined || key.startsWith(`${FOCUS_VIEW_PREFIX}:${alias}~`));
    }
    if (key.startsWith(STASH_PREFIX)) {
      try {
        const [, owner] = JSON.parse(key.slice(STASH_PREFIX.length)) as [string, string, string];
        return owner === repository;
      } catch {
        return false;
      }
    }
    // A workspace document's device draft: `github-notes:<document>:<repository id>`.
    return key.startsWith(DOCUMENT_PREFIX) && key.endsWith(`:${repository}`);
  };
  for (const key of storageKeys()) if (owned(key)) localStorage.removeItem(key);
}

/**
 * Removes the data of every demo scope whose first change, or whose first Focus view state when it has nothing else, is
 * older than 24 hours; runs at every app boot before
 * anything renders, and before each demo write. Answers the scopes it cleared.
 */
export function expireDemoData(now = Date.now()): string[] {
  const cleared: string[] = [];
  for (const key of storageKeys()) {
    if (!key.startsWith(RECORD_PREFIX)) continue;
    const scope = key.slice(RECORD_PREFIX.length), record = readDemoRecord(scope);
    if (!record) {
      // A record that cannot be read is not a clock: drop it so the scope starts one when it is written next.
      localStorage.removeItem(key);
      continue;
    }
    if (now - record.firstWrite >= DEMO_TTL_MS) {
      clearDemoScope(record, scope);
      cleared.push(scope);
    }
  }
  for (const key of storageKeys()) {
    if (!key.startsWith(VIEW_RECORD_PREFIX)) continue;
    const scope = key.slice(VIEW_RECORD_PREFIX.length), record = readViewRecord(scope);
    // Once a change started the scope's clock the clock rules its view state; a record that cannot be read is not a clock.
    if (!record || readDemoRecord(scope)) localStorage.removeItem(key);
    else if (now - record.firstWrite >= DEMO_TTL_MS) {
      clearDemoScope(record, scope);
      cleared.push(scope);
    }
  }
  return cleared;
}

/** The milliseconds left before a scope's data is cleared; undefined before its first change. */
export function demoRemainingMs(scope: string, now = Date.now()): number | undefined {
  const record = readDemoRecord(scope);
  return record ? Math.max(0, record.firstWrite + DEMO_TTL_MS - now) : undefined;
}

/**
 * Registers the demo repositories of a loaded workspace. A scope whose data was made on another head of the repository
 * (the demo content changed in a deploy) is cleared, and the banner says so.
 */
export function registerDemoRepositories(repositories: readonly Pick<RepositoryStatus, 'id' | 'branch' | 'alias' | 'demo' | 'revision' | 'notebooks'>[]): void {
  scopes.clear();
  for (const repository of repositories) {
    if (!repository.demo) continue;
    const scope = draftScope(repository);
    scopes.set(scope, { scope, repository: repository.id, owner: storageId(repository), alias: repository.alias, revision: repository.revision, notebooks: repository.notebooks });
    const record = readDemoRecord(scope) ?? readViewRecord(scope);
    if (record && record.base !== repository.revision) {
      clearDemoScope(record, scope);
      updatedNotice = true;
      notify();
    }
  }
}

/** The registered demo scope of a draft scope, repository id or notebook key; undefined for anything else. */
export const demoScope = (scope: string): DemoScope | undefined => scopes.get(scope);
export const demoScopeOfRepository = (repository: string): DemoScope | undefined => [...scopes.values()].find(candidate => candidate.repository === repository);
/** The name a repository's browser data is kept under: namespaced when it is a registered demo repository. For keys built from the repository id alone. */
export const storageOwner = (repository: string): string => demoScopeOfRepository(repository)?.owner ?? repository;
export const demoScopeOfNotebook = (notebookId: string): DemoScope | undefined => [...scopes.values()].find(candidate => candidate.notebooks.includes(notebookId));
/** Whether any demo repository is registered. */
export const hasDemoScopes = () => scopes.size > 0;

/** What the page does when a write finds its scope expired; replaceable for tests. */
export const demoHooks = { reload: () => location.reload() };

/**
 * Whether a demo scope's data has passed its 24 hours. If so it is cleared and the page reloads, since what the page
 * shows is gone; the writer that asked must write nothing, or the cleared data would come back without a clock.
 * Every writer asks before it reads what it is about to write over.
 */
export function demoExpired(scope: string, now = Date.now()): boolean {
  if (!scopes.has(scope) || !expireDemoData(now).includes(scope)) return false;
  demoHooks.reload();
  return true;
}

/**
 * Notes that a demo scope is about to keep a change: starts its 24-hour clock at the first one. Answers whether the writer
 * may write; it may not once the scope is found expired (`demoExpired`). A scope that is not a registered demo scope is
 * left alone and may be written.
 */
export function noteDemoWrite(scope: string, now = Date.now()): boolean {
  const demo = scopes.get(scope);
  if (!demo) return true;
  if (demoExpired(scope, now)) return false;
  if (readDemoRecord(scope)) return true;
  const record: DemoRecord = { firstWrite: now, base: demo.revision, repository: demo.owner, alias: demo.alias };
  localStorage.setItem(RECORD_PREFIX + scope, JSON.stringify(record));
  localStorage.removeItem(VIEW_RECORD_PREFIX + scope);
  notify();
  return true;
}
/**
 * Notes that a demo scope is about to keep view state the visitor did not choose (the Focus last shown, a pane made
 * active, a size): it is kept, but it is not a change, so it does not start the 24-hour clock the banner counts. A scope
 * with no clock gets a view record instead, and its view state is cleared 24 hours after that, so nothing stays for good.
 * Answers whether the writer may write, as `noteDemoWrite` does.
 */
export function noteDemoViewWrite(scope: string, now = Date.now()): boolean {
  const demo = scopes.get(scope);
  if (!demo) return true;
  if (demoExpired(scope, now)) return false;
  if (readDemoRecord(scope) || readViewRecord(scope)) return true;
  const record: DemoRecord = { firstWrite: now, base: demo.revision, repository: demo.owner, alias: demo.alias };
  localStorage.setItem(VIEW_RECORD_PREFIX + scope, JSON.stringify(record));
  return true;
}
/** `noteDemoViewWrite` for a writer that knows only the repository id. */
export function noteDemoViewWriteIn(repository: string, now = Date.now()): boolean {
  const demo = demoScopeOfRepository(repository);
  return demo ? noteDemoViewWrite(demo.scope, now) : true;
}
/** `noteDemoWrite` for a writer that knows only the repository id. */
export function noteDemoWriteIn(repository: string, now = Date.now()): boolean {
  const demo = demoScopeOfRepository(repository);
  return demo ? noteDemoWrite(demo.scope, now) : true;
}

/** "Reset demo": clears every registered demo scope at once. */
export function resetDemo(): void {
  for (const demo of scopes.values()) {
    const record = readDemoRecord(demo.scope) ?? { firstWrite: 0, base: demo.revision, repository: demo.owner };
    clearDemoScope(record, demo.scope);
  }
}

/** The registered scopes (for the banner's countdown). */
export const demoScopes = (): DemoScope[] => [...scopes.values()];
