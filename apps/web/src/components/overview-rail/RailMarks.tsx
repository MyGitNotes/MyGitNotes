import { useEffect, useRef, useState } from 'react';
import type { RailBlockKind } from '../../lib/overview-rail/blocks.js';
import { displayWidth } from '../../lib/overview-rail/blocks.js';
import type { RailModel, RailWidthMode } from '../../lib/overview-rail/layout.js';
import { RAIL_HIT_WIDTH, RAIL_WIDTH } from '../../lib/overview-rail/layout.js';
import { MINIMAP_INSET, type MinimapShape, minimapWidth } from '../../lib/overview-rail/minimap.js';

interface RailMarksProps {
  mode: RailWidthMode;
  height: number;
  model: RailModel;
  /** The minimap's blocks, drawn under the marks. */
  shapes: readonly MinimapShape[];
  /** How many columns a row of the editor holds. */
  columns: number;
  /** The heading the pointer is on, drawn in the accent colour. */
  active: number | null;
}

/** A tick's share of the narrow rail by heading depth: H1 the longest, H2 shorter, H3 and below the shortest. */
const TICK_SHARE = [1, 0.62, 0.36] as const;
/** How much wider than body text a heading's characters are, by depth, so its mark is as long as the heading looks. */
const HEADING_SCALE = [1.9, 1.5, 1.25, 1.1] as const;
/** The shortest heading mark on the wide rail, as a share of its width, so a short heading still reads as one. */
const HEADING_LEAST = 0.3;
/** Half a pixel, so a one-pixel line lies on a pixel row instead of across two. */
const crisp = (y: number) => Math.round(y) + 0.5;
const KINDS: readonly RailBlockKind[] = ['text', 'code', 'table', 'media', 'quote'];

/**
 * The minimap's blocks, on a canvas sized to the screen's pixels. Its colours come from theme tokens through hidden probes
 * (overview-rail.css), read again whenever the page's theme changes.
 */
function MinimapCanvas({ mode, height, shapes }: Pick<RailMarksProps, 'mode' | 'height' | 'shapes'>) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const inks = useRef<HTMLSpanElement>(null);
  const [theme, setTheme] = useState(0);
  useEffect(() => {
    const changed = () => setTheme(count => count + 1);
    // The theme is set on the root element: its class, data attributes or custom properties.
    const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(changed);
    observer?.observe(document.documentElement, { attributes: true });
    const scheme = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    scheme?.addEventListener('change', changed);
    return () => {
      observer?.disconnect();
      scheme?.removeEventListener('change', changed);
    };
  }, []);
  const width = RAIL_WIDTH[mode];
  useEffect(() => {
    const element = canvas.current, probes = inks.current;
    if (!element || !probes) return;
    const ratio = window.devicePixelRatio || 1;
    element.width = Math.round(width * ratio);
    element.height = Math.round(height * ratio);
    const context = element.getContext('2d');
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const ink = new Map<string, string>();
    for (const probe of probes.children) ink.set((probe as HTMLElement).dataset.kind ?? '', getComputedStyle(probe).color);
    for (const shape of shapes) {
      context.fillStyle = ink.get(shape.kind) ?? '';
      context.fillRect(shape.x, shape.y, shape.width, shape.height);
    }
  }, [shapes, width, height, theme]);
  return (
    <>
      <canvas ref={canvas} className='overview-rail-minimap' style={{ left: RAIL_HIT_WIDTH[mode] - width, width, height }} aria-hidden='true' />
      <span ref={inks} className='overview-rail-inks' aria-hidden='true'>{KINDS.map(kind => <i key={kind} data-kind={kind} />)}</span>
    </>
  );
}

/** The rail's drawing: the minimap of the note's blocks, and over it page breaks, heading marks, find dots, the visible range and the caret. */
export function RailMarks({ mode, height, model, shapes, columns, active }: RailMarksProps) {
  const width = RAIL_WIDTH[mode], hit = RAIL_HIT_WIDTH[mode];
  const x0 = hit - width, inset = MINIMAP_INSET[mode], inner = minimapWidth(mode);
  const headingLength = (depth: number, label: string) => {
    const level = Math.min(depth, 4) - 1;
    if (mode === 'narrow') return Math.max(2, inner * TICK_SHARE[Math.min(level, 2)]);
    return inner * Math.max(HEADING_LEAST, Math.min(1, displayWidth(label) * HEADING_SCALE[level] / Math.max(1, columns)));
  };
  return (
    <>
      <MinimapCanvas mode={mode} height={height} shapes={shapes} />
      <svg className='overview-rail-marks' width={hit} height={height} aria-hidden='true'>
        {model.breaks.map((item, index) => <line key={`b${index}`} className='overview-rail-break' x1={x0} x2={hit} y1={crisp(item.top)} y2={crisp(item.top)} />)}
        {model.headings.map(heading => {
          const y = heading.depth === 1 ? Math.round(heading.top) : crisp(heading.top);
          return <line key={heading.index} className='overview-rail-heading' data-depth={Math.min(heading.depth, 3)} data-active={heading.index === active || undefined} x1={x0 + inset} x2={x0 + inset + headingLength(heading.depth, heading.label)} y1={y} y2={y} />;
        })}
        {model.matches.map(top => <circle key={`m${top}`} className='overview-rail-match' cx={x0 + width * (mode === 'wide' ? 0.85 : 0.5)} cy={top} r={mode === 'wide' ? 2.5 : 2} />)}
        <rect className='overview-rail-visible' x={x0 + 0.75} y={model.visible.top + 0.75} width={width - 1.5} height={Math.max(0, model.visible.height - 1.5)} rx={3} />
        {model.cursor !== null && <line className='overview-rail-cursor' x1={x0} x2={hit} y1={model.cursor} y2={model.cursor} />}
      </svg>
    </>
  );
}
