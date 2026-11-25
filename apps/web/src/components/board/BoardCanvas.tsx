import { type CSSProperties, useId, useState } from 'react';
import type { CompilationItem } from '@mygitnotes/core/compilation';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import type { BoardElementKey, DrawnArrow, NoteLinkLine } from '../../lib/board/connections.js';
import type { PlacedBoard, PlacedCard } from '../../lib/board/placement.js';
import { arrowLabelsShown, cardDetail, cardTitleStyle, sectionTitleSize } from '../../lib/board/zoom.js';
import { useTranslation } from '../../lib/i18n/index.js';
import { BoardCard, type CardView } from './BoardCard.js';
import { BoardControls } from './BoardControls.js';
import { BoardContextMenu, BoardDialogs, BoardFieldEditor, BoardGestureOverlay } from './BoardEditors.js';
import { BoardArrowLabels, BoardLines } from './BoardLines.js';
import { BoardMinimap } from './BoardMinimap.js';
import { BoardTools } from './BoardTools.js';
import type { BoardCamera } from './useBoardCamera.js';
import type { BoardEditor } from './useBoardEditor.js';

export interface BoardCanvasProps {
  title: string;
  board: PlacedBoard;
  arrows: readonly DrawnArrow[];
  noteLinks: readonly NoteLinkLine[];
  views: ReadonlyMap<string, CardView>;
  descriptions: ReadonlyMap<string, string>;
  arrowTexts: readonly { id: string; text: string; }[];
  phone: boolean;
  showNoteLinks: boolean;
  onNoteLinks: (shown: boolean) => void;
  onOpen: (item: CompilationItem, note?: NoteListItem) => void;
  camera: BoardCamera;
  editor: BoardEditor;
  /** Whether the board is dynamic: its sections come from folders, so the 區塊 tool is off and sections keep their size. */
  dynamic: boolean;
  labels: readonly string[];
  titleOf: (key: BoardElementKey) => string;
}

/**
 * The drawn board: a region labelled with the compilation's title, panned and zoomed by its camera. In the DOM the
 * cards are buttons in item order, inside one group per section labelled with its title, so Tab and a screen reader
 * follow the book's order; free text follows, then the arrows as a list. Lines, labels and the minimap are drawn for
 * the eye only. Zoomed out, the board's CSS shows each card's title only, never under 12 px. On an editable board the
 * tools float at its top left, section titles, texts and arrows take focus, and the selection is marked.
 */
