import { describe, expect, it } from 'vitest';
import { fileLivePath, livePathRuleParts, retargetLivePathRule } from './live-checkin.js';
import type { NotebookConfig } from './types.js';

/*
 * Moving and renaming a pending live note (docs/specs/2026-11-15-builtin-live-editor §20.2, slice N1c): the path rule a
 * check-in files it by is built anew from the old rule, a folder and a name. Nothing is committed until the filing.
 */

const notebook: NotebookConfig = { id: 'life', title: 'Life', root: 'notes/life', excluded: ['drafts/**'] };
const meeting = '會議/其他/{{date}} {{title}}.md';

describe('retargetLivePathRule', () => {
  it('replaces the folder and keeps the name pattern, so the title still names the file', () => {
    expect(retargetLivePathRule('inbox/{{title}}.md', { folder: 'projects/a' }, notebook)).toEqual({ pathRule: 'projects/a/{{title}}.md' });
    expect(retargetLivePathRule('{{title}}.md', { folder: '專案' }, notebook)).toEqual({ pathRule: '專案/{{title}}.md' });
    expect(retargetLivePathRule('inbox/{{title}}.md', { folder: '' }, notebook)).toEqual({ pathRule: '{{title}}.md' });
    expect(retargetLivePathRule(meeting, { folder: 'archive' }, notebook)).toEqual({ pathRule: 'archive/{{date}} {{title}}.md' });
  });

  it('fixes the file name on a rename, with no placeholder left, and adds .md where it is missing', () => {
    expect(retargetLivePathRule('inbox/{{title}}.md', { name: 'Plan' }, notebook)).toEqual({ pathRule: 'inbox/Plan.md' });
    expect(retargetLivePathRule('inbox/{{title}}.md', { name: 'Plan.md' }, notebook)).toEqual({ pathRule: 'inbox/Plan.md' });
    expect(retargetLivePathRule('inbox/{{title}}.md', { name: 'Plan.MARKDOWN' }, notebook)).toEqual({ pathRule: 'inbox/Plan.MARKDOWN' });
    expect(retargetLivePathRule(meeting, { name: '週會' }, notebook)).toEqual({ pathRule: '會議/其他/週會.md' });
    expect(retargetLivePathRule('{{title}}.md', { name: '  a/b: c?  ' }, notebook)).toEqual({ pathRule: 'a-b- c-.md' });
  });

  it('moves and renames at once, and a later move keeps a fixed name', () => {
    expect(retargetLivePathRule('inbox/{{title}}.md', { folder: 'x', name: 'Plan' }, notebook)).toEqual({ pathRule: 'x/Plan.md' });
    expect(retargetLivePathRule('inbox/Plan.md', { folder: 'y/z' }, notebook)).toEqual({ pathRule: 'y/z/Plan.md' });
  });

  it('refuses a folder outside the notebook content: a parent step, a dot folder, an excluded one, a bad form', () => {
    for (const folder of ['..', '../x', 'a/../b', './a', '.hidden', 'a/.git', '.templates', '.live', '/abs', 'a/', 'a//b', 'a\\b', 'a\nb', 'drafts', 'drafts/x', 'x'.repeat(513)]) {
      expect(retargetLivePathRule('inbox/{{title}}.md', { folder }, notebook)).toEqual({ invalid: expect.any(String) });
    }
  });

  it('refuses a name with nothing left once made safe, one with a placeholder, and one that is no live note', () => {
    for (const name of ['', '   ', '...', '..', '{{title}}', 'x {{date}}.md', 'map.outline.md', 'x'.repeat(250)]) {
      expect(retargetLivePathRule('inbox/{{title}}.md', { name }, notebook)).toEqual({ invalid: expect.any(String) });
    }
  });

  it('refuses a change that names neither a folder nor a name', () => {
    expect(retargetLivePathRule('inbox/{{title}}.md', {}, notebook)).toEqual({ invalid: expect.any(String) });
  });
});

describe('livePathRuleParts', () => {
  it('splits a rule into its folder, empty at the notebook root, and its name pattern', () => {
    expect(livePathRuleParts('inbox/{{title}}.md')).toEqual({ folder: 'inbox', name: '{{title}}.md' });
    expect(livePathRuleParts(meeting)).toEqual({ folder: '會議/其他', name: '{{date}} {{title}}.md' });
    expect(livePathRuleParts('{{title}}.md')).toEqual({ folder: '', name: '{{title}}.md' });
  });
});

describe('filing a retargeted rule', () => {
  const since = '2026-11-15T01:00:00.000Z';
  it('files a moved note under its title in the new folder, a renamed one under its fixed name, with -2 on a collision', () => {
    const moved = retargetLivePathRule('inbox/{{title}}.md', { folder: 'projects' }, notebook);
    if (!('pathRule' in moved)) throw new Error(moved.invalid);
    expect(fileLivePath({ rule: moved.pathRule, notebook, content: '---\ntitle: 計畫\n---\nx\n', since, existing: [] })).toEqual({ path: 'notes/life/projects/計畫.md' });
    const renamed = retargetLivePathRule('inbox/{{title}}.md', { name: 'Fixed' }, notebook);
    if (!('pathRule' in renamed)) throw new Error(renamed.invalid);
    expect(fileLivePath({ rule: renamed.pathRule, notebook, content: '---\ntitle: Other\n---\nx\n', since, existing: ['notes/life/inbox/Fixed.md'] })).toEqual({ path: 'notes/life/inbox/Fixed-2.md' });
  });
});
