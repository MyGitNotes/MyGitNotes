import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from '../../lib/i18n/index.js';
import { type Box, type NearbyHeadings, placePopover, type PopoverPlacement, type RailWidthMode } from '../../lib/overview-rail/layout.js';

interface RailPopoverProps {
  mode: RailWidthMode;
  nearby: NearbyHeadings;
  /** The page or block the active heading lies in, or null in a note without pages. */
  section: string | null;
  dragging: boolean;
  /** The rail as drawn and the editor's column, in viewport coordinates, and the pointer's height. */
  rail: Box;
  column: Box;
  pointerY: number;
  onChoose: (line: number) => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}

interface Connector {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface Placed extends PopoverPlacement {
  connectors: Connector[];
}

const samePlace = (a: Placed | null, b: Placed) => Boolean(a) && a!.left === b.left && a!.top === b.top && a!.side === b.side && a!.connectors.length === b.connectors.length && a!.connectors.every((line, index) => line.y1 === b.connectors[index].y1 && line.y2 === b.connectors[index].y2 && line.x1 === b.connectors[index].x1);

/**
 * The headings near the pointer on the rail. Hovering previews them and a click on one goes there; while the rail is dragged they are
 * spread out with a line from each mark to its row, the target marked, and nothing moves until the release.
 */
export function RailPopover({ mode, nearby, section, dragging, rail, column, pointerY, onChoose, onPointerEnter, onPointerLeave }: RailPopoverProps) {
  const { t } = useTranslation();
  const box = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<Placed | null>(null);
  const active = nearby.items[nearby.active];
  const shallowest = Math.min(...nearby.items.map(item => item.depth));
  // Measured after each render: the popover's size and its active row decide where it goes, and a drag's lines end at its rows.
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const rows = [...element.querySelectorAll<HTMLElement>('[data-rail-row]')];
    const row = rows[nearby.active];
    const place = placePopover({ mode, rail, column, viewport: { width: window.innerWidth, height: window.innerHeight }, size: { width: element.offsetWidth, height: element.offsetHeight }, anchorY: pointerY, anchorOffset: row ? row.offsetTop + row.offsetHeight / 2 : element.offsetHeight / 2 });
    const from = place.side === 'outside' ? rail.right : rail.left, to = place.side === 'outside' ? place.left : place.left + element.offsetWidth;
    const connectors = dragging ? nearby.items.map((item, index) => ({ x1: from, y1: rail.top + item.top, x2: to, y2: place.top + rows[index].offsetTop + rows[index].offsetHeight / 2 })) : [];
    const next = { ...place, connectors };
    setPlaced(previous => samePlace(previous, next) ? previous : next);
  });
  return createPortal(
    <>
      {placed && placed.connectors.length > 0 && <svg className='overview-rail-connectors' aria-hidden='true'>{placed.connectors.map((line, index) => <line key={index} data-active={index === nearby.active || undefined} {...line} />)}</svg>}
      <div ref={box} className='overview-rail-popover' data-side={placed?.side} data-dragging={dragging || undefined} style={{ left: placed?.left ?? 0, top: placed?.top ?? 0, visibility: placed ? 'visible' : 'hidden' }} onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave} onMouseDown={event => event.preventDefault()}>
        <div className='overview-rail-popover-head'>
          <span>{t(dragging ? 'editor.overviewDragging' : 'editor.overviewNearby')}</span>
          {section && (
            <>
              <span aria-hidden='true'>/</span>
              <span>{section}</span>
            </>
          )}
        </div>
        <ul>
          {nearby.items.map((item, index) => (
            <li key={item.index}>
              <button
                type='button'
                data-rail-row
                data-active={index === nearby.active || undefined}
                tabIndex={-1}
                onClick={() => onChoose(item.line)}
              >
                <span className='overview-rail-depth'>
                  {dragging && index === nearby.active
                    ? (
                      <svg viewBox='0 0 8 8' aria-hidden='true'>
                        <path d='M1 0.5 L7.5 4 L1 7.5 Z' />
                      </svg>
                    )
                    : `H${item.depth}`}
                </span>
                <span className='overview-rail-label' style={{ paddingLeft: (item.depth - shallowest) * 10 }}>{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className='overview-rail-popover-foot'>{dragging ? t('editor.overviewReleaseHint', { heading: active.label }) : t('editor.overviewClickHint')}</p>
      </div>
    </>,
    document.body,
  );
}
