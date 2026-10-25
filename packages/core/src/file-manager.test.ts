import { expect, it } from 'vitest';
import { type FileSnapshot, planFileChange, retitleNoteFile } from './file-manager.js';
import { planFolderChange, relocateLinks, relocateMovedLinks } from './folder-plan.js';
import { CASE_COLLISION_ERROR } from './case-collision.js';

const snapshot = (files: Record<string, string>): FileSnapshot => {
  const paths = Object.keys(files);
  const directories = new Set<string>();
  for (const file of paths) for (let at = file.indexOf('/'); at > 0; at = file.indexOf('/', at + 1)) directories.add(file.slice(0, at));
  return { notebooks: [{ id: 'a', title: 'A', root: 'notes/a' }], directories: [...directories], protectedPaths: [], files: new Map(paths.map(file => [file, Buffer.from(files[file])])) };
};
const text = (plan: ReturnType<typeof planFileChange>, file: string) => plan.files.get(file)?.toString();

it('renames a note and retitles it in the same plan, links of other notes following the new path', () => {
  const plan = planFileChange(snapshot({ 'notes/a/old-name.md': '---\ntitle: Old name\ntags:\n  - x\n---\n\n# Old name\n\n[Other](other.md)\n', 'notes/a/other.md': '# Other\n\n[Back](old-name.md#part)\n' }), { kind: 'move', notebookId: 'a', path: 'notes/a/old-name.md', destination: 'notes/a/new-name.md', title: 'New name' });
  expect(plan.files.has('notes/a/old-name.md')).toBe(false);
  const moved = text(plan, 'notes/a/new-name.md')!;
  expect(moved).toMatch(/^---\ntitle: New name\ntags:\n {2}- x\nupdated: /);
  expect(moved).toContain('\n# New name\n');
  expect(moved).toContain('[Other](other.md)');
  expect(text(plan, 'notes/a/other.md')).toContain('[Back](new-name.md#part)');
});

it('retitles by the same rules as the editor: the H1 names a note without a frontmatter title, a different H1 stays', () => {
  const now = new Date('2026-01-02T03:04:05.000Z');
  expect(retitleNoteFile('# Old\n\nBody.\n', 'notes/a/old.md', 'Fresh', now)).toBe('---\nupdated: "2026-01-02T03:04:05.000Z"\n---\n\n# Fresh\n\nBody.\n');
  expect(retitleNoteFile('---\ntitle: Old\n---\n\n# Chapter\n', 'notes/a/old.md', 'Fresh', now)).toContain('title: Fresh');
  expect(retitleNoteFile('---\ntitle: Old\n---\n\n# Chapter\n', 'notes/a/old.md', 'Fresh', now)).toContain('# Chapter');
  expect(retitleNoteFile('Just text.\n', 'notes/a/old.md', 'Fresh', now)).toContain('title: Fresh');
  expect(retitleNoteFile('- # not a heading\n', 'notes/a/old.outline.md', 'Plan', now)).toContain('title: Plan');
});

it('leaves a compilation, a folder and a plain file untouched by the title', () => {
  const files = { 'notes/a/dir/x.png': 'bin', 'notes/a/dir/n.md': '# N\n', 'notes/a/pins.compilation.yml': 'version: 1\nid: row\ntitle: Pins\narrangement: lane\nitems: []\n' };
  const compilation = planFileChange(snapshot(files), { kind: 'move', notebookId: 'a', path: 'notes/a/pins.compilation.yml', destination: 'notes/a/renamed.compilation.yml', title: 'Renamed' });
  expect(text(compilation, 'notes/a/renamed.compilation.yml')).toBe(files['notes/a/pins.compilation.yml']);
  const folder = planFileChange(snapshot(files), { kind: 'move', notebookId: 'a', path: 'notes/a/dir', destination: 'notes/a/moved', title: 'Moved' });
  expect(text(folder, 'notes/a/moved/n.md')).toBe('# N\n');
  const image = planFileChange(snapshot(files), { kind: 'move', notebookId: 'a', path: 'notes/a/dir/x.png', destination: 'notes/a/dir/y.png', title: 'Y' });
  expect(text(image, 'notes/a/dir/y.png')).toBe('bin');
});

it('still refuses a taken destination when the move carries a title', () => {
  expect(() => planFileChange(snapshot({ 'notes/a/one.md': '# One\n', 'notes/a/two.md': '# Two\n' }), { kind: 'move', notebookId: 'a', path: 'notes/a/one.md', destination: 'notes/a/two.md', title: 'Two' })).toThrow('Destination already exists.');
});

