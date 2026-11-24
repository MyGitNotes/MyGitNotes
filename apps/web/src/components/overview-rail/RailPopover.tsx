import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from '../../lib/i18n/index.js';
import { type Box, type NearbyHeadings, placePopover, type PopoverPlacement, type RailWidthMode } from '../../lib/overview-rail/layout.js';

interface RailPopoverProps {
  mode: RailWidthMode;
  nearby: NearbyHeadings;
  /** The page or block the active heading lies in, or null in a note without pages. */
  section: string | null;
  /** Reads the rail as drawn and the editor's column, in viewport coordinates, after each render; null while either is gone. */
  measure: () => { rail: Box; column: Box; } | null;
  /** The pointer's height on the rail. */
  pointerTop: number;
  onChoose: (line: number) => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}

const samePlace = (a: PopoverPlacement | null, b: PopoverPlacement) => Boolean(a) && a!.left === b.left && a!.top === b.top && a!.side === b.side;

/** The headings near the pointer hovering the rail; a click on one goes there. It shows only while the rail is not pressed. */
export function RailPopover({ mode, nearby, section, measure, pointerTop, onChoose, onPointerEnter, onPointerLeave }: RailPopoverProps) {
  const { t } = useTranslation();
  const box = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<PopoverPlacement | null>(null);
  const shallowest = Math.min(...nearby.items.map(item => item.depth));
  // Measured after each render: the popover's size and its active row decide where it goes.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs after every render on purpose; the state only changes when the place does.
  useLayoutEffect(() => {
    const element = box.current, boxes = measure();
    if (!element || !boxes) return;
    const { rail, column } = boxes, pointerY = rail.top + pointerTop;
    const row = element.querySelectorAll<HTMLElement>('[data-rail-row]')[nearby.active];
    const next = placePopover({ mode, rail, column, viewport: { width: window.innerWidth, height: window.innerHeight }, size: { width: element.offsetWidth, height: element.offsetHeight }, anchorY: pointerY, anchorOffset: row ? row.offsetTop + row.offsetHeight / 2 : element.offsetHeight / 2 });
    setPlaced(previous => samePlace(previous, next) ? previous : next);
  });
  return createPortal(
    <div ref={box} className='overview-rail-popover' data-side={placed?.side} style={{ left: placed?.left ?? 0, top: placed?.top ?? 0, visibility: placed ? 'visible' : 'hidden' }} onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave} onMouseDown={event => event.preventDefault()}>
      {section && <div className='overview-rail-popover-head'>{section}</div>}
      <ul aria-label={t('editor.overviewNearby')}>
        {nearby.items.map((item, index) => (
          <li key={item.index}>
            <button
              type='button'
              data-rail-row
              data-active={index === nearby.active || undefined}
              tabIndex={-1}
              onClick={() => onChoose(item.line)}
            >
              <span className='overview-rail-depth'>{`H${item.depth}`}</span>
              <span className='overview-rail-label' style={{ paddingLeft: (item.depth - shallowest) * 10 }}>{item.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>,
    document.body,
  );
}
