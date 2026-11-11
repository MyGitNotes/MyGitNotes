/**
 * The width the docks beside the page take from the window's right side. The zoom overlays (note, compilation, loading)
 * end there through `--assistant-dock-width`, which is the sum of what each dock on screen reserves.
 */
export type DockId = 'assistant' | 'typst-preview';

const reserved = new Map<DockId, number>();

/** Says how wide `dock` is on screen now; 0 when it is closed, hidden or a sheet over the page. */
export function reserveDockWidth(dock: DockId, width: number): void {
  reserved.set(dock, Math.max(0, Math.round(width)));
  let total = 0;
  for (const value of reserved.values()) total += value;
  document.documentElement.style.setProperty('--assistant-dock-width', `${total}px`);
  for (const listener of listeners) listener();
}

const listeners = new Set<() => void>();
/** Hears every change of a reserved width, so one dock can bound itself by the other. */
export function onDockReserve(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** What `dock` reserves now. */
export const reservedDockWidth = (dock: DockId): number => reserved.get(dock) ?? 0;