it('refuses a name another entry has in different letter case, which macOS and Windows treat as the same file', () => {
  const files = { 'notes/a/Plans.md': '# Plans\n', 'notes/a/draft.md': '# Draft\n', 'notes/a/Archive/old.md': '# Old\n', 'notes/a/dir/n.md': '# N\n' };
  const move = (path: string, destination: string) => planFileChange(snapshot(files), { kind: 'move', notebookId: 'a', path, destination, title: 'Plans' });
  expect(() => move('notes/a/draft.md', 'notes/a/plans.md')).toThrow(CASE_COLLISION_ERROR);
  // Only the case of its own name: written over itself, then deleted.
  expect(() => move('notes/a/Plans.md', 'notes/a/plans.md')).toThrow(CASE_COLLISION_ERROR);
  expect(() => move('notes/a/dir', 'notes/a/archive')).toThrow(CASE_COLLISION_ERROR);
  expect(() => move('notes/a/dir/n.md', 'notes/a/ARCHIVE/n.md')).toThrow();
  expect(() => planFileChange(snapshot(files), { kind: 'create', notebookId: 'a', path: 'notes/a/PLANS.md' })).toThrow(CASE_COLLISION_ERROR);
  expect(() => planFileChange(snapshot(files), { kind: 'mkdir', notebookId: 'a', path: 'notes/a/archive' })).toThrow(CASE_COLLISION_ERROR);
  // A folder's own children move away with it, so they never block it.
  expect(move('notes/a/Archive', 'notes/a/kept').files.has('notes/a/kept/old.md')).toBe(true);
  expect(move('notes/a/draft.md', 'notes/a/plan-b.md').files.has('notes/a/plan-b.md')).toBe(true);
});

it('refuses a folder move or new folder whose name another entry has in different letter case', () => {
  const folders = { notebooks: [{ id: 'a', title: 'A', root: 'notes/a' }], directories: ['notes', 'notes/a', 'notes/a/Ideas', 'notes/a/box', 'notes/a/box/ideas'], protectedPaths: [], files: new Map([['notes/a/box/ideas/x.md', '# X\n']]) };
  expect(() => planFolderChange(folders, { kind: 'create', notebookId: 'a', parent: '', name: 'ideas' })).toThrow(CASE_COLLISION_ERROR);
  expect(() => planFolderChange(folders, { kind: 'move', notebookId: 'a', path: 'box/ideas', parent: '' })).toThrow(CASE_COLLISION_ERROR);
});

const spellings = (name: string) => [`[a](${name})`, `[a](./${name}#h)`, `[a](../x/${name}?q=1)`, `[a](<${name}>)`, `![i](${encodeURIComponent(name)})`, `[a](${encodeURIComponent(name).toLowerCase()})`, `[a](%${name.charCodeAt(0).toString(16)}${name.slice(1)})`, `[ref]: ${name}`, `[a](/notes/a/x/${name})`, `[a](/raw-assets/notes/a/x/${encodeURIComponent(name)})`, `[a](/api/files/raw?notebookId=a&path=notes%2Fa%2Fx%2F${encodeURIComponent(name)})`, `[a](/api/files/raw?notebookId=a&path=notes/a/x/${name.replace(/ /g, '+')})`, '`[code](' + name + ')`', 'plain mention of ' + name];

it.each(['note.md', 'my note.md', 'café.md', '中文筆記.md'])('the link prefilter gives the results of parsing every note for a link to %s', name => {
  const source = `notes/a/x/${name}`, destination = `notes/a/y/${name.replace('.md', '-2.md')}`;
  const relocate = (file: string) => file === source ? destination : file;
  const unrelated = ['# Plain\n\nNo links here.\n', '[other](other.md)\n', '[img](/raw-assets/notes/a/pic.png)\n', '---\ntitle: T\n---\n\n[ext](https://example.com/page)\n'];
  for (const raw of [...spellings(name).map(line => `# Note\n\n${line}\n`), ...unrelated]) {
    for (const file of ['notes/a/x/sibling.md', 'notes/a/other.md']) {
      const expected = relocateLinks(raw, file, file, relocate);
      const actual = relocateMovedLinks(raw, file, file, relocate, source);
      // A note that does not name the moved file is not parsed, so its unrelated links stay byte-identical.
      if (actual !== expected) expect(actual).toBe(raw);
      if (spellings(name).some(line => raw.includes(line))) expect(actual).toBe(expected);
    }
  }
  // The moved note itself is always parsed: its own relative links change with its folder.
  expect(relocateMovedLinks('[s](sibling.md)\n', source, destination, relocate, source)).toBe(relocateLinks('[s](sibling.md)\n', source, destination, relocate));
});
