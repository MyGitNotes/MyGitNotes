import React, { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronDown, Columns2, FileText, GalleryHorizontalEnd, ListPlus, Maximize2, PanelTopClose, Rows2, X } from 'lucide-react';
import { findFocusPane, findFocusTabInPane, type FocusEdge, focusPaneIndex, focusPanes, type FocusTab, focusTabKey } from '@mygitnotes/core/focus-page';
import { COMPILATION_SUFFIX, isCompilationPath } from '@mygitnotes/core/compilation';
import type { NoteFocus } from '../lib/use-note-focus.js';
import type { DisplayedPane } from '../lib/focus-view.js';
import type { FolderItem } from '../lib/types.js';
import { NOTE_DRAG_TYPE } from '../lib/note-drag.js';
import { dropRefusal, dropZone } from '../lib/focus-drop.js';
import { useTranslation } from '../lib/i18n/index.js';
import type { NoteEditorProps } from './NoteEditor.js';
import { HostedNoteEditor } from './NoteEditorHost.js';
import { BatchAddDialog } from './BatchAddDialog.js';
import { Button } from './Button.js';
import { paneDimmed, tabDimmed } from '../lib/focus-search.js';
import { usePublishAgentTarget } from '../lib/pi-agent/session.js';
import { usePhone } from '../lib/use-phone.js';

/** Drag payload for a tab moved inside the displayed Focus: its FocusTab and the pane it was dragged from, as JSON. */
const TAB_DRAG_TYPE = 'application/x-mygitnotes-focus-tab';
/** The tab being dragged inside this window: a drag's data cannot be read until it drops, but the drop zones depend on which tab it is. */
let draggedTab: { pane: string; key: string; } | undefined;
// The source tab can unmount before its own dragend fires, so the end of any drag in the window clears it too (after the pane handlers of that event have read it).
const forgetDraggedTab = () => {
  draggedTab = undefined;
};
if (typeof document !== 'undefined') {
  for (const type of ['dragend', 'drop']) document.addEventListener(type, () => void setTimeout(forgetDraggedTab), true);
}

export interface FocusPaneContext {
  focus: NoteFocus;
  /** Notes dropped from outside must live under this root. */
  notebookRoot: string;
  /** The notebook's configured folders, for the batch-add picker. */
  folders: readonly FolderItem[];
  /** The view of the compilation at `path`, shown in place of a note editor. */
  renderCompilation: (path: string, pane: string) => ReactNode;
  onZoomNote: (path: string) => void;
  /** The rail container and section the active pane's editor renders its document panel into. */
  documentPanel?: NoteEditorProps['documentPanel'];
  /** The paths matching the toolbar search while it dims the Focus; null when it is inactive. */
  searchMatches?: ReadonlySet<string> | null;
}

interface PaneTab {
  tab: FocusTab;
  key: string;
  pane: string;
  index: number;
  label: string;
}
/** Where a drop lands: before `index` of stored `pane`, or at its end without one. */
interface DropSlot {
  pane: string;
  index?: number;
}

