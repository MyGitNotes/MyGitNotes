import { noteRefKey } from '@mygitnotes/core/note-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { closePane, closeTab, emptyFocusLayout, relocateFocusLayout, findFocusPane, findFocusTabInPane, FOCUS_MAX_FOCUSES, FOCUS_MAX_TABS, type FocusEdge, FocusError, type FocusLayout, focusPanes, type FocusTab, focusTabCount, focusTabKey, mergePanes, moveTab as moveFocusTab, moveTabToSplit, nameFocus, notebookFocuses, placeTab, placeTabs, pruneFocus, removeFocus, renameFocus, splitPane, updateFocus } from '@mygitnotes/core/focus-page';
import type { FocusPageController } from './use-focus-page.js';
import { useNoteLookup } from './use-note-queries.js';
import { activatePane, adoptedFocusViewKey, browseTarget, collapseRatios, CURRENT_FOCUS, emptyFocusView, entryView, type FocusEntryView, type FocusViewState, readFocusView, retainPanes, shownAfterClose, showTab, sideTarget, splitRatios } from './focus-view.js';

interface NoteFocusOptions {
  page: FocusPageController;
  notebookId: string;
  /** The repository serving the notebook; its id scopes where this device keeps the view. */
  repository: string;
  /** The workspace's view-state scope before notebook keys, from which this notebook's earlier view is adopted; null when that view is not this notebook's. */
  scope: string | null;
  /** The `focus` URL parameter. */
  focusKey: string | null;
  /** With no `focus` in the URL, show the Focus displayed last, else the default; the URL is left as it is. */
  restoreLast?: boolean;
  writable: boolean;
  /** Whether the whole split tree is on screen (desktop): a note opened beside the only pane then splits it to the right instead of landing behind it as a tab. */
  splitBeside?: boolean;
  /** Saves the pending edits of the editors of `paths` before they unmount; false keeps the current view. */
  flushEditors: (paths?: readonly string[]) => Promise<boolean>;
}

/** Why a note did not open in the displayed Focus; the caller opens zoom instead. */
export type OpenResult = 'opened' | 'full' | 'readonly' | 'blocked';
/** Where a note opened from inside a pane goes: a tab of that pane, or the pane beside it. */
export type OpenPlacement = 'here' | 'beside';

function loadView(key: string): FocusViewState {
  try {
    const raw = localStorage.getItem(key);
    return raw ? readFocusView(JSON.parse(raw)) : emptyFocusView();
  } catch {
    return emptyFocusView();
  }
}
const notePath = (key: string | null) => key?.startsWith('note:') ? key.slice('note:'.length) : undefined;
const notePaths = (keys: (string | null)[]) => keys.map(notePath).filter((path): path is string => Boolean(path));
/** The editor keys of the notes the tabs `keys` show; a Focus belongs to one notebook. */
const noteKeys = (notebookId: string, keys: (string | null)[]) => notePaths(keys).map(path => noteRefKey({ notebookId, path }));

