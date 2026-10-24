import { describe, expect, it } from 'vitest';
import { applyDivision, closeTab, displayFocus, emptyFocusLayout, findFocusPane, findFocusTab, findFocusTabInPane, FOCUS_DIVISIONS, FOCUS_DOCUMENT, FOCUS_MAX_PANES, FOCUS_MAX_TABS, FocusError, type FocusLayout, FocusLayoutSchema, type FocusNode, FocusPageSchema, focusPaneIndex, focusPanes, FocusSchema, focusTabCount, focusTabKey, foreignFocusTab, legacyDivisionOf, legacyFocusTree, moveTab, nameFocus, notebookFocuses, ownFocusPage, placeTab, placeTabs, pruneFocus, readFocusLayout, readFocusPage, relocateFocusPaths, removeFocus, renameFocus, updateFocus, writeFocusPage } from '../src/focus-page.js';
import { NewerVersionError } from '../src/newer-version-error.js';
import { parse as parseYaml } from 'yaml';
import { readWorkspaceDocument, validateWorkspaceDocument, writeWorkspaceDocument } from '../src/workspace-documents.js';

const note = (path: string) => ({ kind: 'note' as const, path });
/** A tab to a compilation is a path tab like any note. */
const compilation = (id: string) => note(`notes/work/${id}.compilation.yml`);
type Tab = ReturnType<typeof note>;
const leaf = (id: string, ...tabs: Tab[]) => ({ kind: 'pane' as const, id, tabs });
const split = (id: string, orientation: 'horizontal' | 'vertical', ...children: unknown[]) => ({ kind: 'split' as const, id, orientation, children });
const single = (...tabs: Tab[]) => ({ root: leaf('p1', ...tabs) });
const columns = (...panes: ReturnType<typeof leaf>[]) => ({ root: split('columns', 'horizontal', ...panes) }) as unknown as FocusLayout;
const focus = (overrides: Record<string, unknown> = {}) => ({ root: leaf('p1'), id: 'f1', notebookId: 'nb1', name: 'Work', ...overrides });
const notes = (count: number) => Array.from({ length: count }, (_, index) => note(`n${index}.md`));
const tabsOf = (layout: FocusLayout) => focusPanes(layout).map(pane => pane.tabs);
const code = (action: () => unknown) => {
  try {
    action();
  } catch (error) {
    return (error as FocusError).code;
  }
  return undefined;
};
/** A division laid out with note `<division>-<pane>.md` in every pane. */
const filled = (division: typeof FOCUS_DIVISIONS[number]): FocusNode => {
  const count = { single: 1, 'columns-2': 2, 'rows-2': 2, 'major-left': 3, 'major-top': 3, 'columns-3': 3, 'grid-2x2': 4 }[division];
  return legacyFocusTree(division, Array.from({ length: count }, (_, index) => [note(`${division}-${index + 1}.md`)]));
};

