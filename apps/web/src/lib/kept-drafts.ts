import { DEMO_STORAGE_PREFIX } from './workspace-repositories.js';

/** A note edit this browser keeps in localStorage, found without knowing which repository it belongs to. */
export interface KeptDraft {
  /** The repository and branch the draft belongs to (`draftScope`). */
  scope: string;
  /** Scope and path, which tell two notes at one path apart. */
  key: string;
  path: string;
  title: string;
}

const WORKING_PREFIX = 'gh_notes_working:';
const EDITOR_PREFIX = 'gh_notes_draft:';

const baseName = (path: string) => path.split('/').pop() || path;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : '';

function read(storage: Storage, key: string): unknown {
  try {
    return JSON.parse(storage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

/**
 * The unsaved note edits of this browser: working changes waiting in Changes, and editor drafts not yet saved. Reads storage alone,
 * so the offline screen can list them before (or without) the workspace loading. Deletions and conflict copies are not listed.
 */
export function listKeptDrafts(storage: Storage): KeptDraft[] {
  const drafts = new Map<string, KeptDraft>();
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key) continue;
    if (key.startsWith(WORKING_PREFIX)) {
      const scope = key.slice(WORKING_PREFIX.length);
      const stored = read(storage, key);
      if (!isRecord(stored)) continue;
      for (const [path, entry] of Object.entries(stored)) {
        if (!isRecord(entry) || entry.deleted === true) continue;
        const note = isRecord(entry.note) ? entry.note : {};
        drafts.set(`${scope}\0${path}`, { scope, key: `${scope}\0${path}`, path, title: text(note.title) || baseName(path) });
      }
    } else if (key.startsWith(EDITOR_PREFIX)) {
      const draft = read(storage, key);
      if (!isRecord(draft) || typeof draft.path !== 'string') continue;
      const scope = key.slice(EDITOR_PREFIX.length, key.length - draft.path.length - 1);
      if (!key.endsWith(`:${draft.path}`) || scope.endsWith(':conflict')) continue;
      const id = `${scope}\0${draft.path}`;
      const metadata = isRecord(draft.metadata) ? draft.metadata : {};
      if (!drafts.has(id)) drafts.set(id, { scope, key: id, path: draft.path, title: text(metadata.title) || baseName(draft.path) });
    }
  }
  return [...drafts.values()].sort((a, b) => a.title.localeCompare(b.title));
}

/** Where the scopes the signed-in session last opened are recorded, so the offline screen shows only that session's drafts. */
export const OPENED_SCOPES_KEY = 'gh_notes_opened_scopes';

/** Records the draft scopes of the repositories the session opened, replacing the earlier record. */
export function recordOpenedScopes(storage: Pick<Storage, 'setItem' | 'getItem'>, scopes: readonly string[]): void {
  const value = JSON.stringify([...new Set(scopes)].sort((a, b) => a.localeCompare(b)));
  try {
    if (storage.getItem(OPENED_SCOPES_KEY) !== value) storage.setItem(OPENED_SCOPES_KEY, value);
  } catch { /* Without the record the offline screen shows a count only. */ }
}

/** Forgets the record, as sign-out does: the next person on this browser sees no title of the drafts left behind. */
export function clearOpenedScopes(storage: Pick<Storage, 'removeItem'> = localStorage): void {
  try {
    storage.removeItem(OPENED_SCOPES_KEY);
  } catch { /* Storage that is unavailable holds no record to clear. */ }
}

function openedScopes(storage: Storage): string[] | null {
  const stored = read(storage, OPENED_SCOPES_KEY);
  return Array.isArray(stored) && stored.every(scope => typeof scope === 'string') && stored.length > 0 ? stored : null;
}

/** What the offline screen may show: the drafts of the repositories this session opened, and how many drafts the browser keeps in all. */
export interface OfflineDrafts {
  listed: KeptDraft[];
  total: number;
}

/**
 * The drafts of the scopes the session last opened, listed by title. Drafts of any other account or repository in this browser,
 * or all of them when no session is recorded (signed out), are only counted: their titles are not shown to whoever holds the screen.
 *
 * The demo's drafts live in scopes of their own (`demo:`), and the demo and the person's notes share this browser: a screen
 * of the person's notes counts none of the demo's, and the demo's counts only its own and lists none of the person's titles.
 */
export function offlineDrafts(storage: Storage, { demo = false }: { demo?: boolean; } = {}): OfflineDrafts {
  const all = listKeptDrafts(storage).filter(draft => draft.scope.startsWith(DEMO_STORAGE_PREFIX) === demo);
  const scopes = demo ? null : openedScopes(storage);
  return { listed: scopes ? all.filter(draft => scopes.includes(draft.scope)) : [], total: all.length };
}
