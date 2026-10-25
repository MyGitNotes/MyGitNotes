/** A note edit this browser keeps in localStorage, found without knowing which repository it belongs to. */
export interface KeptDraft {
  /** Scope (repository id and branch) and path, which tell two notes at one path apart. */
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
        drafts.set(`${scope}\0${path}`, { key: `${scope}\0${path}`, path, title: text(note.title) || baseName(path) });
      }
    } else if (key.startsWith(EDITOR_PREFIX)) {
      const draft = read(storage, key);
      if (!isRecord(draft) || typeof draft.path !== 'string') continue;
      const scope = key.slice(EDITOR_PREFIX.length, key.length - draft.path.length - 1);
      if (!key.endsWith(`:${draft.path}`) || scope.endsWith(':conflict')) continue;
      const id = `${scope}\0${draft.path}`;
      const metadata = isRecord(draft.metadata) ? draft.metadata : {};
      if (!drafts.has(id)) drafts.set(id, { key: id, path: draft.path, title: text(metadata.title) || baseName(draft.path) });
    }
  }
  return [...drafts.values()].sort((a, b) => a.title.localeCompare(b.title));
}
