import { describe, expect, it } from 'vitest';
import { applyStageAction, applyStudyAction, createStudyNote, emptyStudyWorkspace, undoStudyAction } from '@mygitnotes/core/study';
import { compilationRowItems, studyQueueItems, studyRowItems, ungrouped } from './compilation-content.js';
import type { NoteItem } from './types.js';
import { type CompilationItem, type CompilationRow, isFileItem } from '@mygitnotes/core/compilation';
const notes = [{ notebookId: 'a', path: 'notes/a/one.md', title: 'One', tags: ['clue'] }, { notebookId: 'b', path: 'notes/b/two.md', title: 'Two', tags: ['clue'] }, { notebookId: 'a', path: 'notes/a/sub/three.md', title: 'Three', tags: [] }, { notebookId: 'a', path: 'notes/ab/other.md', title: 'Other', tags: [] }].map((note, i) => ({ ...note, id: String(i), content: '', metadata: {} })) as NoteItem[];
it('lists tags only from the lane notebook and respects exact folder boundaries', () => {
  const base = { id: 'row', path: 'notes/a/live.compilation.yml', name: 'Live', view: 'small' as const, notebookId: 'a', kind: 'dynamic' as const };
  expect(compilationRowItems({ ...base, source: { kind: 'tag', tag: 'clue', notebookId: 'a' } }, notes, []).map(i => isFileItem(i) && i.notebookId)).toEqual(['a']);
  expect(compilationRowItems({ ...base, notebookId: 'b', source: { kind: 'tag', tag: 'clue', notebookId: 'b' } }, notes, []).map(i => isFileItem(i) && i.path)).toEqual(['notes/b/two.md']);
  expect(compilationRowItems({ ...base, source: { kind: 'folder', notebookId: 'a', path: 'notes/a', recursive: false } }, notes, [])).toHaveLength(1);
  expect(compilationRowItems({ ...base, source: { kind: 'folder', notebookId: 'a', path: 'notes/a', recursive: true } }, notes, [])).toHaveLength(2);
  expect(compilationRowItems({ ...base, source: { kind: 'tag', tag: 'new-tag', notebookId: 'a' } }, [...notes, { ...notes[0], tags: ['new-tag'] }], [])).toHaveLength(1);
});

it('applies independent dynamic sorting to notes and assets without mutating inputs', () => {
  const row: Extract<CompilationRow, { kind: 'dynamic'; }> = { id: 'r', path: 'notes/a/sorted.compilation.yml', name: 'Sorted', view: 'small', notebookId: 'a', kind: 'dynamic', source: { kind: 'folder', notebookId: 'a', path: 'notes/a', recursive: true }, sort: { field: 'title', order: 'desc' } };
  const selected = [{ ...notes[0], title: 'Note 2', mtime: 100, metadata: { created: 300 }, status: 'published' }, { ...notes[2], title: 'Note 10', mtime: 300, metadata: { created: 100 }, status: 'capture' }];
  const assets = [{ name: 'Note 5', notebookId: 'a', path: 'notes/a/image.png', mtime: 200, size: 1, rawUrl: '', markdownRef: '' }];
  const paths = (sort: typeof row.sort) => compilationRowItems({ ...row, sort }, selected, assets, [{ id: 'a', title: 'A', root: 'notes/a', statuses: ['capture', 'published'] }]).map(item => isFileItem(item) && item.path);
  expect(paths({ field: 'title', order: 'desc' })).toEqual(['notes/a/sub/three.md', 'notes/a/image.png', 'notes/a/one.md']);
  expect(paths({ field: 'updated', order: 'asc' })).toEqual(['notes/a/one.md', 'notes/a/image.png', 'notes/a/sub/three.md']);
  expect(paths({ field: 'created', order: 'desc' })).toEqual(['notes/a/one.md', 'notes/a/image.png', 'notes/a/sub/three.md']);
  expect(paths({ field: 'status', order: 'asc' })).toEqual(['notes/a/sub/three.md', 'notes/a/one.md', 'notes/a/image.png']);
  expect(selected.map(note => note.title)).toEqual(['Note 2', 'Note 10']);
  expect(row.sort).toEqual({ field: 'title', order: 'desc' });
  const tagged: CompilationRow = { ...row, source: { kind: 'tag', tag: 'clue', notebookId: 'a' }, sort: { field: 'updated', order: 'desc' } };
  expect(compilationRowItems(tagged, selected.map(note => ({ ...note, tags: ['clue'] })), assets).map(item => isFileItem(item) && item.path)).toEqual(['notes/a/sub/three.md', 'notes/a/one.md']);
});