describe('Focus schema invariants', () => {
  it('allows the same note tab placed in two panes', () => {
    expect(FocusLayoutSchema.safeParse({ root: split('s', 'horizontal', leaf('p1', note('a.md')), leaf('p2', note('a.md'))) }).success).toBe(true);
  });
  it('dedupes a same-pane duplicate on parse, keeping the first occurrence', () => {
    const parsed = FocusLayoutSchema.parse(single(note('a.md'), compilation('l1'), note('a.md')));
    expect(parsed).toEqual(single(note('a.md'), compilation('l1')));
  });
  it('returns an equal layout when parsing finds nothing to normalise', () => {
    const input = single(note('a.md'));
    expect(FocusLayoutSchema.parse(input)).toEqual(input);
  });
  it('replaces a split with one child by the child', () => {
    expect(FocusLayoutSchema.parse({ root: split('s', 'horizontal', leaf('p1', note('a.md'))) })).toEqual(single(note('a.md')));
  });
  it('flattens a split nested in a split of the same orientation, at its position', () => {
    const parsed = FocusLayoutSchema.parse({ root: split('outer', 'horizontal', leaf('p1'), split('inner', 'horizontal', leaf('p2'), leaf('p3')), leaf('p4')) });
    expect(parsed.root).toEqual(split('outer', 'horizontal', leaf('p1'), leaf('p2'), leaf('p3'), leaf('p4')));
  });
  it('keeps a split nested in a split of the other orientation', () => {
    const root = split('outer', 'horizontal', leaf('p1'), split('inner', 'vertical', leaf('p2'), leaf('p3')));
    expect(FocusLayoutSchema.parse({ root }).root).toEqual(root);
  });
  it('rejects a duplicate node id, panes and splits sharing one namespace', () => {
    expect(FocusLayoutSchema.safeParse({ root: split('s', 'horizontal', leaf('p1'), leaf('p1')) }).success).toBe(false);
    expect(FocusLayoutSchema.safeParse({ root: split('p1', 'horizontal', leaf('p1'), leaf('p2')) }).success).toBe(false);
  });
  it('rejects a split without children and an invalid node id', () => {
    expect(FocusLayoutSchema.safeParse({ root: split('s', 'horizontal') }).success).toBe(false);
    expect(FocusLayoutSchema.safeParse({ root: leaf('has space') }).success).toBe(false);
  });
  it('caps panes at FOCUS_MAX_PANES', () => {
    const row = (count: number) => ({ root: split('s', 'horizontal', ...Array.from({ length: count }, (_, index) => leaf(`p${index}`))) });
    expect(FocusLayoutSchema.safeParse(row(FOCUS_MAX_PANES)).success).toBe(true);
    expect(FocusLayoutSchema.safeParse(row(FOCUS_MAX_PANES + 1)).success).toBe(false);
  });
  it('caps nesting at four split levels', () => {
    const nested = (levels: number): unknown => levels === 0 ? leaf('leaf') : split(`s${levels}`, levels % 2 ? 'horizontal' : 'vertical', nested(levels - 1), leaf(`side${levels}`));
    expect(FocusLayoutSchema.safeParse({ root: nested(4) }).success).toBe(true);
    expect(FocusLayoutSchema.safeParse({ root: nested(5) }).success).toBe(false);
  });
  it('rejects a 10 000-level nested layout without exhausting the stack', () => {
    let root: unknown = leaf('leaf');
    for (let level = 0; level < 10_000; level++) root = split(`s${level}`, level % 2 ? 'horizontal' : 'vertical', root, leaf(`side${level}`));
    expect(() => FocusLayoutSchema.parse({ root })).toThrow(/nested too deeply/);
    expect(() => readFocusPage({ version: 2, focuses: [focus({ root })] })).toThrow(/nested too deeply/);
  });
  it('caps total tabs at FOCUS_MAX_TABS across the whole layout', () => {
    expect(FocusLayoutSchema.safeParse(single(...notes(FOCUS_MAX_TABS))).success).toBe(true);
    expect(FocusLayoutSchema.safeParse(single(...notes(FOCUS_MAX_TABS + 1))).success).toBe(false);
  });
  it('caps focuses at 40 and rejects duplicate ids', () => {
    const focuses = Array.from({ length: 40 }, (_, index) => focus({ id: `f${index}`, name: `F${index}` }));
    expect(FocusPageSchema.safeParse({ version: 2, focuses }).success).toBe(true);
    expect(FocusPageSchema.safeParse({ version: 2, focuses: [...focuses, focus({ id: 'f40', name: 'F40' })] }).success).toBe(false);
    expect(FocusPageSchema.safeParse({ version: 2, focuses: [focus({ id: 'dup' }), focus({ id: 'dup', name: 'Other' })] }).success).toBe(false);
  });
  it('rejects duplicate names within a notebook but allows the same name across notebooks', () => {
    expect(FocusPageSchema.safeParse({ version: 2, focuses: [focus({ id: 'f1', name: 'Same' }), focus({ id: 'f2', name: 'Same' })] }).success).toBe(false);
    expect(FocusPageSchema.safeParse({ version: 2, focuses: [focus({ id: 'f1', name: 'Same', notebookId: 'a' }), focus({ id: 'f2', name: 'Same', notebookId: 'b' })] }).success).toBe(true);
  });
  it('no longer accepts a lane tab', () => {
    expect(FocusLayoutSchema.safeParse(single({ kind: 'lane' } as never)).success).toBe(false);
  });
  it('rejects unknown keys everywhere the schemas are strict, and any version but 2', () => {
    expect(FocusLayoutSchema.safeParse({ ...single(), extra: 1 }).success).toBe(false);
    expect(FocusLayoutSchema.safeParse({ root: { ...leaf('p1'), extra: 1 } }).success).toBe(false);
    expect(FocusLayoutSchema.safeParse(single({ kind: 'note', path: 'a.md', extra: 1 } as never)).success).toBe(false);
    expect(FocusSchema.safeParse({ ...focus(), extra: 1 }).success).toBe(false);
    expect(FocusPageSchema.safeParse({ version: 2, focuses: [], extra: 1 }).success).toBe(false);
    expect(FocusPageSchema.safeParse({ version: 1, focuses: [] }).success).toBe(false);
  });
});

