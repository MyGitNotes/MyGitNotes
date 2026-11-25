import { useLayoutEffect, useRef } from 'react';
import type { CompilationRow } from '@mygitnotes/core/compilation';
import type { NoteRef } from '@mygitnotes/core/note-query';
import { addBeside, addNote, type BoardAddition } from '../../lib/board/add.js';
import type { BoardSelectionKey } from '../../lib/board/edit.js';
import type { Point } from '../../lib/board/geometry.js';
import type { PlacedBoard } from '../../lib/board/placement.js';
import { screenToBoard } from '../../lib/board/zoom.js';
import { useTranslation } from '../../lib/i18n/index.js';
import type { NoteItem } from '../../lib/types.js';
import type { BoardCamera } from './useBoardCamera.js';
import type { BoardEditor } from './useBoardEditor.js';

/** What the 卡片 tool asks of the board's host: a blank note for this board, whether new notes start live, and where it opens. */
export interface BoardCardNote {
  /** Creates a blank note (at the notebook root, or in a dynamic board's folder or with its tag) and gives it back. */
  create: () => Promise<NoteItem | undefined>;
  /** New notes of this repository start as pending live notes, with no Git path a board item could name: 卡片 is off. */
  live: boolean;
  /** Opens the new note: in the side panel with its title selected, or where the host opens notes. */
  open: (note: NoteItem) => void;
}

/**
 * How notes join a board: dropped from the 筆記庫 drawer at a point, 「加到白板」 at the viewport's centre (in the
 * selected section, if one is), 「＋N 相連」 beside a card, and the 卡片 tool's new note where it was clicked. A note
 * the board already shows is found instead (centred and selected); a refusal is said by the editor. Each addition
 * is one edit, one undo step. `bind` hands it the editor once it exists, since the editor takes its 卡片 tool from here.
 */
export function useBoardAdding({ row, placed, camera, cardNote }: { row: CompilationRow; placed: PlacedBoard; camera: BoardCamera; cardNote?: BoardCardNote; }) {
  const { t } = useTranslation();
  const editor = useRef<BoardEditor>(undefined);
  const latest = useRef({ row, placed });
  useLayoutEffect(() => {
    latest.current = { row, placed };
  });
  const creating = useRef(false);

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

  const dropAt = (note: NoteRef, at: Point) => commit(addNote(latest.current.row, latest.current.placed, note, { at }));
  /** 「加到白板」: into the selected section, where it auto-places the card, else at the viewport's centre, clear of other cards. */
  const addToBoard = (note: NoteRef) => {
    const section = [...editor.current?.selection ?? []].find(key => key.startsWith('section:'))?.slice('section:'.length);
    const centre = screenToBoard(camera.camera, { x: camera.size.width / 2, y: camera.size.height / 2 });
    commit(addNote(latest.current.row, latest.current.placed, note, section !== undefined ? { section } : { at: centre, clear: true }));
  };
  const addLinked = (cardKey: string, notes: readonly NoteRef[]) => commit(addBeside(latest.current.row, latest.current.placed, cardKey, notes));
  const createCard = async (at: Point) => {
    if (!cardNote || cardNote.live || creating.current) return;
    creating.current = true;
    try {
      const note = await cardNote.create();
      if (!note) return;
      // A dynamic board's new member is auto-placed once its query takes it.
      if (latest.current.row.kind === 'custom') commit(addNote(latest.current.row, latest.current.placed, note, { at }));
      cardNote.open(note);
    } catch (caught) {
      editor.current?.setNotice(caught instanceof Error ? caught.message : String(caught));
    } finally {
      creating.current = false;
    }
  };
  const card = cardNote ? { create: (at: Point) => void createCard(at), ...(cardNote.live ? { off: t('board.cardLive') } : {}) } : undefined;
  return { card, find, dropAt, addToBoard, addLinked, bind: (value: BoardEditor) => editor.current = value };
}
export type BoardAdding = ReturnType<typeof useBoardAdding>;
