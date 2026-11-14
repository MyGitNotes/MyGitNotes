import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { ConfigValidationError, parseWorkspaceConfig } from '../src/config.js';
import { formatTemplateDate, formatTemplateTime, isTemplateFile, lastUseOf, listedNoteTemplates, listNoteTemplates, listTemplates, loadNoteTemplate, localTemplateClock, mergeTemplateLists, noteFromTemplate, type NoteTemplateInfo, renderNoteTemplate, renderTemplatePath, starterTemplate, templateFileId, templateFilePath, templateFromNote, templateLastUse, templateSettings, templateValues } from '../src/templates.js';
import { parseNoteContent } from '../src/frontmatter.js';
import { scanNotebookNotes } from '../src/note-service.js';
import type { NotebookConfig } from '../src/types.js';

describe('Notebook template configuration', () => {
  it('parses notebook templates with id, title and file', () => {
    const yaml = `
schema_version: 1
workspace:
  title: "Templates"
  default_notebook: academic
notebooks:
  - id: academic
    title: "Academic"
    root: notes/academic
    templates:
      - id: reading
        title: "Literature Note"
        file: .templates/reading.md
`;
    const config = parseWorkspaceConfig(yaml);
    expect(config.notebooks[0].templates).toEqual([{ id: 'reading', title: 'Literature Note', file: '.templates/reading.md' }]);
  });

  it('rejects a template file path that escapes the notebook', () => {
    const yaml = `
schema_version: 1
workspace:
  title: "Templates"
  default_notebook: academic
notebooks:
  - id: academic
    title: "Academic"
    root: notes/academic
    templates:
      - id: reading
        title: "Literature Note"
        file: ../../etc/passwd
`;
    expect(() => parseWorkspaceConfig(yaml)).toThrow(ConfigValidationError);
  });

  it('rejects duplicate template ids within a notebook', () => {
    const yaml = `
schema_version: 1
workspace:
  title: "Templates"
  default_notebook: academic
notebooks:
  - id: academic
    title: "Academic"
    root: notes/academic
    templates:
      - id: reading
        title: "One"
        file: .templates/one.md
      - id: reading
        title: "Two"
        file: .templates/two.md
`;
    expect(() => parseWorkspaceConfig(yaml)).toThrow(ConfigValidationError);
  });
});

describe('loadNoteTemplate + renderNoteTemplate', () => {
  let repoRoot: string;
  const notebook: NotebookConfig = { id: 'academic', title: 'Academic', root: 'notes/academic', templates: [{ id: 'reading', title: 'Literature Note', file: 'templates/reading.md' }] };

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-notes-templates-'));
    const templateDir = path.join(repoRoot, 'notes/academic/templates');
    fs.mkdirSync(templateDir, { recursive: true });
    fs.writeFileSync(path.join(templateDir, 'reading.md'), '---\ntitle: "{{title}}"\nstatus: unread\ntags:\n  - reading\ncreated_on: "{{date}}"\n---\n\n# {{title}}\n\nCaptured on {{date}}.\n', 'utf-8');
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it('substitutes {{title}} and {{date}} in frontmatter and body', () => {
    const template = loadNoteTemplate(repoRoot, notebook, 'reading');
    const rendered = renderNoteTemplate(template, { title: 'Grounding and Explanation', date: '2026-09-16' });
    expect(rendered.metadata.title).toBe('Grounding and Explanation');
    expect(rendered.metadata.created_on).toBe('2026-09-16');
    expect(rendered.metadata.status).toBe('unread');
    expect(rendered.metadata.tags).toEqual(['reading']);
    expect(rendered.content).toContain('# Grounding and Explanation');
    expect(rendered.content).toContain('Captured on 2026-09-16.');
  });

  it('formats today as an ISO date', () => {
    expect(formatTemplateDate(new Date('2026-09-16T12:00:00Z'))).toBe('2026-09-16');
  });

  it('treats the title as a literal value, not a String.replace pattern', () => {
    const template = loadNoteTemplate(repoRoot, notebook, 'reading');
    const rendered = renderNoteTemplate(template, { title: 'Budget $$ $& $1 report', date: '2026-09-16' });
    expect(rendered.metadata.title).toBe('Budget $$ $& $1 report');
    expect(rendered.content).toContain('# Budget $$ $& $1 report');
  });

  it('excludes configured template files from notebook note scanning', () => {
    fs.writeFileSync(path.join(repoRoot, 'notes/academic/paper.md'), '---\ntitle: Paper\n---\n\nBody.\n', 'utf-8');
    const notes = scanNotebookNotes(repoRoot, notebook);
    expect(notes.map(n => n.path)).toEqual(['notes/academic/paper.md']);
  });
});