describe('pane order and lookup', () => {
  const layout = { root: split('root', 'horizontal', leaf('left'), split('right', 'vertical', leaf('top'), leaf('bottom'))) } as unknown as FocusLayout;
  it('lists panes depth first and finds them by id', () => {
    expect(focusPanes(layout).map(pane => pane.id)).toEqual(['left', 'top', 'bottom']);
    expect(focusPaneIndex(layout, 'bottom')).toBe(2);
    expect(focusPaneIndex(layout, 'missing')).toBe(-1);
    expect(findFocusPane(layout, 'top')?.id).toBe('top');
    expect(findFocusPane(layout, 'right')).toBeUndefined();
  });
  it('starts a new Focus as one empty pane', () => {
    expect(emptyFocusLayout()).toEqual({ root: leaf('p1') });
    expect(legacyDivisionOf(emptyFocusLayout())).toBe('single');
  });
});

describe('reading version 1', () => {
  const v1 = (division: string, panes: number) => ({ version: 1, focuses: [{ id: 'f1', notebookId: 'nb1', name: 'Work', division, panes: Array.from({ length: panes }, (_, index) => ({ tabs: [note(`n${index + 1}.md`)] })) }] });
  const tree = (id: string, orientation: 'horizontal' | 'vertical', ...children: unknown[]) => split(id, orientation, ...children);
  const p = (index: number) => leaf(`p${index}`, note(`n${index}.md`));
  const table: [string, number, unknown][] = [['single', 1, p(1)], ['columns-2', 2, tree('columns-2', 'horizontal', p(1), p(2))], ['rows-2', 2, tree('rows-2', 'vertical', p(1), p(2))], ['columns-3', 3, tree('columns-3', 'horizontal', p(1), p(2), p(3))], ['major-left', 3, tree('major-left', 'horizontal', p(1), tree('major-left-1', 'vertical', p(2), p(3)))], ['major-top', 3, tree('major-top', 'vertical', p(1), tree('major-top-1', 'horizontal', p(2), p(3)))], ['grid-2x2', 4, tree('grid-2x2', 'vertical', tree('grid-2x2-0', 'horizontal', p(1), p(2)), tree('grid-2x2-1', 'horizontal', p(3), p(4)))]];
  it.each(table)('migrates %s to its tree and ids', (division, count, root) => {
    expect(readFocusPage(v1(division, count))).toEqual({ version: 2, focuses: [{ id: 'f1', notebookId: 'nb1', name: 'Work', root }] });
  });
  it('covers every division', () => {
    expect(new Set(table.map(([division]) => division))).toEqual(new Set(FOCUS_DIVISIONS));
  });
  it('gives the same page when read twice', () => {
    const raw = v1('grid-2x2', 4);
    expect(JSON.stringify(readFocusPage(raw))).toBe(JSON.stringify(readFocusPage(structuredClone(raw))));
  });
  it('keeps empty panes of a migrated division', () => {
    const page = readFocusPage({ version: 1, focuses: [{ id: 'f1', notebookId: 'nb1', name: 'Work', division: 'columns-2', panes: [{ tabs: [note('a.md')] }, { tabs: [] }] }] });
    expect(tabsOf(page.focuses[0])).toEqual([[note('a.md')], []]);
  });
  it('still fails a pane count that does not match the division, and a mixed page', () => {
    expect(() => readFocusPage(v1('grid-2x2', 3))).toThrow();
    expect(() => readFocusPage({ version: 1, focuses: [v1('single', 1).focuses[0], { id: 'f2', notebookId: 'nb1', name: 'Bad', division: 'nope', panes: [] }] })).toThrow();
  });
  it('dedupes a same-pane duplicate while migrating', () => {
    const page = readFocusPage({ version: 1, focuses: [{ id: 'f1', notebookId: 'nb1', name: 'Work', division: 'single', panes: [{ tabs: [note('a.md'), note('a.md')] }] }] });
    expect(tabsOf(page.focuses[0])).toEqual([[note('a.md')]]);
  });
  it('fails with the newer-version error for a version above 2', () => {
    expect(() => readFocusPage({ version: 3, focuses: [] })).toThrow(NewerVersionError);
    expect(() => readFocusPage({ version: 3, focuses: [] })).toThrow('saved by a newer MyGitNotes');
    expect(() => readFocusPage({ version: 0, focuses: [] })).toThrow(/./);
  });
  it('reads a scratch layout stored as a division or as a tree', () => {
    expect(readFocusLayout({ division: 'columns-2', panes: [{ tabs: [note('a.md')] }, { tabs: [] }] }).root).toEqual(split('columns-2', 'horizontal', leaf('p1', note('a.md')), leaf('p2')));
    expect(readFocusLayout(single(note('a.md')))).toEqual(single(note('a.md')));
    expect(() => readFocusLayout({ division: 'columns-2', panes: [] })).toThrow();
    expect(() => readFocusLayout({ nonsense: true })).toThrow();
  });
});