/** One pane on screen: its tab list and the displayed tab. On narrow screens it stands for several stored panes. */
export const FocusPane: React.FC<FocusPaneContext & { displayed: DisplayedPane; /** Whether the whole tree is on screen (desktop), the only case a drop on a pane's edge splits it. */ edgeDrops?: boolean; }> = ({ displayed, edgeDrops = false, ...context }) => {
  const { focus, notebookRoot, folders, renderCompilation, onZoomNote, documentPanel, searchMatches = null } = context;
  const { t } = useTranslation();
  const layout = focus.layout!, entry = focus.entry!;
  const active = displayed.panes.includes(entry.activePane);
  const editable = focus.editable;
  const tabsOf = (pane: string) => findFocusPane(layout, pane)?.tabs ?? [];
  /** "Pane N" in pane order, as the user counts them. */
  const numberOf = (pane: string) => focusPaneIndex(layout, pane) + 1;
  const tabs: PaneTab[] = displayed.panes.flatMap(pane => tabsOf(pane).map((tab, index) => ({ tab, key: focusTabKey(tab), pane, index, label: focus.notes.get(tab.path)?.title || tab.path.split('/').pop()!.replace(/\.md$|\.compilation\.yml$/, '') })));
  const repeatedLabels = new Set(tabs.filter((tab, index) => tabs.findIndex(candidate => candidate.label === tab.label) !== index).map(tab => tab.label));
  const shown = tabs.find(tab => tab.pane === displayed.pane && tab.key === displayed.key);
  const panelId = `focus-pane-${displayed.pane}`;
  const hideToolbar = entry.hideToolbar[displayed.pane];
  // The shown note's editor puts its actions in this slot of the tab bar; a phone's bar has no room, so there they stay with the note row.
  const phone = usePhone();
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null);

  const list = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const measure = () => setOverflowing(element.scrollWidth > element.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [tabs.length]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [displayed.key]);

  const [slot, setSlot] = useState<DropSlot>();
  /** The edge a drag hovers (the new pane takes that half) and the limit that would refuse it, which the preview names instead. */
  const [edge, setEdge] = useState<{ edge: FocusEdge; refusal?: string; }>();
  const [batchAddOpen, setBatchAddOpen] = useState(false);
  const accepts = (event: React.DragEvent) => editable && [TAB_DRAG_TYPE, NOTE_DRAG_TYPE, 'text/plain'].some(type => event.dataTransfer.types.includes(type));
  const hover = (event: React.DragEvent, next: DropSlot) => {
    if (!accepts(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = event.shiftKey ? 'copy' : 'move';
    setEdge(undefined);
    setSlot(current => current?.pane === next.pane && current.index === next.index ? current : next);
  };
  /** The edge zone the pointer is in, or undefined for the centre: edges split only where the tree is fully shown, never for a pane's own only tab. */
  const edgeAt = (event: React.DragEvent): FocusEdge | undefined => {
    if (!edgeDrops || (draggedTab?.pane === displayed.pane && tabsOf(displayed.pane).length === 1)) return undefined;
    const zone = dropZone(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY);
    return zone === 'center' ? undefined : zone;
  };
  const refusalAt = (zone: FocusEdge, shift: boolean) => dropRefusal(layout, displayed.pane, zone, draggedTab, shift);
  const bodyOver = (event: React.DragEvent) => {
    if (!accepts(event)) return;
    const zone = edgeAt(event);
    const refusal = zone && refusalAt(zone, event.shiftKey);
    if (!zone || refusal) {
      // At a limit the edge band behaves as the centre and the preview says why it does not split.
      hover(event, { pane: displayed.pane });
      if (zone) setEdge({ edge: zone, refusal });
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = event.shiftKey ? 'copy' : 'move';
    setSlot(undefined);
    setEdge(current => current?.edge === zone && !current.refusal ? current : { edge: zone });
  };
  const bodyDrop = (event: React.DragEvent) => {
    const zone = edgeAt(event);
    const refused = !zone || !accepts(event) || refusalAt(zone, event.shiftKey);
    forgetDraggedTab();
    if (!zone || refused) {
      drop(event, { pane: displayed.pane });
      return;
    }
    setEdge(undefined);
    event.preventDefault();
    event.stopPropagation();
    const dropped = droppedTab(event.dataTransfer, notebookRoot);
    if (dropped && focus.shown) void focus.split(focus.shown, displayed.pane, zone, dropped.tab, dropped.pane, event.shiftKey).catch(() => {});
  };
  /** Over a tab, the half under the pointer picks the gap before or after it. */
  const slotAt = (event: React.DragEvent, tab: PaneTab): DropSlot => {
    const box = event.currentTarget.getBoundingClientRect();
    return { pane: tab.pane, index: event.clientX > box.left + box.width / 2 ? tab.index + 1 : tab.index };
  };
  /** The insertion line sits before the tab at the slot, or after the last tab of its pane. */
  const marker = (tab: PaneTab) => {
    if (!slot || tab.pane !== slot.pane) return undefined;
    if (tab.index === slot.index) return 'before';
    const count = tabsOf(tab.pane).length;
    return tab.index === count - 1 && (slot.index === undefined || slot.index >= count) ? 'after' : undefined;
  };
  /** A tab-bar drag moves by default; Shift copies instead. A browse-row drag (no source pane) always copies. Same-pane drops always reorder. */
  const drop = (event: React.DragEvent, target: DropSlot) => {
    forgetDraggedTab();
    setSlot(undefined);
    setEdge(undefined);
    if (!accepts(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const dropped = droppedTab(event.dataTransfer, notebookRoot);
    if (!dropped || !focus.shown) return;
    const { tab, pane: sourcePane } = dropped;
    const key = focusTabKey(tab);
    const existingIndex = findFocusTabInPane(layout, target.pane, key);
    const index = target.index !== undefined && existingIndex !== -1 && existingIndex < target.index ? target.index - 1 : target.index;
    // The target pane already holding this tab has nothing to move or copy; the modifier key is irrelevant.
    if (sourcePane !== undefined && sourcePane !== target.pane && existingIndex === -1 && !event.shiftKey) {
      void focus.moveTab(focus.shown, key, sourcePane, target.pane, index).catch(() => {});
      return;
    }
    void focus.place(focus.shown, tab, target.pane, index).catch(() => {});
  };

  return (
    <section
      className='focus-pane'
      data-focus-pane={displayed.pane}
      data-active={active || undefined}
      data-dimmed={paneDimmed(searchMatches, displayed.panes.flatMap(tabsOf)) || undefined}
      data-dropping={slot ? true : undefined}
      data-drop-zone={edge && !edge.refusal ? edge.edge : undefined}
      data-hide-toolbar={hideToolbar || undefined}
      aria-label={t('focus.paneNumber', { number: numberOf(displayed.pane) })}
      onPointerDownCapture={() => focus.activate(displayed.pane)}
      onFocusCapture={() => focus.activate(displayed.pane)}
      onDragOver={event => hover(event, { pane: displayed.pane })}
      onDragLeave={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setSlot(undefined);
          setEdge(undefined);
        }
      }}
      onDrop={event => drop(event, { pane: displayed.pane })}
    >
      <div className='focus-pane-bar'>
        <div
          ref={list}
          className='focus-tabs'
          role='tablist'
          aria-label={t('focus.paneTabs', { number: numberOf(displayed.pane) })}
          onKeyDown={event => {
            const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            const target = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: buttons.length - 1 }[event.key];
            if (index < 0 || target === undefined) return;
            event.preventDefault();
            buttons[(target + buttons.length) % buttons.length].focus();
          }}
        >
          {tabs.map(tab => (
            <div
              key={`${tab.pane}:${tab.key}`}
              role='presentation'
              className='focus-tab'
              data-pane={tab.pane}
              data-dimmed={tabDimmed(searchMatches, tab.tab) || undefined}
              data-shown={(tab.pane === displayed.pane && tab.key === displayed.key) || undefined}
              data-drop={marker(tab)}
              draggable={editable}
              onDragStart={event => {
                event.dataTransfer.setData(TAB_DRAG_TYPE, JSON.stringify({ tab: tab.tab, pane: tab.pane }));
                event.dataTransfer.effectAllowed = 'copyMove';
                draggedTab = { pane: tab.pane, key: tab.key };
              }}
              onDragEnd={() => {
                draggedTab = undefined;
              }}
              onDragOver={event => hover(event, slotAt(event, tab))}
              onDrop={event => drop(event, slotAt(event, tab))}
            >
              <button
                type='button'
                role='tab'
                aria-selected={tab.pane === displayed.pane && tab.key === displayed.key}
                aria-controls={panelId}
                aria-label={repeatedLabels.has(tab.label) ? `${tab.label}, ${t('focus.paneNumber', { number: numberOf(tab.pane) })}` : undefined}
                data-pane-cue={repeatedLabels.has(tab.label) ? t('focus.paneShort', { number: numberOf(tab.pane) }) : undefined}
                tabIndex={(tab.pane === displayed.pane && tab.key === displayed.key) || (!displayed.key && tab === tabs[0]) ? 0 : -1}
                title={tab.label}
                onClick={() => void focus.show(tab.pane, tab.key)}
                onKeyDown={event => {
                  if (editable && event.key === 'Delete') {
                    event.preventDefault();
                    void focus.close(tab.key, tab.pane).catch(() => {});
                  }
                }}
              >
                {isCompilationPath(tab.tab.path) ? <GalleryHorizontalEnd aria-hidden='true' /> : <FileText aria-hidden='true' />}
                <span>{tab.label}</span>
              </button>
              {editable && (
                <button type='button' className='focus-tab-close' tabIndex={-1} aria-label={t('focus.closeTab', { name: tab.label })} title={t('focus.closeTab', { name: tab.label })} onClick={() => void focus.close(tab.key, tab.pane).catch(() => {})}>
                  <X aria-hidden='true' />
                </button>
              )}
            </div>
          ))}
        </div>
        <div className='focus-pane-actions'>
          {!phone && <div ref={setActionsSlot} className='focus-pane-note-actions' />}
          {overflowing && <FocusMenu label={t('focus.allTabs')} icon={<ChevronDown aria-hidden='true' />} items={tabs.map(tab => ({ key: `${tab.pane}:${tab.key}`, label: tab.label, current: tab.pane === displayed.pane && tab.key === displayed.key, onSelect: () => void focus.show(tab.pane, tab.key) }))} />}
          {edgeDrops && editable && displayed.key && (['right', 'bottom'] as const).map(side => {
            const refusal = dropRefusal(layout, displayed.pane, side);
            const label = t(side === 'right' ? 'focus.splitRight' : 'focus.splitDown');
            const reason = refusal ? t(refusal === 'pane-limit' ? 'focus.paneLimit' : refusal === 'depth-limit' ? 'focus.depthLimit' : 'focus.limit') : undefined;
            return <button key={side} type='button' className='ui-icon-button focus-pane-split' data-split={side} disabled={Boolean(refusal)} aria-label={label} title={reason ? `${label}. ${reason}` : label} onClick={() => void focus.splitShown(displayed.pane, side === 'right' ? 'horizontal' : 'vertical').catch(() => {})}>{side === 'right' ? <Columns2 aria-hidden='true' /> : <Rows2 aria-hidden='true' />}</button>;
          })}
          {editable && (
            <button type='button' className='ui-icon-button' aria-label={t('focus.batchAdd')} title={t('focus.batchAdd')} onClick={() => setBatchAddOpen(true)}>
              <ListPlus aria-hidden='true' />
            </button>
          )}
          {shown && (
            <button type='button' className='ui-icon-button' aria-label={t('focus.zoomNote')} title={t('focus.zoomNote')} onClick={() => onZoomNote(shown.tab.path)}>
              <Maximize2 aria-hidden='true' />
            </button>
          )}
          <button type='button' className='ui-icon-button focus-pane-hide-toolbar' aria-pressed={hideToolbar} aria-label={t('focus.hideToolbar')} title={t('focus.hideToolbar')} onClick={() => focus.setHideToolbar(displayed.pane, !hideToolbar)}>
            <PanelTopClose aria-hidden='true' />
          </button>
        </div>
      </div>
      <div id={panelId} className='focus-pane-body' role='tabpanel' aria-label={shown?.label} onDragOver={bodyOver} onDrop={bodyDrop}>
        {shown
          ? isCompilationPath(shown.tab.path)
            ? (
              <React.Fragment key={shown.tab.path}>
                <CompilationAgentTarget notebookId={focus.notebookId} path={shown.tab.path} active={active} />
                {renderCompilation(shown.tab.path, displayed.pane)}
              </React.Fragment>
            )
            : <PaneNoteEditor key={shown.tab.path} notebookId={focus.notebookId} path={shown.tab.path} active={active} documentPanel={active ? documentPanel : undefined} actionsSlot={phone ? undefined : actionsSlot} />
          : (
            <div className='focus-pane-empty'>
              <p>{editable ? t('focus.emptyPane') : t('focus.emptyPaneReadonly')}</p>
              {editable && focusPanes(layout).length > 1 && displayed.panes.length === 1 && tabsOf(displayed.pane).length === 0 && <Button type='button' size='small' onClick={() => void focus.closeEmptyPane(displayed.pane).catch(() => {})}>{t('focus.closePane')}</Button>}
            </div>
          )}
        {edge && <div className='focus-drop-preview' aria-hidden='true' data-zone={edge.refusal ? undefined : edge.edge}>{edge.refusal && <span>{t(edge.refusal === 'pane-limit' ? 'focus.paneLimit' : edge.refusal === 'depth-limit' ? 'focus.depthLimit' : 'focus.limit')}</span>}</div>}
      </div>
      {batchAddOpen && focus.shown && <BatchAddDialog focus={focus} target={focus.shown} pane={displayed.pane} notebookId={focus.notebookId} notebookRoot={notebookRoot} folders={folders} onClose={() => setBatchAddOpen(false)} />}
    </section>
  );
};

/** A dropped tab: its FocusTab, and (for a tab-bar drag) the pane it came from — undefined for a browse-row drag, which always copies. */
interface DroppedTab {
  tab: FocusTab;
  pane?: string;
}

function droppedTab(data: DataTransfer, notebookRoot: string): DroppedTab | undefined {
  const moved = data.getData(TAB_DRAG_TYPE);
  if (moved) {
    try {
      const { tab, pane } = JSON.parse(moved) as { tab: FocusTab; pane: string; };
      if (typeof pane === 'string' && tab.kind === 'note' && typeof tab.path === 'string') return { tab, pane };
    } catch { /* falls through to undefined */ }
    return undefined;
  }
  const path = (data.getData(NOTE_DRAG_TYPE) || data.getData('text/plain')).trim();
  return path.startsWith(`${notebookRoot}/`) && (path.endsWith('.md') || path.endsWith(COMPILATION_SUFFIX)) ? { tab: { kind: 'note', path } } : undefined;
}

const FocusMenu: React.FC<{ label: string; showLabel?: boolean; icon: ReactNode; items: { key: string; label: string; current?: boolean; onSelect: () => void; }[]; }> = ({ label, showLabel, icon, items }) => (
  <DropdownMenu.Root>
    {showLabel
      ? (
        <DropdownMenu.Trigger className='ui-button focus-menu-trigger'>
          {icon}
          <span>{label}</span>
        </DropdownMenu.Trigger>
      )
      : <DropdownMenu.Trigger className='ui-icon-button' aria-label={label} title={label}>{icon}</DropdownMenu.Trigger>}
    <DropdownMenu.Portal>
      <DropdownMenu.Content className='focus-menu' align='end' sideOffset={4} collisionPadding={8} aria-label={label} onEscapeKeyDown={event => event.stopPropagation()}>{items.map(item => <DropdownMenu.Item key={item.key} data-current={item.current || undefined} onSelect={item.onSelect}>{item.label}</DropdownMenu.Item>)}</DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
);

/** A note tab's editor: the pane is one host of the note, sharing its single editor with zoom and graph cards. */
/** A compilation has no editor to name itself to the agent panel, so its pane names the file, without a caret. */
function CompilationAgentTarget({ notebookId, path, active }: { notebookId: string; path: string; active: boolean; }) {
  const target = useMemo(() => ({ notebookId, path }), [notebookId, path]);
  usePublishAgentTarget(target, active);
  return null;
}

const PaneNoteEditor: React.FC<{ notebookId: string; path: string; active: boolean; documentPanel?: NoteEditorProps['documentPanel']; actionsSlot?: HTMLElement | null; }> = ({ notebookId, path, active, documentPanel, actionsSlot }) => <HostedNoteEditor notebookId={notebookId} path={path} frame='pane' active={active} documentPanel={documentPanel} actionsSlot={actionsSlot} />;
