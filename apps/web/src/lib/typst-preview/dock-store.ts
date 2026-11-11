import { useSyncExternalStore } from 'react';

/** Where the preview dock's open state, width and chosen targets are remembered, per browser. */
export const TYPST_PREVIEW_DOCK_STORAGE_KEY = 'mygitnotes:typst-preview-dock';
export const DEFAULT_PREVIEW_DOCK_WIDTH = 520;
export const MIN_PREVIEW_DOCK_WIDTH = 320;
/** What an arrow key moves the dock's edge by. */
export const PREVIEW_DOCK_KEY_STEP = 16;
/** The page keeps at least this much beside the docks. */
const MIN_PAGE_WIDTH = 320;

export interface PreviewDockState {
  open: boolean;
  width: number;
  /** The target last chosen for each project, by project key. */
  targets: Record<string, string>;
}

const CLOSED: PreviewDockState = { open: false, width: DEFAULT_PREVIEW_DOCK_WIDTH, targets: {} };

function readSaved(): PreviewDockState {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(TYPST_PREVIEW_DOCK_STORAGE_KEY) ?? 'null');
    if (typeof saved !== 'object' || saved === null) return CLOSED;
    const { open, width, targets } = saved as Record<string, unknown>;
    const chosen: Record<string, string> = {};
    if (typeof targets === 'object' && targets !== null) { for (const [key, value] of Object.entries(targets)) if (typeof value === 'string') chosen[key] = value; }
    return { open: open === true, width: typeof width === 'number' && Number.isFinite(width) ? Math.max(MIN_PREVIEW_DOCK_WIDTH, Math.round(width)) : DEFAULT_PREVIEW_DOCK_WIDTH, targets: chosen };
  } catch {
    return CLOSED;
  }
}

let state: PreviewDockState | undefined;
const listeners = new Set<() => void>();
const current = () => state ??= readSaved();

function update(next: Partial<PreviewDockState>) {
  state = { ...current(), ...next };
  try {
    localStorage.setItem(TYPST_PREVIEW_DOCK_STORAGE_KEY, JSON.stringify(state));
  } catch { /* The choice still applies until the page closes. */ }
  for (const listener of listeners) listener();
}

/** The widest the dock may be: half the window, and never so wide that the page beside both docks gets too narrow. */
export const maxPreviewDockWidth = (viewport: number, beside = 0) => Math.max(MIN_PREVIEW_DOCK_WIDTH, Math.min(Math.floor(viewport / 2), viewport - beside - MIN_PAGE_WIDTH));

/** The width the dock takes in a window `viewport` pixels wide with `beside` pixels taken by the assistant dock. */
export const previewDockWidth = (width: number, viewport: number, beside = 0) => Math.min(maxPreviewDockWidth(viewport, beside), Math.max(MIN_PREVIEW_DOCK_WIDTH, width));

export const previewDock = {
  get: current,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  open: () => update({ open: true }),
  close: () => update({ open: false }),
  toggle: () => update({ open: !current().open }),
  setWidth: (width: number, viewport: number, beside = 0) => update({ width: previewDockWidth(Math.round(width), viewport, beside) }),
  setTarget: (project: string, target: string) => update({ targets: { ...current().targets, [project]: target } }),
  /** Forgets the in-memory copy so the next read comes from storage; tests that rewrite storage call it. */
  reload() {
    state = undefined;
    for (const listener of listeners) listener();
  },
};

/** The dock's state; the toggle and the dock share one store, so neither needs a provider. */
export function usePreviewDock(): PreviewDockState {
  return useSyncExternalStore(previewDock.subscribe, previewDock.get, previewDock.get);
}
