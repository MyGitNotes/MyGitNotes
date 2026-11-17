import { noteRefKey } from '@mygitnotes/core/note-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { closePane, closeTab, emptyFocusLayout, findFocusPane, findFocusTabInPane, FOCUS_MAX_FOCUSES, FOCUS_MAX_TABS, type FocusEdge, FocusError, type FocusLayout, focusPanes, type FocusTab, focusTabCount, focusTabKey, mergePanes, moveTab as moveFocusTab, moveTabToSplit, nameFocus, notebookFocuses, placeTab, placeTabs, pruneFocus, relocateFocusLayout, removeFocus, renameFocus, splitPane, updateFocus } from '@mygitnotes/core/focus-page';
import type { FocusPageController } from './use-focus-page.js';
import { noteDemoViewWriteIn, noteDemoWriteIn } from './demo-storage.js';
import { useNoteLookup } from './use-note-queries.js';
import { movedPaths, useNoteWhereabouts, whereaboutsIn } from './note-whereabouts.js';
import { activatePane, adoptedFocusViewKey, browseTarget, collapseRatios, CURRENT_FOCUS, emptyFocusView, entryView, fillPane, type FocusEntryView, type FocusViewState, readFocusView, relocateEntryKeys, retainPanes, shownAfterClose, showTab, sideTarget, splitRatios } from './focus-view.js';

