import { type CSSProperties, memo, useId } from 'react';
import type { CompilationItem } from '@mygitnotes/core/compilation';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import type { DrawnArrow, NoteLinkLine } from '../../lib/board/connections.js';
import type { PlacedBoard, PlacedCard } from '../../lib/board/placement.js';
import { arrowLabelsShown, cardDetail, cardTitleStyle, sectionTitleSize } from '../../lib/board/zoom.js';
import { useTranslation } from '../../lib/i18n/index.js';
import { BoardCard, type CardView } from './BoardCard.js';
import { BoardControls } from './BoardControls.js';
import { BoardArrowLabels, BoardLines } from './BoardLines.js';
import { BoardMinimap } from './BoardMinimap.js';
import { useBoardCamera } from './useBoardCamera.js';

export interface BoardCanvasProps {
  /** The board's key on this device (notebook and path), under which its camera is saved. */
  boardKey: string;
  title: string;
  board: PlacedBoard;
  arrows: readonly DrawnArrow[];
  noteLinks: readonly NoteLinkLine[];
  views: ReadonlyMap<string, CardView>;
  descriptions: ReadonlyMap<string, string>;
  arrowTexts: readonly { id: string; text: string; }[];
  /** Whether every card is known, so the camera's first fit sees the whole board. */
  loaded: boolean;
  phone: boolean;
  showNoteLinks: boolean;
  onNoteLinks: (shown: boolean) => void;
  onOpen: (item: CompilationItem, note?: NoteListItem) => void;
}

/**
 * The drawn board: a region labelled with the compilation's title, panned and zoomed by its camera. In the DOM the
 * cards are buttons in item order, inside one group per section labelled with its title, so Tab and a screen reader
 * follow the book's order; free text follows, then the arrows as a list. Lines, labels and the minimap are drawn for
 * the eye only. Zoomed out, the board's CSS shows each card's title only, never under 12 px.
 */
export const BoardCanvas = memo(function BoardCanvas({ boardKey, title, board, arrows, noteLinks, views, descriptions, arrowTexts, loaded, phone, showNoteLinks, onNoteLinks, onOpen }: BoardCanvasProps) {
  const { t } = useTranslation();
  const ids = useId();
  const { viewport, camera, size, ready, animated, zoomStep, fit, centreOn, handlers } = useBoardCamera({ board: boardKey, bounds: board.bounds, loaded });
  const { zoom } = camera;
  const titleStyle = cardTitleStyle(zoom);
  // The dotted grid follows the board, every 24 units, or 48 zoomed out so it stays sparse.
  const gridStep = (zoom < .5 ? 48 : 24) * zoom;
  const layerStyle = { transform: `translate(${camera.x}px, ${camera.y}px) scale(${zoom})`, '--board-card-title-size': `${titleStyle.fontSize}px`, '--board-card-title-lines': titleStyle.lines, '--board-section-title-size': `${sectionTitleSize(zoom)}px` } as CSSProperties;
  const describedBy = (key: string) => descriptions.get(key) ? `${ids}-d-${key}` : undefined;
  const card = (entry: PlacedCard, originX: number, originY: number) => <BoardCard key={entry.key} card={entry} view={views.get(entry.key)!} originX={originX} originY={originY} describedBy={describedBy(entry.key)} onOpen={onOpen} />;
  // Item order: the cards before the first heading stand alone, then each section groups its chapter's cards.
  const free = board.cards.filter(entry => !entry.section);
  const cardsOf = new Map(board.sections.map(section => [section.key, board.cards.filter(entry => entry.section === section.key)]));
  return (
    <div className='board-stage' data-phone={phone || undefined}>
      <div ref={viewport} role='region' aria-label={title} className='board-viewport' style={{ backgroundSize: `${gridStep}px ${gridStep}px`, backgroundPosition: `${camera.x}px ${camera.y}px` }} data-ready={ready || undefined} {...handlers}>
        <div className='board-layer' style={layerStyle} data-detail={cardDetail(zoom)} data-arrow-labels={arrowLabelsShown(zoom) || undefined} data-animated={animated || undefined}>
          {board.sections.map(section => <div key={section.key} className='board-section-frame' aria-hidden='true' style={{ left: section.rect.x, top: section.rect.y, width: section.rect.w, height: section.rect.h }} />)}
          <BoardLines noteLinks={showNoteLinks ? noteLinks : []} arrows={arrows} />
          {free.map(entry => card(entry, 0, 0))}
          {board.sections.map(section => (
            <div key={section.key} role='group' aria-label={section.title} className='board-section' data-board-section={section.key} style={{ left: section.rect.x, top: section.rect.y, width: section.rect.w, height: section.rect.h }}>
              <span className='board-section-title' aria-hidden='true'>{section.title}</span>
              {cardsOf.get(section.key)!.map(entry => card(entry, section.rect.x, section.rect.y))}
            </div>
          ))}
          {board.texts.length > 0 && <div className='board-texts' role='group' aria-label={t('board.texts')}>{board.texts.map(text => <p key={text.id} className={text.color ? `board-text board-text-tone-${text.color}` : 'board-text'} data-board-text={text.id} data-color={text.color} style={{ left: text.rect.x, top: text.rect.y, width: text.rect.w }}>{text.text}</p>)}</div>}
          <BoardArrowLabels arrows={arrows} />
        </div>
        {arrowTexts.length > 0 && <ul className='sr-only' aria-label={t('board.arrows')}>{arrowTexts.map(arrow => <li key={arrow.id}>{arrow.text}</li>)}</ul>}
        <div hidden>{[...descriptions].map(([key, text]) => <span key={key} id={`${ids}-d-${key}`}>{text}</span>)}</div>
      </div>
      <BoardControls zoom={zoom} noteLinks={showNoteLinks} onNoteLinks={onNoteLinks} onZoom={zoomStep} onFit={fit} />
      {!phone && <BoardMinimap board={board} camera={camera} size={size} onCentre={centreOn} />}
    </div>
  );
});
