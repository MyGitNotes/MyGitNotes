import { Tooltip } from '../Tooltip.js';
import type { ReactNode } from 'react';

export function GraphTool({ label, children, onClick, pressed, disabled }: { label: string; children: ReactNode; onClick: () => void; pressed?: boolean; disabled?: boolean; }) {
  return (
    <Tooltip label={label}>
      <button type='button' className='ui-button graph-tool' aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>{children}</button>
    </Tooltip>
  );
}
