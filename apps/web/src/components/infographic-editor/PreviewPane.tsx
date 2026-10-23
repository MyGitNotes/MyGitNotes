import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { withoutBlankRows } from '../../lib/infographics/grid.js';
import { type InfographicBlock, serializeInfographic } from '../../lib/infographics/model.js';

export interface PreviewHandle {
  /** Redraws the figure from `block` once no further call has come for the debounce time. */
  schedule: (block: InfographicBlock) => void;
}

interface Props {
  label: string;
  initial: string;
  render: (source: string) => string;
  delayMs?: number;
}

/** The one figure being edited, redrawn a moment after the last change; the editor around it does not re-render with it. */
export const PreviewPane = forwardRef<PreviewHandle, Props>(function PreviewPane({ label, initial, render, delayMs = 150 }, ref) {
  const [html, setHtml] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useImperativeHandle(ref, () => ({
    schedule(block) {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setHtml(render(serializeInfographic(withoutBlankRows(block)))), delayMs);
    },
  }), [render, delayMs]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return <div className='ig-preview live-directive-preview-content prose-custom' role='img' aria-label={label} dangerouslySetInnerHTML={{ __html: html }} />;
});
