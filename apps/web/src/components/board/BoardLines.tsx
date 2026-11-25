import { memo, useId } from 'react';
import type { DrawnArrow, NoteLinkLine } from '../../lib/board/connections.js';
import type { BoardSelectionKey } from '../../lib/board/edit.js';

/**
 * The lines under the cards, in board units: the dashed links written inside notes, then the drawn arrows over them,
 * each a curve with an arrowhead at its target. Decoration only; the cards' descriptions and the list of arrows say
 * the same in words. On an editable board a wider invisible stroke along each arrow takes the pointer, to select it.
 */
export const BoardLines = memo(function BoardLines({ noteLinks, arrows, editable = false, selection, focused }: { noteLinks: readonly NoteLinkLine[]; arrows: readonly DrawnArrow[]; editable?: boolean; selection?: ReadonlySet<BoardSelectionKey>; focused?: string; }) {
  const head = `board-arrowhead-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg className='board-lines' width='1' height='1' aria-hidden='true' focusable='false'>
      <defs>
        <marker id={head} viewBox='0 0 10 10' refX='9' refY='5' markerWidth='10' markerHeight='10' markerUnits='userSpaceOnUse' orient='auto-start-reverse'>
          <path d='M 0 0 L 10 5 L 0 10 z' className='board-arrowhead' />
        </marker>
      </defs>
      <g className='board-note-links'>{noteLinks.map(line => <line key={line.key} data-board-note-link={`${line.a} ${line.b}`} x1={line.start.x} y1={line.start.y} x2={line.end.x} y2={line.end.y} />)}</g>
      <g className='board-arrows'>{arrows.map(arrow => <path key={arrow.id} data-board-arrow={arrow.id} data-selected={selection?.has(`arrow:${arrow.id}`) || focused === arrow.id || undefined} d={arrow.path} markerEnd={`url(#${head})`} />)}</g>
      {editable && <g className='board-arrow-hits'>{arrows.map(arrow => <path key={arrow.id} data-board-key={`arrow:${arrow.id}`} d={arrow.path} />)}</g>}
    </svg>
  );
});

/** The arrows' labels on their lines, hidden once they would render under 10 px; on an editable board a label selects its arrow. */
export const BoardArrowLabels = memo(function BoardArrowLabels({ arrows, editable = false, selection }: { arrows: readonly DrawnArrow[]; editable?: boolean; selection?: ReadonlySet<BoardSelectionKey>; }) {
  return <>{arrows.filter(arrow => arrow.label).map(arrow => <span key={arrow.id} className='board-arrow-label' aria-hidden='true' data-board-key={editable ? `arrow:${arrow.id}` : undefined} data-selected={selection?.has(`arrow:${arrow.id}`) || undefined} style={{ left: arrow.middle.x, top: arrow.middle.y }}>{arrow.label}</span>)}</>;
});
