import { type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BOARD_MAX_ARROWS, BOARD_MAX_SECTIONS, BOARD_MAX_TEXTS, type BoardText, type CompilationRow } from '@mygitnotes/core/compilation';
import type { BoardElementKey } from '../../lib/board/connections.js';
import { addArrow, addText, type BoardEdit, boardId, type BoardRefusal, type BoardSelectionKey, createSection, editText, endOf, labelArrow, moveSelection, removeSelection, renameSection, setTextColor, splitKey } from '../../lib/board/edit.js';
import type { Point, Rect } from '../../lib/board/geometry.js';
import { type BoardHistory, emptyHistory, recordStep, redoStep, undoStep } from '../../lib/board/history.js';
import type { PlacedBoard } from '../../lib/board/placement.js';
import { writableCompilationText } from '../../lib/compilation-rows.js';
import { useTranslation } from '../../lib/i18n/index.js';
import type { BoardCamera } from './useBoardCamera.js';
import { type BoardGestures, useBoardPointer } from './useBoardPointer.js';

export type BoardTool = 'select' | 'card' | 'text' | 'section' | 'arrow';
/** An element being titled, written or labelled in place: the board writes it once, when the field is left. */
export type BoardDraft = { kind: 'section'; id: string; rect: Rect; title: string; } | { kind: 'rename'; key: string; title: string; } | { kind: 'text'; id: string; x: number; y: number; text: string; existing: boolean; } | { kind: 'label'; id: string; label: string; existing: boolean; from?: BoardElementKey; to?: BoardElementKey; };

/** One arrow-key press moves the selection this far, with Shift farther; the run writes once the keys rest this long. */
const NUDGE = 8, NUDGE_FAR = 40, NUDGE_SETTLE = 400;
const NOTICE_TIME = 5000;
type Nudge = { keys: BoardSelectionKey[]; dx: number; dy: number; };
const ARROW_KEYS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** Whether a key event comes from a field typing text, whose keys are its own. */
export const typing = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
/** The board element a DOM node belongs to: a card, a section's title, a text or an arrow, by `data-board-key`. */
export const boardKeyOf = (target: EventTarget | null): BoardSelectionKey | undefined => target instanceof Element ? target.closest('[data-board-key]')?.getAttribute('data-board-key') as BoardSelectionKey | undefined ?? undefined : undefined;

export interface BoardEditorInput {
  row: CompilationRow;
  placed: PlacedBoard;
  /** Lays out any row as `placed` lays out `row`, for the board an edit would draw. */
  place: (row: CompilationRow) => PlacedBoard;
  editable: boolean;
  onChange?: (row: CompilationRow) => void;
  camera: BoardCamera;
  /** The 卡片 tool: what a click with it does (creates a note there), or why it is off; without it the board has no 卡片. */
  card?: { create: (at: Point) => void; off?: string; };
}

/**
 * The editing state of one board for this visit: the tool, the selection, the gesture or keyboard nudge under way
 * (drawn as a preview row, written once it ends), the element being titled or labelled in place, removals waiting
 * for confirmation, and the undo stack. Each gesture becomes one `onChange`, so the compilation file is written
 * once per gesture. Without `editable` it only passes the camera's pointer handlers through.
 */