const READING = `---
template:
  name: 讀書筆記
  description: 讀完一本書的摘要與心得
  path: reading/{{date}}-{{book}}.md
  placeholders:
    book: 書名
    author:
      description: 作者
      default: 佚名
tags: [reading]
author: "{{author}}"
created: 2026-01-01T00:00:00.000Z
updated: 2026-01-02T00:00:00.000Z
---
# {{title}}

Read at {{ time }} on {{date}}.

> {{takeaway}}
`;

describe('.templates/ discovery', () => {
  let repoRoot: string;
  const notebook: NotebookConfig = { id: 'academic', title: 'Academic', root: 'notes/academic', templates: [{ id: 'registered', title: 'Registered', file: 'templates/registered.md' }, { id: 'clash', title: 'Manifest clash', file: 'templates/clash.md' }] };
  const write = (file: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(repoRoot, file)), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, file), content, 'utf-8');
  };

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-notes-template-files-'));
    write('notes/academic/templates/registered.md', '---\ntitle: "{{title}}"\n---\n# {{title}}\n');
    write('notes/academic/templates/clash.md', '# manifest {{title}}\n');
    write('notes/academic/.templates/reading.md', READING);
    write('notes/academic/.templates/clash.md', '# file {{title}}\n');
    write('notes/academic/.templates/meeting.md', '# {{title}}\n\nWith {{who}}.\n');
    // Neither a subfolder, another extension nor a dot file is a template.
    write('notes/academic/.templates/nested/deep.md', '# deep\n');
    write('notes/academic/.templates/notes.txt', 'text\n');
    write('notes/academic/.templates/.hidden.md', '# hidden\n');
    write('notes/academic/paper.md', '# Paper\n');
  });
  afterEach(() => fs.rmSync(repoRoot, { recursive: true, force: true }));

  it('lists the manifest templates first, then the .templates files no manifest entry names, the manifest winning an id clash', () => {
    const listed = listNoteTemplates(repoRoot, notebook);
    expect(listed.map(template => [template.id, template.source, template.file])).toEqual([['registered', 'manifest', 'notes/academic/templates/registered.md'], ['clash', 'manifest', 'notes/academic/templates/clash.md'], ['meeting', 'file', 'notes/academic/.templates/meeting.md'], ['reading', 'file', 'notes/academic/.templates/reading.md']]);
    expect(listed.map(template => template.name)).toEqual(['Registered', 'Manifest clash', 'meeting', '讀書筆記']);
    expect(loadNoteTemplate(repoRoot, notebook, 'clash').content).toContain('manifest');
  });

  it('describes a template with its path pattern and its declared, found and built-in placeholders', () => {
    const reading = listNoteTemplates(repoRoot, notebook).find(template => template.id === 'reading')!;
    expect(reading).toMatchObject({ notebookId: 'academic', name: '讀書筆記', description: '讀完一本書的摘要與心得', path: 'reading/{{date}}-{{book}}.md' });
    expect(reading.placeholders).toEqual([{ name: 'title', description: expect.any(String), declared: false, builtin: true }, { name: 'date', description: expect.any(String), declared: false, builtin: true }, { name: 'time', description: expect.any(String), declared: false, builtin: true }, { name: 'book', description: '書名', declared: true }, { name: 'author', description: '作者', default: '佚名', declared: true }, { name: 'takeaway', declared: false }]);
  });

  it('never lists a .templates file as a note', () => {
    expect(scanNotebookNotes(repoRoot, notebook).map(note => note.path)).toEqual(['notes/academic/paper.md']);
  });

  it('loads a .templates file by its file name and refuses an unknown id', () => {
    expect(loadNoteTemplate(repoRoot, notebook, 'meeting')).toMatchObject({ id: 'meeting', title: 'meeting' });
    expect(() => loadNoteTemplate(repoRoot, notebook, 'deep')).toThrow(/not configured/);
    expect(() => loadNoteTemplate(repoRoot, notebook, '.hidden')).toThrow(/not configured/);
  });

  it('counts only .templates/*.md and registered files in ordinary content as template files', () => {
    expect(isTemplateFile('.templates/reading.md', notebook)).toBe(true);
    expect(isTemplateFile('templates/registered.md', notebook)).toBe(true);
    expect(isTemplateFile('.templates/nested/deep.md', notebook)).toBe(false);
    expect(isTemplateFile('.other/reading.md', notebook)).toBe(false);
    expect(isTemplateFile('.templates/notes.txt', notebook)).toBe(false);
    expect(isTemplateFile('paper.md', notebook)).toBe(false);
    expect(isTemplateFile('.secret/x.md', { ...notebook, templates: [{ id: 'x', title: 'X', file: '.secret/x.md' }] })).toBe(false);
  });
});

