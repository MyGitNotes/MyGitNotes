import { type CSSProperties, type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef } from 'react';
import { Group, Panel, type PanelImperativeHandle, Separator, usePanelRef } from 'react-resizable-panels';
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

/** Hands the keyboard from one place of a dock's toggle to the other as the dock turns. */
export interface DockToggleFocusHandoff {
  /** Called on a click: the toggle that can take focus once the dock has turned should take it. */
  request: () => void;
  /** Whether a request is waiting; answering true clears it. */
  claim: () => boolean;
}

export interface BrowseDockToggleProps {
  placement: BrowseDockPlacement;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /**
   * Shared by the toggles of a dock that moves its toggle (inside the left dock while it is open, in the Notes toolbar while it is
   * collapsed): after a click, the toggle that can take focus (one not inside an inert region) takes it, so the keyboard stays on the
   * control that turns the dock back.
   */
  focusHandoff?: DockToggleFocusHandoff;
}

/** Collapses and reopens the browse region: from the Notes toolbar's left end, or from inside the left dock while it holds the list's search. */
export function BrowseDockToggle({ placement, collapsed, onCollapsedChange, focusHandoff }: BrowseDockToggleProps): JSX.Element {
  const { t } = useTranslation();
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = button.current;
    if (!focusHandoff || !element || element.closest('[inert]')) return;
    if (focusHandoff.claim()) element.focus();
  }, [collapsed, focusHandoff]);
  // The browse region sits left of or above the Focus; browse-dock.css turns the icon's arrow as it collapses.
  const Icon = placement === 'left' ? PanelLeftClose : PanelTopClose;
  const label = t(collapsed ? 'focus.expandBrowseAndHeader' : 'focus.collapseBrowseAndHeader');
  const toggle = () => {
    focusHandoff?.request();
    onCollapsedChange(!collapsed);
  };
  return (
    <button ref={button} type='button' className='ui-icon-button browse-dock-toggle' data-collapsed={collapsed || undefined} aria-label={label} title={label} aria-expanded={!collapsed} onClick={toggle}>
      <Icon size={16} />
    </button>
  );
}

/** The width (height for the top dock) the person gave the dock, and whether a restore of it is already queued. */
interface StoredSize {
  size: number;
  queued: boolean;
}

/**
 * Puts the dock back at its stored pixel size once the current task's other work is done, so the library has handled the change that
 * prompted it first. Skipped during a drag, which owns the size until it settles.
 */
function restoreStoredSize(stored: StoredSize, group: RefObject<HTMLDivElement | null>, panel: RefObject<PanelImperativeHandle | null>): void {
  if (stored.queued) return;
  stored.queued = true;
  queueMicrotask(() => {
    stored.queued = false;
    const element = group.current;
    if (!element?.isConnected || element.querySelector(':scope > [data-separator="active"]')) return;
    panel.current?.resize(`${stored.size}px`);
  });
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

  // The library keeps the dock as a share of its group and loses the pixel size in two ways. It registers the group a second time in the
  // commit after the mount, after that mount's effects ran; when the workspace's filter sidebar folded away in one of them, the second
  // registration keeps the share of the narrower group and takes the wider one as the size it last knew (a stored 288 opened at 350).
  // And a resize here can land before its observer reports a new group size, which it then scales by the size it knew. So whenever the
  // group changes size, or its layout changes for any reason but the person's own drag or key press, the dock goes back to the stored
  // width, once the library's own handling of that change is done.
  const stored = useRef<StoredSize>({ size, queued: false });
  useLayoutEffect(() => {
    stored.current.size = size;
  }, [size]);
  useLayoutEffect(() => {
    const group = groupElement.current;
    if (narrow || !group) return;
    const observer = new ResizeObserver(() => restoreStoredSize(stored.current, groupElement, browsePanel));
    observer.observe(group);
    return () => observer.disconnect();
  }, [narrow, placement, browsePanel]);

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
          if (!meta.isUserInteraction) {
            restoreStoredSize(stored.current, groupElement, browsePanel);
            return;
          }
          if (share === undefined || !groupElement.current) return;
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
