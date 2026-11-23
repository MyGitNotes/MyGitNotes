// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { NoteFilters } from '@mygitnotes/core/note-filters';
import type { NotebookFacets } from '@mygitnotes/core/note-query';
import type { FilterControls } from '../lib/filter-controls.js';
import { I18nProvider } from '../lib/i18n/index.js';
import { type BrowseColumnsLayout, type BrowsePresentation } from '../lib/browse-columns.js';
import { listFacets } from '../lib/list-facets.js';
import { useBrowseColumns } from '../app/useBrowseColumns.js';
import { BrowseColumns, LIST_COLUMN_ID, NOTEBOOK_COLUMN_ID } from './BrowseColumns.js';
import { NotebookColumn } from './NotebookColumn.js';
import { NotebookTree } from './NotebookTree.js';
import { NoteListColumn } from './NoteListColumn.js';
import { ListFilterButtons } from './ListFilterButtons.js';
import type { FolderItem } from '../lib/types.js';

const kind = { total: 0, statuses: {}, tags: {} };
const facets: Record<string, NotebookFacets> = { life: { total: 7, hidden: 1, statuses: { todo: 3, done: 4 }, tags: { work: 2 }, directories: {}, outlines: kind, compilations: kind }, work: { total: 1, hidden: 0, statuses: {}, tags: {}, directories: {}, outlines: kind, compilations: kind } };
const notebooks = [{ id: 'life', title: 'Life', root: 'notes/life', statuses: ['todo', 'done'] }, { id: 'work', title: 'Work', root: 'notes/work' }];
const folders: FolderItem[] = [{ notebookId: 'life', path: 'projects', title: 'projects', order: 0 }, { notebookId: 'work', path: 'clients', title: 'clients', order: 0 }];

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('github-notes:language', 'en');
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as typeof window.matchMedia;
  window.innerWidth = 1440;
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function controls(value: Partial<NoteFilters> = {}): FilterControls {
  return { value: { kind: 'note', notebookId: 'life', folders: [], descendants: true, tags: [], tagMode: 'any', q: '', status: null, showHidden: false, ...value }, neighbors: false, notebooks, folders, tags: ['work'], statuses: ['todo', 'done'], count: 7, onChange: () => {}, allNotebooks: false, onAllNotebooksChange: () => {}, onClear: () => {} };
}

interface PageProps {
  layout?: BrowseColumnsLayout;
  presentation?: BrowsePresentation;
  /** The note the Focus shows, if any. */
  note?: string;
  notebookId?: string;
  folder?: string | null;
  onToggleNotebooks?: () => void;
  onToggleList?: () => void;
  onToggleColumns?: () => void;
  measure?: (element: HTMLElement | null) => void;
}

/** The Notes page's three columns as the app composes them. */
function Page({ layout = { notebooks: 'open', list: true }, presentation = 'list', note, notebookId = 'life', folder = null, onToggleNotebooks = () => {}, onToggleList = () => {}, onToggleColumns = () => {}, measure }: PageProps) {
  const notebook = notebooks.find(nb => nb.id === notebookId)!;
  const filters = controls({ notebookId, folders: folder ? [`${notebook.root}/${folder}`] : [] });
  return (
    <I18nProvider>
      <BrowseColumns
        layout={layout}
        measure={measure}
        merged={presentation !== 'list'}
        notebooks={layout.notebooks === 'hidden' ? null : (
          <NotebookColumn
            mode={layout.notebooks}
            columnId={NOTEBOOK_COLUMN_ID}
            notebooks={notebooks}
            selectedNotebookId={notebookId}
            onSelectNotebook={() => {}}
            counts={{ life: 7, work: 1 }}
            current={<NotebookTree notebook={notebook} filters={filters} facets={facets} folders={folders} foldersLoading={false} foldersWritable selectedFolder={folder} onSelectFolder={() => {}} onManageFiles={() => {}} expanded onToggleExpanded={() => {}} />}
            query=''
            onQueryChange={() => {}}
            onOpenSearch={() => {}}
            onToggle={onToggleNotebooks}
            kind='note'
            onSelectKind={() => {}}
          />
        )}
        list={
          <NoteListColumn columnId={LIST_COLUMN_ID} notebookTitle={notebook.title} path={folder ? [folder] : []} count={folder ? 2 : 7} presentation={presentation} onPresentationChange={() => {}} onCollapse={presentation === 'list' ? onToggleList : undefined} chips={<ListFilterButtons filters={filters} counts={listFacets(filters, facets)} notebookId={notebookId} sortField='updated' sortOrder='desc' onSortChange={() => {}} sortable showHidden={false} hiddenNoteCount={1} onShowHiddenChange={() => {}} />}>
            <ul>
              <li aria-current={note === 'a' ? 'true' : undefined}>Note A</li>
              <li aria-current={note === 'b' ? 'true' : undefined}>Note B</li>
            </ul>
          </NoteListColumn>
        }
        note={note ? <article>Note {note}</article> : <p>No note open</p>}
        restore={<button type='button' data-column-toggle='' aria-controls={layout.notebooks === 'hidden' ? NOTEBOOK_COLUMN_ID : LIST_COLUMN_ID} aria-expanded='false' onClick={layout.notebooks === 'hidden' ? onToggleColumns : onToggleList}>Show columns</button>}
      />
    </I18nProvider>
  );
}

