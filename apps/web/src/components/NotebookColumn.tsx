import { type ReactNode, type Ref, useImperativeHandle, useRef } from 'react';
import { BookOpen, GalleryHorizontalEnd, ListTree, Search, X } from 'lucide-react';
import type { NotebookConfig } from '../lib/types.js';
import { useTranslation } from '../lib/i18n/index.js';
import { useSidebarLinks } from '../lib/web-features.js';
import { bindingsFor, keymapEntry } from '../lib/keyboard/keymap.js';
import { ariaKeyShortcuts, formatKeys } from '../lib/keyboard/keys.js';
import { keyEnvironment } from '../lib/keyboard/platform.js';
import { NavTree } from './NavTree.js';
import { SidebarLinks } from './SidebarLinks.js';
import type { NoteSearchHandle } from './note-list-search.js';

/** Notebooks under a repository's title, when the workspace has several repositories. */
export interface NotebookGroup {
  label: string;
  notebooks: string[];
}

export interface NotebookColumnProps {
  mode: 'open' | 'rail';
  /** The column's element, which its toggle controls. */
  columnId: string;
  notebooks: NotebookConfig[];
  groups?: NotebookGroup[];
  /** Notebooks whose repository cannot serve them; their rows say so. */
  unavailableNotebooks?: string[];
  selectedNotebookId: string;
  onSelectNotebook: (id: string) => void;
  switchDisabled?: boolean;
  /** Notes per notebook, once the counts arrive. */
  counts?: Record<string, number>;
  /** The open notebook's row, folders, outlines and compilations (`NotebookTree`), in its place among the notebooks. */
  current: ReactNode;
  /** The note search, the `q` query parameter. */
  query: string;
  onQueryChange: (query: string) => void;
  searchRef?: Ref<NoteSearchHandle>;
  /** The rail's search button: opens the column at its search field. */
  onOpenSearch: () => void;
  /** What the list shows, for the rail's outline and compilation buttons. */
  kind: 'note' | 'outline' | 'compilation';
  onSelectKind: (kind: 'outline' | 'compilation') => void;
}

/** The notebooks in the order to show them: under each repository's title where there are several, else one untitled group. */
function grouped(notebooks: NotebookConfig[], groups: NotebookGroup[] | undefined): { label?: string; notebooks: NotebookConfig[]; }[] {
  if (!groups?.length) return [{ notebooks }];
  return groups.map(group => ({ label: group.label, notebooks: group.notebooks.flatMap(id => notebooks.filter(nb => nb.id === id)) })).filter(group => group.notebooks.length > 0);
}

/** A notebook's rail initial: its first letter or character. */
const initial = (title: string) => Array.from(title.trim())[0]?.toUpperCase() ?? '?';

/**
 * Column 1 of the Notes page: the note search, then every notebook, one click to switch, with the open notebook unfolded in its place into
 * its folders, outlines and compilations, and an edition's links at the foot. Folded, it is a rail of the notebooks' initials (each named in
 * full), the search button, and the open notebook's outlines and compilations.
 */
