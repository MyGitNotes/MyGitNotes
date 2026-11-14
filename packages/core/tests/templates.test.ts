import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { ConfigValidationError, parseWorkspaceConfig } from '../src/config.js';
import { formatTemplateDate, formatTemplateTime, isTemplateFile, listNoteTemplates, loadNoteTemplate, localTemplateClock, noteFromTemplate, renderNoteTemplate, renderTemplatePath, starterTemplate, templateFileId, templateFilePath, templateFromNote, templateValues } from '../src/templates.js';
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
    const made = noteFromTemplate({ root: 'notes/academic' }, template, { values: { book: 'Dune' }, now });
    expect(made).toMatchObject({ path: 'notes/academic/reading/2026-11-14-Dune.md', title: '2026-11-14-Dune', unfilled: ['takeaway'] });
    expect(made.metadata).toEqual({ tags: ['reading'], author: '佚名', title: '2026-11-14-Dune' });
    const own = noteFromTemplate({ root: 'notes/academic' }, template, { path: 'notes/academic/dune.md', title: 'Dune', values: { book: 'Dune' }, content: 'My own body', metadata: { author: 'Me' }, now });
    expect(own).toMatchObject({ path: 'notes/academic/dune.md', title: 'Dune', content: 'My own body', metadata: { author: 'Me', title: 'Dune' }, unfilled: [] });
    expect(() => noteFromTemplate({ root: 'notes/academic' }, template, { now })).toThrow(/needs a value for book/);
    expect(() => noteFromTemplate({ root: 'notes/academic' }, { metadata: {}, content: '' }, { now })).toThrow(/path is required/);
  });

  it('names a template file after a name made safe, and reads its id back', () => {
    expect(templateFilePath({ root: 'notes/ex' }, ' 讀書/筆記 ')).toBe('notes/ex/.templates/讀書-筆記.md');
    expect(() => templateFilePath({ root: 'notes/ex' }, ' .. ')).toThrow(/needs a name/);
    expect(templateFileId('.templates/讀書-筆記.md')).toBe('讀書-筆記');
    expect(templateFileId('.templates/a/b.md')).toBeUndefined();
    expect(templateFileId('x/.templates/b.md')).toBeUndefined();
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
