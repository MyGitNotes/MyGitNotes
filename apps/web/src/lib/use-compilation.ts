import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type CompilationPage, type CompilationRow, compilationSlug, uniqueCompilationPath } from '@mygitnotes/core/compilation';
import { type NoteListItem, type NoteRef, noteRefKey } from '@mygitnotes/core/note-query';
import { useCompilationActions } from './compilation-actions.js';
import { compilationMetadata, compilationText, parseCompilationNote, type ParsedCompilation, planCompilationWrites, writableCompilationText } from './compilation-rows.js';
import { useEditorRegistry } from './note-editing.js';
import { initialCompilationStatus } from './compilation-status.js';
import { useNoteFacets, useNoteList, useNoteLookup } from './use-note-queries.js';
import type { NotebookConfig } from './types.js';

/** The pause after the last edit before a compilation file is written. */
const WRITE_DELAY = 350;

/** What a view of compilations holds: the rows, and `change` to write the difference back. */
export interface CompilationController {
  page: CompilationPage;
  /** Files that do not open, with the reason. */
  invalid: ParsedCompilation[];
  /** Replaces the rows; changed rows are written, new rows created and missing rows deleted. False when a row was refused (the error says why). */
  change: (next: CompilationPage) => boolean;
  /** Writes what is waiting and resolves once nothing is in flight: true when every write succeeded. */
  save: () => Promise<boolean>;
  /**
   * Holds every other caller's writes off until `release`: while held, `change` and `save` are refused with `reason`
   * as the error, so a write the holder may yet take back (the 卡片 tool's new card, rolled back when its write fails)
   * reaches no file through another edit, nor does anything that waits for the writes (the editors' save before a
   * move or leaving the page) go on. One hold at a time.
   */
  hold: (reason: string) => CompilationHold;
  /**
   * For an edit that reads the rows now and writes or moves the file later (after saving editors, a dialog's answer):
   * refused while a hold is taken (undefined, the error says why), else a check to make before that write, false (the
   * error says why) once a hold was taken since, whose write the rows read may lack or still hold.
   */
  capture: () => (() => boolean) | undefined;
  loading: boolean;
  saving: boolean;
  error: string;
  setError: (message: string) => void;
  /** Whether every compilation shown may be written. */
  writable: boolean;
  /** Files drawn but never written or copied, by path, with the reason: a legacy graph layout whose positions a whiteboard cannot keep. */
  upgradeLoss: ReadonlyMap<string, string>;
}

/** A hold on a compilation's writes, see `CompilationController.hold`. */
export interface CompilationHold {
  /** Runs `edit`, its `change` calls taken as the holder's. */
  admit: <T>(edit: () => T) => T;
  /** Writes what is waiting, as `save` does, for the holder. */
  save: () => Promise<boolean>;
  /** Ends the hold: the other callers write again. */
  release: () => void;
}

interface ControllerInput {
  entries: NoteListItem[];
  notebooks: readonly NotebookConfig[];
  loading: boolean;
  error: string;
  /** Registers the pending writes with the editors that are saved before the page unmounts. */
  registryKey: string;
  /** Where a new row's file goes; without it a view cannot add rows. */
  newPath?: (row: CompilationRow, taken: ReadonlySet<string>) => string;
  /** The status a new row without one starts with, as a new note of its notebook would. */
  initialStatus?: (notebookId: string) => string | undefined;
}

