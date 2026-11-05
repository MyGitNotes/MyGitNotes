// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { type FocusLayout, splitPane } from '@mygitnotes/core/focus-page';
import type { NoteFocus } from '../lib/use-note-focus.js';
import { I18nProvider } from '../lib/i18n/index.js';
import { FocusPane } from './FocusPane.js';
import { PhoneNotesProvider } from '../lib/phone-notes.js';

// The pane body hosts a note editor; this test is about the tab bar and the pane frame.
const hosted = vi.hoisted(() => ({ slots: [] as unknown[] }));
vi.mock('./NoteEditorHost.js', () => ({
  HostedNoteEditor: ({ actionsSlot }: { actionsSlot?: unknown; }) => {
    hosted.slots.push(actionsSlot);
    return null;
  },
}));

// The batch-add dialog reads notes through a query client this test does not provide; it only has to appear.
vi.mock('./BatchAddDialog.js', () => ({ BatchAddDialog: () => createElement('div', { role: 'dialog', 'aria-label': 'Add matching' }) }));

beforeEach(() => {
  window.localStorage.setItem('github-notes:language', 'en');
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

const layout: FocusLayout = { root: { kind: 'split', id: 'columns-2', orientation: 'horizontal', children: [{ kind: 'pane', id: 'p1', tabs: [{ kind: 'note', path: 'notes/a.md' }, { kind: 'note', path: 'notes/b.compilation.yml' }] }, { kind: 'pane', id: 'p2', tabs: [{ kind: 'note', path: 'notes/c.md' }] }] } };
const focus = { notebookId: 'life', layout, entry: { activePane: 'p1', shown: { p1: 'note:notes/a.md', p2: 'note:notes/c.md' }, recent: ['p1', 'p2'], history: { p1: ['note:notes/a.md'], p2: ['note:notes/c.md'] }, ratios: {}, hideToolbar: { p1: false, p2: false } }, notes: new Map([['notes/a.md', { title: 'Alpha' }], ['notes/b.compilation.yml', { title: 'Beta list' }], ['notes/c.md', { title: 'Gamma' }]]), editable: false, shown: null } as unknown as NoteFocus;

function pane(index: number, searchMatches: ReadonlySet<string> | null) {
  const id = `p${index + 1}`;
  const displayed = { panes: [id], pane: id, key: index === 0 ? 'note:notes/a.md' : 'note:notes/c.md' };
  return render(createElement(I18nProvider, null, createElement(FocusPane, { focus, notebookRoot: 'notes', folders: [], renderCompilation: path => createElement('div', null, path), onZoomNote: () => {}, searchMatches, displayed })));
}
const dimmedTabs = () => [...document.querySelectorAll('.focus-tab[data-dimmed]')].map(tab => tab.textContent);

it('dims nothing while the search is inactive', () => {
  pane(0, null);
  expect(dimmedTabs()).toEqual([]);
  expect(document.querySelector('.focus-pane[data-dimmed]')).toBeNull();
});

it('dims the tabs that do not match, notes and compilations alike, and keeps a pane with a match undimmed', () => {
  pane(0, new Set(['notes/a.md']));
  expect(dimmedTabs()).toEqual(['Beta list']);
  expect(document.querySelector('.focus-pane[data-dimmed]')).toBeNull();
});

it('dims a pane as a whole when none of its tabs match, and clearing the search restores it', () => {
  const view = pane(1, new Set(['notes/a.md']));
  expect(dimmedTabs()).toEqual(['Gamma']);
  expect(document.querySelector('.focus-pane[data-dimmed]')).not.toBeNull();
  view.rerender(createElement(I18nProvider, null, createElement(FocusPane, { focus, notebookRoot: 'notes', folders: [], renderCompilation: () => null, onZoomNote: () => {}, searchMatches: null, displayed: { panes: ['p2'], pane: 'p2', key: 'note:notes/c.md' } })));
  expect(dimmedTabs()).toEqual([]);
  expect(document.querySelector('.focus-pane[data-dimmed]')).toBeNull();
});

it('does not make a pane active on a press on one of its tabs, which may start a drag, but does on a press anywhere else', () => {
  const activate = vi.fn();
  const view = render(createElement(I18nProvider, null, createElement(FocusPane, { focus: { ...focus, activate } as unknown as NoteFocus, notebookRoot: 'notes', folders: [], renderCompilation: () => null, onZoomNote: () => {}, searchMatches: null, displayed: { panes: ['p2'], pane: 'p2', key: 'note:notes/c.md' } })));
  const tab = screen.getByRole('tab', { name: 'Gamma' });
  fireEvent.pointerDown(tab);
  fireEvent.focusIn(tab);
  expect(activate).not.toHaveBeenCalled();
  fireEvent.pointerDown(view.container.querySelector('.focus-pane-body')!);
  expect(activate).toHaveBeenCalledWith('p2');
});

it("leaves the shown note's actions in its own row, so the bar keeps its width for tabs", () => {
  hosted.slots.length = 0;
  const view = pane(0, null);
  expect(view.container.querySelector('.focus-pane-note-actions')).toBeNull();
  expect(hosted.slots.at(-1)).toBeUndefined();
});

it("offers the shown note's editor a slot at the start of the bar's actions while the pane hides its note row", () => {
  hosted.slots.length = 0;
  const hidden = { ...focus, entry: { ...focus.entry, hideToolbar: { p1: true, p2: false } } } as unknown as NoteFocus;
  const view = render(createElement(I18nProvider, null, createElement(FocusPane, { focus: hidden, notebookRoot: 'notes', folders: [], renderCompilation: () => null, onZoomNote: () => {}, searchMatches: null, displayed: { panes: ['p1'], pane: 'p1', key: 'note:notes/a.md' } })));
  const slot = view.container.querySelector('.focus-pane-actions')!.firstElementChild;
  expect(slot).toHaveClass('focus-pane-note-actions');
  expect(hosted.slots.at(-1)).toBe(slot);
});

describe('drop zones', () => {
  const split = vi.fn(async () => true), place = vi.fn(async () => true), moveTab = vi.fn(async () => true);
  const editable = (overrides: Record<string, unknown> = {}) => ({ ...focus, editable: true, shown: 'current', split, place, moveTab, ...overrides }) as unknown as NoteFocus;
  const BODY = { left: 0, top: 0, width: 400, height: 200 };
  const transfer = (data: Record<string, string>) => ({ types: Object.keys(data), getData: (type: string) => data[type] ?? '', dropEffect: 'none', effectAllowed: 'all', setData: (type: string, value: string) => void (data[type] = value) });
  const row = () => transfer({ 'text/plain': 'notes/new.md' });
  function mount(index: number, options: { focus?: NoteFocus; edgeDrops?: boolean; } = {}) {
    const id = `p${index + 1}`;
    const displayed = { panes: [id], pane: id, key: index === 0 ? 'note:notes/a.md' : 'note:notes/c.md' };
    const view = render(createElement(I18nProvider, null, createElement(FocusPane, { focus: options.focus ?? editable(), notebookRoot: 'notes', folders: [], renderCompilation: () => null, onZoomNote: () => {}, searchMatches: null, displayed, edgeDrops: options.edgeDrops ?? true })));
    const body = view.container.querySelector<HTMLElement>('.focus-pane-body')!;
    body.getBoundingClientRect = () => ({ ...BODY, right: 400, bottom: 200, x: 0, y: 0, toJSON: () => ({}) });
    return { view, body, section: view.container.querySelector<HTMLElement>('.focus-pane')! };
  }
  beforeEach(() => vi.clearAllMocks());
  /** jsdom has no DragEvent, so the pointer position is put on the event by hand. */
  const dragAt = (kind: 'dragOver' | 'drop', element: Element, dataTransfer: unknown, clientX: number, clientY: number, shiftKey = false) => {
    const event = createEvent[kind](element, { dataTransfer, shiftKey });
    Object.defineProperties(event, { clientX: { value: clientX }, clientY: { value: clientY }, shiftKey: { value: shiftKey } });
    fireEvent(element, event);
  };

  it('splits on a browse row dropped on an edge and previews the half the new pane takes', () => {
    const { body, section } = mount(1);
    const data = row();
    dragAt('dragOver', body, data, 390, 100);
    expect(section).toHaveAttribute('data-drop-zone', 'right');
    expect(document.querySelector('.focus-drop-preview')).toHaveAttribute('data-zone', 'right');
    dragAt('drop', body, data, 390, 100);
    expect(split).toHaveBeenCalledWith('current', 'p2', 'right', { kind: 'note', path: 'notes/new.md' }, undefined, false);
    expect(place).not.toHaveBeenCalled();
    expect(section).not.toHaveAttribute('data-drop-zone');
  });

  it('adds a tab when the drop lands on the centre', () => {
    const { body, section } = mount(1);
    const data = row();
    dragAt('dragOver', body, data, 200, 100);
    expect(section).not.toHaveAttribute('data-drop-zone');
    dragAt('drop', body, data, 200, 100);
    expect(place).toHaveBeenCalledWith('current', { kind: 'note', path: 'notes/new.md' }, 'p2', undefined, false);
    expect(split).not.toHaveBeenCalled();
  });

  it('moves a dragged tab to the edge, and copies with Shift', () => {
    const { body, view } = mount(1);
    const data = transfer({});
    fireEvent.dragStart(view.container.querySelector('.focus-tab')!, { dataTransfer: data });
    // Tab 0 of pane p2 is the pane's only tab, so it shows no edge zones there; drag a tab of p1 instead.
    fireEvent.dragEnd(view.container.querySelector('.focus-tab')!, { dataTransfer: data });
    const fromOther = transfer({ 'application/x-mygitnotes-focus-tab': JSON.stringify({ tab: { kind: 'note', path: 'notes/a.md' }, pane: 'p1' }) });
    dragAt('drop', body, fromOther, 5, 100);
    expect(split).toHaveBeenCalledWith('current', 'p2', 'left', { kind: 'note', path: 'notes/a.md' }, 'p1', false);
    dragAt('drop', body, fromOther, 5, 100, true);
    expect(split).toHaveBeenLastCalledWith('current', 'p2', 'left', { kind: 'note', path: 'notes/a.md' }, 'p1', true);
  });

  it('has no edge zones for the only tab of the pane it is dragged over', () => {
    const { body, view, section } = mount(1);
    const data = transfer({ 'application/x-mygitnotes-focus-tab': JSON.stringify({ tab: { kind: 'note', path: 'notes/c.md' }, pane: 'p2' }) });
    fireEvent.dragStart(view.container.querySelector('.focus-tab')!, { dataTransfer: data });
    dragAt('dragOver', body, data, 390, 100);
    expect(section).not.toHaveAttribute('data-drop-zone');
    dragAt('drop', body, data, 390, 100);
    expect(split).not.toHaveBeenCalled();
    fireEvent.dragEnd(view.container.querySelector('.focus-tab')!, { dataTransfer: data });
  });

  it('has no edge zones on tablets and phones, or when the Focus is read-only', () => {
    for (const options of [{ edgeDrops: false }, { focus: editable({ editable: false }) }]) {
      const { body, section, view } = mount(1, options);
      const data = row();
      dragAt('dragOver', body, data, 390, 100);
      expect(section).not.toHaveAttribute('data-drop-zone');
      dragAt('drop', body, data, 390, 100);
      expect(split).not.toHaveBeenCalled();
      view.unmount();
    }
  });

  it('falls back to the centre at the pane limit and says why in the preview', () => {
    let wide: FocusLayout = { root: { kind: 'pane', id: 'p1', tabs: [{ kind: 'note', path: 'notes/a.md' }] } };
    for (let count = 1; count < 8; count++) wide = splitPane(wide, 'p1', 'right', { kind: 'note', path: `notes/n${count}.md` }).layout;
    const { body, section } = mount(0, { focus: editable({ layout: wide, entry: { ...focus.entry, shown: { p1: 'note:notes/a.md' } } }) });
    const data = row();
    dragAt('dragOver', body, data, 390, 100);
    expect(section).not.toHaveAttribute('data-drop-zone');
    expect(document.querySelector('.focus-drop-preview')).toHaveTextContent('at most 8 panes');
    dragAt('drop', body, data, 390, 100);
    expect(split).not.toHaveBeenCalled();
    expect(place).toHaveBeenCalled();
  });
});

/** Opens the pane's own menu by keyboard, as Radix menus do not open on a jsdom click. */
async function openPaneMenu() {
  const trigger = screen.getByRole('button', { name: 'Pane actions' });
  trigger.focus();
  await act(async () => {
    fireEvent.keyDown(trigger, { key: 'Enter' });
  });
}

describe('pane buttons', () => {
  const splitShown = vi.fn(async () => true), closeEmptyPane = vi.fn(async () => true);
  const withEmptyPane: FocusLayout = { root: { kind: 'split', id: 'columns-2', orientation: 'horizontal', children: [{ kind: 'pane', id: 'p1', tabs: [{ kind: 'note', path: 'notes/a.md' }] }, { kind: 'pane', id: 'p2', tabs: [] }] } };
  const editable = (overrides: Record<string, unknown> = {}) => ({ ...focus, editable: true, shown: 'current', activate: vi.fn(), splitShown, closeEmptyPane, ...overrides }) as unknown as NoteFocus;
  function mount(options: { focus?: NoteFocus; edgeDrops?: boolean; pane?: string; key?: string | null; }) {
    const pane = options.pane ?? 'p1';
    const displayed = { panes: [pane], pane, key: options.key === undefined ? 'note:notes/a.md' : options.key };
    return render(createElement(I18nProvider, null, createElement(FocusPane, { focus: options.focus ?? editable(), notebookRoot: 'notes', folders: [], renderCompilation: () => null, onZoomNote: () => {}, searchMatches: null, displayed, edgeDrops: options.edgeDrops ?? true })));
  }
  beforeEach(() => vi.clearAllMocks());

  it('offers Split right and Split down in the pane menu on desktop, and splits the shown note', async () => {
    mount({});
    await openPaneMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Split right' }));
    await openPaneMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Split down' }));
    expect(splitShown).toHaveBeenNthCalledWith(1, 'p1', 'horizontal');
    expect(splitShown).toHaveBeenNthCalledWith(2, 'p1', 'vertical');
  });

  it('offers no split below desktop, in a read-only Focus, or in a pane that shows nothing', async () => {
    for (const options of [{ edgeDrops: false }, { focus: editable({ editable: false }) }, { key: null }]) {
      const view = mount(options);
      await openPaneMenu();
      await screen.findByRole('menuitemcheckbox', { name: 'Hide toolbar' });
      expect(screen.queryByRole('menuitem', { name: 'Split right' })).toBeNull();
      view.unmount();
    }
  });

  it('disables the split items at the pane limit and says why', async () => {
    let wide: FocusLayout = { root: { kind: 'pane', id: 'p1', tabs: [{ kind: 'note', path: 'notes/a.md' }] } };
    for (let count = 1; count < 8; count++) wide = splitPane(wide, 'p1', 'right', { kind: 'note', path: `notes/n${count}.md` }).layout;
    mount({ focus: editable({ layout: wide }) });
    await openPaneMenu();
    const items = (await screen.findAllByRole('menuitem')).filter(item => item.textContent?.startsWith('Split'));
    expect(items.map(item => item.getAttribute('aria-disabled'))).toEqual(['true', 'true']);
    expect(items[0]).toHaveTextContent('at most 8 panes');
  });

  it('offers Close pane on an empty pane next to another, not on the only pane', () => {
    const entry = { ...focus.entry, shown: { p1: 'note:notes/a.md', p2: null } };
    mount({ focus: editable({ layout: withEmptyPane, entry }), pane: 'p2', key: null });
    const close = document.querySelector<HTMLButtonElement>('.focus-pane-empty button')!;
    expect(close).toHaveTextContent('Close pane');
    close.click();
    expect(closeEmptyPane).toHaveBeenCalledWith('p2');
    cleanup();
    const only: FocusLayout = { root: { kind: 'pane', id: 'p1', tabs: [] } };
    mount({ focus: editable({ layout: only, entry: { ...focus.entry, shown: { p1: null } } }), key: null });
    expect(document.querySelector('.focus-pane-empty button')).toBeNull();
  });
});

describe('the pane menu', () => {
  const splitShown = vi.fn(async () => true), setHideToolbar = vi.fn();
  const editable = (hideToolbar = false) => ({ ...focus, editable: true, shown: 'current', activate: vi.fn(), splitShown, setHideToolbar, entry: { ...focus.entry, hideToolbar: { p1: hideToolbar, p2: false } } }) as unknown as NoteFocus;
  const onZoomNote = vi.fn();
  let width = 0;
  beforeEach(() => {
    vi.clearAllMocks();
    width = 0;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width, height: 38, left: 0, top: 0, right: width, bottom: 38, x: 0, y: 0, toJSON: () => ({}) }));
  });
  afterEach(() => vi.restoreAllMocks());
  function mount(paneWidth: number, hideToolbar = false) {
    width = paneWidth;
    const displayed = { panes: ['p1'], pane: 'p1', key: 'note:notes/a.md' };
    return render(createElement(I18nProvider, null, createElement(FocusPane, { focus: editable(hideToolbar), notebookRoot: 'notes', folders: [], renderCompilation: () => null, onZoomNote, searchMatches: null, displayed, edgeDrops: true })));
  }
  const barNames = (view: ReturnType<typeof mount>) => [...view.container.querySelectorAll('.focus-pane-actions button')].map(button => button.getAttribute('aria-label'));

  it.each([900, 300])('keeps only the pane menu beside the tabs of a %ipx pane', async width => {
    const view = mount(width);
    expect(barNames(view)).toEqual(['Pane actions']);
    expect(view.container.querySelector('.focus-pane')).not.toHaveAttribute('data-tight');
    await openPaneMenu();
    expect((await screen.findAllByRole('menuitem')).map(item => item.textContent)).toEqual(['Split right', 'Split down', 'Add matching', 'Open in zoom']);
    expect(screen.getByRole('menuitemcheckbox', { name: 'Hide toolbar' })).toHaveAttribute('aria-checked', 'false');
  });

  it.each([['Split right', 'menuitem', () => expect(splitShown).toHaveBeenCalledWith('p1', 'horizontal')], ['Split down', 'menuitem', () => expect(splitShown).toHaveBeenCalledWith('p1', 'vertical')], ['Hide toolbar', 'menuitemcheckbox', () => expect(setHideToolbar).toHaveBeenCalledWith('p1', true)], ['Open in zoom', 'menuitem', () => expect(onZoomNote).toHaveBeenCalledWith('notes/a.md')], ['Add matching', 'menuitem', () => expect(screen.getByRole('dialog')).toBeInTheDocument()]] as const)('fires %s from the menu', async (name, role, expectFired) => {
    mount(900);
    await openPaneMenu();
    fireEvent.click(await screen.findByRole(role, { name }));
    expectFired();
  });

  it("gives the bar's buttons a row of their own once the note row is hidden and the pane cannot hold them beside its tabs", () => {
    expect(mount(900, true).container.querySelector('.focus-pane')).not.toHaveAttribute('data-tight');
    cleanup();
    expect(mount(300, true).container.querySelector('.focus-pane')).toHaveAttribute('data-tight');
  });
});