const notebooksColumn = () => document.getElementById(NOTEBOOK_COLUMN_ID)!;
const listColumn = () => document.getElementById(LIST_COLUMN_ID)!;

/** A column's chrome: the elements and attributes that make up its structure and styling, without the rows of its lists and tree. */
function chrome(column: HTMLElement): string[] {
  const out: string[] = [];
  const walk = (element: Element, depth: number) => {
    const attributes = [...element.attributes].filter(attribute => !['aria-current', 'aria-pressed', 'aria-selected', 'title', 'value'].includes(attribute.name)).map(attribute => `${attribute.name}=${attribute.value}`).sort();
    out.push(`${'  '.repeat(depth)}${element.tagName.toLowerCase()} ${attributes.join(' ')}`);
    // The rows of the notebooks, the tree, the path's segments and the list are content.
    if (element.matches('[data-browse-content]')) return;
    for (const child of element.children) walk(child, depth + 1);
  };
  walk(column, 0);
  return out;
}

describe('the three columns', () => {
  it('keeps column 1 and column 2 the same elements with the same classes when a note opens, closes, and the folder or notebook changes', () => {
    const { rerender } = render(<Page />);
    const first = { notebooks: notebooksColumn(), list: listColumn(), notebooksChrome: chrome(notebooksColumn()), listChrome: chrome(listColumn()) };
    expect(first.notebooks).toHaveClass('browse-column-notebooks');
    expect(first.list).toHaveClass('browse-column-list');
    const same = () => {
      expect(notebooksColumn()).toBe(first.notebooks);
      expect(listColumn()).toBe(first.list);
      expect(chrome(notebooksColumn())).toEqual(first.notebooksChrome);
      expect(chrome(listColumn())).toEqual(first.listChrome);
    };
    rerender(<Page note='a' />);
    expect(screen.getByText('Note a')).toBeInTheDocument();
    same();
    rerender(<Page />);
    same();
    rerender(<Page note='b' folder='projects' />);
    expect(screen.getByText('Note b')).toBeInTheDocument();
    same();
    rerender(<Page note='b' notebookId='work' />);
    same();
  });

  it('lays out all three columns (A1), the notebooks rail (A2), and only the note once both fold (A3)', () => {
    const { rerender } = render(<Page note='a' />);
    const root = document.querySelector('.browse-columns')!;
    expect(root).toHaveAttribute('data-notebooks', 'open');
    expect(root).toHaveAttribute('data-list', 'open');
    expect(notebooksColumn()).toBeVisible();
    expect(listColumn()).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Show columns' })).not.toBeInTheDocument();

    rerender(<Page note='a' layout={{ notebooks: 'rail', list: true }} />);
    expect(root).toHaveAttribute('data-notebooks', 'rail');
    expect(screen.getByRole('button', { name: 'Expand notebooks' })).toHaveAttribute('aria-expanded', 'false');

    rerender(<Page note='a' layout={{ notebooks: 'hidden', list: false }} />);
    expect(root).toHaveAttribute('data-notebooks', 'hidden');
    expect(root).toHaveAttribute('data-list', 'closed');
    expect(notebooksColumn()).not.toBeVisible();
    expect(listColumn()).not.toBeVisible();
    expect(screen.getByText('Note a')).toBeVisible();
    // The way back sits left of the note's title.
    expect(screen.getByRole('button', { name: 'Show columns' }).closest('.browse-column-note')).not.toBeNull();
  });

  it('spreads the table and the board across the note column, keeping the notebooks column', () => {
    const { rerender } = render(<Page note='a' presentation='table' />);
    const root = document.querySelector('.browse-columns')!;
    expect(root).toHaveAttribute('data-merged', 'true');
    expect(notebooksColumn()).toBeVisible();
    expect(listColumn()).toBeVisible();
    // The note column stays mounted, out of sight, so its editors keep their state.
    expect(screen.getByText('Note a')).not.toBeVisible();
    expect(screen.queryByRole('button', { name: 'Hide note list' })).not.toBeInTheDocument();
    rerender(<Page note='a' presentation='kanban' layout={{ notebooks: 'open', list: false }} />);
    expect(listColumn()).toBeVisible();
    expect(screen.getByText('Note a')).not.toBeVisible();
    rerender(<Page note='a' presentation='list' />);
    expect(root).not.toHaveAttribute('data-merged');
    expect(screen.getByText('Note a')).toBeVisible();
  });
});

