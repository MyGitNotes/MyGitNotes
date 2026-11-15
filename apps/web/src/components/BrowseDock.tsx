import { type CSSProperties, type ReactNode, useLayoutEffect, useRef } from 'react';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';
import { PanelLeftClose, PanelTopClose } from 'lucide-react';
import { useTranslation } from '../lib/i18n/index.js';
import { useFoldAnimation } from '../lib/use-fold-animation.js';
import './browse-dock.css';

export type BrowseDockPlacement = 'left' | 'top';

export interface BrowseDockProps {
  placement: BrowseDockPlacement;
  /** Left dock width or top dock height, in px. */
  size: number;
  onSizeChange: (size: number) => void;
  /** Folds the browse panel away; its tree stays mounted, so the Focus and its editors never remount. */
  collapsed: boolean;
  /** ≤767px: only one of browse region / Focus is shown, full screen. */
  narrow: boolean;
  narrowView: 'browse' | 'focus';
  /** The browse region content; BrowseDock wraps it in its own scroll container. */
  browse: ReactNode;
  /** The Focus area. */
  children: ReactNode;
}

const MIN_LEFT_WIDTH = 200;
const MAX_LEFT_RATIO = 0.6;
const MIN_TOP_HEIGHT = 120;
const MAX_TOP_RATIO = 0.7;

/** Collapses and reopens the browse region from the Notes toolbar's left end. */
export function BrowseDockToggle({ placement, collapsed, onCollapsedChange }: { placement: BrowseDockPlacement; collapsed: boolean; onCollapsedChange: (collapsed: boolean) => void; }): JSX.Element {
  const { t } = useTranslation();
  // The browse region sits left of or above the Focus; browse-dock.css turns the icon's arrow as it collapses.
  const Icon = placement === 'left' ? PanelLeftClose : PanelTopClose;
  const label = t(collapsed ? 'focus.expandBrowseAndHeader' : 'focus.collapseBrowseAndHeader');
  return (
    <button type='button' className='ui-icon-button browse-dock-toggle' data-collapsed={collapsed || undefined} aria-label={label} title={label} onClick={() => onCollapsedChange(!collapsed)}>
      <Icon size={16} />
    </button>
  );
}

export function BrowseDock({ placement, size, onSizeChange, collapsed, narrow, narrowView, browse, children }: BrowseDockProps): JSX.Element {
  const groupElement = useRef<HTMLDivElement>(null);
  const animating = useFoldAnimation(collapsed);
  const { t } = useTranslation();
  const browsePanel = usePanelRef();

  // The library reads defaultSize only when the panel first registers. A size that arrives later (the notebook's stored view can reach
  // the dock after it opened) re-registers the panel, and the group puts back the proportions it last had: the dock kept its first width,
  // scaled to the space it had by then. Resizing here makes it follow the stored size.
  useLayoutEffect(() => {
    browsePanel.current?.resize(`${size}px`);
  }, [browsePanel, size, placement, narrow]);

  if (narrow) {
    return <div className='browse-dock' data-placement={placement} data-narrow='true'>{narrowView === 'browse' ? <div className='workspace-scroll browse-dock-scroll'>{browse}</div> : <div className='browse-dock-focus'>{children}</div>}</div>;
  }

  const orientation = placement === 'left' ? 'horizontal' : 'vertical';
  const minSize = placement === 'left' ? MIN_LEFT_WIDTH : MIN_TOP_HEIGHT;
  const maxRatio = placement === 'left' ? MAX_LEFT_RATIO : MAX_TOP_RATIO;
  // Stable per placement, so switching placement (left <-> top) remounts the Group cleanly.
  const groupId = `browse-dock-${placement}`;

  // One tree for both states: browse-dock.css folds the browse panel to nothing and back with a transition, so the library's stored size is
  // untouched and the Focus keeps its editors. While folded the panel is inert: nothing in it can take focus.
  return (
    <div className='browse-dock' data-placement={placement} data-collapsed={collapsed || undefined} data-animating={animating || undefined} style={{ '--browse-dock-size': `${size}px` } as CSSProperties}>
      <Group
        key={groupId}
        id={groupId}
        orientation={orientation}
        className='browse-dock-group'
        elementRef={groupElement}
        onLayoutChanged={(layout, meta) => {
          // Fires once a drag settles and on each key press; the size comes from the layout it reports, since the panel's measured size
          // trails it until the browser lays the panel out again (a key press stored the width from before it).
          const share = layout[`${groupId}-browse`];
          if (!meta.isUserInteraction || share === undefined || !groupElement.current) return;
          const panels = [...groupElement.current.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child.hasAttribute('data-panel'));
          const extent = panels.reduce((sum, panel) => sum + (orientation === 'horizontal' ? panel.offsetWidth : panel.offsetHeight), 0);
          onSizeChange(Math.round(share * extent / 100));
        }}
      >
        <Panel id={`${groupId}-browse`} panelRef={browsePanel} defaultSize={`${size}px`} minSize={`${minSize}px`} maxSize={`${Math.round(maxRatio * 100)}%`} groupResizeBehavior='preserve-pixel-size' className='browse-dock-panel' {...(collapsed ? { inert: '' } : {})}>
          <div className='browse-dock-panel-content'>
            <div className='workspace-scroll browse-dock-scroll'>{browse}</div>
          </div>
        </Panel>
        <Separator className='workspace-splitter browse-dock-splitter' disabled={collapsed} aria-label={t(placement === 'left' ? 'focus.resizeBrowseWidth' : 'focus.resizeBrowseHeight')} />
        <Panel id={`${groupId}-focus`} groupResizeBehavior='preserve-relative-size' className='browse-dock-focus-panel'>
          <div className='browse-dock-focus'>{children}</div>
        </Panel>
      </Group>
    </div>
  );
}
