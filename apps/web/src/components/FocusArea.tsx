import './focus.css';
import React from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import type { DisplayNode } from '@mygitnotes/core/focus-page';
import { displayedPanes } from '../lib/focus-view.js';
import { useIsDesktop } from './WorkspaceChrome.js';
import { usePhone } from '../lib/use-phone.js';
import { FocusPane, type FocusPaneContext } from './FocusPane.js';

/** How many panes fit: all of them on desktop, two on tablets, one on phones. */
export function usePaneCapacity(): 1 | 2 | 'all' {
  const desktop = useIsDesktop();
  const phone = usePhone();
  return desktop ? 'all' : phone ? 1 : 2;
}

/** The displayed Focus: its split tree, with draggable splits whose sizes are kept per Focus on this device. */
export const FocusArea: React.FC<FocusPaneContext & { capacity: 1 | 2 | 'all'; }> = ({ capacity, ...context }) => {
  const { focus } = context;
  if (!focus.layout || !focus.entry) return null;
  const display = displayedPanes(focus.entry, focus.layout, capacity);
  const leaves = new Map(display.panes.map(pane => [pane.panes[0], pane]));
  const ratios = focus.entry.ratios;

  const render = (node: DisplayNode): React.ReactNode => {
    if (node.kind === 'pane') return <FocusPane {...context} displayed={leaves.get(node.id)!} />;
    // Stored sizes apply only while they cover exactly the children; otherwise the children share equally.
    const stored = ratios[node.id];
    const covers = stored !== undefined && Object.keys(stored).length === node.children.length && node.children.every(child => typeof stored[child.id] === 'number');
    return (
      <Group
        key={node.id}
        id={node.id}
        orientation={node.orientation}
        className='focus-split'
        defaultLayout={covers ? stored : undefined}
        onLayoutChanged={(layout, meta) => {
          if (meta.isUserInteraction) focus.setRatios(node.id, Object.fromEntries(node.children.map(child => [child.id, layout[child.id]])));
        }}
      >
        {node.children.flatMap((child, index) => [...(index > 0 ? [<Separator key={`separator-${index}`} className='focus-splitter' data-axis={node.orientation} />] : []), <Panel key={child.id} id={child.id} minSize='10%' className='focus-split-panel'>{render(child)}</Panel>])}
      </Group>
    );
  };

  return <div className='focus-area' data-panes={display.panes.length}>{render(display.root)}</div>;
};