export function useBoardEditor({ row, placed, place, editable, onChange, camera, card }: BoardEditorInput) {
  const { t } = useTranslation();
  const [tool, setToolState] = useState<{ tool: BoardTool; sticky: boolean; }>({ tool: 'select', sticky: false });
  const [selection, setSelection] = useState<ReadonlySet<BoardSelectionKey>>(new Set());
  const [gesturePreview, setGesturePreview] = useState<CompilationRow>();
  const [nudge, setNudgeState] = useState<Nudge>();
  // The run as last set, so the write that ends it happens once, whichever of the timer, a press or a blur ends it.
  const nudgeRef = useRef<Nudge>(undefined);
  const setNudge = (next: Nudge | undefined) => {
    nudgeRef.current = next;
    setNudgeState(next);
  };
  const [draft, setDraftState] = useState<BoardDraft>();
  // The draft as last set, so a field's Enter and the blur that follows it write once.
  const draftRef = useRef<BoardDraft>(undefined);
  const setDraft = (next: BoardDraft | undefined) => {
    draftRef.current = next;
    setDraftState(next);
  };
  const [picker, setPicker] = useState<BoardElementKey>();
  const [menu, setMenu] = useState<{ key: BoardSelectionKey; x: number; y: number; }>();
  const [confirm, setConfirm] = useState<BoardSelectionKey[]>();
  const [notice, setNotice] = useState('');
  // The undo stack belongs to this visit of this board; another board starts over.
  const [history, setHistory] = useState<{ board: string; steps: BoardHistory; }>({ board: row.path, steps: emptyHistory });
  const steps = history.board === row.path ? history.steps : emptyHistory;
  const latest = useRef({ row, placed, steps });
  useLayoutEffect(() => {
    latest.current = { row, placed, steps };
  });

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), NOTICE_TIME);
    return () => clearTimeout(timer);
  }, [notice]);

  const refusal = (reason: BoardRefusal) => {
    switch (reason) {
      case 'dynamicSections':
      case 'folderSection':
        return t('board.dynamicSections');
      case 'arrowEnds':
        return t('board.arrowEnds');
      case 'sectionLimit':
        return t('board.sectionLimit', { limit: String(BOARD_MAX_SECTIONS) });
      case 'textLimit':
        return t('board.textLimit', { limit: String(BOARD_MAX_TEXTS) });
      case 'arrowLimit':
        return t('board.arrowLimit', { limit: String(BOARD_MAX_ARROWS) });
      case 'itemLimit':
        return t('screen.limit');
      case 'dynamicItems':
        return t('board.dynamicItems');
    }
  };
  /** Writes one gesture's edit and records it as one undo step; a refusal is said. Returns whether the row changed. */
  const apply = (edit: BoardEdit): boolean => {
    setNotice(edit.refused ? refusal(edit.refused) : '');
    const current = latest.current.row;
    if (edit.row === current || !onChange) return false;
    // A row whose file would not open again (past a limit) is not written, and is no step to undo.
    try {
      writableCompilationText(edit.row);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : String(caught));
      return false;
    }
    setHistory(previous => ({ board: current.path, steps: recordStep(previous.board === current.path ? previous.steps : emptyHistory, current, edit.row) }));
    onChange(edit.row);
    return true;
  };
  const travel = (direction: 'undo' | 'redo') => {
    const current = latest.current.row;
    const step = (direction === 'undo' ? undoStep : redoStep)(latest.current.steps, current);
    if (!step || !onChange) return;
    if ('stale' in step) {
      setHistory({ board: current.path, steps: emptyHistory });
      return setNotice(t('board.historyStale'));
    }
    setHistory({ board: current.path, steps: step.history });
    setNotice('');
    onChange(step.row);
  };

  const setTool = (next: BoardTool, sticky = false) => {
    if (next === 'card' && card?.off) return setNotice(card.off);
    setToolState({ tool: next, sticky });
    setNotice('');
  };
  /** After one use a tool returns to 選取, unless it was double-clicked. */
  const used = () => setToolState(current => current.sticky ? current : { tool: 'select', sticky: false });

  // A keyboard nudge run is drawn as it goes and written once the keys rest.
  const nudgeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flushNudge = () => {
    clearTimeout(nudgeTimer.current);
    const run = nudgeRef.current;
    if (!run) return false;
    setNudge(undefined);
    apply(moveSelection(latest.current.row, latest.current.placed, run.keys, run.dx, run.dy));
    return true;
  };
  useEffect(() => () => clearTimeout(nudgeTimer.current), []);
  // A press anywhere else (the arrangement switch, another pane) writes the run first, so leaving never drops it.
  const flushRef = useRef(flushNudge);
  useLayoutEffect(() => {
    flushRef.current = flushNudge;
  });
  // A nudge that carries the focused card into another section draws it in that section's group, a new element; the
  // keyboard stays on it, until a press or Tab moves the focus on.
  const refocus = useRef<BoardSelectionKey>(undefined);
  useLayoutEffect(() => {
    const key = refocus.current, root = camera.viewport.current;
    const active = document.activeElement;
    if (!key || !root || (active && active !== document.body && root.contains(active))) return;
    root.querySelector<HTMLElement>(`[data-board-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
  });
  const nudging = nudge !== undefined;
  useEffect(() => {
    if (!nudging) return;
    const press = () => flushRef.current();
    document.addEventListener('pointerdown', press, true);
    return () => document.removeEventListener('pointerdown', press, true);
  }, [nudging]);
  const settleNudge = () => {
    clearTimeout(nudgeTimer.current);
    nudgeTimer.current = setTimeout(flushNudge, NUDGE_SETTLE);
  };

  const startDraft = (next: BoardDraft) => {
    setPicker(undefined);
    setDraft(next);
  };
  const newSection = (rect: Rect) => startDraft({ kind: 'section', id: boardId(row), rect, title: t('board.newSection') });
  const newText = (x: number, y: number) => startDraft({ kind: 'text', id: boardId(row), x, y, text: '', existing: false });
  const newArrow = (from: BoardElementKey, to: BoardElementKey) => {
    if (!endOf(row, placed, from) || !endOf(row, placed, to) || from === to) return setNotice(t('board.arrowEnds'));
    if ((row.board?.arrows?.length ?? 0) >= BOARD_MAX_ARROWS) return setNotice(refusal('arrowLimit'));
    startDraft({ kind: 'label', id: boardId(row), label: '', existing: false, from, to });
  };
  /** Opens the element under a key for typing in place: a section's title, a text, an arrow's label. */
  const edit = (key: BoardSelectionKey) => {
    const { kind, id } = splitKey(key);
    if (kind === 'section' && row.kind === 'custom') {
      const section = placed.sections.find(candidate => candidate.key === id);
      if (section) startDraft({ kind: 'rename', key: id, title: section.title });
    } else if (kind === 'section') setNotice(t('board.dynamicSections'));
    else if (kind === 'text') {
      const text = placed.texts.find(candidate => candidate.id === id);
      if (text) startDraft({ kind: 'text', id, x: text.x, y: text.y, text: text.text, existing: true });
    } else if (kind === 'arrow') {
      const arrow = row.board?.arrows?.find(candidate => candidate.id === id);
      if (arrow) startDraft({ kind: 'label', id, label: arrow.label ?? '', existing: true });
    }
  };
  /** Ends typing in place: writes the element (a new section, text or arrow, or the change to one) as one edit. */
  const commitDraft = () => {
    const value = draftRef.current;
    if (!value) return;
    setDraft(undefined);
    if (apply(draftEdit(latest.current.row, latest.current.placed, value, t('board.newSection'))) && value.kind === 'section') setSelection(new Set<BoardSelectionKey>([`section:${value.id}`]));
  };

  const requestRemove = (keys: readonly BoardSelectionKey[] = [...selection]) => {
    if (!keys.length) return;
    // A section's heading is a chapter: deleting it asks first, its cards staying on the board.
    if (row.kind === 'custom' && keys.some(key => key.startsWith('section:'))) return setConfirm([...keys]);
    apply(removeSelection(row, placed, keys));
    setSelection(new Set());
  };
  const confirmRemove = () => {
    if (confirm) apply(removeSelection(row, placed, confirm));
    setConfirm(undefined);
    setSelection(new Set());
  };
  const linkable = (key: BoardSelectionKey | undefined): key is BoardElementKey => Boolean(key && !key.startsWith('arrow:') && endOf(row, placed, key as BoardElementKey));
  const openPicker = (key = selection.size === 1 ? [...selection][0] : undefined) => {
    if (linkable(key)) setPicker(key);
    else setNotice(t('board.linkNeedsOne'));
  };
  const recolor = (value: BoardText['color'] | undefined) => {
    const [key] = selection;
    if (selection.size === 1 && key.startsWith('text:')) apply(setTextColor(row, splitKey(key).id, value));
  };

  const gestures: BoardGestures = useBoardPointer({ row, placed, editable, camera, tool: tool.tool, selection, setSelection, setPreview: setGesturePreview, apply, used, newSection, newText, newArrow, newCard: point => card && !card.off && card.create(point), edit, openMenu: (key, at) => setMenu({ key, ...at }), flushNudge, busy: Boolean(draft || confirm || picker || menu) });

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!editable || typing(event.target) || draft || confirm || picker || menu) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const mod = event.metaKey || event.ctrlKey;
    const target = boardKeyOf(event.target);
    const consume = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    const direction = ARROW_KEYS[event.key];
    if (direction && !mod) {
      const keys = selection.size ? [...selection] : target && !target.startsWith('arrow:') ? [target] : [];
      if (!keys.length) return;
      consume();
      if (target) refocus.current = target;
      const step = event.shiftKey ? NUDGE_FAR : NUDGE;
      const current = nudgeRef.current;
      setNudge({ keys: current?.keys ?? keys, dx: (current?.dx ?? 0) + direction[0] * step, dy: (current?.dy ?? 0) + direction[1] * step });
      settleNudge();
      return;
    }
    // Any other edit first writes the nudge run under way; the key that ended it does nothing more.
    const other = (mod && ['z', 'y', 'l'].includes(key)) || key === 'Delete' || key === 'Backspace';
    if (other && nudgeRef.current) {
      consume();
      flushNudge();
      return;
    }
    if (mod && key === 'z') {
      consume();
      travel(event.shiftKey ? 'redo' : 'undo');
    } else if (mod && key === 'y') {
      consume();
      travel('redo');
    } else if (mod && event.shiftKey && key === 'l') {
      consume();
      openPicker(selection.size === 1 ? [...selection][0] : target);
    } else if (key === 'Escape') {
      if (selection.size) setSelection(new Set());
      else if (tool.tool !== 'select') setTool('select');
      else return;
      consume();
    } else if (key === 'Delete' || key === 'Backspace') {
      const keys = selection.size ? [...selection] : target ? [target] : [];
      if (!keys.length) return;
      consume();
      requestRemove(keys);
    } else if (key === ' ' && target) {
      // Space toggles a focused element's selection; it does not press the card.
      consume();
      if (!event.repeat) setSelection(current => toggled(current, target));
    } else if ((key === 'Enter' || key === 'F2') && target && !target.startsWith('card:')) {
      consume();
      edit(target);
    }
  };
  const onKeyUp = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!editable || typing(event.target)) return;
    if (event.key === ' ' && boardKeyOf(event.target)) event.preventDefault();
    if (ARROW_KEYS[event.key] && nudgeRef.current) settleNudge();
  };
  // Focus leaving the board (Tab to the header) writes the nudge run under way.
  const onBlur = (event: ReactFocusEvent<HTMLElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    refocus.current = undefined;
    flushNudge();
  };
  const onPointerDown: typeof gestures.handlers.onPointerDown = event => {
    refocus.current = undefined;
    gestures.handlers.onPointerDown(event);
  };

  // What the board draws: the gesture or nudge under way, or the element being created, over the stored row.
  const newTitle = t('board.newSection');
  const draftPreview = useMemo(() => {
    if (draft?.kind !== 'section' && !(draft?.kind === 'label' && !draft.existing)) return undefined;
    const result = draftEdit(row, placed, draft, newTitle).row;
    return result === row ? undefined : result;
  }, [draft, row, placed, newTitle]);
  const nudgePreview = useMemo(() => nudge ? moveSelection(row, placed, nudge.keys, nudge.dx, nudge.dy, { preview: true }).row : undefined, [nudge, row, placed]);
  const preview = gesturePreview ?? nudgePreview ?? draftPreview;
  const previewBoard = useMemo(() => preview ? place(preview) : undefined, [preview, place]);

  return { editable, apply, setNotice, card, tool: tool.tool, sticky: tool.sticky, setTool, selection, setSelection, preview, previewBoard, overlay: gestures.overlay, draft, setDraft, commitDraft, cancelDraft: () => setDraft(undefined), focusBoard: () => camera.viewport.current?.focus({ preventScroll: true }), picker, closePicker: () => setPicker(undefined), pick: (to: BoardElementKey) => picker && newArrow(picker, to), openPicker, linkable, menu, closeMenu: () => setMenu(undefined), canLink: selection.size === 1 && linkable([...selection][0]), confirm, confirmRemove, cancelRemove: () => setConfirm(undefined), requestRemove, recolor, notice, canUndo: steps.past.length > 0, canRedo: steps.future.length > 0, undo: () => travel('undo'), redo: () => travel('redo'), handlers: { ...gestures.handlers, onPointerDown, onKeyDown, onKeyUp, onBlur } };
}
export type BoardEditor = ReturnType<typeof useBoardEditor>;

/** The edit a finished draft makes: a new section, a rename, a new or rewritten text, a new or relabelled arrow. */
function draftEdit(row: CompilationRow, placed: PlacedBoard, value: BoardDraft, newTitle: string): BoardEdit {
  switch (value.kind) {
    case 'section':
      return createSection(row, placed, value.rect, { id: value.id, title: value.title.trim() || newTitle });
    case 'rename':
      return renameSection(row, value.key, value.title);
    case 'text':
      return value.existing ? editText(row, value.id, value.text) : addText(row, { id: value.id, x: value.x, y: value.y, text: value.text });
    case 'label': {
      if (value.existing) return labelArrow(row, value.id, value.label);
      const from = endOf(row, placed, value.from!), to = endOf(row, placed, value.to!);
      return from && to ? addArrow(row, { id: value.id, from, to, label: value.label }) : { row, refused: 'arrowEnds' };
    }
  }
}

export const toggled = (set: ReadonlySet<BoardSelectionKey>, key: BoardSelectionKey): Set<BoardSelectionKey> => {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
};