describe('placeholders', () => {
  const template = parseNoteContent(READING);

  it('fills a given value, then the built-in, then the declared default, and leaves the rest as literal text', () => {
    const rendered = renderNoteTemplate(template, { title: 'Dune', date: '2026-11-14', time: '09:30', values: { book: 'Dune' } });
    expect(rendered.metadata).toEqual({ tags: ['reading'], author: '佚名', title: 'Dune' });
    expect(rendered.content).toBe('# Dune\n\nRead at 09:30 on 2026-11-14.\n\n> {{takeaway}}\n');
    expect(rendered.unfilled).toEqual(['takeaway']);
  });

  it('leaves a declared default unapplied when the caller fills the built-in placeholders only', () => {
    const rendered = renderNoteTemplate(template, { title: 'Dune', date: '2026-11-14', time: '09:30', defaults: false });
    expect(rendered.metadata.author).toBe('{{author}}');
    expect(rendered.unfilled).toEqual(['author', 'takeaway']);
  });

  it('drops the template block and the template file’s own id, created and updated', () => {
    const rendered = renderNoteTemplate(parseNoteContent('---\nid: tpl\ncreated: 2026-01-01\nupdated: 2026-01-02\ntemplate:\n  name: X\nkept: yes\n---\nBody\n'), { title: 'T', date: '2026-11-14' });
    expect(rendered.metadata).toEqual({ kept: 'yes', title: 'T' });
  });

  it('lets a value win over a built-in and a default, and keeps $ in a value literal', () => {
    const rendered = renderNoteTemplate(template, { title: 'T', date: '2026-11-14', time: '09:30', values: { date: '1999-01-01', author: 'Frank $& Herbert', takeaway: '$1' } });
    expect(rendered.metadata.author).toBe('Frank $& Herbert');
    expect(rendered.content).toContain('on 1999-01-01.');
    expect(rendered.content).toContain('> $1');
    expect(rendered.unfilled).toEqual([]);
  });

  it('leaves {{time}} literal when no time is given, as callers before it did not pass one', () => {
    expect(renderNoteTemplate({ metadata: {}, content: '{{time}} {{ not a name }} {{1x}}' }, { title: 'T', date: '2026-11-14' })).toMatchObject({ content: '{{time}} {{ not a name }} {{1x}}', unfilled: ['time'] });
  });

  it('refuses a value that names no placeholder, listing the ones the template has', () => {
    expect(() => templateValues(template, { boook: 'Dune' })).toThrow(/no placeholder 'boook'.*title, date, time, book, author, takeaway/);
    expect(() => templateValues(template, { book: ['Dune'] })).toThrow(/must be text/);
    expect(() => templateValues(template, 'Dune')).toThrow(/must be an object/);
    expect(templateValues(template, { book: 'Dune', date: 2026 })).toEqual({ book: 'Dune', date: '2026' });
  });

  it('fills the path pattern with values made safe as file names and refuses a placeholder without one', () => {
    expect(renderTemplatePath(template, { date: '2026-11-14', values: { book: 'Dune: Part 1/2' } })).toBe('reading/2026-11-14-Dune- Part 1-2.md');
    expect(() => renderTemplatePath(template, { date: '2026-11-14' })).toThrow(/needs a value for book/);
    expect(() => renderTemplatePath(template, { date: '2026-11-14', values: { book: '..' } })).toThrow(/needs a value for book/);
    expect(renderTemplatePath({ metadata: { template: { path: '{{folder}}/{{title}}' } } }, { date: 'd', title: 'Plan', values: { folder: '../up' } })).toBe('-up/Plan.md');
    expect(renderTemplatePath({ metadata: {} }, { date: 'd' })).toBeUndefined();
  });

  it('makes the note of a caller that fills by name: path from the pattern, title from the file name, caller fields over the template', () => {
    const now = new Date('2026-11-14T09:30:00Z');
    const made = noteFromTemplate({ root: 'notes/academic' }, template, { templateId: 'reading', values: { book: 'Dune' }, now });
    expect(made).toMatchObject({ path: 'notes/academic/reading/2026-11-14-Dune.md', title: '2026-11-14-Dune', unfilled: ['takeaway'] });
    expect(made.metadata).toEqual({ tags: ['reading'], author: '佚名', title: '2026-11-14-Dune', template: 'reading' });
    const own = noteFromTemplate({ root: 'notes/academic' }, template, { templateId: 'reading', path: 'notes/academic/dune.md', title: 'Dune', values: { book: 'Dune' }, content: 'My own body', metadata: { author: 'Me' }, now });
    expect(own).toMatchObject({ path: 'notes/academic/dune.md', title: 'Dune', content: 'My own body', metadata: { author: 'Me', title: 'Dune' }, unfilled: [] });
    expect(() => noteFromTemplate({ root: 'notes/academic' }, template, { templateId: 'reading', now })).toThrow(/needs a value for book/);
    expect(() => noteFromTemplate({ root: 'notes/academic' }, { metadata: {}, content: '' }, { templateId: 'blank', now })).toThrow(/path is required/);
  });

  it('stamps the note with the id of its template, which the caller’s metadata cannot replace', () => {
    const now = new Date('2026-11-14T09:30:00Z');
    expect(noteFromTemplate({ root: 'notes/academic' }, template, { templateId: 'reading', values: { book: 'Dune' }, metadata: { template: 'other', author: 'Me' }, now }).metadata).toMatchObject({ template: 'reading', author: 'Me' });
  });

  it('reads a note’s template stamp as no template block: no settings, no declared placeholder, and gone from a note saved as a template', () => {
    expect(templateSettings({ template: 'reading' })).toEqual({ placeholders: {} });
    expect(renderNoteTemplate({ metadata: { template: 'reading', tags: ['a'] }, content: '# {{title}}\n' }, { title: 'Copy', date: '2026-11-14' }).metadata).toEqual({ tags: ['a'], title: 'Copy' });
    expect(templateFromNote({ title: 'Dune', metadata: { template: 'reading', tags: ['a'] }, content: '# Dune\n' }).metadata).toEqual({ template: { name: 'Dune' }, tags: ['a'] });
  });

  it('names a template file after a name made safe, and reads its id back', () => {
    expect(templateFilePath({ root: 'notes/ex' }, ' 讀書/筆記 ')).toBe('notes/ex/.templates/讀書-筆記.md');
    expect(() => templateFilePath({ root: 'notes/ex' }, ' .. ')).toThrow(/needs a name/);
    expect(templateFileId('.templates/讀書-筆記.md')).toBe('讀書-筆記');
    expect(templateFileId('.templates/a/b.md')).toBeUndefined();
    expect(templateFileId('x/.templates/b.md')).toBeUndefined();
    // A backslash would reach a subfolder once the file system resolves it; a control character is no name.
    expect(templateFileId('.templates/sub\\x.md')).toBeUndefined();
    expect(templateFileId('.templates/a\u0001b.md')).toBeUndefined();
    // Spaces between leading dots do not leave a dot file behind.
    expect(templateFilePath({ root: 'notes/ex' }, '. .git')).toBe('notes/ex/.templates/git.md');
    expect(templateFilePath({ root: 'notes/ex' }, ' . . x . ')).toBe('notes/ex/.templates/x.md');
  });

  it('starts a template with a template block, and copies a note into one without the note file’s own keys', () => {
    expect(starterTemplate('Meeting')).toEqual({ metadata: { template: { name: 'Meeting', description: '' } }, content: '# {{title}}\n' });
    expect(templateFromNote({ title: 'Weekly', metadata: { id: 'weekly', created: 'c', updated: 'u', tags: ['a'], template: { name: 'old' } }, content: '# Weekly\n' })).toEqual({ metadata: { template: { name: 'Weekly' }, tags: ['a'] }, content: '# Weekly\n' });
  });

  it('formats the clock in UTC for the server and in local time for the page', () => {
    expect(formatTemplateTime(new Date('2026-09-16T12:05:00Z'))).toBe('12:05');
    expect(localTemplateClock(new Date(2026, 8, 6, 7, 5))).toEqual({ date: '2026-09-06', time: '07:05' });
  });
});