export function NotebookColumn({ mode, columnId, notebooks, groups, unavailableNotebooks = [], selectedNotebookId, onSelectNotebook, switchDisabled = false, counts, current, query, onQueryChange, searchRef, onOpenSearch, kind, onSelectKind }: NotebookColumnProps): JSX.Element {
  const { t } = useTranslation();
  const links = useSidebarLinks();
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(searchRef, () => ({ focus: () => input.current?.focus() }), []);
  const [searchKeys] = bindingsFor(keymapEntry('note.searchList'), keyEnvironment);
  const titleOf = (nb: NotebookConfig) => unavailableNotebooks.includes(nb.id) ? `${nb.title} · ${t('notebook.unavailable')}` : nb.title;
  const sections = grouped(notebooks, groups);
  const footer = links.length > 0 && (
    <div className='browse-notebooks-footer'>
      <SidebarLinks links={links} variant='sidebar' />
    </div>
  );

  if (mode === 'rail') {
    return (
      // Keyed apart from the open column's top row, so React never turns the focused search field into the rail's search button. The column's
      // toggle is the header's, left of the logo.
      <div key='rail' className='browse-rail'>
        <button type='button' className='ui-icon-button' aria-label={t('header.searchPlaceholder')} title={t('header.searchPlaceholder')} aria-keyshortcuts={searchKeys && ariaKeyShortcuts(searchKeys, keyEnvironment)} onClick={onOpenSearch}>
          <Search size={16} aria-hidden='true' />
        </button>
        <span className='browse-rail-divider' aria-hidden='true' />
        <nav className='browse-rail-notebooks' aria-label={t('sidebar.notebooks')}>
          {sections.flatMap(section => section.notebooks).map(nb => (
            <button key={nb.id} type='button' className='browse-rail-notebook' aria-label={titleOf(nb)} title={titleOf(nb)} aria-current={nb.id === selectedNotebookId ? 'true' : undefined} disabled={switchDisabled && nb.id !== selectedNotebookId} onClick={() => onSelectNotebook(nb.id)}>
              <span aria-hidden='true'>{initial(nb.title)}</span>
            </button>
          ))}
        </nav>
        <span className='browse-rail-divider' aria-hidden='true' />
        <button type='button' className='ui-icon-button' aria-label={t('outline.list')} title={t('outline.list')} aria-pressed={kind === 'outline'} onClick={() => onSelectKind('outline')}>
          <ListTree size={16} aria-hidden='true' />
        </button>
        <button type='button' className='ui-icon-button' aria-label={t('sidebar.compilations')} title={t('sidebar.compilations')} aria-pressed={kind === 'compilation'} onClick={() => onSelectKind('compilation')}>
          <GalleryHorizontalEnd size={16} aria-hidden='true' />
        </button>
        {links.length > 0 && <SidebarLinks links={links} variant='sidebar' />}
      </div>
    );
  }

  return (
    <>
      <div key='top' className='browse-notebooks-top'>
        <label className='browse-search' role='search'>
          <Search size={15} aria-hidden='true' />
          <input
            ref={input}
            type='search'
            aria-label={t('header.searchPlaceholder')}
            placeholder={t('browse.searchShort')}
            aria-keyshortcuts={searchKeys && ariaKeyShortcuts(searchKeys, keyEnvironment)}
            value={query}
            onChange={event => onQueryChange(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Escape' && query) {
                event.preventDefault();
                onQueryChange('');
              }
            }}
          />
          {query
            ? (
              <button
                type='button'
                className='browse-search-clear'
                aria-label={t('header.clearSearch')}
                title={t('header.clearSearch')}
                onClick={() => {
                  onQueryChange('');
                  input.current?.focus();
                }}
              >
                <X size={14} aria-hidden='true' />
              </button>
            )
            : searchKeys && <kbd>{formatKeys(searchKeys, keyEnvironment).join(' ')}</kbd>}
        </label>
      </div>
      <div className='browse-notebooks-scroll'>
        <NavTree aria-label={t('sidebar.notebooks')} className='browse-notebooks'>
          {sections.map((section, index) => {
            const rows = section.notebooks.map(nb =>
              nb.id === selectedNotebookId ? <div key={nb.id} data-browse-content=''>{current}</div> : (
                <button key={nb.id} type='button' className='browse-notebook-row' title={titleOf(nb)} disabled={switchDisabled} onClick={() => onSelectNotebook(nb.id)}>
                  <BookOpen size={16} aria-hidden='true' />
                  <span className='browse-notebook-title'>{titleOf(nb)}</span>
                  {counts?.[nb.id] !== undefined && <span className='sidebar-notebook-count' aria-hidden='true'>{counts[nb.id]}</span>}
                </button>
              )
            );
            if (!section.label) return <div key='notebooks' className='browse-notebooks-group' data-browse-content=''>{rows}</div>;
            const headingId = `${columnId}-group-${index}`;
            return (
              <div key={section.label} role='group' aria-labelledby={headingId} className='browse-notebooks-group' data-browse-content=''>
                <h3 id={headingId} className='browse-notebooks-heading'>{section.label}</h3>
                {rows}
              </div>
            );
          })}
        </NavTree>
      </div>
      {footer}
    </>
  );
}