it('follows a manual order, then adds the members it does not name oldest update first', () => {
  const row: Extract<CompilationRow, { kind: 'dynamic'; }> = { id: 'r', path: 'notes/a/manual.compilation.yml', name: 'Manual', view: 'small', notebookId: 'a', kind: 'dynamic', source: { kind: 'folder', notebookId: 'a', path: 'notes/a', recursive: true }, sort: { field: 'manual', order: 'asc' }, manualOrder: ['notes/a/one.md', 'notes/a/gone.md', 'notes/a/sub/three.md'] };
  const selected = [{ ...notes[0], mtime: 100 }, { ...notes[2], mtime: 50 }, { ...notes[0], id: 'new-late', path: 'notes/a/late.md', title: 'Late', mtime: 400 }, { ...notes[0], id: 'new-early', path: 'notes/a/early.md', title: 'Early', mtime: 200 }];
  const assets = [{ name: 'Image', notebookId: 'a', path: 'notes/a/image.png', mtime: 300, size: 1, rawUrl: '', markdownRef: '' }];
  const paths = (next: typeof row) => compilationRowItems(next, selected, assets).map(item => isFileItem(item) && item.path);
  expect(paths(row)).toEqual(['notes/a/one.md', 'notes/a/sub/three.md', 'notes/a/early.md', 'notes/a/image.png', 'notes/a/late.md']);
  // Without a stored order every member is new, so the lane reads oldest update first.
  expect(paths({ ...row, manualOrder: undefined })).toEqual(['notes/a/sub/three.md', 'notes/a/one.md', 'notes/a/early.md', 'notes/a/image.png', 'notes/a/late.md']);
  // Another sort ignores the stored order.
  expect(paths({ ...row, sort: { field: 'title', order: 'asc' } })[0]).toBe('notes/a/early.md');
});

it('filters and sorts study views while preserving custom pin order and note status', () => {
  const now = new Date('2026-09-14T04:00:00Z');
  const selected = notes.slice(0, 2).map((note, i) => ({ ...note, status: i ? 'done' : 'working', content: 'Question\n\n---\n\nAnswer' }));
  let study = emptyStudyWorkspace();
  for (const [index, source] of selected.entries()) {
    const note = createStudyNote(source, now);
    study = applyStudyAction(study, note, note.cards[0].id, { kind: 'read', due: index ? '2026-09-16T04:00:00.000Z' : '2026-09-17T04:00:00.000Z' }, now);
  }
  const row: Extract<CompilationRow, { kind: 'custom'; }> = { id: 'custom', path: 'notes/a/selected.compilation.yml', name: 'Selected', kind: 'custom', view: 'small', notebookId: 'a', items: selected.map((note, i) => ({ id: `pin-${i}`, kind: 'note', notebookId: note.notebookId, path: note.path })) };
  expect(studyRowItems(row.items, { ...row, study: { filter: 'future', dueFirst: true } }, selected, study, now).map(item => item.id)).toEqual(['pin-1', 'pin-0']);
  expect(studyRowItems(row.items, { ...row, study: { filter: 'future', dueFirst: false, status: 'working' } }, selected, study, now).map(item => item.id)).toEqual(['pin-0']);
  expect(studyRowItems(row.items, { ...row, study: { filter: 'due', dueFirst: true } }, selected, study, now)).toEqual([]);
  expect(row.items.map(item => item.id)).toEqual(['pin-0', 'pin-1']);
  expect(selected.map(note => note.status)).toEqual(['working', 'done']);
});

