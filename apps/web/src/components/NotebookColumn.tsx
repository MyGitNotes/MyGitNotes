import { type MouseEvent, type ReactNode, type Ref, useImperativeHandle, useRef } from 'react';
import { BookOpen, GalleryHorizontalEnd, ListTree, Search, X } from 'lucide-react';
import type { NotebookConfig } from '../lib/types.js';
import { useTranslation } from '../lib/i18n/index.js';
import { useSidebarLinks } from '../lib/web-features.js';
import { bindingsFor, keymapEntry } from '../lib/keyboard/keymap.js';
import { ariaKeyShortcuts, formatKeys } from '../lib/keyboard/keys.js';
import { keyEnvironment } from '../lib/keyboard/platform.js';
import { NavTree } from './NavTree.js';
import { hasNotebookMark, notebookInitial, NotebookMark } from './NotebookMark.js';
import { SidebarLinks } from './SidebarLinks.js';
import type { NoteSearchHandle } from './note-list-search.js';
import { Tooltip } from './Tooltip.js';

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
  /** What the list shows, for the rail's outline and compilation buttons, each a toggle: pressed again, it goes back to the notes. */
  kind: 'note' | 'outline' | 'compilation';
  onSelectKind: (kind: 'note' | 'outline' | 'compilation') => void;
  /** A notebook's context menu (its rail tile or its row), where the page offers 「外觀…」. */
  onNotebookContextMenu?: (event: MouseEvent<HTMLElement>, notebookId: string) => void;
}

/** The notebooks in the order to show them: under each repository's title where there are several, else one untitled group. */
function grouped(notebooks: NotebookConfig[], groups: NotebookGroup[] | undefined): { label?: string; notebooks: NotebookConfig[]; }[] {
  if (!groups?.length) return [{ notebooks }];
  return groups.map(group => ({ label: group.label, notebooks: group.notebooks.flatMap(id => notebooks.filter(nb => nb.id === id)) })).filter(group => group.notebooks.length > 0);
}

/**
 * Column 1 of the Notes page: the note search, then every notebook, one click to switch, with the open notebook unfolded in its place into
 * its folders, outlines and compilations, and an edition's links at the foot. Folded, it is a rail of the notebooks' initials (each named in
 * full), the search button, and the open notebook's outlines and compilations. A notebook with an icon or a colour shows its mark
 * (`NotebookMark`) in place of the initial and the book; every control is named by a tooltip (`Tooltip`), not a native title.
 */
export function NotebookColumn({ mode, columnId, notebooks, groups, unavailableNotebooks = [], selectedNotebookId, onSelectNotebook, switchDisabled = false, counts, current, query, onQueryChange, searchRef, onOpenSearch, kind, onSelectKind, onNotebookContextMenu }: NotebookColumnProps): JSX.Element {
  const { t } = useTranslation();
  const links = useSidebarLinks();
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(searchRef, () => ({ focus: () => input.current?.focus() }), []);
  const [searchKeys] = bindingsFor(keymapEntry('note.searchList'), keyEnvironment);
  const searchShortcut = searchKeys && formatKeys(searchKeys, keyEnvironment).join(' ');
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
        <Tooltip label={t('header.searchPlaceholder')} detail={searchShortcut} side='right'>
          <button type='button' className='ui-icon-button' aria-label={t('header.searchPlaceholder')} aria-keyshortcuts={searchKeys && ariaKeyShortcuts(searchKeys, keyEnvironment)} onClick={onOpenSearch}>
            <Search size={16} aria-hidden='true' />
          </button>
        </Tooltip>
        <span className='browse-rail-divider' aria-hidden='true' />
        <nav className='browse-rail-notebooks' aria-label={t('sidebar.notebooks')}>
          {sections.flatMap(section => section.notebooks).map(nb => {
            const current = nb.id === selectedNotebookId;
            return (
              <Tooltip key={nb.id} label={titleOf(nb)} detail={counts?.[nb.id]} side='right'>
                <button type='button' className='browse-rail-notebook' aria-label={titleOf(nb)} aria-current={current ? 'true' : undefined} data-marked={hasNotebookMark(nb) ? '' : undefined} disabled={switchDisabled && !current} onClick={() => onSelectNotebook(nb.id)} onContextMenu={onNotebookContextMenu && (event => onNotebookContextMenu(event, nb.id))}>{hasNotebookMark(nb) ? <NotebookMark notebook={nb} size='rail' selected={current} /> : <span aria-hidden='true'>{notebookInitial(nb.title)}</span>}</button>
              </Tooltip>
            );
          })}
        </nav>
        <span className='browse-rail-divider' aria-hidden='true' />
        <Tooltip label={t('outline.list')} side='right'>
          <button type='button' className='ui-icon-button' aria-label={t('outline.list')} aria-pressed={kind === 'outline'} onClick={() => onSelectKind(kind === 'outline' ? 'note' : 'outline')}>
            <ListTree size={16} aria-hidden='true' />
          </button>
        </Tooltip>
        <Tooltip label={t('sidebar.compilations')} side='right'>
          <button type='button' className='ui-icon-button' aria-label={t('sidebar.compilations')} aria-pressed={kind === 'compilation'} onClick={() => onSelectKind(kind === 'compilation' ? 'note' : 'compilation')}>
            <GalleryHorizontalEnd size={16} aria-hidden='true' />
          </button>
        </Tooltip>
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
              <Tooltip label={t('header.clearSearch')}>
                <button
                  type='button'
                  className='browse-search-clear'
                  aria-label={t('header.clearSearch')}
                  onClick={() => {
                    onQueryChange('');
                    input.current?.focus();
                  }}
                >
                  <X size={14} aria-hidden='true' />
                </button>
              </Tooltip>
            )
            : searchShortcut && <kbd>{searchShortcut}</kbd>}
        </label>
      </div>
      <div className='browse-notebooks-scroll'>
        <NavTree aria-label={t('sidebar.notebooks')} className='browse-notebooks'>
          {sections.map((section, index) => {
            const rows = section.notebooks.map(nb =>
              nb.id === selectedNotebookId ? <div key={nb.id} data-browse-content=''>{current}</div> : (
                <Tooltip key={nb.id} label={titleOf(nb)} detail={counts?.[nb.id]} side='right'>
                  <button type='button' className='browse-notebook-row' disabled={switchDisabled} onClick={() => onSelectNotebook(nb.id)} onContextMenu={onNotebookContextMenu && (event => onNotebookContextMenu(event, nb.id))}>
                    {hasNotebookMark(nb) ? <NotebookMark notebook={nb} size='row' /> : <BookOpen size={16} aria-hidden='true' />}
                    <span className='browse-notebook-title'>{titleOf(nb)}</span>
                    {counts?.[nb.id] !== undefined && <span className='sidebar-notebook-count' aria-hidden='true'>{counts[nb.id]}</span>}
                  </button>
                </Tooltip>
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