describe('the tab list', () => {
  const show = vi.fn(async () => true), close = vi.fn(async () => true), place = vi.fn(async () => true);
  const many: FocusLayout = { root: { kind: 'pane', id: 'p1', tabs: ['a', 'd', 'e', 'f'].map(name => ({ kind: 'note' as const, path: `notes/${name}.md` })) } };
  const editable = { ...focus, layout: many, editable: true, shown: 'current', activate: vi.fn(), show, close, place, entry: { ...focus.entry, shown: { p1: 'note:notes/e.md' } }, notes: new Map([['notes/a.md', { title: 'Alpha' }], ['notes/d.md', { title: 'Delta' }], ['notes/e.md', { title: 'Epsilon' }], ['notes/f.md', { title: 'Zeta' }]]) } as unknown as NoteFocus;
  beforeEach(() => {
    vi.clearAllMocks();
    // The bar holds less than its tabs.
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
  });
  afterEach(() => vi.restoreAllMocks());
  const openList = async () => {
    render(createElement(I18nProvider, null, createElement(FocusPane, { focus: editable, notebookRoot: 'notes', folders: [], renderCompilation: () => null, onZoomNote: () => {}, searchMatches: null, displayed: { panes: ['p1'], pane: 'p1', key: 'note:notes/e.md' }, edgeDrops: true })));
    const trigger = screen.getByRole('button', { name: 'All tabs in this pane' });
    trigger.focus();
    await act(async () => {
      fireEvent.keyDown(trigger, { key: 'Enter' });
    });
    return screen.findAllByRole('menuitem');
  };

  const mountBar = () => render(createElement(I18nProvider, null, createElement(FocusPane, { focus: editable, notebookRoot: 'notes', folders: [], renderCompilation: () => null, onZoomNote: () => {}, searchMatches: null, displayed: { panes: ['p1'], pane: 'p1', key: 'note:notes/e.md' }, edgeDrops: true }))).container.querySelector<HTMLElement>('.focus-tabs')!;

  it('scrolls the list, and only the list, until the shown tab is whole', () => {
    // The list shows 0-300; the shown tab sits at 400-560 until the list scrolls.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
      const scroll = this.closest<HTMLElement>('.focus-tabs')?.scrollLeft ?? 0;
      const box = this.matches('.focus-tab[data-shown]') ? { left: 400 - scroll, width: 160 } : { left: 0, width: 300 };
      return { ...box, top: 0, height: 38, right: box.left + box.width, bottom: 38, x: box.left, y: 0, toJSON: () => ({}) };
    });
    expect(mountBar().scrollLeft).toBe(260);
  });

  it('scrolls the tabs sideways with the wheel', () => {
    const list = mountBar();
    list.scrollLeft = 0;
    const wheel = new WheelEvent('wheel', { deltaY: 120, cancelable: true });
    list.dispatchEvent(wheel);
    expect(list.scrollLeft).toBe(120);
    expect(wheel.defaultPrevented).toBe(true);
  });

  it('lists every tab and marks the shown one', async () => {
    const rows = await openList();
    expect(rows.map(row => row.textContent)).toEqual(['Alpha', 'Delta', 'Epsilon', 'Zeta']);
    expect(rows[2]).toHaveAttribute('data-current');
    fireEvent.click(rows[1]);
    expect(show).toHaveBeenCalledWith('p1', 'note:notes/d.md');
  });

  it("closes a tab from its row's button without showing it, and keeps the list open", async () => {
    await openList();
    fireEvent.click(screen.getByRole('button', { name: 'Close Delta' }));
    expect(close).toHaveBeenCalledWith('note:notes/d.md', 'p1');
    expect(show).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('closes the focused row with Delete', async () => {
    const rows = await openList();
    fireEvent.keyDown(rows[3], { key: 'Delete' });
    expect(close).toHaveBeenCalledWith('note:notes/f.md', 'p1');
  });

  it('reorders a row dropped on the upper half of another', async () => {
    const rows = await openList();
    const data: Record<string, string> = {};
    const transfer = { types: [] as string[], getData: (type: string) => data[type] ?? '', setData: (type: string, value: string) => void (data[type] = value, transfer.types.push(type)), dropEffect: 'none', effectAllowed: 'all' };
    fireEvent.dragStart(rows[3], { dataTransfer: transfer });
    rows[1].getBoundingClientRect = () => ({ left: 0, top: 100, width: 200, height: 30, right: 200, bottom: 130, x: 0, y: 100, toJSON: () => ({}) });
    const over = createEvent.dragOver(rows[1], { dataTransfer: transfer });
    Object.defineProperty(over, 'clientY', { value: 105 });
    fireEvent(rows[1], over);
    expect(rows[1]).toHaveAttribute('data-drop', 'before');
    const dropped = createEvent.drop(rows[1], { dataTransfer: transfer });
    Object.defineProperty(dropped, 'clientY', { value: 105 });
    fireEvent(rows[1], dropped);
    // A tab-bar drag only reorders; the pane goes on showing its tab.
    expect(place).toHaveBeenCalledWith('current', { kind: 'note', path: 'notes/f.md' }, 'p1', 1, true);
  });
});

