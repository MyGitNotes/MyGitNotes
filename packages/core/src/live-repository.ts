import { CheckedOutError, isLiveContentHash, isLiveId, isLiveRevision, liveAdapterError, type LiveCheckout, liveCheckoutOf, type LiveContext, type LiveEditorInfo, liveEditorOf, type LiveNotes, livePendingPath, type LivePersonCalls, type LiveText, liveTextOf, LiveUnavailableError, normalizeLiveText } from './live-notes.js';
import { localIdIn } from './notebook-key.js';
import type { RepositoryId } from './repository.js';
import type { LiveNoteState, NotebookConfig } from './types.js';

/*
 * One request's view of a repository's live editor (docs/specs/2026-11-15-live-notes/spec.md §2): the person-side
 * calls of the adapter for that repository, every answer checked, and the request's list of live links read once.
 */

/** A live note as a request last read or wrote it: what a hosted revision token carries for it. */
export interface LiveRecord {
  id: string;
  liveRevision: string;
  contentHash: string;
}

/** A live link with the notebook it belongs to and the path reads know it by: its Git path, or a pending note's virtual path. */
export interface LiveLink {
  checkout: LiveCheckout;
  notebook: NotebookConfig;
  path: string;
}

export interface LiveRepository {
  readonly repository: RepositoryId;
  readonly editor: LiveEditorInfo;
  /** The repository's live links, checked; read from the adapter once per request. */
  checkouts(): Promise<LiveCheckout[]>;
  /** Those links with their notebooks and paths. */
  links(): Promise<LiveLink[]>;
  /** The live text of a link, fresh from the adapter and checked. */
  read(id: string): Promise<LiveText>;
  /** Writes a whole text on `baseRevision`, which the editor rebases over typing since; the text is sent in normal form. */
  write(id: string, content: string, baseRevision: string, agent: boolean): Promise<{ liveRevision: string; changed: boolean; }>;
  append(id: string, text: string, agent: boolean): Promise<{ liveRevision: string; }>;
}

export interface LiveRepositoryOptions {
  liveNotes: LiveNotes;
  /** Who the calls act for: a signed-in person, or a write grant's person. Signed out, no view is made. */
  context: LiveContext;
  repository: RepositoryId;
  /** The repository's alias in the workspace: links name notebooks by key (`<alias>~<id>`). */
  alias: string;
  /** The notebooks the repository serves, with their local ids. */
  notebooks(): Promise<NotebookConfig[]>;
}

const call = async <T>(run: () => Promise<T>): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    throw liveAdapterError(error);
  }
};

const revisionOf = (value: unknown): string => {
  const liveRevision = (value as { liveRevision?: unknown; } | null)?.liveRevision;
  if (!isLiveRevision(liveRevision)) throw new LiveUnavailableError();
  return liveRevision;
};

/**
 * The view of a repository's live editor for one request; null where the adapter covers no editor for it. The
 * adapter's person calls are asked for only on first use, so a request that reads nothing live makes no adapter call.
 */
export function liveRepository({ liveNotes, context, repository, alias, notebooks }: LiveRepositoryOptions): LiveRepository | null {
  const editor = liveEditorOf(liveNotes, repository);
  if (!editor) return null;
  let person: LivePersonCalls | undefined;
  const calls = () => person ??= liveNotes.person(context);
  let listed: Promise<LiveLink[]> | undefined;
  const links = () => {
    listed ??= (async () => {
      const [rows, served] = await Promise.all([call(() => calls().checkouts(repository)), notebooks()]);
      if (!Array.isArray(rows)) throw new LiveUnavailableError();
      const notebook = (key: string) => {
        const local = localIdIn(alias, key);
        return local === null ? undefined : served.find(entry => entry.id === local);
      };
      const checked: LiveLink[] = [];
      // One link per path and per id: a second row for either (an adapter fault) is dropped.
      const seen = new Set<string>();
      for (const row of rows) {
        const checkout = liveCheckoutOf(row, { editor, notebook });
        if (!checkout) continue;
        const owner = notebook(checkout.notebook)!;
        const path = checkout.path ?? livePendingPath(owner.root, checkout.id);
        if (seen.has(path) || seen.has(`id:${checkout.id}`)) {
          console.warn(`[live-notes] dropped live link ${checkout.id}: a second link for its path or id`);
          continue;
        }
        seen.add(path).add(`id:${checkout.id}`);
        checked.push({ checkout, notebook: owner, path });
      }
      return checked;
    })();
    // A failed list is asked again by the next read rather than remembered.
    listed.catch(() => (listed = undefined));
    return listed;
  };
  return {
    repository,
    editor,
    links,
    checkouts: async () => (await links()).map(link => link.checkout),
    async read(id) {
      if (!isLiveId(id)) throw new LiveUnavailableError();
      return liveTextOf(await call(() => calls().read(repository, id)));
    },
    async write(id, content, baseRevision, agent) {
      const answer = await call(() => calls().write(repository, id, { content: normalizeLiveText(content), baseRevision, agent }));
      return { liveRevision: revisionOf(answer), changed: (answer as { changed?: unknown; }).changed !== false };
    },
    async append(id, text, agent) {
      return { liveRevision: revisionOf(await call(() => calls().append(repository, id, { text: normalizeLiveText(text), agent }))) };
    },
  };
}

/** The refusal of a Git write of one note's text while it is checked out: the writer read it before, or from Git. */
export function editedLiveError(file: string): CheckedOutError {
  return new CheckedOutError([file], `${file} is being edited live (編輯中); read it again and write with the revision that read returns, or check it in with check_in_note first.`);
}

/** What reads say of a live link. */
export function liveNoteState(row: LiveCheckout): LiveNoteState {
  return { since: row.since, activeEditors: row.activeEditors, ...(row.path === null ? { pending: true as const } : {}), ...(row.conflict ? { conflict: row.conflict } : {}), editorUrl: row.editorUrl };
}

/*
 * The internal revision a write on a live note names: `live:<id>:<contentHash>:<liveRevision>`. It is never shown to a
 * caller: the hosted token carries its parts, and the hosted router hands it on only for a note checked out under that id.
 */
const LIVE_BASE = /^live:([A-Za-z0-9_-]{1,64}):([0-9a-f]{64}):([\x20-\x7e]{1,256})$/;

export function liveBase(record: LiveRecord): string {
  return `live:${record.id}:${record.contentHash}:${record.liveRevision}`;
}

/** The parts of an internal live revision; null for any other value, such as a commit id. */
export function parseLiveBase(value: unknown): LiveRecord | null {
  if (typeof value !== 'string') return null;
  const match = LIVE_BASE.exec(value);
  if (!match || !isLiveContentHash(match[2])) return null;
  return { id: match[1], contentHash: match[2], liveRevision: match[3] };
}