describe('the list of templates an agent asks for', () => {
  const info = (id: string, fields: Partial<NoteTemplateInfo & { lastUsed: string | null; }> = {}) => ({ notebookId: 'ex', id, name: id, source: 'file' as const, file: `notes/ex/.templates/${id}.md`, placeholders: [], lastUsed: null, ...fields });
  const templates = [info('weekly', { name: 'Weekly review' }), info('reading', { name: '讀書筆記', description: 'Notes on a Book', lastUsed: '2026-11-01T00:00:00.000Z' }), info('meeting', { name: 'Meeting', description: 'Minutes of a meeting', lastUsed: '2026-11-10T00:00:00.000Z' }), info('book-order', { name: 'Book order' })];
  const ids = (list: { templates: { id: string; }[]; }) => list.templates.map(template => template.id);

  it('orders by the last use, newest first, then the never-used by name', () => {
    expect(ids(listTemplates(templates))).toEqual(['meeting', 'reading', 'book-order', 'weekly']);
  });

  it('matches every word of the query against id, name and description, whatever the case', () => {
    expect(ids(listTemplates(templates, { query: 'BOOK' }))).toEqual(['reading', 'book-order']);
    expect(ids(listTemplates(templates, { query: ' notes  book ' }))).toEqual(['reading']);
    expect(ids(listTemplates(templates, { query: 'book meeting' }))).toEqual([]);
    expect(ids(listTemplates(templates, { query: '讀書' }))).toEqual(['reading']);
    expect(ids(listTemplates(templates, { query: 'WEEKLY' }))).toEqual(['weekly']);
  });

  it('returns 20 unless asked, at most 100, with the matches before the limit and whether any were cut', () => {
    const many = Array.from({ length: 130 }, (_, index) => info(`t${String(index).padStart(3, '0')}`));
    expect(listTemplates(many)).toMatchObject({ total: 130, truncated: true, templates: { length: 20 } });
    expect(listTemplates(many, { limit: 500 })).toMatchObject({ total: 130, truncated: true, templates: { length: 100 } });
    expect(listTemplates(many, { limit: 3, query: 't00' })).toMatchObject({ total: 10, truncated: true, templates: [{ id: 't000' }, { id: 't001' }, { id: 't002' }] });
    expect(listTemplates(templates, { limit: 4 })).toMatchObject({ total: 4, truncated: false });
    expect(() => listTemplates(templates, { limit: 'many' })).toThrow(/limit/);
  });

  it('merges the lists of several repositories in the same order, adding up their totals', () => {
    const merged = mergeTemplateLists([listTemplates(templates.slice(0, 2), { limit: 2 }), listTemplates(templates.slice(2), { limit: 2 })], 2);
    expect(merged).toMatchObject({ total: 4, truncated: true });
    expect(ids(merged)).toEqual(['meeting', 'reading']);
  });

  it('reads no inherited property as a last use, for a template named after one', () => {
    const used = templateLastUse([{ metadata: { template: 'reading', created: '2026-11-01' } }]);
    expect(lastUseOf(used, 'constructor')).toBeNull();
    expect(lastUseOf(JSON.parse(JSON.stringify(used)), 'toString')).toBeNull();
    expect(lastUseOf(used, 'reading')).toBe('2026-11-01T00:00:00.000Z');
  });

  it('dates a template’s last use by the newest note stamped with its id: the note’s created date, else its updated', () => {
    const notes = [{ metadata: { template: 'reading', created: '2026-11-01T08:00:00.000Z', updated: '2026-11-20T00:00:00.000Z' } }, { metadata: { template: 'reading', created: '2026-11-05T08:00:00+08:00' } }, { metadata: { template: 'meeting', updated: '2026-10-02T00:00:00.000Z' } }, { metadata: { template: 'undated' } }, { metadata: { template: { name: 'A template block' }, created: '2026-11-09T00:00:00.000Z' } }, { metadata: { created: '2026-11-09T00:00:00.000Z' } }];
    expect(templateLastUse(notes)).toEqual({ reading: '2026-11-05T00:00:00.000Z', meeting: '2026-10-02T00:00:00.000Z' });
  });
});