export function BoardCanvas({ title, board, arrows, noteLinks, views, descriptions, arrowTexts, phone, showNoteLinks, onNoteLinks, onOpen, camera, editor, dynamic, labels, titleOf }: BoardCanvasProps) {
  const { t } = useTranslation();
  const ids = useId();
  const [focusedArrow, setFocusedArrow] = useState<string>();
  const { viewport, camera: view, size, ready, animated, zoomStep, fit, centreOn } = camera;
  const { zoom } = view;
  const { editable, selection, draft } = editor;
  const titleStyle = cardTitleStyle(zoom);
  // The dotted grid follows the board, every 24 units, or 48 zoomed out so it stays sparse.
  const gridStep = (zoom < .5 ? 48 : 24) * zoom;
  const layerStyle = { transform: `translate(${view.x}px, ${view.y}px) scale(${zoom})`, '--board-zoom': zoom, '--board-card-title-size': `${titleStyle.fontSize}px`, '--board-card-title-lines': titleStyle.lines, '--board-section-title-size': `${sectionTitleSize(zoom)}px` } as CSSProperties;
  const describedBy = (key: string) => descriptions.get(key) ? `${ids}-d-${key}` : undefined;
  const selected = (key: string) => selection.has(key as BoardElementKey) || undefined;
  const card = (entry: PlacedCard, originX: number, originY: number) => <BoardCard key={entry.key} card={entry} view={views.get(entry.key)!} originX={originX} originY={originY} describedBy={describedBy(entry.key)} selected={selected(`card:${entry.key}`)} onOpen={onOpen} />;
  // Item order: the cards before the first heading stand alone, then each section groups its chapter's cards.
  const free = board.cards.filter(entry => !entry.section);
  const cardsOf = new Map(board.sections.map(section => [section.key, board.cards.filter(entry => entry.section === section.key)]));
  // The element typed in place is hidden under its field.
  const renaming = draft?.kind === 'rename' ? draft.key : undefined, rewriting = draft?.kind === 'text' ? draft.id : undefined;
  const resizable = editable && !dynamic && selection.size === 1 ? board.sections.find(section => selection.has(`section:${section.key}`)) : undefined;
  return (
    <div className='board-stage' data-phone={phone || undefined} data-editable={editable || undefined} data-tool={editable ? editor.tool : undefined} onKeyDown={editor.handlers.onKeyDown} onKeyUp={editor.handlers.onKeyUp} onBlur={editor.handlers.onBlur}>
      <div ref={viewport} role='region' aria-label={title} tabIndex={editable ? -1 : undefined} className='board-viewport' style={{ backgroundSize: `${gridStep}px ${gridStep}px`, backgroundPosition: `${view.x}px ${view.y}px` }} data-ready={ready || undefined} onPointerDown={editor.handlers.onPointerDown} onPointerMove={editor.handlers.onPointerMove} onPointerUp={editor.handlers.onPointerUp} onPointerCancel={editor.handlers.onPointerCancel} onClickCapture={editor.handlers.onClickCapture} onDoubleClick={editor.handlers.onDoubleClick} onContextMenu={editor.handlers.onContextMenu} onFocus={editor.handlers.onFocus} onScroll={editor.handlers.onScroll}>
        <div className='board-layer' style={layerStyle} data-detail={cardDetail(zoom)} data-arrow-labels={arrowLabelsShown(zoom) || undefined} data-animated={animated || undefined}>
          {board.sections.map(section => <div key={section.key} className='board-section-frame' aria-hidden='true' data-selected={selected(`section:${section.key}`)} style={{ left: section.rect.x, top: section.rect.y, width: section.rect.w, height: section.rect.h }} />)}
          <BoardLines noteLinks={showNoteLinks ? noteLinks : []} arrows={arrows} editable={editable} selection={selection} focused={focusedArrow} />
          {free.map(entry => card(entry, 0, 0))}
          {board.sections.map(section => <div key={section.key} role='group' aria-label={section.title} className='board-section' data-board-section={section.key} style={{ left: section.rect.x, top: section.rect.y, width: section.rect.w, height: section.rect.h }}>{editable ? <button type='button' className='board-section-title' data-board-key={`section:${section.key}`} data-selected={selected(`section:${section.key}`)} data-editing={renaming === section.key || undefined} aria-label={t('board.sectionTitle', { title: section.title })}>{section.title}</button> : <span className='board-section-title' aria-hidden='true'>{section.title}</span>}{cardsOf.get(section.key)!.map(entry => card(entry, section.rect.x, section.rect.y))}</div>)}
          {board.texts.length > 0 && (
            <div className='board-texts' role='group' aria-label={t('board.texts')}>
              {board.texts.map(text => {
                const props = { className: text.color ? `board-text board-text-tone-${text.color}` : 'board-text', 'data-board-text': text.id, 'data-color': text.color, style: { left: text.rect.x, top: text.rect.y, width: text.rect.w } };
                return editable ? <button key={text.id} type='button' {...props} data-board-key={`text:${text.id}`} data-selected={selected(`text:${text.id}`)} data-editing={rewriting === text.id || undefined}>{text.text}</button> : <p key={text.id} {...props}>{text.text}</p>;
              })}
            </div>
          )}
          <BoardArrowLabels arrows={arrows} editable={editable} selection={selection} />
          {resizable && <div className='board-resize' data-board-resize={resizable.key} aria-hidden='true' style={{ left: resizable.rect.x + resizable.rect.w, top: resizable.rect.y + resizable.rect.h }} />}
          <BoardGestureOverlay overlay={editor.overlay} />
        </div>
        {arrowTexts.length > 0 && (editable
          ? (
            <ul className='sr-only' aria-label={t('board.arrows')}>
              {arrowTexts.map(arrow => (
                <li key={arrow.id}>
                  <button
                    type='button'
                    data-board-key={`arrow:${arrow.id}`}
                    aria-label={t('board.arrowItem', { text: arrow.text })}
                    aria-pressed={selection.has(`arrow:${arrow.id}`)}
                    onFocus={() => setFocusedArrow(arrow.id)}
                    onBlur={() => setFocusedArrow(undefined)}
                  >
                    {arrow.text}
                  </button>
                </li>
              ))}
            </ul>
          )
          : <ul className='sr-only' aria-label={t('board.arrows')}>{arrowTexts.map(arrow => <li key={arrow.id}>{arrow.text}</li>)}</ul>)}
        <div hidden>{[...descriptions].map(([key, text]) => <span key={key} id={`${ids}-d-${key}`}>{text}</span>)}</div>
      </div>
      {editable && <BoardTools editor={editor} dynamic={dynamic} />}
      {editable && <BoardFieldEditor editor={editor} board={board} arrows={arrows} camera={view} labels={labels} />}
      {editable && <BoardContextMenu editor={editor} />}
      {editable && <BoardDialogs editor={editor} board={board} titleOf={titleOf} dynamic={dynamic} />}
      {editor.notice && <p role='status' className='board-notice'>{editor.notice}</p>}
      {editable && <p className='sr-only' aria-live='polite'>{selection.size ? t('board.selected', { count: String(selection.size) }) : ''}</p>}
      <BoardControls zoom={zoom} noteLinks={showNoteLinks} onNoteLinks={onNoteLinks} onZoom={zoomStep} onFit={fit} />
      {!phone && <BoardMinimap board={board} camera={view} size={size} onCentre={centreOn} />}
    </div>
  );
}