describe('writing', () => {
  const store = (page: unknown) => parseYaml(writeWorkspaceDocument(FOCUS_DOCUMENT, page as never));
  const v1Page = { version: 1, focuses: [{ id: 'a', notebookId: 'nb1', name: 'A', division: 'major-left', panes: [{ tabs: [note('a.md')] }, { tabs: [] }, { tabs: [note('b.md')] }] }, { id: 'b', notebookId: 'nb1', name: 'B', division: 'single', panes: [{ tabs: [] }] }] };
  it('stores version 1 while every Focus is a division', () => {
    expect(store(readFocusPage(v1Page))).toEqual(v1Page);
  });
  it('writes a version 1 file back unchanged', () => {
    const raw = parseYaml(writeWorkspaceDocument(FOCUS_DOCUMENT, readFocusPage(v1Page)));
    expect(raw).toEqual(v1Page);
    expect(writeWorkspaceDocument(FOCUS_DOCUMENT, readWorkspaceDocument(FOCUS_DOCUMENT, writeWorkspaceDocument(FOCUS_DOCUMENT, readFocusPage(v1Page))))).toBe(writeWorkspaceDocument(FOCUS_DOCUMENT, readFocusPage(v1Page)));
  });
  it('stores every division as version 1', () => {
    for (const division of FOCUS_DIVISIONS) {
      const page = FocusPageSchema.parse({ version: 2, focuses: [focus({ root: filled(division) })] });
      expect(store(page)).toMatchObject({ version: 1, focuses: [{ division }] });
    }
  });
  it('stores the whole page as version 2 when one Focus is not a division', () => {
    const odd = { root: split('s', 'horizontal', leaf('left', note('a.md')), split('t', 'vertical', leaf('top'), leaf('bottom'))) };
    const page = FocusPageSchema.parse({ version: 2, focuses: [focus({ id: 'one' }), focus({ id: 'two', name: 'Two', ...odd })] });
    const stored = store(page);
    expect(stored.version).toBe(2);
    expect(readFocusPage(stored)).toEqual(page);
  });
  it('stores version 2 for a division shape with ids a division would not give', () => {
    const page = FocusPageSchema.parse({ version: 2, focuses: [focus({ root: split('x', 'horizontal', leaf('a'), leaf('b')) })] });
    expect(legacyDivisionOf(page.focuses[0])).toBeUndefined();
    expect(writeFocusPage(page)).toBe(page);
  });
  it('validates a stored version 1 and version 2 file, and refuses a notebook key', () => {
    const yaml = (value: unknown) => JSON.stringify(value);
    expect(() => validateWorkspaceDocument(FOCUS_DOCUMENT, yaml(v1Page))).not.toThrow();
    expect(() => validateWorkspaceDocument(FOCUS_DOCUMENT, yaml({ version: 2, focuses: [focus()] }))).not.toThrow();
    expect(() => validateWorkspaceDocument(FOCUS_DOCUMENT, yaml({ version: 3, focuses: [] }))).toThrow();
    expect(() => validateWorkspaceDocument(FOCUS_DOCUMENT, yaml({ version: 2, focuses: [focus({ notebookId: 'repo~nb1' })] }))).toThrow();
  });
});