interface NoteFocusOptions {
  page: FocusPageController;
  notebookId: string;
  /** The notebook's root, repository-relative: a tab follows its note only within it. Unknown, no tab follows yet. */
  notebookRoot?: string;
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
export function useNoteFocus({ page, notebookId, notebookRoot, repository, scope, focusKey, restoreLast = false, writable, splitBeside = false, flushEditors }: NoteFocusOptions) {
  // Until the workspace says which repository serves the notebook the view has no home: it is not read or kept, or it would be filed under no repository at all.
  const key = repository ? adoptedFocusViewKey(repository, scope, notebookId) : '';
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
  /** `arranges` marks a layout change the visitor made; everything else (the Focus last shown, the active pane, sizes) is view state that follows them around. */
  const update = useCallback((change: (view: FocusViewState) => FocusViewState, arranges = false) => {
    const next = change(viewRef.current);
    viewRef.current = next;
    try {
      // A demo repository's view is kept in this browser; only the visitor's own layout change starts the 24-hour clock, and view state alone is cleared 24 hours after it was first kept.
      if (key && (arranges ? noteDemoWriteIn(repository) : noteDemoViewWriteIn(repository))) localStorage.setItem(key, JSON.stringify(next));
    } catch { /* The view still applies to this tab. */ }
    setStored({ key, view: next });
  }, [key, repository]);

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
  // A tab whose path the lists no longer show is not taken for a deleted note: the server says where the note is (another
  // person moved or renamed a live note, so the lists show it at its target), and the tab follows it there.
  const storedRefs = storedPaths.map(path => ({ notebookId, path }));
  const whereabouts = useNoteWhereabouts(storedRefs, lookup);
  const moved = movedPaths(whereabouts, storedRefs, notebookRoot);
  /**
   * A tab is kept until the server says its note or lane is gone, or moved out of the notebook; while the question is on
   * its way, and when it could not be asked (offline), it stays.
   */
  const present = (tab: FocusTab) => {
    if (!settled || !storedPaths.includes(tab.path) || notes.has(tab.path)) return true;
    const answer = whereabouts.get(noteRefKey({ notebookId, path: tab.path }));
    return (notebookRoot !== undefined ? whereaboutsIn(answer, notebookRoot) : answer)?.kind !== 'gone';
  };
  /** A named Focus shows a moved note's tab where it lies now, and its next write keeps it there; this browser's (current) one is relocated at once, below. */
  const followed = (layout: FocusLayout) => {
    if (!moved.size) return layout;
    const relocated = structuredClone(layout);
    return relocateFocusLayout(relocated, path => moved.get(path) ?? path) ? relocated : layout;
  };
  /** Gone notes and compilations are hidden now and dropped on the next write. */
  const layoutOf = (target: string) => {
    const layout = storedLayout(target);
    return layout && pruneFocus(followed(layout), present);
  };
  /** The tab each pane shows, followed as its tab is: from the render the server says where the note lies, the pane shows it there, never another tab meanwhile. */
  const followedView = (state: FocusViewState) => moved.size ? relocateEntryKeys(state, path => moved.get(path) ?? path) : state;
  const entryOf = (target: string, layout = layoutOf(target)) => layout ? entryView(followedView(viewRef.current), target, layout) : undefined;
  const namedWritable = writable && page.writable && available;
  const editable = (target: string) => target === CURRENT_FOCUS || namedWritable;

  const layout = shown ? layoutOf(shown) ?? null : null;
  const entry = shown && layout ? entryView(followedView(view), shown, layout) : null;

  // Remember the displayed Focus so returning to this notebook shows it again.
  useEffect(() => {
    if (shown && (available || shown === requested) && viewRef.current.last !== shown) update(current => ({ ...current, last: shown }));
  }, [shown, requested, available, update]);

  const setEntry = (target: string, change: (entry: FocusEntryView) => FocusEntryView, layout = layoutOf(target)) => {
    if (!layout) return;
    update(current => ({ ...current, entries: { ...current.entries, [target]: change(entryView(followedView(current), target, layout)) } }));
  };
  const [mutationError, setMutationError] = useState<FocusError | null>(null);
  // An error belongs to the Focus it was raised on.
  useEffect(() => setMutationError(null), [shown]);
  /** Applies a structural change; false when the target cannot be written to. Throws (and records) FocusError when the change itself is invalid. */
  const mutate = (target: string, change: (layout: FocusLayout) => FocusLayout): boolean => {
    if (!editable(target)) return false;
    try {
      if (target === CURRENT_FOCUS) update(current => ({ ...current, current: change(pruneFocus(followed(current.current), present)) }), true);
      else page.change(updateFocus(page.page, target, focus => ({ ...focus, ...change(pruneFocus(followed(focus), present)) })));
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
  /**
   * Places `tab` in `pane` of any Focus (a drop, the Add to Focus picker, or batch add) and shows it there; a copy of `tab` already open in another pane is untouched there.
   * A tab dragged from a tab bar (`fromTabBar`) only takes its place: the pane goes on showing what it showed, unless it showed nothing. Throws FocusError.
   */
  const place = async (target: string, tab: FocusTab, pane: string, index?: number, fromTabBar = false): Promise<boolean> => {
    const current = layoutOf(target), before = entryOf(target, current);
    if (!current || !before || !editable(target)) return false;
    const tabKey = focusTabKey(tab);
    if (target === shown && !fromTabBar && !await flushEditors(noteKeys(notebookId, [before.shown[pane]]))) return false;
    if (!mutate(target, layout => placeTab(layout, tab, pane, index))) return false;
    setEntry(target, entry => fromTabBar ? fillPane(entry, pane, tabKey) : showTab(entry, pane, tabKey), current);
    return true;
  };
  /**
   * Moves the tab `key` from `fromPane` to `toPane` (or reorders it within the same pane), for a tab-bar drag without the copy modifier. Each pane goes on showing
   * what it showed and the active pane stays: the source shows its previous tab when the moved one was on screen there, and `toPane` shows the tab only if it showed nothing. Throws FocusError.
   */
  const moveTab = async (target: string, key: string, fromPane: string, toPane: string, index?: number): Promise<boolean> => {
    const current = layoutOf(target), before = entryOf(target, current);
    if (!current || !before || !editable(target)) return false;
    const leavesSource = fromPane !== toPane && before.shown[fromPane] === key;
    // An emptied source pane is removed, which re-lays out the Focus, so every displayed editor is saved first.
    const emptiesSource = fromPane !== toPane && findFocusPane(current, fromPane)?.tabs.length === 1;
    const toFlush = emptiesSource ? Object.values(before.shown) : leavesSource ? [before.shown[fromPane]] : [];
    if (target === shown && !await flushEditors(noteKeys(notebookId, toFlush))) return false;
    const sourceNext = leavesSource ? shownAfterClose(current, fromPane, key, before.history[fromPane]) : null;
    let after = current;
    if (!mutate(target, layout => after = moveFocusTab(layout, fromPane, toPane, key, index))) return false;
    setEntry(target, entry => {
      const withSource = leavesSource ? { ...entry, shown: { ...entry.shown, [fromPane]: sourceNext } } : entry;
      const moved = fillPane(withSource, toPane, key);
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

  /**
   * Points the tabs of this browser's (current) Focus at the path `move` gives them, as a file move does for the named
   * Focus it rewrites in the workspace, and the tab each pane of any Focus shows with them, so a moved note stays shown.
   */
  const relocatePaths = (movedNotebookId: string, move: (path: string) => string) => {
    if (movedNotebookId !== notebookId) return;
    const layout = structuredClone(viewRef.current.current);
    const moved = relocateFocusLayout(layout, move);
    const keyed = relocateEntryKeys(viewRef.current, move);
    if (moved || keyed !== viewRef.current) update(() => moved ? { ...keyed, current: layout } : keyed, moved);
  };
  // The tabs of a note the server says lies elsewhere now follow it there: this browser's (current) Focus, and the tab
  // each pane of any Focus shows. Another window of this browser reads the relocated view and follows too.
  const movedKey = [...moved].map(pair => pair.join('\t')).join('\n');
  const relocate = useRef(relocatePaths);
  useEffect(() => {
    relocate.current = relocatePaths;
  });
  useEffect(() => {
    if (!movedKey) return;
    const map = new Map(movedKey.split('\n').map(line => line.split('\t') as [string, string]));
    relocate.current(notebookId, path => map.get(path) ?? path);
  }, [movedKey, notebookId]);

  const canName = namedWritable && page.page.focuses.length < FOCUS_MAX_FOCUSES;
  /** Names (current): it becomes a named Focus with the same view, and (current) starts empty. Throws FocusError. */
  const name = (label: string): string => {
    const { page: next, focus } = nameFocus(page.page, pruneFocus(followed(viewRef.current.current), present), notebookId, label);
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