/** Keeps edits made to rows as pending until the stored files show them, writes them after a pause, and reports failures. */
function useCompilationController({ entries, notebooks, loading, error: loadError, registryKey, newPath, initialStatus }: ControllerInput): CompilationController {
  const actions = useCompilationActions();
  const register = useEditorRegistry();
  const parsed = useMemo(() => entries.map(entry => parseCompilationNote(entry, notebooks)), [entries, notebooks]);
  const stored = useMemo(() => parsed.flatMap(entry => entry.row ? [entry.row] : []), [parsed]);
  // Files a write would lose positions of: drawn, never written.
  const lossy = useMemo(() => new Map(parsed.flatMap(entry => entry.row && entry.upgradeLoss ? [[entry.path, entry.upgradeLoss] as const] : [])), [parsed]);
  // Rows edited here and not yet seen in the stored files; null stands for a deleted file.
  const [pending, setPending] = useState<Record<string, CompilationRow | null>>({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const rows = useMemo(() => {
    const result = stored.filter(row => pending[row.path] !== null).map(row => pending[row.path] ?? row);
    const known = new Set(stored.map(row => row.path));
    for (const [path, row] of Object.entries(pending)) if (row && !known.has(path)) result.push(row);
    return result;
  }, [stored, pending]);

  const latest = useRef({ pending, stored, entries, rows, actions, newPath, initialStatus, lossy });
  /* eslint-disable react/refs -- The write timer and the unmount flush read the newest state without restarting. */
  latest.current = { pending, stored, entries, rows, actions, newPath, initialStatus, lossy };
  /* eslint-enable react/refs */
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inflight = useRef<Promise<boolean>>(Promise.resolve(true));
  const queued = useRef(new Map<string, CompilationRow | null>());
  // The hold on the writes, if one is taken; `admitting` while the holder's own edit runs.
  const held = useRef<{ reason: string; admitting: boolean; }>(undefined);
  /** Why a write of a caller other than the holder is refused just now, or nothing. */
  const refusal = useCallback(() => held.current && !held.current.admitting ? held.current.reason : undefined, []);
  // How many holds were taken, and the last one's reason: rows read before a hold are not written after it.
  const holds = useRef({ count: 0, reason: '' });

  // A pending edit ends once the stored file shows it.
  useEffect(() => {
    /* eslint-disable react/set-state-in-effect -- Pending edits are settled against the stored files after each query answer. */
    setPending(current => {
      let changed = false;
      const next: Record<string, CompilationRow | null> = {};
      for (const [path, row] of Object.entries(current)) {
        const file = stored.find(candidate => candidate.path === path);
        const settled = row === null ? !file : Boolean(file) && compilationText(file!) === compilationText(row) && !queued.current.has(path);
        if (settled) changed = true;
        else next[path] = row;
      }
      return changed ? next : current;
    });
    /* eslint-enable react/set-state-in-effect */
  }, [stored]);

  const write = useCallback(async () => {
    const batch = [...queued.current];
    queued.current.clear();
    if (!batch.length) return true;
    const { stored: existing, entries: listed, actions: api } = latest.current;
    const failed: string[] = [];
    for (const [path, row] of batch) {
      try {
        const entry = listed.find(candidate => candidate.path === path);
        if (row === null) {
          if (entry) await api.remove(entry);
        } else if (existing.some(candidate => candidate.path === path)) await api.save({ path, notebookId: row.notebookId }, compilationText(row), compilationMetadata(row));
        else await api.create(row.notebookId, path, compilationText(row), compilationMetadata(row));
      } catch (caught) {
        failed.push(path);
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    }
    if (failed.length) setPending(current => Object.fromEntries(Object.entries(current).filter(([path]) => !failed.includes(path))));
    return !failed.length;
  }, []);
  const flush = useCallback((): Promise<boolean> => {
    clearTimeout(timer.current);
    timer.current = undefined;
    setSaving(true);
    inflight.current = inflight.current.then(() => write()).finally(() => {
      if (!queued.current.size && !timer.current) setSaving(false);
    });
    return inflight.current;
  }, [write]);
  const save = useCallback(() => {
    const waiting = refusal();
    if (!waiting) return flush();
    setError(waiting);
    return Promise.resolve(false);
  }, [flush, refusal]);

  const change = useCallback((next: CompilationPage) => {
    const { rows: current, actions: api, newPath: placeNew, initialStatus: startStatus } = latest.current;
    const writes = planCompilationWrites(current, next.rows);
    if (!writes.save.length && !writes.create.length && !writes.remove.length) return true;
    // The rows shown may hold the holder's write, which it may yet take back: nothing else writes them meanwhile.
    const waiting = refusal();
    if (waiting) {
      setError(waiting);
      return false;
    }
    const taken = new Set([...current.map(row => row.path), ...Object.keys(latest.current.pending)]);
    const created = writes.create.flatMap(row => {
      if (row.path) return [row];
      if (!placeNew) return [];
      const path = placeNew(row, taken);
      taken.add(path);
      const status = row.status || startStatus?.(row.notebookId);
      return [{ ...row, path, ...(status ? { status } : {}) }];
    });
    const updates: Record<string, CompilationRow | null> = {};
    const refused: string[] = [];
    for (const row of [...writes.save, ...created]) {
      if (!api.canWrite(row.notebookId)) continue;
      // A row whose file would not open again, or would lose a legacy layout's positions, is not written; its stored file and the rows shown stay as they were.
      const loss = latest.current.lossy.get(row.path);
      if (loss) {
        refused.push(loss);
        continue;
      }
      try {
        writableCompilationText(row);
      } catch (caught) {
        refused.push(caught instanceof Error ? caught.message : String(caught));
        continue;
      }
      updates[row.path] = row;
      queued.current.set(row.path, row);
    }
    for (const path of writes.remove) {
      updates[path] = null;
      queued.current.set(path, null);
    }
    setPending(previous => ({ ...previous, ...updates }));
    setError(refused.join('\n'));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), WRITE_DELAY);
    return !refused.length;
  }, [flush, refusal]);

  const hold = useCallback((reason: string): CompilationHold => {
    if (held.current) throw new Error('The compilation writes are already held.');
    const token = { reason, admitting: false };
    held.current = token;
    holds.current = { count: holds.current.count + 1, reason };
    return {
      admit: edit => {
        token.admitting = true;
        try {
          return edit();
        } finally {
          token.admitting = false;
        }
      },
      save: flush,
      release: () => {
        if (held.current === token) held.current = undefined;
      },
    };
  }, [flush]);
  const capture = useCallback(() => {
    const waiting = refusal();
    if (waiting) {
      setError(waiting);
      return undefined;
    }
    const at = holds.current.count;
    return () => {
      if (holds.current.count === at) return true;
      setError(holds.current.reason);
      return false;
    };
  }, [refusal]);

  // Edits waiting for the pause are written before the view goes away, and before the app saves its editors; while a
  // held write may yet be taken back, what waits for the writes (a move of the file, leaving the page) does not go on.
  useEffect(() =>
    register(registryKey, async () => {
      const waiting = refusal();
      if (waiting) {
        setError(waiting);
        return false;
      }
      if (!queued.current.size) return true;
      await flush();
      return !queued.current.size;
    }), [register, registryKey, flush, refusal]);
  useEffect(() => () => {
    if (queued.current.size) void flush();
  }, [flush]);

  const writable = rows.length > 0 ? rows.every(row => actions.canWrite(row.notebookId)) : false;
  return { page: { rows }, invalid: parsed.filter(entry => entry.error), change, save, hold, capture, loading, saving, error: error || loadError, setError, writable, upgradeLoss: lossy };
}

/**
 * Every compilation of `notebookId` as one controller, which creates rows (new rows need a `path`): the rows
 * come from the same query as the left pane, with the files' content. No view draws several at once since the
 * graph page went; the controller's create and hold paths are tested through it.
 */
export function useCompilations(notebookId: string, notebooks: readonly NotebookConfig[]): CompilationController {
  const list = useNoteList({ notebookId, kind: 'compilation', showHidden: true, sort: 'title', order: 'asc' }, { content: true });
  const { hasMore, loadingMore, loadMore } = list;
  useEffect(() => {
    if (hasMore && !loadingMore) loadMore();
  }, [hasMore, loadingMore, loadMore]);
  const entries = useMemo(() => [...list.notes, ...list.uncommitted], [list.notes, list.uncommitted]);
  const newPath = useCallback((row: CompilationRow, taken: ReadonlySet<string>) => {
    const notebook = notebooks.find(candidate => candidate.id === row.notebookId);
    if (!notebook) throw new Error(`Notebook ${row.notebookId} is not configured.`);
    return newCompilationPath(notebook, row.name, path => taken.has(path));
  }, [notebooks]);
  const facets = useNoteFacets(false);
  const initialStatus = useCallback((id: string) => initialCompilationStatus([...notebooks], id, facets.facets), [notebooks, facets.facets]);
  return useCompilationController({ entries, notebooks, loading: list.loading || hasMore, error: list.error, registryKey: `compilations:${notebookId}`, newPath, initialStatus });
}

/** The path a new compilation named `name` is written to in the root of `notebook`, unused by the rows shown. */
export function newCompilationPath(notebook: Pick<NotebookConfig, 'root'>, name: string, taken: (path: string) => boolean, folder = ''): string {
  return uniqueCompilationPath([notebook.root.replace(/\/$/, ''), folder.replace(/^\/|\/$/g, '')].filter(Boolean).join('/'), compilationSlug(name), taken);
}

/** One open compilation, read with its content: `page.rows` holds its row, or `invalid` says why it does not open. */
export function useCompilation(ref: NoteRef, notebooks: readonly NotebookConfig[]): CompilationController & { note: NoteListItem | undefined; missing: boolean; } {
  const lookup = useNoteLookup([ref], true);
  const entries = useMemo(() => lookup.notes, [lookup.notes]);
  const controller = useCompilationController({ entries, notebooks, loading: lookup.loading, error: lookup.error, registryKey: noteRefKey(ref) });
  return { ...controller, note: entries[0], missing: !lookup.loading && !lookup.error && entries.length === 0 };
}