describe('applyDivision', () => {
  it('folds removed panes onto the last remaining pane, in pane order', () => {
    const layout = { root: filled('major-left') };
    expect(tabsOf(applyDivision(layout, 'columns-2'))).toEqual([[note('major-left-1.md')], [note('major-left-2.md'), note('major-left-3.md')]]);
  });
  it('merges every pane into one when shrinking to single', () => {
    const merged = applyDivision({ root: filled('grid-2x2') }, 'single');
    expect(merged).toEqual({ root: leaf('p1', note('grid-2x2-1.md'), note('grid-2x2-2.md'), note('grid-2x2-3.md'), note('grid-2x2-4.md')) });
  });
  it('appends empty panes when growing, and builds the division tree', () => {
    const grown = applyDivision(single(note('a.md')), 'columns-2');
    expect(grown).toEqual({ root: split('columns-2', 'horizontal', leaf('p1', note('a.md')), leaf('p2')) });
    expect(legacyDivisionOf(grown)).toBe('columns-2');
  });
  it('returns the same reference for the same division, and preserves Focus fields', () => {
    const layout = single();
    expect(applyDivision(layout, 'single')).toBe(layout);
    const named = { ...focus(), root: filled('columns-2') } as unknown as FocusLayout & { id: string; name: string; notebookId: string; };
    expect(applyDivision(named, 'single')).toMatchObject({ id: 'f1', notebookId: 'nb1', name: 'Work' });
  });
  it('keeps a pane its id when the division keeps it', () => {
    expect(focusPanes(applyDivision({ root: filled('grid-2x2') }, 'rows-2')).map(pane => pane.id)).toEqual(['p1', 'p2']);
  });
  it("dedupes a note the kept pane already holds when a removed pane folds onto it, keeping the kept pane's own copy", () => {
    const layout = { root: legacyFocusTree('columns-2', [[note('a.md'), note('x.md')], [note('x.md')]]) };
    expect(applyDivision(layout, 'single')).toEqual(single(note('a.md'), note('x.md')));
  });
  it("dedupes a note shared between two removed panes when both fold onto the kept pane, keeping the earlier pane's copy", () => {
    const layout = { root: legacyFocusTree('major-left', [[note('a.md')], [note('y.md'), note('b.md')], [note('y.md'), note('c.md')]]) };
    expect(applyDivision(layout, 'single')).toEqual(single(note('a.md'), note('y.md'), note('b.md'), note('c.md')));
  });
});

describe('placeTab', () => {
  const layout = columns(leaf('p1', note('a.md'), note('b.md')), leaf('p2', note('c.md')));
  it('adds a new tab at the end of the target pane by default', () => {
    expect(tabsOf(placeTab(layout, note('d.md'), 'p2'))).toEqual([[note('a.md'), note('b.md')], [note('c.md'), note('d.md')]]);
  });
  it('inserts a new tab at a clamped index', () => {
    expect(tabsOf(placeTab(layout, note('d.md'), 'p1', 1))[0]).toEqual([note('a.md'), note('d.md'), note('b.md')]);
    expect(tabsOf(placeTab(layout, note('d.md'), 'p1', -5))[0]).toEqual([note('d.md'), note('a.md'), note('b.md')]);
    expect(tabsOf(placeTab(layout, note('d.md'), 'p1', 999))[0]).toEqual([note('a.md'), note('b.md'), note('d.md')]);
  });
  it('places a tab in the target pane without removing it from another pane', () => {
    expect(tabsOf(placeTab(layout, note('b.md'), 'p2', 0))).toEqual([[note('a.md'), note('b.md')], [note('b.md'), note('c.md')]]);
    expect(tabsOf(layout)[0]).toEqual([note('a.md'), note('b.md')]);
  });
  it('repositions an existing tab within the target pane, without duplicating it', () => {
    expect(tabsOf(placeTab(layout, note('a.md'), 'p1', 1))[0]).toEqual([note('b.md'), note('a.md')]);
  });
  it('keeps the structure and the other panes by reference', () => {
    const placed = placeTab(layout, note('d.md'), 'p2');
    expect(placed.root.kind === 'split' && layout.root.kind === 'split' && placed.root.children[0] === layout.root.children[0]).toBe(true);
  });
  it('throws invalid-pane for an unknown pane id', () => {
    expect(code(() => placeTab(layout, note('d.md'), 'p9'))).toBe('invalid-pane');
    expect(code(() => placeTab(layout, note('d.md'), 'columns'))).toBe('invalid-pane');
  });
  it('throws tab-limit only when adding would exceed the cap, never when moving', () => {
    const full = single(...notes(FOCUS_MAX_TABS)) as unknown as FocusLayout;
    expect(code(() => placeTab(full, note('overflow.md'), 'p1'))).toBe('tab-limit');
    expect(focusTabCount(placeTab(full, note('n5.md'), 'p1', 0))).toBe(FOCUS_MAX_TABS);
  });
});

describe('closeTab', () => {
  const layout = columns(leaf('p1', note('a.md'), note('b.md')), leaf('p2', note('a.md')));
  it('removes the matching tab from the given pane only, and leaves the pane when it empties', () => {
    expect(tabsOf(closeTab(layout, 'p1', focusTabKey(note('a.md'))))).toEqual([[note('b.md')], [note('a.md')]]);
    expect(tabsOf(closeTab(layout, 'p2', focusTabKey(note('a.md'))))).toEqual([[note('a.md'), note('b.md')], []]);
  });
  it('returns the same reference for an unknown key or pane', () => {
    expect(closeTab(layout, 'p1', 'note:missing.md')).toBe(layout);
    expect(closeTab(layout, 'p9', focusTabKey(note('a.md')))).toBe(layout);
  });
});