describe('on a phone', () => {
  const asPhone = () => {
    window.matchMedia = ((query: string) => ({ matches: query.includes('max-width: 767px'), media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as typeof window.matchMedia;
  };
  afterEach(() => Reflect.deleteProperty(window, 'matchMedia'));

  it('marks the pane so its tab bar can give way, and leaves a note its own title bar', () => {
    asPhone();
    pane(0, null);
    expect(document.querySelector('.focus-pane')).toHaveAttribute('data-phone');
    // A note brings the bar itself; the pane adds no second one above it.
    expect(screen.queryByRole('button', { name: 'Back to the note list' })).toBeNull();
  });

  it('gives a compilation the way back to the list, which a note has in its own bar', () => {
    asPhone();
    const back = vi.fn();
    const displayed = { panes: ['p1'], pane: 'p1', key: 'note:notes/b.compilation.yml' };
    render(createElement(PhoneNotesProvider, { value: { back, changesCount: 0 } }, createElement(I18nProvider, null, createElement(FocusPane, { focus, notebookRoot: 'notes', folders: [], renderCompilation: path => createElement('div', null, path), onZoomNote: () => {}, searchMatches: null, displayed }))));
    fireEvent.click(screen.getByRole('button', { name: 'Back to the note list' }));
    expect(back).toHaveBeenCalledTimes(1);
  });
});
