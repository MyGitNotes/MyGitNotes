import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { parseNoteContent, patchNoteFrontmatter, replaceNoteStatus, replaceNoteTags, serializeNoteContent } from '../src/frontmatter.js';
import { patchFrontmatterField } from '../src/frontmatter-patch.js';
import { serializeNoteFile } from '../src/note-file.js';
import { renderNoteTemplate } from '../src/note-template.js';

it('quotes a plain field only when its reader type changes', () => {
  for (const title of ['yes', '2026-01-01', '12:30']) {
    const raw = serializeNoteContent({ title, date: '2026-02-02' }, 'new', false, new Date(), '---\ntitle: foo\ndate: 2025-01-01\n---\nold');
    expect(raw).toContain(`title: "${title}"`);
    expect(raw).toContain('date: 2026-02-02');
  }
});

it('preserves each reordered map item’s date style', () => {
  const raw = '---\nev:\n  - at: 2025-01-01\n  - at: "2025-02-02"\n---\nold';
  const result = serializeNoteContent({ ev: [{ at: '2025-02-02' }, { at: '2025-01-01' }] }, 'new', false, new Date(), raw);
  expect(result).toContain('- at: "2025-02-02"\n  - at: 2025-01-01');
});

// A post of the boss's Astro blog: its schema reads `pubDatetime` with `z.date()`, so the bare value must stay a YAML date.
const post = '---\ntitle: Post\npubDatetime: 2026-11-24T09:00:00+08:00\ndate: 2025-01-01\ndraft: no\nquoted: "2025-01-01"\nsingle: \'2025-01-01\'\ntags:\n  - astro\n  - on\n---\n\nBody.\n';
const kept = ['pubDatetime: 2026-11-24T09:00:00+08:00', 'date: 2025-01-01', 'draft: no', 'quoted: "2025-01-01"', "single: '2025-01-01'"];
const now = new Date('2026-11-24T10:00:00.000Z');
const file = 'blog/src/content/posts/post.md';
const { metadata } = parseNoteContent(post);
const lines = (raw: string) => raw.split('\n');

describe('a key keeps the style its note wrote it in', () => {
  it('on a body edit, which rewrites the whole block', () => {
    const raw = serializeNoteFile(file, metadata, 'New body.\n', false, now, post);
    expect(lines(raw)).toEqual(expect.arrayContaining([...kept, '  - on']));
    expect(parseNoteContent(raw).content).toBe('New body.\n');
  });

  it('on a tag patch, through the save and through replaceNoteTags', () => {
    const saved = serializeNoteFile(file, { ...metadata, tags: ['astro', 'on', '2026-11-24'] }, parseNoteContent(post).content, false, now, post);
    expect(lines(saved)).toEqual(expect.arrayContaining([...kept, '  - on', '  - "2026-11-24"']));
    const replaced = replaceNoteTags(post, ['astro', 'on', '2026-11-24']);
    expect(lines(replaced)).toEqual(expect.arrayContaining([...kept, '  - on', '  - "2026-11-24"']));
  });

  it('on an MCP replace_notes write, which serializes the replaced body over the stored text', () => {
    const raw = serializeNoteContent(metadata, 'Body, replaced.\n', false, now, post);
    expect(lines(raw)).toEqual(expect.arrayContaining(kept));
  });

  it('when only its value changes: bare stays bare, quoted stays quoted', () => {
    const edits = { ...metadata, pubDatetime: '2026-12-01T09:00:00+08:00', date: '2025-02-02', quoted: '2025-02-02', single: '2025-02-02' };
    const expected = ['pubDatetime: 2026-12-01T09:00:00+08:00', 'date: 2025-02-02', 'quoted: "2025-02-02"', "single: '2025-02-02'"];
    expect(lines(serializeNoteFile(file, edits, parseNoteContent(post).content, false, now, post))).toEqual(expect.arrayContaining(expected));
    expect(lines(serializeNoteFile(file, edits, 'New body.\n', false, now, post))).toEqual(expect.arrayContaining(expected));
    expect(lines(patchNoteFrontmatter(post, metadata, edits))).toEqual(expect.arrayContaining(expected));
    expect(replaceNoteStatus('---\nstatus: inbox\n---\nBody\n', 'on')).toBe('---\nstatus: "on"\n---\nBody\n');
  });

  it('never writes a value MGN would read back as another one', () => {
    for (const raw of [serializeNoteFile(file, { ...metadata, draft: 'true', date: '12' }, 'New body.\n', false, now, post), patchFrontmatterField(patchFrontmatterField(post, 'draft', 'true'), 'date', '12')]) {
      const read = parseNoteContent(raw).metadata;
      expect(read.draft).toBe('true');
      expect(read.date).toBe('12');
    }
  });

  it('quotes a new key holding an ambiguous string, whichever path writes it', () => {
    const due = { ...metadata, due: '2026-12-01' };
    for (const raw of [serializeNoteFile(file, due, parseNoteContent(post).content, false, now, post), serializeNoteFile(file, due, 'New body.\n', false, now, post), patchNoteFrontmatter(post, metadata, due)]) {
      expect(lines(raw)).toEqual(expect.arrayContaining([...kept, 'due: "2026-12-01"']));
      expect(YAML.parse(raw.split('---\n')[1], { version: '1.1' }).due).toBe('2026-12-01');
    }
  });
});

describe('a note made from a template', () => {
  // moldplan's 會議記錄 template writes its date placeholder quoted; the note keeps it quoted, as text for every reader.
  it.each(['"{{date}}"', "'{{date}}'"])('writes date: %s quoted', placeholder => {
    const template = parseNoteContent(`---\ntemplate:\n  name: Meeting\ndate: ${placeholder}\n---\n# {{title}}\n`);
    const { metadata: filled, content } = renderNoteTemplate(template, { title: 'Sync', date: '2026-11-24', time: '10:00' });
    const raw = serializeNoteFile('notes/sync.md', filled, content, true, now);
    expect(lines(raw)).toContain('date: "2026-11-24"');
    expect(YAML.parse(raw.split('---\n')[1], { version: '1.1' }).date).toBe('2026-11-24');
  });
});