describe('moveTab', () => {
  const layout = columns(leaf('p1', note('a.md'), note('b.md')), leaf('p2', note('c.md')));
  it('removes the tab from the source pane and places it in the target pane', () => {
    expect(tabsOf(moveTab(layout, 'p1', 'p2', focusTabKey(note('a.md')), 0))).toEqual([[note('b.md')], [note('a.md'), note('c.md')]]);
  });
  it('reorders within the same pane when fromPane and toPane match', () => {
    expect(tabsOf(moveTab(layout, 'p1', 'p1', focusTabKey(note('a.md')), 1))[0]).toEqual([note('b.md'), note('a.md')]);
  });
  it('throws invalid-pane when the key is not in the source pane, or the pane does not exist', () => {
    expect(code(() => moveTab(layout, 'p1', 'p2', focusTabKey(note('c.md'))))).toBe('invalid-pane');
    expect(code(() => moveTab(layout, 'p9', 'p2', focusTabKey(note('c.md'))))).toBe('invalid-pane');
  });
});

describe('placeTabs', () => {
  const layout = columns(leaf('p1', note('a.md')), leaf('p2', note('b.md')));
  it('adds only the tabs the target pane does not already hold, reporting counts', () => {
    const result = placeTabs(layout, [note('a.md'), note('c.md'), note('d.md')], 'p1');
    expect(tabsOf(result.layout)).toEqual([[note('a.md'), note('c.md'), note('d.md')], [note('b.md')]]);
    expect([result.added, result.skipped]).toEqual([2, 1]);
  });
  it('stops adding once the layout-wide tab budget is reached, reporting the shortfall as skipped', () => {
    const full = single(...notes(FOCUS_MAX_TABS)) as unknown as FocusLayout;
    const result = placeTabs(full, [note('overflow-1.md'), note('overflow-2.md')], 'p1');
    expect([result.added, result.skipped]).toEqual([0, 2]);
    expect(result.layout).toEqual(full);
  });
  it('throws invalid-pane for an unknown pane', () => {
    expect(() => placeTabs(layout, [note('x.md')], 'p5')).toThrow(FocusError);
  });
});

describe('pruneFocus', () => {
  it('returns the same reference when nothing is dropped', () => {
    const layout = single(note('a.md'), compilation('l1')) as unknown as FocusLayout;
    expect(pruneFocus(layout, () => true)).toBe(layout);
  });
  it('drops tabs the predicate rejects and never collapses a pane', () => {
    const layout = columns(leaf('p1', note('a.md'), compilation('l1')), leaf('p2', compilation('l2')));
    const pruned = pruneFocus(layout, tab => !tab.path.endsWith('.compilation.yml'));
    expect(pruned).not.toBe(layout);
    expect(tabsOf(pruned)).toEqual([[note('a.md')], []]);
  });
});

describe('findFocusTab and focusTabCount', () => {
  it('locates a tab by key and counts tabs across panes', () => {
    const layout = columns(leaf('p1', note('a.md')), leaf('p2', note('b.md'), compilation('l1')));
    expect(findFocusTab(layout, focusTabKey(note('b.md')))).toEqual({ pane: 'p2', index: 0 });
    expect(findFocusTab(layout, 'note:missing.md')).toBeUndefined();
    expect(focusTabCount(layout)).toBe(3);
  });
  it('finds the first pane holding a tab open in several panes', () => {
    const layout = columns(leaf('p1', note('a.md')), leaf('p2', note('a.md')));
    expect(findFocusTab(layout, focusTabKey(note('a.md')))).toEqual({ pane: 'p1', index: 0 });
  });
});

describe('findFocusTabInPane', () => {
  it('only looks inside the given pane, even when the tab is open elsewhere too', () => {
    const layout = columns(leaf('p1', note('a.md')), leaf('p2', note('a.md'), note('b.md')));
    expect(findFocusTabInPane(layout, 'p1', focusTabKey(note('a.md')))).toBe(0);
    expect(findFocusTabInPane(layout, 'p2', focusTabKey(note('a.md')))).toBe(0);
    expect(findFocusTabInPane(layout, 'p2', focusTabKey(note('b.md')))).toBe(1);
    expect(findFocusTabInPane(layout, 'p1', focusTabKey(note('b.md')))).toBe(-1);
    expect(findFocusTabInPane(layout, 'p9', focusTabKey(note('b.md')))).toBe(-1);
  });
});