describe('a worktree’s templates', () => {
  let repoRoot: string;
  const notebook: NotebookConfig = { id: 'ex', title: 'Example', root: 'notes/ex', templates: [{ id: 'registered', title: 'Registered', file: 'kept/registered.md' }] };
  const write = (file: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(repoRoot, file)), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, file), content, 'utf-8');
  };
  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-notes-template-cache-'));
    write('notes/ex/kept/registered.md', '# {{title}}\n');
    write('notes/ex/.templates/reading.md', READING);
    write('notes/ex/.templates/meeting.md', '# {{title}}\n');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it('are parsed once while their files keep their size and times, and an edited file is read again at once', () => {
    // A file changed within the last two seconds is never trusted, as in a notes scan; these files are older than that.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 5000);
    const reads = vi.spyOn(fs, 'readFileSync');
    const templateReads = () => reads.mock.calls.filter(([file]) => /registered\.md$|\.templates/.test(String(file))).length;
    const first = listNoteTemplates(repoRoot, notebook);
    expect(templateReads()).toBe(3);
    expect(listNoteTemplates(repoRoot, notebook)).toEqual(first);
    expect(loadNoteTemplate(repoRoot, notebook, 'reading')).toMatchObject({ raw: READING, title: '讀書筆記' });
    expect(templateReads()).toBe(3);

    write('notes/ex/.templates/reading.md', '---\ntemplate:\n  name: Changed\n---\n# {{title}}\n');
    write('notes/ex/.templates/weekly.md', '# {{title}}\n');
    expect(listNoteTemplates(repoRoot, notebook).map(template => [template.id, template.name])).toEqual([['registered', 'Registered'], ['meeting', 'meeting'], ['reading', 'Changed'], ['weekly', 'weekly']]);
    expect(templateReads()).toBe(5);
    // What a caller does to a loaded template never reaches the next caller.
    (loadNoteTemplate(repoRoot, notebook, 'reading').metadata.template as { name: string; }).name = 'Mutated';
    expect(loadNoteTemplate(repoRoot, notebook, 'reading').title).toBe('Changed');
    fs.rmSync(path.join(repoRoot, 'notes/ex/.templates/weekly.md'));
    expect(listNoteTemplates(repoRoot, notebook).map(template => template.id)).toEqual(['registered', 'meeting', 'reading']);
  });

  it('are none in a symlinked .templates folder, whose files the note routes refuse', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-notes-template-link-'));
    try {
      fs.writeFileSync(path.join(outside, 'linked.md'), '# {{title}}\n');
      fs.rmSync(path.join(repoRoot, 'notes/ex/.templates'), { recursive: true });
      fs.symlinkSync(outside, path.join(repoRoot, 'notes/ex/.templates'), 'dir');
      expect(listNoteTemplates(repoRoot, notebook).map(template => template.id)).toEqual(['registered']);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('carry their last use from the notebook’s notes stamped with their id, and only .templates files are templates', () => {
    write('notes/ex/dune.md', '---\ntemplate: reading\ncreated: "2026-11-01T08:00:00.000Z"\n---\n# Dune\n');
    write('notes/ex/emma.md', '---\ntemplate: reading\ncreated: "2026-11-10T08:00:00.000Z"\n---\n# Emma\n');
    const listed = listedNoteTemplates(repoRoot, notebook);
    expect(listed.map(template => [template.id, template.lastUsed])).toEqual([['registered', null], ['meeting', null], ['reading', '2026-11-10T08:00:00.000Z']]);
  });
});