/** Named Focus (Git-synced through the Focus workspace document) and this browser's (current) Focus and view state for one notebook. */
export function useNoteFocus({ page, notebookId, repository, scope, focusKey, restoreLast = false, writable, splitBeside = false, flushEditors }: NoteFocusOptions) {
  const key = adoptedFocusViewKey(repository, scope, notebookId);
  const [stored, setStored] = useState(() => ({ key, view: loadView(key) }));
  const view = stored.key === key ? stored.view : loadView(key);
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    if (stored.key !== key) setStored({ key, view: loadView(key) });
  }, [key, stored.key]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === key) setStored({ key, view: loadView(key) });
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [key]);
  const update = useCallback((change: (view: FocusViewState) => FocusViewState) => {
    const next = change(viewRef.current);
    viewRef.current = next;
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch { /* The view still applies to this tab. */ }
    setStored({ key, view: next });
  }, [key]);

  const available = !page.loading && !page.error;
  const focuses = useMemo(() => available ? notebookFocuses(page.page, notebookId) : [], [available, page.page, notebookId]);
  const known = (target: string) => target === CURRENT_FOCUS || focuses.some(focus => focus.id === target);
  const storedLayout = (target: string): FocusLayout | undefined => target === CURRENT_FOCUS ? viewRef.current.current : focuses.find(focus => focus.id === target);
  /** The Focus asked for: the URL's, else the one displayed last, else the default. One that no longer exists gives way to the default. */
  const requested = focusKey ?? (restoreLast ? view.last ?? CURRENT_FOCUS : null);
  // While the Focus document is not available, a named Focus cannot be shown yet, so the Default stands in for it; `last` keeps the name.
  const shown = requested && known(requested) ? requested : requested ? CURRENT_FOCUS : null;
  // The displayed Focus's notes are read (without bodies) for tab titles and to hide notes that no longer exist.
  const storedLayoutShown = shown ? storedLayout(shown) : undefined;
  const storedPaths = storedLayoutShown ? focusPanes(storedLayoutShown).flatMap(pane => pane.tabs.map(tab => tab.path)) : [];
  // A Focus belongs to one notebook, so its tabs name notes by path.
  const lookup = useNoteLookup(storedPaths.map(path => ({ notebookId, path })), false);
  const notes = useMemo(() => new Map(lookup.notes.map(note => [note.path, note])), [lookup.notes]);
  const settled = !lookup.loading && !lookup.error;
  /** A tab is kept until its note or lane is known to be missing. */
  const present = (tab: FocusTab) => !settled || !storedPaths.includes(tab.path) || notes.has(tab.path);
  /** Missing notes and compilations are hidden now and dropped on the next write. */
  const layoutOf = (target: string) => {
    const layout = storedLayout(target);
    return layout && pruneFocus(layout, present);
  };
  const entryOf = (target: string, layout = layoutOf(target)) => layout ? entryView(viewRef.current, target, layout) : undefined;
  const namedWritable = writable && page.writable && available;
  const editable = (target: string) => target === CURRENT_FOCUS || namedWritable;

  const layout = shown ? layoutOf(shown) ?? null : null;
  const entry = shown && layout ? entryView(view, shown, layout) : null;

  // Remember the displayed Focus so returning to this notebook shows it again.
  useEffect(() => {
    if (shown && (available || shown === requested) && viewRef.current.last !== shown) update(current => ({ ...current, last: shown }));
  }, [shown, requested, available, update]);

  const setEntry = (target: string, change: (entry: FocusEntryView) => FocusEntryView, layout = layoutOf(target)) => {
    if (!layout) return;
    update(current => ({ ...current, entries: { ...current.entries, [target]: change(entryView(current, target, layout)) } }));
  };
  const [mutationError, setMutationError] = useState<FocusError | null>(null);
  // An error belongs to the Focus it was raised on.
  useEffect(() => setMutationError(null), [shown]);
  /** Applies a structural change; false when the target cannot be written to. Throws (and records) FocusError when the change itself is invalid. */
  const mutate = (target: string, change: (layout: FocusLayout) => FocusLayout): boolean => {
    if (!editable(target)) return false;
    try {
      if (target === CURRENT_FOCUS) update(current => ({ ...current, current: change(pruneFocus(current.current, present)) }));
      else page.change(updateFocus(page.page, target, focus => ({ ...focus, ...change(pruneFocus(focus, present)) })));
      setMutationError(null);
      return true;
    } catch (caught) {
      if (caught instanceof FocusError) setMutationError(caught);
      throw caught;
    }
  };

  /** Opens a note from the browse region (into the active pane) or from inside pane `source`: into `source` itself for `here`, else the most recently used other pane; a copy already open in another pane is untouched there. */
  const openNote = async (path: string, source?: string, placement: OpenPlacement = 'beside'): Promise<OpenResult> => {
    if (!shown || !layout || !entry) return 'readonly';
    const tab: FocusTab = { kind: 'note', path }, tabKey = focusTabKey(tab);
    const only = focusPanes(layout);
    if (source !== undefined && placement === 'beside' && splitBeside && only.length === 1) {
      // The only pane has no pane beside it, so the note opens in a new pane to its right (D9).
      if (!editable(shown)) return 'readonly';
      if (focusTabCount(layout) >= FOCUS_MAX_TABS) return 'full';
      try {
        return await split(shown, only[0].id, 'right', tab) ? 'opened' : 'blocked';
      } catch {
        // The layout changed since it was read, so it counts as full, as a refused placement does.
        setMutationError(null);
        return 'full';
      }
    }
    const pane = source === undefined ? browseTarget(entry) : placement === 'here' ? source : sideTarget(entry, source, focusPanes(layout).map(current => current.id)) ?? source;
    const found = findFocusTabInPane(layout, pane, tabKey) !== -1;
    if (!found && !editable(shown)) return 'readonly';
    if (!found && focusTabCount(layout) >= FOCUS_MAX_TABS) return 'full';
    if (!await flushEditors(noteKeys(notebookId, [entry.shown[pane]]))) return 'blocked';
    // The tab count is already checked above; a FocusError here means the layout changed since, so it counts as full too.
    if (!found) {
      try {
        if (!mutate(shown, current => placeTab(current, tab, pane))) return 'full';
      } catch {
        setMutationError(null);
        return 'full';
      }
    }
    setEntry(shown, current => showTab(current, pane, tabKey), layout);
    return 'opened';
  };
  /** Places `tab` in `pane` of any Focus (a drop, the Add to Focus picker, or batch add) and shows it there; a copy of `tab` already open in another pane is untouched there. Throws FocusError. */
  const place = async (target: string, tab: FocusTab, pane: string, index?: number): Promise<boolean> => {
    const current = layoutOf(target), before = entryOf(target, current);
    if (!current || !before || !editable(target)) return false;
    const tabKey = focusTabKey(tab);
    if (target === shown && !await flushEditors(noteKeys(notebookId, [before.shown[pane]]))) return false;
    if (!mutate(target, layout => placeTab(layout, tab, pane, index))) return false;
    setEntry(target, entry => showTab(entry, pane, tabKey), current);
    return true;
  };
  /** Moves the tab `key` from `fromPane` to `toPane` (or reorders it within the same pane), for a tab-bar drag without the copy modifier. Throws FocusError. */
  const moveTab = async (target: string, key: string, fromPane: string, toPane: string, index?: number): Promise<boolean> => {
    const current = layoutOf(target), before = entryOf(target, current);
    if (!current || !before || !editable(target)) return false;
    const leavesSource = fromPane !== toPane && before.shown[fromPane] === key;
    // An emptied source pane is removed, which re-lays out the Focus, so every displayed editor is saved first.
    const emptiesSource = fromPane !== toPane && findFocusPane(current, fromPane)?.tabs.length === 1;
    const toFlush = emptiesSource ? Object.values(before.shown) : leavesSource ? [before.shown[fromPane], before.shown[toPane]] : [before.shown[toPane]];
    if (target === shown && !await flushEditors(noteKeys(notebookId, toFlush))) return false;
    const sourceNext = leavesSource ? shownAfterClose(current, fromPane, key, before.history[fromPane]) : null;
    let after = current;
    if (!mutate(target, layout => after = moveFocusTab(layout, fromPane, toPane, key, index))) return false;
    setEntry(target, entry => {
      const withSource = leavesSource ? { ...entry, shown: { ...entry.shown, [fromPane]: sourceNext } } : entry;
      const moved = showTab(withSource, toPane, key);
      return emptiesSource ? retainPanes({ ...moved, ratios: collapseRatios(moved.ratios, current, fromPane) }, after) : moved;
    }, current);
    return true;
  };
  /** Opens `tab` in a new pane on the `edge` side of `pane` (a drop on a pane's edge). With a `sourcePane` and no `copy` the tab moves there from that pane, whose pane is removed if it is left empty. Throws FocusError, among them `pane-limit` and `depth-limit`. */
  const split = async (target: string, pane: string, edge: FocusEdge, tab: FocusTab, sourcePane?: string, copy = false): Promise<boolean> => {
    const current = layoutOf(target), before = entryOf(target, current);
    if (!current || !before || !editable(target)) return false;
    // Wrapping a pane or removing one re-parents panes, which remounts their editors.
    if (target === shown && !await flushEditors(noteKeys(notebookId, Object.values(before.shown)))) return false;
    const tabKey = focusTabKey(tab), from = copy ? undefined : sourcePane;
    let after = current, created = pane;
    if (
      !mutate(target, layout => {
        const result = from !== undefined ? moveTabToSplit(layout, from, tabKey, pane, edge) : splitPane(layout, pane, edge, tab);
        created = result.pane;
        return after = result.layout;
      })
    ) return false;
    if (after === current) return true;
    setEntry(target, entry => {
      const emptied = from !== undefined && from !== pane && findFocusPane(current, from)?.tabs.length === 1;
      const mid = emptied ? closePane(current, from) : current;
      const sourceNext = from !== undefined && !emptied && entry.shown[from] === tabKey ? shownAfterClose(current, from, tabKey, entry.history[from]) : undefined;
      const withSource = from !== undefined && sourceNext !== undefined ? { ...entry, shown: { ...entry.shown, [from]: sourceNext } } : entry;
      // An emptied source's id may be the new pane's: its leftover state is dropped before the new pane takes the id.
      const settled = emptied ? retainPanes({ ...withSource, ratios: collapseRatios(entry.ratios, current, from) }, mid) : withSource;
      return showTab(retainPanes({ ...settled, ratios: splitRatios(settled.ratios, mid, after, pane, created) }, after), created, tabKey);
    }, current);
    return true;
  };
  const show = async (pane: string, tabKey: string) => {
    if (!shown || !entry) return;
    const previous = entry.shown[pane];
    if (previous !== tabKey && !await flushEditors(noteKeys(notebookId, [previous]))) return;
    setEntry(shown, current => showTab(current, pane, tabKey));
  };
  const activate = (pane: string) => {
    if (shown && entry && entry.activePane !== pane) setEntry(shown, current => activatePane(current, pane));
  };
  /** Closes `tabKey` in `pane` only; a copy in another pane is untouched. Throws FocusError if the shown Focus was removed since it was read. */
  const close = async (tabKey: string, pane: string) => {
    if (!shown || !layout || !entry) return;
    if (findFocusTabInPane(layout, pane, tabKey) === -1) return;
    const visible = entry.shown[pane] === tabKey;
    // A pane left empty is removed, which re-lays out the Focus, so every displayed editor is saved first.
    const removesPane = focusPanes(layout).length > 1 && findFocusPane(layout, pane)?.tabs.length === 1;
    if ((visible || removesPane) && !await flushEditors(noteKeys(notebookId, removesPane ? Object.values(entry.shown) : [tabKey]))) return;
    const next = shownAfterClose(layout, pane, tabKey, entry.history[pane]);
    let after = layout;
    if (!mutate(shown, current => after = closeTab(current, pane, tabKey))) return;
    if (removesPane) setEntry(shown, current => retainPanes({ ...current, ratios: collapseRatios(current.ratios, layout, pane) }, after), layout);
    else if (visible) setEntry(shown, current => ({ ...current, shown: { ...current.shown, [pane]: next } }), layout);
  };
  /** Adds every tab in `tabs` to `pane` of `target`, skipping any already there; reports how many were added vs. skipped. False when the target cannot be written to. Throws FocusError. */
  const addBatch = (target: string, tabs: FocusTab[], pane: string): { added: number; skipped: number; } | false => {
    if (!editable(target)) return false;
    let outcome = { added: 0, skipped: 0 };
    if (
      !mutate(target, layout => {
        const result = placeTabs(layout, tabs, pane);
        outcome = { added: result.added, skipped: result.skipped };
        return result.layout;
      })
    ) return false;
    return outcome;
  };
  /** Split right / Split down: opens the note `pane` shows again in a new pane on that side (the same note may sit in several panes). False when the pane shows nothing. Throws FocusError. */
  const splitShown = async (pane: string, orientation: 'horizontal' | 'vertical'): Promise<boolean> => {
    if (!shown || !layout || !entry) return false;
    const tab = findFocusPane(layout, pane)?.tabs.find(candidate => focusTabKey(candidate) === entry.shown[pane]);
    return tab ? split(shown, pane, orientation === 'horizontal' ? 'right' : 'bottom', tab) : false;
  };
  /** Removes an empty pane (D4). False for a pane that still holds tabs. Throws FocusError if the shown Focus was removed since it was read. */
  const closeEmptyPane = async (pane: string): Promise<boolean> => {
    if (!shown || !layout || !entry || findFocusPane(layout, pane)?.tabs.length !== 0) return false;
    if (focusPanes(layout).length > 1 && !await flushEditors(noteKeys(notebookId, Object.values(entry.shown)))) return false;
    let after = layout;
    if (!mutate(shown, current => after = closePane(current, pane))) return false;
    setEntry(shown, current => retainPanes({ ...current, ratios: collapseRatios(current.ratios, layout, pane) }, after), layout);
    return true;
  };
  /** Folds every pane into the first one, in pane order; the active pane's shown tab stays on screen and the merged pane becomes active. Throws FocusError if the shown Focus was removed since it was read. */
  const mergeAll = async (): Promise<boolean> => {
    if (!shown || !layout || !entry || layout.root.kind === 'pane') return false;
    // Every pane is laid out again, so every displayed editor remounts.
    if (!await flushEditors(noteKeys(notebookId, Object.values(entry.shown)))) return false;
    let after = layout;
    if (!mutate(shown, current => after = mergePanes(current))) return false;
    const first = after.root.kind === 'pane' ? after.root.id : '', kept = entry.shown[entry.activePane];
    setEntry(shown, current => {
      const merged = retainPanes({ ...current, ratios: {} }, after);
      return kept ? showTab(merged, first, kept) : activatePane(merged, first);
    }, layout);
    return true;
  };
  const setRatios = (split: string, sizes: Record<string, number>) => {
    if (shown) setEntry(shown, current => ({ ...current, ratios: { ...current.ratios, [split]: sizes } }));
  };
  const setHideToolbar = (pane: string, on: boolean) => {
    if (shown) setEntry(shown, current => ({ ...current, hideToolbar: { ...current.hideToolbar, [pane]: on } }));
  };
  const setDock = (dock: Partial<FocusViewState['dock']>) => update(current => ({ ...current, dock: { ...current.dock, ...dock } }));
  /** Empties every pane of the shown Focus, leaving one empty pane. Throws FocusError if the shown Focus was removed since it was read. */
  const clear = async (): Promise<boolean> => {
    if (!shown || !entry) return false;
    if (!await flushEditors(noteKeys(notebookId, Object.values(entry.shown)))) return false;
    if (!mutate(shown, () => emptyFocusLayout())) return false;
    update(current => {
      const { [shown]: _cleared, ...entries } = current.entries;
      return { ...current, entries };
    });
    return true;
  };

  /** Points the tabs of this browser's (current) Focus at the path `move` gives them, as a file move does for the named Focus it rewrites in the workspace. */
  const relocatePaths = (movedNotebookId: string, move: (path: string) => string) => {
    if (movedNotebookId !== notebookId) return;
    const layout = structuredClone(viewRef.current.current);
    if (relocateFocusLayout(layout, move)) update(current => ({ ...current, current: layout }));
  };

  const canName = namedWritable && page.page.focuses.length < FOCUS_MAX_FOCUSES;
  /** Names (current): it becomes a named Focus with the same view, and (current) starts empty. Throws FocusError. */
  const name = (label: string): string => {
    const { page: next, focus } = nameFocus(page.page, pruneFocus(viewRef.current.current, present), notebookId, label);
    page.change(next);
    update(current => {
      const { [CURRENT_FOCUS]: moved, ...entries } = current.entries;
      return { ...current, current: emptyFocusLayout(), entries: moved ? { ...entries, [focus.id]: moved } : entries, last: focus.id };
    });
    return focus.id;
  };
  /** Throws FocusError for a duplicate name. */
  const rename = (id: string, label: string) => page.change(renameFocus(page.page, id, label));
  const remove = async (id: string) => {
    if (id === shown && entry && !await flushEditors(noteKeys(notebookId, Object.values(entry.shown)))) return false;
    page.change(removeFocus(page.page, id));
    update(current => {
      const { [id]: _removed, ...entries } = current.entries;
      return { ...current, entries, last: current.last === id ? CURRENT_FOCUS : current.last };
    });
    return true;
  };

  return { notebookId, focuses, error: page.error, loading: page.loading, view, shown, layout, entry, notes, mutationError, dismissMutationError: () => setMutationError(null), editable: shown ? editable(shown) : false, canName, layoutOf, entryOf, editableFocus: editable, openNote, place, moveTab, split, show, activate, close, addBatch, splitShown, closeEmptyPane, mergeAll, clear, setRatios, setHideToolbar, setDock, relocatePaths, name, rename, remove };
}
export type NoteFocus = ReturnType<typeof useNoteFocus>;
