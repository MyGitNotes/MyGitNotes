import type { RailModel, RailWidthMode } from '../../lib/overview-rail/layout.js';
import { RAIL_HIT_WIDTH, RAIL_WIDTH } from '../../lib/overview-rail/layout.js';

interface RailMarksProps {
  mode: RailWidthMode;
  height: number;
  model: RailModel;
  /** The heading the pointer is on, drawn in the accent colour; a drag also points at it. */
  active: number | null;
  dragging: boolean;
}

/** A tick's share of the rail by heading depth: H1 the longest, H2 shorter, H3 and below the shortest. */
const TICK_SHARE = [1, 0.62, 0.36] as const;
/** Half a pixel, so a one-pixel line lies on a pixel row instead of across two. */
const crisp = (y: number) => Math.round(y) + 0.5;

/** The rail's drawing: track, page breaks, heading ticks, find dots, the visible range and the caret. */
export function RailMarks({ mode, height, model, active, dragging }: RailMarksProps) {
  const width = RAIL_WIDTH[mode], hit = RAIL_HIT_WIDTH[mode];
  const x0 = hit - width, inner = width - 2;
  const target = active === null ? undefined : model.headings[active];
  return (
    <svg className='overview-rail-marks' width={hit} height={height} aria-hidden='true'>
      <rect className='overview-rail-track' x={x0 + 0.5} y={0.5} width={width - 1} height={Math.max(0, height - 1)} rx={2} />
      {model.breaks.map((item, index) => <line key={`b${index}`} className='overview-rail-break' x1={x0} x2={hit} y1={crisp(item.top)} y2={crisp(item.top)} />)}
      {model.headings.map(heading => {
        const length = Math.max(2, inner * TICK_SHARE[Math.min(heading.depth, 3) - 1]);
        const y = heading.depth === 1 ? Math.round(heading.top) : crisp(heading.top);
        return <line key={heading.index} className='overview-rail-heading' data-depth={Math.min(heading.depth, 3)} data-active={heading.index === active || undefined} x1={x0 + 1} x2={x0 + 1 + length} y1={y} y2={y} />;
      })}
      {model.matches.map(top => <circle key={`m${top}`} className='overview-rail-match' cx={x0 + width * (mode === 'wide' ? 0.75 : 0.5)} cy={top} r={mode === 'wide' ? 2 : 1.5} />)}
      <rect className='overview-rail-visible' x={x0 + 0.75} y={model.visible.top + 0.75} width={width - 1.5} height={Math.max(0, model.visible.height - 1.5)} rx={2} />
      {model.cursor !== null && <line className='overview-rail-cursor' x1={x0} x2={hit} y1={model.cursor} y2={model.cursor} />}
      {dragging && target && <path className='overview-rail-target' d={`M ${x0 - 7} ${target.top - 4} L ${x0 - 2} ${target.top} L ${x0 - 7} ${target.top + 4} Z`} />}
    </svg>
  );
}