it('orders cards by each move time plus its destination interval across days and after a same-stage move', () => {
  const selected = notes.slice(0, 3).map(note => ({ ...note, status: 'working' }));
  const progression = { stages: [{ status: 'working', intervalDays: 3 }, { status: 'review', intervalDays: 7 }], easy: 'two' as const };
  let study = emptyStudyWorkspace();
  // The older review-stage card is due between two working-stage cards.
  const times = ['2026-09-14T08:00:00.000Z', '2026-09-10T09:00:00.000Z', '2026-09-14T10:00:00.000Z'];
  selected.forEach((source, i) => {
    const now = new Date(times[i]);
    study = applyStageAction(study, createStudyNote(source, now), 'lane', 'working', progression, { kind: 'stage-review', rating: i === 1 ? 3 : 2 }, now);
  });
  const row: Extract<CompilationRow, { kind: 'custom'; }> = { id: 'lane', path: 'notes/a/study.compilation.yml', name: 'Study', kind: 'custom', view: 'small', notebookId: 'a', items: selected.map((note, i) => ({ id: `pin-${i}`, kind: 'note', notebookId: note.notebookId, path: note.path })), study: { filter: 'all', dueFirst: true } };
  const ordered = () => studyRowItems([...row.items].reverse(), row, selected, study).map(item => item.id);
  expect(study.notes.map(note => note.lastMovedAt)).toEqual(times);
  expect(ordered()).toEqual(['pin-0', 'pin-1', 'pin-2']);
  const first = study.notes[0];
  study = applyStageAction(study, first, 'lane', 'working', progression, { kind: 'stage-review', rating: 2 }, new Date('2026-09-14T11:00:00.000Z'));
  expect(ordered()).toEqual(['pin-1', 'pin-2', 'pin-0']);
  const dueRow = { ...row, study: { filter: 'due' as const, dueFirst: true } };
  expect(studyRowItems(row.items, dueRow, selected, study, new Date('2026-09-17T09:30:00.000Z')).map(item => item.id)).toEqual(['pin-1']);
  study = undoStudyAction(study);
  expect(ordered()).toEqual(['pin-0', 'pin-1', 'pin-2']);
});

it("lists a folder source's assets and sorts by statuses from the source's notebook, not the compilation's", () => {
  const row: CompilationRow = { id: 'r', path: 'notes/a/manual.compilation.yml', name: 'Manual', view: 'small', notebookId: 'a', kind: 'dynamic', source: { kind: 'folder', notebookId: 'b', path: 'notes/b', recursive: true }, sort: { field: 'status', order: 'asc' } };
  const members = [{ ...notes[1], title: 'Done', status: 'done' }, { ...notes[1], id: 'x', path: 'notes/b/draft.md', title: 'Draft', status: 'draft' }];
  const assets = [{ name: 'pic.png', notebookId: 'b', path: 'notes/b/pic.png', mtime: 1, size: 1, rawUrl: '', markdownRef: '' }, { name: 'own.png', notebookId: 'a', path: 'notes/b/own.png', mtime: 1, size: 1, rawUrl: '', markdownRef: '' }];
  const notebooks = [{ id: 'a', title: 'A', root: 'notes/a', statuses: ['done', 'draft'] }, { id: 'b', title: 'B', root: 'notes/b', statuses: ['draft', 'done'] }];
  expect(compilationRowItems(row, members, assets, notebooks).map(item => isFileItem(item) && `${item.notebookId}:${item.path}`)).toEqual(['b:notes/b/draft.md', 'b:notes/b/two.md', 'b:notes/b/pic.png']);
});

it('studies the pinned notes in flat order without chapter headings, while the reading views keep the headings in place', () => {
  const selected = notes.slice(0, 2).map(note => ({ ...note, status: 'working' }));
  const row: Extract<CompilationRow, { kind: 'custom'; }> = { id: 'chapters', path: 'notes/a/chapters.compilation.yml', name: 'Chapters', kind: 'custom', view: 'book', notebookId: 'a', items: [{ id: 'h1', kind: 'heading', title: 'One' }, { id: 'pin-0', kind: 'note', notebookId: 'a', path: selected[0].path }, { id: 'h2', kind: 'heading', title: 'Two' }, { id: 'pin-1', kind: 'note', notebookId: 'b', path: selected[1].path }, { id: 'v', kind: 'youtube', videoId: 'dQw4w9WgXcQ', start: 0 }] };
  const queue = studyQueueItems(compilationRowItems(row, selected, []));
  expect(queue.map(item => item.id)).toEqual(['pin-0', 'pin-1', 'v']);
  expect(studyRowItems(queue, { ...row, study: { filter: 'all', dueFirst: true } }, selected, emptyStudyWorkspace()).map(item => item.id)).toEqual(['pin-0', 'pin-1', 'v']);
  // A lane or book reads with the filter `all`, a status filter included: headings stay where they are.
  expect(studyRowItems(row.items, { ...row, study: { filter: 'all', dueFirst: false, status: 'working' } }, selected, emptyStudyWorkspace()).map(item => item.id)).toEqual(['h1', 'pin-0', 'h2', 'pin-1']);
});

