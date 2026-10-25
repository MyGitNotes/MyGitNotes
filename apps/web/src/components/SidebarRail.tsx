import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { carriesNoteMove } from '../lib/note-drag.js';
import { useTranslation } from '../lib/i18n/index.js';
import './sidebar-rail.css';

export type RailSectionId = 'notebooks' | 'status' | 'tags' | 'changes';

export interface RailSection {
  id: RailSectionId;
  label: string;
  icon: ReactNode;
  /** Whether a filter of this section is on, or how many; shown as a mark on its icon. */
  active?: boolean | number;
  /** Shown at the top of the flyout, under its title. */
  summary?: ReactNode;
  body: ReactNode;
}

const FLYOUT_WIDTH = 296;
const GAP = 6;
const MARGIN = 8;

/** Overlays other widgets portal out of the flyout (menus, dialogs): a press in them belongs to the flyout's own content. */
const OWN_OVERLAYS = 'dialog, [role="dialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper], [data-radix-select-viewport], .select-popup, .sidebar-tag-menu, .folder-action-menu';

/**
 * The filter sidebar folded to a column of icons. One icon per section; pressing it opens that section as a flyout beside the rail, which
 * closes on Escape, on a press outside it, or when the owner sets `open` to null (after something was picked).
 */
export function SidebarRail({ label, sections, open, onOpenChange }: { label: string; sections: RailSection[]; open: RailSectionId | null; onOpenChange: (section: RailSectionId | null) => void; }) {
  const { t } = useTranslation();
  const id = useId();
  const rail = useRef<HTMLElement>(null);
  const flyout = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number; maxHeight: number; }>();
  const current = sections.find(section => section.id === open);

  // Placed beside the rail at the pressed icon's height, and kept inside the window.
  useLayoutEffect(() => {
    if (!current || !rail.current) return;
    const button = rail.current.querySelector<HTMLElement>(`[data-rail-section="${current.id}"]`);
    const place = () => {
      const railRect = rail.current!.getBoundingClientRect();
      const top = Math.max(MARGIN, Math.min(button?.getBoundingClientRect().top ?? MARGIN, window.innerHeight - 200));
      setPosition({ left: railRect.right + GAP, top, maxHeight: window.innerHeight - top - MARGIN });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [current]);

  // A flyout that opens takes focus; once it closes with focus lost to the page, the icon that opened it gets focus back.
  const wasOpen = useRef<RailSectionId | null>(null);
  useEffect(() => {
    if (open) flyout.current?.focus({ preventScroll: true });
    else if (wasOpen.current && (!document.activeElement || document.activeElement === document.body)) rail.current?.querySelector<HTMLElement>(`[data-rail-section="${wasOpen.current}"]`)?.focus({ preventScroll: true });
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      // A menu inside the flyout takes its own Escape first.
      if (event.key !== 'Escape' || event.defaultPrevented || (event.target instanceof Element && event.target.closest(OWN_OVERLAYS) && !flyout.current?.contains(event.target))) return;
      onOpenChange(null);
    };
    const onPress = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || flyout.current?.contains(target) || rail.current?.contains(target) || target.closest(OWN_OVERLAYS)) return;
      onOpenChange(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPress, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPress, true);
    };
  }, [open, onOpenChange]);

  return (
    <aside ref={rail} aria-label={label} className='workspace-sidebar notes-sidebar sidebar-rail'>
      <div className='sidebar-rail-buttons' role='toolbar' aria-label={label} aria-orientation='vertical'>
        {sections.map(section => {
          const expanded = open === section.id;
          return (
            <button
              key={section.id}
              type='button'
              className='ui-icon-button sidebar-rail-button'
              data-rail-section={section.id}
              data-active={section.active ? true : undefined}
              aria-label={t('focusList.railSection', { section: section.label })}
              title={section.label}
              aria-haspopup='dialog'
              aria-expanded={expanded}
              aria-controls={expanded ? `${id}-${section.id}` : undefined}
              onClick={() => onOpenChange(expanded ? null : section.id)}
              // Dragging a note over the notebooks opens its folders, so the note can be dropped on one.
              onDragEnter={section.id === 'notebooks' ? event => carriesNoteMove(event) && onOpenChange(section.id) : undefined}
            >
              {section.icon}
              {typeof section.active === 'number' && section.active > 0 ? <span className='sidebar-rail-count'>{section.active}</span> : section.active ? <span className='sidebar-rail-mark' aria-hidden='true' /> : null}
            </button>
          );
        })}
      </div>
      {current && createPortal(
        <div ref={flyout} id={`${id}-${current.id}`} role='dialog' aria-label={current.label} tabIndex={-1} className='sidebar-flyout notes-sidebar' style={position ? { left: position.left, top: position.top, maxHeight: position.maxHeight, width: FLYOUT_WIDTH } : { left: -9999, top: 0, width: FLYOUT_WIDTH }}>
          <header className='sidebar-flyout-header'>
            <h2>{current.label}</h2>
            <button type='button' className='ui-icon-button' aria-label={t('filters.close')} title={t('filters.close')} onClick={() => onOpenChange(null)}>
              <X size={15} />
            </button>
          </header>
          {current.summary}
          <div className='sidebar-flyout-body'>{current.body}</div>
        </div>,
        document.body,
      )}
    </aside>
  );
}
