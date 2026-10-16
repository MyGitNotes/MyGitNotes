import { useSyncExternalStore } from 'react';

/** Where the dock's open state, width and expanded state are remembered, per browser. */
export const ASSISTANT_DOCK_STORAGE_KEY = 'mygitnotes:assistant-dock';
export const DEFAULT_ASSISTANT_DOCK_WIDTH = 380;
export const MIN_ASSISTANT_DOCK_WIDTH = 320;
/** The expanded dock is half the window, but never wider than this. */
export const MAX_EXPANDED_DOCK_WIDTH = 760;
/** What an arrow key moves the dock's edge by. */
export const ASSISTANT_DOCK_KEY_STEP = 16;

export interface AssistantDockState {
  open: boolean;
  /** The width the person chose by dragging or keys; the expanded width does not replace it. */
  width: number;
  expanded: boolean;
}

const CLOSED: AssistantDockState = { open: false, width: DEFAULT_ASSISTANT_DOCK_WIDTH, expanded: false };

function readSaved(): AssistantDockState {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(ASSISTANT_DOCK_STORAGE_KEY) ?? 'null');
    if (typeof saved !== 'object' || saved === null) return CLOSED;
    const { open, width, expanded } = saved as Record<string, unknown>;
    return { open: open === true, width: typeof width === 'number' && Number.isFinite(width) ? Math.max(MIN_ASSISTANT_DOCK_WIDTH, Math.round(width)) : DEFAULT_ASSISTANT_DOCK_WIDTH, expanded: expanded === true };
  } catch {
    return CLOSED;
  }
}

let state: AssistantDockState | undefined;
const listeners = new Set<() => void>();

const current = () => state ??= readSaved();

function update(next: Partial<AssistantDockState>) {
  const before = current();
  const merged = { ...before, ...next };
  if (merged.open === before.open && merged.width === before.width && merged.expanded === before.expanded) return;
  state = merged;
  try {
    localStorage.setItem(ASSISTANT_DOCK_STORAGE_KEY, JSON.stringify(merged));
  } catch { /* The choice still applies until the page closes. */ }
  for (const listener of listeners) listener();
}

/** Where focus was as the dock opened: closing the dock removes what had focus inside it, and focus goes back here. */
let returnFocus: HTMLElement | null = null;

function setOpen(open: boolean) {
  if (open && !current().open && typeof document !== 'undefined') {
    const active = document.activeElement;
    returnFocus = active instanceof HTMLElement && active !== document.body && !insideAssistantDock(active) ? active : null;
  }
  update({ open });
}

/** The widest the dock may be dragged to: half the window. */
export const maxAssistantDockWidth = (viewport: number) => Math.max(MIN_ASSISTANT_DOCK_WIDTH, Math.floor(viewport / 2));

/** The width the dock takes in a window `viewport` pixels wide: the chosen width within its bounds, or the wide width when expanded. */
export function assistantDockWidth({ width, expanded }: Pick<AssistantDockState, 'width' | 'expanded'>, viewport: number): number {
  const max = maxAssistantDockWidth(viewport);
  return expanded ? Math.max(MIN_ASSISTANT_DOCK_WIDTH, Math.min(max, MAX_EXPANDED_DOCK_WIDTH)) : Math.min(max, Math.max(MIN_ASSISTANT_DOCK_WIDTH, width));
}

export const assistantDock = {
  get: current,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  open: () => setOpen(true),
  close: () => setOpen(false),
  toggle: () => setOpen(!current().open),
  /**
   * After the dock closed: when focus went with it (it fell to the page's body), puts focus back where it was as the dock
   * opened, or, when that is gone, on the last dock toggle on the page, the one in the topmost layer.
   */
  restoreFocus() {
    const target = returnFocus;
    returnFocus = null;
    if (document.activeElement !== null && document.activeElement !== document.body) return;
    if (target?.isConnected) target.focus();
    if (target && document.activeElement === target) return;
    const toggles = document.querySelectorAll<HTMLElement>('.assistant-dock-toggle:not(:disabled)');
    toggles[toggles.length - 1]?.focus();
  },
  /** Dragging or pressing a key picks a width of its own, which ends the expanded state. */
  setWidth: (width: number, viewport: number) => update({ width: Math.max(MIN_ASSISTANT_DOCK_WIDTH, Math.min(maxAssistantDockWidth(viewport), Math.round(width))), expanded: false }),
  setExpanded: (expanded: boolean) => update({ expanded }),
  /** Forgets the in-memory copy so the next read comes from storage; tests that rewrite storage call it. */
  reload() {
    state = undefined;
    for (const listener of listeners) listener();
  },
};

/** The dock's state and controls; every toggle and the dock itself share one store, so none needs a provider. */
export function useAssistantDock() {
  const snapshot = useSyncExternalStore(assistantDock.subscribe, assistantDock.get, assistantDock.get);
  return { ...snapshot, openDock: assistantDock.open, closeDock: assistantDock.close, toggleDock: assistantDock.toggle };
}

/** Whether a node lies inside the dock, or in the menu it opens, whose keys (Escape included) belong to it and not to the editor beside it. */
export function insideAssistantDock(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.assistant-dock, .assistant-dock-menu') !== null;
}