/** The page with its columns' real state, as the app keeps it. */
function Stateful() {
  const columns = useBrowseColumns({ panes: 1 });
  return <Page note='a' layout={columns.layout} measure={columns.measure} onToggleNotebooks={columns.toggleNotebooks} onToggleList={columns.toggleList} onToggleColumns={columns.toggleColumns} />;
}

describe('folding by hand', () => {
  it('keeps the keyboard on the toggle that brings a folded column back', () => {
    render(<Stateful />);
    const collapseList = screen.getByRole('button', { name: 'Hide note list' });
    expect(collapseList).toHaveAttribute('aria-expanded', 'true');
    expect(collapseList).toHaveAttribute('aria-controls', LIST_COLUMN_ID);
    collapseList.focus();
    fireEvent.click(collapseList);
    expect(listColumn()).not.toBeVisible();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Show columns' }));

    const collapseNotebooks = screen.getByRole('button', { name: 'Collapse notebooks' });
    expect(collapseNotebooks).toHaveAttribute('aria-controls', NOTEBOOK_COLUMN_ID);
    collapseNotebooks.focus();
    fireEvent.click(collapseNotebooks);
    // Both folded: only the note and the way back are left.
    expect(document.querySelector('.browse-columns')).toHaveAttribute('data-notebooks', 'hidden');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Show columns' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show columns' }));
    expect(notebooksColumn()).toBeVisible();
    expect(listColumn()).toBeVisible();
  });

  it('moves the keyboard to the rail\'s own toggle when the notebooks column folds to its rail, and back when it opens', () => {
    render(<Stateful />);
    const collapse = screen.getByRole('button', { name: 'Collapse notebooks' });
    collapse.focus();
    fireEvent.click(collapse);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Expand notebooks' }));
    fireEvent.click(screen.getByRole('button', { name: 'Expand notebooks' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Collapse notebooks' }));
  });

  it('keeps the folded columns for the next visit in this browser', () => {
    const first = render(<Stateful />);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse notebooks' }));
    expect(document.querySelector('.browse-columns')).toHaveAttribute('data-notebooks', 'rail');
    first.unmount();
    render(<Stateful />);
    expect(document.querySelector('.browse-columns')).toHaveAttribute('data-notebooks', 'rail');
    expect(screen.getByRole('button', { name: 'Expand notebooks' })).toBeInTheDocument();
  });
});

describe('narrow pages', () => {
  it('folds the notebooks column to its rail below 1100px, respects opening it by hand, and opens it again once there is room', () => {
    window.innerWidth = 1000;
    render(<Stateful />);
    expect(document.querySelector('.browse-columns')).toHaveAttribute('data-notebooks', 'rail');
    fireEvent.click(screen.getByRole('button', { name: 'Expand notebooks' }));
    expect(document.querySelector('.browse-columns')).toHaveAttribute('data-notebooks', 'open');
    act(() => {
      window.innerWidth = 1440;
      window.dispatchEvent(new Event('resize'));
    });
    expect(document.querySelector('.browse-columns')).toHaveAttribute('data-notebooks', 'open');
    act(() => {
      window.innerWidth = 1050;
      window.dispatchEvent(new Event('resize'));
    });
    expect(document.querySelector('.browse-columns')).toHaveAttribute('data-notebooks', 'rail');
    // Folding by itself is not the person's choice: on a wide page the column is open again.
    act(() => {
      window.innerWidth = 1440;
      window.dispatchEvent(new Event('resize'));
    });
    expect(document.querySelector('.browse-columns')).toHaveAttribute('data-notebooks', 'open');
    expect(JSON.parse(window.localStorage.getItem('mygitnotes:browse-columns') ?? '{}')).toEqual({ notebooksCollapsed: false, listCollapsed: false });
  });

  it('folds the notebooks column when the panes of a Focus need the room', () => {
    function Panes({ panes }: { panes: number; }) {
      const columns = useBrowseColumns({ panes });
      return <Page note='a' layout={columns.layout} measure={element => columns.measure(element && Object.assign(element, { getBoundingClientRect: () => ({ width: 1391 }) as DOMRect }))} />;
    }
    const { rerender } = render(<Panes panes={1} />);
    expect(document.querySelector('.browse-columns')).toHaveAttribute('data-notebooks', 'open');
    rerender(<Panes panes={2} />);
    expect(document.querySelector('.browse-columns')).toHaveAttribute('data-notebooks', 'rail');
    // The list stays.
    expect(listColumn()).toBeVisible();
  });
});

it('runs the column toggles from the keyboard: Mod+\\ folds every column, Mod+Shift+\\ the list alone', async () => {
  const { KeyboardRoot } = await import('../lib/keyboard/KeyboardDispatcher.js');
  const { useRegisterCommands } = await import('../lib/commands/registry.js');
  const { browseColumnCommands } = await import('../app/useBrowseColumns.js');
  const { useTranslation } = await import('../lib/i18n/index.js');
  function WithKeys() {
    const columns = useBrowseColumns({ panes: 1 });
    const { t } = useTranslation();
    useRegisterCommands(browseColumnCommands(columns, t));
    return <Page note='a' layout={columns.layout} onToggleList={columns.toggleList} onToggleNotebooks={columns.toggleNotebooks} onToggleColumns={columns.toggleColumns} />;
  }
  render(<I18nProvider><KeyboardRoot><WithKeys /></KeyboardRoot></I18nProvider>);
  const press = (init: KeyboardEventInit) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: '\\', code: 'Backslash', ctrlKey: true, ...init });
    act(() => {
      document.body.dispatchEvent(event);
    });
    return event;
  };
  const root = () => document.querySelector('.browse-columns')!;
  expect(press({ shiftKey: true }).defaultPrevented).toBe(true);
  expect(root()).toHaveAttribute('data-list', 'closed');
  expect(root()).toHaveAttribute('data-notebooks', 'open');
  press({ shiftKey: true });
  expect(root()).toHaveAttribute('data-list', 'open');
  press({});
  expect(root()).toHaveAttribute('data-notebooks', 'hidden');
  expect(root()).toHaveAttribute('data-list', 'closed');
  press({});
  expect(root()).toHaveAttribute('data-notebooks', 'open');
  expect(root()).toHaveAttribute('data-list', 'open');
});

it('names every column toggle as a button with its state', () => {
  const onToggle = vi.fn();
  render(<Page onToggleNotebooks={onToggle} />);
  const toggle = screen.getByRole('button', { name: 'Collapse notebooks' });
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(toggle);
  expect(onToggle).toHaveBeenCalledOnce();
});
