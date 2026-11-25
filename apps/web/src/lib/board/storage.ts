import type { Point } from './geometry.js';

/** This device's saved board cameras, by board; each keeps the board point at the viewport's centre and the zoom. */
export const BOARD_CAMERA_STORAGE_KEY = 'mygitnotes:board-camera';
/** Whether this device shows the dashed links written inside notes; on unless turned off. */
export const BOARD_NOTE_LINKS_STORAGE_KEY = 'mygitnotes:board-note-links';
/** The most boards whose camera a device keeps; the oldest saved goes first. */
const KEPT_CAMERAS = 50;

export interface SavedCamera extends Point {
  zoom: number;
}
type Store = Pick<Storage, 'getItem' | 'setItem'> | undefined;

const storage = (): Store => {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
};

function readCameras(store: Store): [string, SavedCamera][] {
  try {
    const value: unknown = JSON.parse(store?.getItem(BOARD_CAMERA_STORAGE_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((entry): entry is [string, SavedCamera] => Array.isArray(entry) && typeof entry[0] === 'string' && [entry[1]?.x, entry[1]?.y, entry[1]?.zoom].every(Number.isFinite)) : [];
  } catch {
    return [];
  }
}

/** The camera this device saved for a board (`notebookId` and path), if any. */
export const readBoardCamera = (board: string, store: Store = storage()): SavedCamera | undefined => readCameras(store).find(([key]) => key === board)?.[1];

/** Saves a board's camera on this device, newest last; a full store drops the oldest. A storage that refuses keeps nothing. */
export function saveBoardCamera(board: string, camera: SavedCamera, store: Store = storage()): void {
  const kept = readCameras(store).filter(([key]) => key !== board);
  const rounded = { x: Math.round(camera.x), y: Math.round(camera.y), zoom: Math.round(camera.zoom * 1000) / 1000 };
  try {
    store?.setItem(BOARD_CAMERA_STORAGE_KEY, JSON.stringify([...kept, [board, rounded]].slice(-KEPT_CAMERAS)));
  } catch { /* A full or blocked storage keeps the previous cameras. */ }
}

export const readBoardNoteLinks = (store: Store = storage()): boolean => {
  try {
    return store?.getItem(BOARD_NOTE_LINKS_STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
};

export function saveBoardNoteLinks(shown: boolean, store: Store = storage()): void {
  try {
    store?.setItem(BOARD_NOTE_LINKS_STORAGE_KEY, shown ? 'on' : 'off');
  } catch { /* The choice holds for this visit. */ }
}

/** The width of a board's side panel on this device, in CSS px. */
export const BOARD_PANEL_WIDTH_STORAGE_KEY = 'mygitnotes:board-panel-width';
export const BOARD_PANEL_WIDTH = { min: 320, max: 960, initial: 440 } as const;
export const clampPanelWidth = (width: number) => Math.round(Math.min(BOARD_PANEL_WIDTH.max, Math.max(BOARD_PANEL_WIDTH.min, width)));

export const readBoardPanelWidth = (store: Store = storage()): number => {
  try {
    const value = Number(store?.getItem(BOARD_PANEL_WIDTH_STORAGE_KEY));
    return value > 0 ? clampPanelWidth(value) : BOARD_PANEL_WIDTH.initial;
  } catch {
    return BOARD_PANEL_WIDTH.initial;
  }
};

export function saveBoardPanelWidth(width: number, store: Store = storage()): void {
  try {
    store?.setItem(BOARD_PANEL_WIDTH_STORAGE_KEY, String(clampPanelWidth(width)));
  } catch { /* The width holds for this visit. */ }
}
