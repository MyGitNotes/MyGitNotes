import { type PointerEvent, useRef } from 'react';
import { inflate, type Point, type Rect, unionRects } from '../../lib/board/geometry.js';
import type { PlacedBoard } from '../../lib/board/placement.js';
import { type Camera, type Size, visibleRect } from '../../lib/board/zoom.js';

const WIDTH = 200, MAX_HEIGHT = 140;

/**
 * The minimap: the board's sections, cards and text in outline with the viewport's frame; a press or drag moves the
 * viewport there. Hidden from assistive technology, whose way around the board is the zoom control and the cards.
 */
export function BoardMinimap({ board, camera, size, onCentre }: { board: PlacedBoard; camera: Camera; size: Size; onCentre: (point: Point) => void; }) {
  const svg = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const visible = visibleRect(camera, size);
  const area = inflate(unionRects([...board.bounds ? [board.bounds] : [], visible])!, 40);
  const height = Math.max(60, Math.min(MAX_HEIGHT, WIDTH * area.h / Math.max(1, area.w)));
  const at = (event: PointerEvent<SVGSVGElement>): Point => {
    const box = svg.current!.getBoundingClientRect();
    // The drawing keeps its aspect ratio inside the box, centred.
    const scale = Math.min(box.width / area.w, box.height / area.h);
    return { x: area.x + (event.clientX - box.left - (box.width - area.w * scale) / 2) / scale, y: area.y + (event.clientY - box.top - (box.height - area.h * scale) / 2) / scale };
  };
  const rect = (value: Rect, className: string, key: string) => <rect key={key} className={className} x={value.x} y={value.y} width={value.w} height={value.h} />;
  return (
    <div className='board-minimap' aria-hidden='true'>
      <svg
        ref={svg}
        width={WIDTH}
        height={height}
        viewBox={`${area.x} ${area.y} ${area.w} ${area.h}`}
        onPointerDown={event => {
          dragging.current = true;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          onCentre(at(event));
        }}
        onPointerMove={event => dragging.current && onCentre(at(event))}
        onPointerUp={() => dragging.current = false}
        onPointerCancel={() => dragging.current = false}
      >
        {board.sections.map(section => rect(section.rect, 'board-minimap-section', `s:${section.key}`))}
        {board.cards.map(card => rect(card.rect, 'board-minimap-card', `c:${card.key}`))}
        {board.texts.map(text => rect(text.rect, 'board-minimap-text', `t:${text.id}`))}
        {rect(visible, 'board-minimap-frame', 'frame')}
      </svg>
    </div>
  );
}