describe('displayFocus', () => {
  const display = (division: typeof FOCUS_DIVISIONS[number], capacity: 1 | 2 | 'all') => displayFocus({ root: filled(division) }, capacity).groups;
  it('shows every pane of the stored tree on a desktop', () => {
    expect(display('single', 'all')).toEqual([['p1']]);
    expect(display('grid-2x2', 'all')).toEqual([['p1'], ['p2'], ['p3'], ['p4']]);
    expect(displayFocus({ root: filled('major-left') }, 'all').root).toMatchObject({ kind: 'split', id: 'major-left', orientation: 'horizontal' });
  });
  it('folds everything into one pane on a phone', () => {
    expect(display('single', 1)).toEqual([['p1']]);
    expect(display('grid-2x2', 1)).toEqual([['p1', 'p2', 'p3', 'p4']]);
    expect(displayFocus({ root: filled('columns-3') }, 1).root).toEqual({ kind: 'pane', id: 'p1', panes: ['p1', 'p2', 'p3'] });
  });
  it('shows a Focus of two panes or fewer as stored on a tablet', () => {
    expect(display('single', 2)).toEqual([['p1']]);
    expect(display('rows-2', 2)).toEqual([['p1'], ['p2']]);
    expect(displayFocus({ root: filled('rows-2') }, 2).root).toMatchObject({ id: 'rows-2', orientation: 'vertical' });
  });
  it('splits a larger Focus into its root first child and the rest, along the root orientation', () => {
    expect(display('major-left', 2)).toEqual([['p1'], ['p2', 'p3']]);
    expect(display('columns-3', 2)).toEqual([['p1'], ['p2', 'p3']]);
    expect(displayFocus({ root: filled('major-top') }, 2).root).toMatchObject({ id: 'display-2', orientation: 'vertical' });
  });
  it('shows a 2×2 Focus on a tablet as its two rows', () => {
    expect(display('grid-2x2', 2)).toEqual([['p1', 'p2'], ['p3', 'p4']]);
    expect(displayFocus({ root: filled('grid-2x2') }, 2).root).toMatchObject({ id: 'display-2', orientation: 'vertical' });
  });
});

describe('relocateFocusPaths', () => {
  const build = () => ({ version: 2 as const, focuses: [focus({ id: 'f1', notebookId: 'one', root: split('s', 'horizontal', leaf('p1', note('notes/one/a.md'), compilation('l1')), split('t', 'vertical', leaf('p2', note('notes/one/b.md')), leaf('p3'))) }), focus({ id: 'f2', notebookId: 'two', name: 'Other', root: leaf('p1', note('notes/two/a.md')) })] });
  it('rewrites note paths only for the matching notebook, mutating in place and walking the whole tree', () => {
    const page = FocusPageSchema.parse(build());
    const changed = relocateFocusPaths(page, 'one', path => path.replace('notes/one', 'notes/one-renamed'));
    expect(changed).toBe(true);
    expect(tabsOf(page.focuses[0])).toEqual([[note('notes/one-renamed/a.md'), compilation('l1')], [note('notes/one-renamed/b.md')], []]);
    expect(tabsOf(page.focuses[1])).toEqual([[note('notes/two/a.md')]]);
  });
  it('returns false when nothing changes', () => {
    expect(relocateFocusPaths(FocusPageSchema.parse(build()), 'one', path => path)).toBe(false);
    expect(relocateFocusPaths(FocusPageSchema.parse(build()), 'missing', path => `${path}-x`)).toBe(false);
  });
});

