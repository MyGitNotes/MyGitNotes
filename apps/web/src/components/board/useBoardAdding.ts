import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CompilationRow } from '@mygitnotes/core/compilation';
import { type AddableNote, addBeside, addNote, addRefusal, type BoardAddition } from '../../lib/board/add.js';
import type { BoardSelectionKey } from '../../lib/board/edit.js';
import type { Point } from '../../lib/board/geometry.js';
import type { PlacedBoard } from '../../lib/board/placement.js';
import { screenToBoard } from '../../lib/board/zoom.js';
import { useTranslation } from '../../lib/i18n/index.js';
import type { BoardNoteReceipt } from '../../lib/compilation-actions.js';
import type { NoteItem } from '../../lib/types.js';
import type { BoardCamera } from './useBoardCamera.js';
import type { BoardEditor } from './useBoardEditor.js';

/** What the 卡片 tool asks of the board's host: a blank note for this board, whether new notes start live, and where it opens. */
export interface BoardCardNote {
  /** Creates a blank note (at the notebook root, or in a dynamic board's folder or with its tag): the note, and how to take it away again. */
  create: () => Promise<BoardNoteReceipt>;
  /** New notes of this repository start as pending live notes, with no Git path a board item could name: 卡片 is off. */
  live: boolean;
  /** Opens the new note: in the side panel with its title selected, or where the host opens notes. */
  open: (note: NoteItem) => void;
  /** Writes the board's pending edits now; false when the write failed. */
  save: () => Promise<boolean>;
}

/**
 * How notes join a board: dropped from the 筆記庫 drawer at a point, 「加到白板」 at the viewport's centre (in the
 * selected section, if one is), 「＋N 相連」 beside a card, and the 卡片 tool's new note where it was clicked. A note
 * the board already shows is found instead (centred and selected); a refusal is said by the editor. Each addition
 * is one edit, one undo step. `bind` hands it the editor once it exists, since the editor takes its 卡片 tool from here.
 *
 * The 卡片 tool asks first whether the board can take one more item, then creates the note, places it and writes the
 * board at once; only once the board holds it does the note open. A note the board could not take (refused, its
 * write failed, or the board went away meanwhile) is rolled back. From its placing until that write settles the board
 * takes no other edit (`held` says why), so no later write can carry the new card past a rollback.
 */
export function useBoardAdding({ row, placed, camera, cardNote }: { row: CompilationRow; placed: PlacedBoard; camera: BoardCamera; cardNote?: BoardCardNote; }) {
  const { t } = useTranslation();
  const editor = useRef<BoardEditor>(undefined);
  const latest = useRef({ row, placed });
  useLayoutEffect(() => {
    latest.current = { row, placed };
  });
  const creating = useRef(false);
  // Set while the 卡片 tool's card waits for its write; `admitting` lets its own placing through.
  const [holding, setHolding] = useState(false);
  const hold = useRef(false), admitting = useRef(false);
  const held = () => hold.current && !admitting.current ? t('board.cardSaving') : undefined;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Centres a card and selects it, the keyboard landing on it once the camera has drawn it there. */
  const find = (key: string) => {
    const card = latest.current.placed.cards.find(candidate => candidate.key === key);
    if (!card) return;
    camera.centreOn({ x: card.rect.x + card.rect.w / 2, y: card.rect.y + card.rect.h / 2 });
    editor.current?.setSelection(new Set([`card:${key}` as const]));
    requestAnimationFrame(() => [...camera.viewport.current?.querySelectorAll<HTMLElement>('[data-board-key]') ?? []].find(element => element.dataset.boardKey === `card:${key}`)?.focus({ preventScroll: true }));
  };
  /** Writes an addition, selecting what it added; a note already on the board is found instead. */
  const commit = (result: BoardAddition) => {
    if (result.found) return find(result.found);
    if (editor.current?.apply(result) && result.added.length) editor.current.setSelection(new Set(result.added.map(id => `card:${id}` as BoardSelectionKey)));
  };

  const dropAt = (note: AddableNote, at: Point) => commit(addNote(latest.current.row, latest.current.placed, note, { at }));
  /** 「加到白板」: at the viewport's centre, clear of other cards, in the selected section's chapter, else in the one the centre lands in. */
  const addToBoard = (note: AddableNote) => {
    const section = [...editor.current?.selection ?? []].find(key => key.startsWith('section:'))?.slice('section:'.length);
    const centre = screenToBoard(camera.camera, { x: camera.size.width / 2, y: camera.size.height / 2 });
    commit(addNote(latest.current.row, latest.current.placed, note, { at: centre, clear: true, ...(section !== undefined ? { section } : {}) }));
  };
  const addLinked = (cardKey: string, notes: readonly AddableNote[]) => commit(addBeside(latest.current.row, latest.current.placed, cardKey, notes));
  const createCard = async (at: Point) => {
    if (!cardNote || cardNote.live || creating.current) return;
    const custom = latest.current.row.kind === 'custom';
    const refused = custom ? addRefusal(latest.current.row, 1) : undefined;
    if (refused) return void editor.current?.apply({ row: latest.current.row, refused });
    creating.current = true;
    try {
      const { note, rollback } = await cardNote.create();
      // A dynamic board's new member is auto-placed once its query takes it.
      const kept = !custom || (mounted.current && placeNew(note, at) && await cardNote.save());
      if (!kept) {
        await rollback();
        return;
      }
      if (mounted.current) cardNote.open(note);
    } catch (caught) {
      if (mounted.current) editor.current?.setNotice(caught instanceof Error ? caught.message : String(caught));
    } finally {
      creating.current = false;
      hold.current = false;
      if (mounted.current) setHolding(false);
    }
  };
  /** Places the 卡片 tool's note where it was clicked, holding other edits off until it is written; false when the board did not take it. */
  const placeNew = (note: NoteItem, at: Point) => {
    const result = addNote(latest.current.row, latest.current.placed, note, { at });
    hold.current = true;
    setHolding(true);
    admitting.current = true;
    const applied = Boolean(editor.current?.apply(result));
    admitting.current = false;
    if (!applied || !result.added.length) return false;
    editor.current!.setSelection(new Set(result.added.map(id => `card:${id}` as BoardSelectionKey)));
    return true;
  };
  const card = cardNote ? { create: (at: Point) => void createCard(at), ...(cardNote.live ? { off: t('board.cardLive') } : {}) } : undefined;
  return { card, find, dropAt, addToBoard, addLinked, held, holding, bind: (value: BoardEditor) => editor.current = value };
}
export type BoardAdding = ReturnType<typeof useBoardAdding>;