describe('chapters by folder', () => {
  const notebooksA = [{ id: 'a', title: 'Company', root: 'notes/a' }];
  const folderItems = [{ notebookId: 'a', path: 'meet', title: 'Meetings', order: 0 }, { notebookId: 'a', path: 'meet/zeta', title: 'Zeta', order: 1 }, { notebookId: 'a', path: 'meet/alpha', title: 'Alpha', order: 2 }];
  const member = (path: string, title: string, mtime = 1) => ({ id: path, notebookId: 'a', path: `notes/a/${path}`, title, tags: ['meeting'], metadata: {}, content: '', mtime }) as NoteItem;
  const members = [member('meet/alpha/a.md', 'A', 3), member('meet/zeta/c.md', 'C', 2), member('meet/root.md', 'Root', 5), member('meet/zeta/b.md', 'B', 4)];
  const folderRow: Extract<CompilationRow, { kind: 'dynamic'; }> = { id: 'g', path: 'notes/a/g.compilation.yml', name: 'G', view: 'book', notebookId: 'a', kind: 'dynamic', source: { kind: 'folder', notebookId: 'a', path: 'notes/a/meet', recursive: true }, sort: { field: 'title', order: 'asc' }, group: 'folder' };
  const shown = (items: ReturnType<typeof compilationRowItems>) => items.map(item => item.kind === 'heading' ? `# ${item.title}` : isFileItem(item) ? item.path.slice('notes/a/'.length) : item.id);
  it('puts a heading named after each folder before its members, root notes first under the source folder, then folders in the sidebar order', () => {
    expect(shown(compilationRowItems(folderRow, members, [], notebooksA, folderItems))).toEqual(['# Meetings', 'meet/root.md', '# Zeta', 'meet/zeta/b.md', 'meet/zeta/c.md', '# Alpha', 'meet/alpha/a.md']);
    expect(compilationRowItems(folderRow, members, [], notebooksA, folderItems)[0]).toMatchObject({ id: 'group:meet', kind: 'heading' });
  });
  it('names the chapters of a tag source from the notebook root, its own notes under the notebook title', () => {
    const tagRow: CompilationRow = { ...folderRow, source: { kind: 'tag', tag: 'meeting', notebookId: 'a' } };
    expect(shown(compilationRowItems(tagRow, [...members, member('top.md', 'Top')], [], notebooksA, folderItems))).toEqual(['# Company', 'top.md', '# Meetings', 'meet/root.md', '# Meetings / Zeta', 'meet/zeta/b.md', 'meet/zeta/c.md', '# Meetings / Alpha', 'meet/alpha/a.md']);
  });
  it('orders each chapter by the manual order among its own members, so a path of another chapter moves nothing', () => {
    const manual = { ...folderRow, sort: { field: 'manual' as const, order: 'asc' as const }, manualOrder: ['notes/a/meet/alpha/a.md', 'notes/a/meet/zeta/c.md'] };
    expect(shown(compilationRowItems(manual, members, [], notebooksA, folderItems))).toEqual(['# Meetings', 'meet/root.md', '# Zeta', 'meet/zeta/c.md', 'meet/zeta/b.md', '# Alpha', 'meet/alpha/a.md']);
  });
  it("puts a folder source's assets in their folder's chapter after its notes, and folders of assets alone after the note chapters", () => {
    const asset = (path: string) => ({ name: path.split('/').pop()!, notebookId: 'a', path: `notes/a/${path}`, mtime: 1, size: 1, rawUrl: '', markdownRef: '' });
    expect(shown(compilationRowItems(folderRow, members, [asset('meet/zeta/pic.png'), asset('meet/files/doc.pdf')], notebooksA, folderItems))).toEqual(['# Meetings', 'meet/root.md', '# Zeta', 'meet/zeta/b.md', 'meet/zeta/c.md', 'meet/zeta/pic.png', '# Alpha', 'meet/alpha/a.md', '# files', 'meet/files/doc.pdf']);
  });
  it('leaves a compilation without group as it was, and the study queue the same with and without group', () => {
    const plain = { ...folderRow, group: undefined };
    expect(compilationRowItems(plain, members, [], notebooksA, folderItems).every(item => item.kind !== 'heading')).toBe(true);
    // A study session reads the members as if the compilation had no chapters.
    expect(studyQueueItems(compilationRowItems(ungrouped(folderRow), members, [], notebooksA, folderItems)).map(item => item.id)).toEqual(compilationRowItems(plain, members, [], notebooksA, folderItems).map(item => item.id));
  });
});

it('studies a note pinned as two sections once, at its first item', () => {
  const selected = notes.slice(0, 2);
  const items: CompilationItem[] = [{ id: 's1', kind: 'note', notebookId: 'a', path: selected[0].path, anchor: 'One' }, { id: 'b', kind: 'note', notebookId: 'b', path: selected[1].path }, { id: 's2', kind: 'note', notebookId: 'a', path: selected[0].path, anchor: 'Two' }];
  expect(studyQueueItems(items).map(item => item.id)).toEqual(['s1', 'b']);
});
