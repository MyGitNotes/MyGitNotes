import { describe, expect, it } from 'vitest';
import { aliasedMedia, classifyResource, isHiddenPath } from '../src/classifier.js';
import { WorkspaceConfig } from '../src/types.js';

describe('Resource Classifier', () => {
  const sampleConfig: WorkspaceConfig = { schema_version: 1, workspace: { title: 'Test Workspace', default_notebook: 'example' }, notebooks: [{ id: 'example', title: 'Example Notebook', root: 'notes/example', assets: 'assets' }] };

  it('classifies notes properly', () => {
    expect(classifyResource('notes/example/intro.md', sampleConfig).type).toBe('note');
    expect(classifyResource('notes/example/guide.mdx', sampleConfig).type).toBe('note');
    expect(classifyResource('notes/example/subfolder/idea.txt', sampleConfig).type).toBe('note');
  });

  it('classifies the other files of a notebook by what a viewer can do with them, so only Markdown and text files are notes', () => {
    const kind = (file: string) => classifyResource(`notes/example/${file}`, sampleConfig);
    for (const file of ['db/schema.sql', 'deploy.yml', 'a/b/config.yaml', 'data.json', 'table.csv', 'src/main.ts', 'tool.py', 'run.sh', 'Makefile', 'Dockerfile', 'a/LICENSE', 'out/report.xml', 'script.JS']) expect([file, kind(file).type]).toEqual([file, 'text_file']);
    expect(kind('spec.pdf')).toEqual({ path: 'notes/example/spec.pdf', type: 'pdf_file', notebookId: 'example' });
    expect(kind('out/index.html').type).toBe('html_file');
    expect(kind('out/page.HTM').type).toBe('html_file');
    for (const file of ['archive.zip', 'sheet.xlsx', 'movie.mp4', 'unknown.blob', 'noextension', 'photo.avif']) expect([file, kind(file).type]).toEqual([file, 'other_file']);
    // Notes and images keep their kinds; the file kinds never cover a note.
    for (const file of ['a.md', 'a.markdown', 'a.mdx', 'a.txt']) expect([file, kind(file).type]).toEqual([file, 'note']);
    for (const file of ['a.png', 'a.JPG', 'a.svg', 'a.webp']) expect([file, kind(file).type]).toEqual([file, 'asset']);
    // Paths that were never reachable stay as they were.
    expect(kind('.hidden/schema.sql').type).toBe('hidden');
    expect(kind('node_modules/x/schema.sql').type).toBe('hidden');
    expect(kind('docs/agent/schema.sql').type).toBe('agent_doc');
    expect(kind('assets/schema.sql').type).toBe('asset');
    expect(classifyResource('notes/other/schema.sql', sampleConfig).type).toBe('product_source');
  });

  it("keeps a notebook's excluded paths out of the notes: Markdown there is a text file, and a compilation is its YAML text", () => {
    const config: WorkspaceConfig = { ...sampleConfig, notebooks: [{ ...sampleConfig.notebooks[0], excluded: ['**/analysis/**', '*.draft.md'] }] };
    const kind = (file: string) => classifyResource(`notes/example/${file}`, config).type;
    expect(kind('a/analysis/report.md')).toBe('text_file');
    expect(kind('a/analysis/report.txt')).toBe('text_file');
    expect(kind('a/analysis/plan.outline.md')).toBe('text_file');
    expect(kind('a/analysis/set.compilation.yml')).toBe('text_file');
    expect(kind('a/analysis/data.pdf')).toBe('pdf_file');
    expect(kind('x.draft.md')).toBe('text_file');
    expect(kind('sub/x.draft.md')).toBe('note');
    expect(kind('a/keep.md')).toBe('note');
    expect(kind('a/analysis/chart.png')).toBe('asset');
  });

  it('classifies agent instructions', () => {
    expect(classifyResource('AGENTS.md', sampleConfig).type).toBe('agent_instruction');
    expect(classifyResource('notes/example/AGENTS.md', sampleConfig).type).toBe('agent_instruction');
  });

  it('classifies agent docs', () => {
    expect(classifyResource('docs/agent/index.md', sampleConfig).type).toBe('agent_doc');
    expect(classifyResource('docs/agent/security/rules.md', sampleConfig).type).toBe('agent_doc');
    expect(classifyResource('notes/example/docs/agent/guide.md', sampleConfig).type).toBe('agent_doc');
  });

  it('classifies workspace config', () => {
    expect(classifyResource('.mygitnotes.yaml', sampleConfig).type).toBe('workspace_config');
    expect(classifyResource('.github-notes.yaml', sampleConfig).type).toBe('workspace_config');
  });

  it('classifies assets in notebook asset directory', () => {
    expect(classifyResource('notes/example/assets/screenshot.png', sampleConfig).type).toBe('asset');
    expect(classifyResource('notes/example/assets/doc.pdf', sampleConfig).type).toBe('asset');
  });

  it('classifies assets under notebook pathAliases target directories', () => {
    const aliasedConfig: WorkspaceConfig = { ...sampleConfig, notebooks: [{ id: 'blog', title: 'Blog', root: 'blog/src/content/posts', pathAliases: { '@/*': 'blog/src/*' } }] };
    const res = classifyResource('blog/src/assets/images/two-params-weibull/fix-beta.png', aliasedConfig);
    expect(res.type).toBe('asset');
    expect(res.notebookId).toBe('blog');
  });

  it("counts only media under a notebook alias target, outside its root, as the notebook's aliased media", () => {
    const blog = { id: 'blog', title: 'Blog', root: 'blog/src/content/posts', pathAliases: { '@/*': 'blog/src/*' } };
    expect(aliasedMedia('blog/src/assets/images/a.png', blog)).toBe(true);
    expect(aliasedMedia('blog/src/assets/images/a.SVG', blog)).toBe(true);
    for (const file of ['blog/src/content/posts/a.png', 'blog/src/assets/data.json', 'blog/src/assets/a.md', 'blog/src/.hidden/a.png', 'blog/src/node_modules/x/a.png', 'blog/logo.png', 'blog/src/../../etc/a.png', '../blog/src/a.png', '/blog/src/a.png', 'blog/src/assets//a.png']) expect([file, aliasedMedia(file, blog)]).toEqual([file, false]);
    expect(aliasedMedia('blog/src/a.png', { id: 'blog', title: 'Blog', root: 'blog/posts' })).toBe(false);
    for (const target of ['*', './*', '../*', '../shared/*']) expect([target, aliasedMedia('a.png', { id: 'b', title: 'B', root: 'posts', pathAliases: { '@/*': target } })]).toEqual([target, false]);
  });

  it('classifies product source files', () => {
    expect(classifyResource('packages/core/src/index.ts', sampleConfig).type).toBe('product_source');
    expect(classifyResource('apps/web/src/App.tsx', sampleConfig).type).toBe('product_source');
    expect(classifyResource('scripts/update-core.ts', sampleConfig).type).toBe('product_source');
  });

  it('classifies hidden system files', () => {
    expect(classifyResource('.git/HEAD', sampleConfig).type).toBe('hidden');
    expect(classifyResource('node_modules/yaml/index.js', sampleConfig).type).toBe('hidden');
    expect(classifyResource('notes/example/.DS_Store', sampleConfig).type).toBe('hidden');
    expect(isHiddenPath('.git/config')).toBe(true);
    expect(isHiddenPath('.DS_Store')).toBe(true);
    expect(isHiddenPath('node_modules/foo')).toBe(true);
  });
});