describe('notebookFocuses, nameFocus, renameFocus, updateFocus and removeFocus', () => {
  const layout = single(note('a.md')) as unknown as FocusLayout;
  const empty = { version: 2 as const, focuses: [] };
  const pageOf = (...focuses: ReturnType<typeof focus>[]) => FocusPageSchema.parse({ version: 2, focuses });
  it('lists a notebook Focuses in file order', () => {
    const page = pageOf(focus({ id: 'f1', notebookId: 'a' }), focus({ id: 'f2', notebookId: 'b', name: 'B' }), focus({ id: 'f3', notebookId: 'a', name: 'C' }));
    expect(notebookFocuses(page, 'a').map(f => f.id)).toEqual(['f1', 'f3']);
  });
  it('appends a named Focus and validates the resulting page', () => {
    const { page: next, focus: created } = nameFocus(empty, layout, 'nb1', '  Work  ');
    expect(created).toMatchObject({ notebookId: 'nb1', name: 'Work', root: leaf('p1', note('a.md')) });
    expect(typeof created.id).toBe('string');
    expect(next.focuses).toHaveLength(1);
    expect(() => FocusPageSchema.parse(next)).not.toThrow();
  });
  it('throws focus-limit at the cap and duplicate-name within a notebook', () => {
    const full = pageOf(...Array.from({ length: 40 }, (_, index) => focus({ id: `f${index}`, name: `F${index}` })));
    expect(code(() => nameFocus(full, layout, 'nb1', 'Overflow'))).toBe('focus-limit');
    const page = pageOf(focus({ id: 'f1', notebookId: 'nb1', name: 'Work' }));
    expect(code(() => nameFocus(page, layout, 'nb1', 'Work'))).toBe('duplicate-name');
    expect(nameFocus(page, layout, 'other', 'Work').focus.notebookId).toBe('other');
  });
  it('renames a Focus, allowing its own current name and rejecting a sibling collision', () => {
    const page = pageOf(focus({ id: 'f1', notebookId: 'nb1', name: 'Work' }), focus({ id: 'f2', notebookId: 'nb1', name: 'Play' }));
    expect(renameFocus(page, 'f1', 'Work').focuses[0].name).toBe('Work');
    expect(renameFocus(page, 'f1', '  Renamed  ').focuses[0].name).toBe('Renamed');
    expect(code(() => renameFocus(page, 'f2', 'Work'))).toBe('duplicate-name');
    expect(code(() => renameFocus(page, 'missing', 'X'))).toBe('unknown-focus');
  });
  it('updates a Focus through a pure change function and validates the result', () => {
    const page = pageOf(focus({ id: 'f1' }));
    const updated = updateFocus(page, 'f1', current => ({ ...current, root: leaf('p1', note('a.md')) }));
    expect(tabsOf(updated.focuses[0])).toEqual([[note('a.md')]]);
    expect(code(() => updateFocus(page, 'missing', current => current))).toBe('unknown-focus');
  });
  it('removes a Focus, leaving an unknown id unchanged', () => {
    const page = pageOf(focus({ id: 'f1' }), focus({ id: 'f2', name: 'Other' }));
    expect(removeFocus(page, 'f1').focuses.map(f => f.id)).toEqual(['f2']);
    expect(removeFocus(page, 'missing')).toBe(page);
  });
});

describe('Focus notebook ownership', () => {
  const notebooks = [{ id: 'work', root: 'notes/work' }, { id: 'other', root: 'notes/other' }];
  it('rejects tabs owned by another notebook, compilations included', () => {
    expect(foreignFocusTab(note('notes/work/a.md'), 'work', notebooks)).toBe(false);
    expect(foreignFocusTab(compilation('mine'), 'work', notebooks)).toBe(false);
    expect(foreignFocusTab(note('notes/other/outside.md'), 'work', notebooks)).toBe(true);
    expect(foreignFocusTab(note('notes/other/theirs.compilation.yml'), 'work', notebooks)).toBe(true);
    expect(foreignFocusTab(note('elsewhere/x.md'), 'work', notebooks)).toBe(true);
  });
  it('drops cross-notebook tabs from a stored page, through a version 2 tree', () => {
    const root = split('s', 'horizontal', leaf('p1', note('notes/work/a.md'), note('notes/other/outside.md')), leaf('p2', note('notes/other/theirs.compilation.yml')));
    const page = FocusPageSchema.parse({ version: 2, focuses: [focus({ notebookId: 'work', root })] });
    const owned = ownFocusPage(page, notebooks);
    expect(owned.foreign).toBe(true);
    expect(tabsOf(owned.page.focuses[0])).toEqual([[note('notes/work/a.md')], []]);
    expect(ownFocusPage(owned.page, notebooks)).toEqual({ page: owned.page, foreign: false });
  });
  it('keeps a Focus of a notebook another repository serves exactly as stored', () => {
    const page = FocusPageSchema.parse({ version: 2, focuses: [focus({ notebookId: 'elsewhere', root: leaf('p1', note('notes/work/a.md'), note('anything/b.md')) })] });
    expect(ownFocusPage(page, notebooks)).toEqual({ page, foreign: false });
  });
});

describe('reading a Focus file of a workspace not yet migrated', () => {
  const page = (...tabs: unknown[]) => ({ version: 1, focuses: [{ id: 'f1', notebookId: 'nb1', name: 'Work', division: 'single', panes: [{ tabs }] }] });
  it('leaves out legacy lane tabs so the rest of Focus still opens', () => {
    const read = readFocusPage(page(note('a.md'), { kind: 'lane', id: 'reading' }, note('b.md')));
    expect(tabsOf(read.focuses[0])).toEqual([[note('a.md'), note('b.md')]]);
  });
  it('still rejects a tab of any other unknown kind', () => {
    expect(() => readFocusPage(page({ kind: 'drawing', id: 'x' }))).toThrow();
  });
});
