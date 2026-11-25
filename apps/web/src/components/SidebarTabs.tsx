import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from 'react';
import { useTranslation } from '../lib/i18n/index.js';

export type SidebarTab = 'directory' | 'filters';
const TABS: readonly SidebarTab[] = ['directory', 'filters'];

/**
 * A phone drawer's two pages: 目錄 (the notebook's folders, outlines and compilations) and 篩選 (status and tags). Only a tap or the
 * keyboard switches them, so a sideways swipe in the drawer still closes it. Both panels stay mounted, the other one hidden, so the
 * folders a person opened and the filters they ticked are there when they come back.
 */
export function SidebarTabs({ directory, filters, initial = 'directory' }: { directory: ReactNode; filters: ReactNode; initial?: SidebarTab; }) {
  const { t } = useTranslation();
  const id = useId();
  const [tab, setTab] = useState<SidebarTab>(initial);
  const buttons = useRef(new Map<SidebarTab, HTMLButtonElement>());
  const label = (value: SidebarTab) => t(value === 'directory' ? 'sidebar.tabDirectory' : 'sidebar.tabFilters');
  // Arrow keys, Home and End move between the tabs, as a tab list's do.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = TABS.indexOf(tab);
    const next = event.key === 'ArrowRight' ? TABS[(index + 1) % TABS.length] : event.key === 'ArrowLeft' ? TABS[(index + TABS.length - 1) % TABS.length] : event.key === 'Home' ? TABS[0] : event.key === 'End' ? TABS[TABS.length - 1] : undefined;
    if (!next) return;
    event.preventDefault();
    setTab(next);
    buttons.current.get(next)?.focus();
  };
  return (
    <div className='sidebar-tabs'>
      <div role='tablist' aria-label={t('sidebar.notebooks')} className='sidebar-tab-list' onKeyDown={onKeyDown}>
        {TABS.map(value => (
          <button
            key={value}
            ref={element => {
              if (element) buttons.current.set(value, element);
              else buttons.current.delete(value);
            }}
            type='button'
            role='tab'
            id={`${id}-${value}-tab`}
            aria-selected={tab === value}
            aria-controls={`${id}-${value}`}
            tabIndex={tab === value ? 0 : -1}
            className='sidebar-tab'
            onClick={() => setTab(value)}
          >
            {label(value)}
          </button>
        ))}
      </div>
      {TABS.map(value => <div key={value} role='tabpanel' id={`${id}-${value}`} aria-labelledby={`${id}-${value}-tab`} className='sidebar-tab-panel' data-tab={value} hidden={tab !== value}>{value === 'directory' ? directory : filters}</div>)}
    </div>
  );
}
