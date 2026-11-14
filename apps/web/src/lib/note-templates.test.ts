import { noteRefKey } from '@mygitnotes/core/note-query';
import { describe, expect, it } from 'vitest';
import { isTemplatePath, noteDrafts, type NoteTemplateInfo, overlayDraftTemplates } from './note-templates.js';
import { overlayDraftRows } from './draft-overlay.js';
import type { NoteItem } from './types.js';
import type { WorkingNotes } from './working-notes.js';
import { DEFAULT_NOTE_QUERY } from '@mygitnotes/core/note-query';

const notebook = { id: 'qa~ex', root: 'notes/ex', templates: [{ id: 'registered', title: 'Registered', file: 'kept/registered.md' }] };
const note = (path: string, content: string, metadata: Record<string, unknown> = {}): NoteItem => ({ id: path, path, notebookId: 'qa~ex', title: path, content, metadata, tags: [], revision: 'a'.repeat(40) });
const drafts = (...entries: { note: NoteItem; base: NoteItem | null; deleted?: true; }[]): WorkingNotes => Object.fromEntries(entries.map(entry => [noteRefKey(entry.note), entry]));
const info = (id: string, source: 'file' | 'manifest', file: string, name = id): NoteTemplateInfo => ({ notebookId: 'qa~ex', id, name, source, file, placeholders: [] });
const served = [info('registered', 'manifest', 'notes/ex/kept/registered.md', 'Registered'), info('meeting', 'file', 'notes/ex/.templates/meeting.md'), info('reading', 'file', 'notes/ex/.templates/reading.md')];

describe('a notebook’s templates with the page’s working changes', () => {
  it('is the server’s list untouched when no working change is of a template', () => {
    expect(overlayDraftTemplates(served, notebook, drafts({ note: note('notes/ex/a.md', '# A'), base: null }))).toEqual(served);
  });

  it('adds a template created on this page, describes an edited one from its draft, and drops a deleted one', () => {
    const created = note('notes/ex/.templates/Book review.md', '# {{title}}\n\nBy {{author}}.\n', { template: { name: 'Book review', description: 'After a book', placeholders: { author: 'Who wrote it' } } });
    const edited = note('notes/ex/.templates/meeting.md', '# {{title}}\n\nWith {{who}}.\n', { template: { name: 'Standup' } });
    const removed = note('notes/ex/.templates/reading.md', '# gone');
    const listed = overlayDraftTemplates(served, notebook, drafts({ note: created, base: null }, { note: edited, base: edited }, { note: removed, base: removed, deleted: true }));
    expect(listed.map(template => [template.id, template.source, template.name])).toEqual([['registered', 'manifest', 'Registered'], ['Book review', 'file', 'Book review'], ['meeting', 'file', 'Standup']]);
    expect(listed[1]).toMatchObject({ notebookId: 'qa~ex', file: 'notes/ex/.templates/Book review.md', description: 'After a book', placeholders: expect.arrayContaining([{ name: 'author', description: 'Who wrote it', declared: true }]) });
    expect(listed[2].placeholders.map(placeholder => placeholder.name)).toContain('who');
  });

  it('keeps a manifest template’s title when its file is edited, and ignores drafts of other notebooks, subfolders and other dot folders', () => {
    const registered = note('notes/ex/kept/registered.md', '# {{title}}\n\n{{extra}}\n', { template: { name: 'Ignored' } });
    const elsewhere = { ...note('notes/other/.templates/x.md', '# x'), notebookId: 'qa~other' };
    const listed = overlayDraftTemplates(served, notebook, drafts({ note: registered, base: registered }, { note: elsewhere, base: null }, { note: note('notes/ex/.templates/sub/deep.md', '# deep'), base: null }, { note: note('notes/ex/.other/x.md', '# x'), base: null }));
    expect(listed.map(template => template.id)).toEqual(['registered', 'meeting', 'reading']);
    expect(listed[0]).toMatchObject({ name: 'Registered', source: 'manifest' });
    expect(listed[0].placeholders.map(placeholder => placeholder.name)).toContain('extra');
  });
});

describe('template files are no notes', () => {
  it('names a notebook’s .templates files and registered files as template paths, and nothing else', () => {
    expect(isTemplatePath(notebook, 'notes/ex/.templates/reading.md')).toBe(true);
    expect(isTemplatePath(notebook, 'notes/ex/kept/registered.md')).toBe(true);
    expect(isTemplatePath(notebook, 'notes/ex/.templates/sub/deep.md')).toBe(false);
    expect(isTemplatePath(notebook, 'notes/ex/a.md')).toBe(false);
    expect(isTemplatePath(notebook, 'notes/other/.templates/reading.md')).toBe(false);
    expect(isTemplatePath(undefined, 'notes/ex/.templates/reading.md')).toBe(false);
  });

  it('keeps a template’s working change out of the note lists, and hands back the same drafts when there is none', () => {
    const plain = drafts({ note: note('notes/ex/a.md', '# A'), base: null });
    expect(noteDrafts(plain)).toBe(plain);
    const mixed = drafts({ note: note('notes/ex/a.md', '# A'), base: null }, { note: note('notes/ex/.templates/new.md', '# {{title}}'), base: null });
    expect(Object.values(noteDrafts(mixed)).map(entry => entry.note.path)).toEqual(['notes/ex/a.md']);
    expect(noteDrafts(mixed)).toBe(noteDrafts(mixed));
    const query = { ...DEFAULT_NOTE_QUERY, notebookId: 'qa~ex' };
    // Without the filter the new template would be listed as an uncommitted note.
    expect(overlayDraftRows([], query, mixed).uncommitted.map(row => row.path)).toContain('notes/ex/.templates/new.md');
    expect(overlayDraftRows([], query, noteDrafts(mixed)).uncommitted.map(row => row.path)).toEqual(['notes/ex/a.md']);
  });
});
