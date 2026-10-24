import { type CSSProperties, type ReactNode, useRef } from 'react';
import { Group, Panel, type PanelSize, Separator } from 'react-resizable-panels';
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

const MIN_LEFT_WIDTH = 220;
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
  // Reported continuously while dragging; onSizeChange only fires once the drag settles.
  const lastResizePx = useRef(size);
  const animating = useFoldAnimation(collapsed);

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
        onLayoutChanged={(_layout, meta) => {
          if (meta.isUserInteraction) onSizeChange(lastResizePx.current);
        }}
      >
        <Panel
          id={`${groupId}-browse`}
          defaultSize={`${size}px`}
          minSize={`${minSize}px`}
          maxSize={`${Math.round(maxRatio * 100)}%`}
          groupResizeBehavior='preserve-pixel-size'
          onResize={(panelSize: PanelSize) => {
            if (panelSize?.inPixels) lastResizePx.current = Math.round(panelSize.inPixels);
          }}
          className='browse-dock-panel'
          {...(collapsed ? { inert: '' } : {})}
        >
          <div className='browse-dock-panel-content'>
            <div className='workspace-scroll browse-dock-scroll'>{browse}</div>
          </div>
        </Panel>
        <Separator className='workspace-splitter browse-dock-splitter' disabled={collapsed} />
        <Panel id={`${groupId}-focus`} groupResizeBehavior='preserve-relative-size' className='browse-dock-focus-panel'>
          <div className='browse-dock-focus'>{children}</div>
        </Panel>
      </Group>
    </div>
  );
}
