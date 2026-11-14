import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createRemoteSource, createWorkspaceRepositories, deriveAlias, openRemoteRepository, parseNoteContent, RemoteManifest, type RemoteSource, repositoryRef, type WorkspaceConfigSource } from '@mygitnotes/core';
import { createMCPServer } from '../src/server.js';
import { callRemoteTool, legacyRemoteTools, remoteTools } from '../src/remote-tools.js';
import { callWorkspaceRemoteTool } from '../src/workspace-remote.js';
import { gitlabFixture } from '../../core/tests/fixtures/gitlab.js';

const READING = '---\ntemplate:\n  name: Reading\n  description: Notes on a book\n  path: reading/{{book}}.md\n  placeholders:\n    book: The book\n    author:\n      description: Who wrote it\n      default: Unknown\ntags: [reading]\nauthor: "{{author}}"\n---\n# {{title}}\n\n> {{takeaway}}\n';
const MEETING = '# {{title}}\n\nWith {{who}}.\n';
const MANIFEST = (version: number) => `schema_version: ${version}\nworkspace:\n  title: Test\n  default_notebook: ex\nnotebooks:\n  - id: ex\n    title: Example\n    root: notes/ex\n    templates:\n      - id: registered\n        title: Registered\n        file: kept/registered.md\n`;
const STAMPED = (template: string, created: string) => `---\ntemplate: ${template}\ncreated: "${created}"\n---\n# Made\n`;
const TEMPLATES = { 'notes/ex/.templates/reading.md': READING, 'notes/ex/.templates/meeting.md': MEETING, 'notes/ex/kept/registered.md': '---\nstatus: unread\n---\n# {{title}}\n' };

describe('local MCP templates', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });
  async function open() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-templates-'));
    roots.push(root);
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
    git('init', '-b', 'main');
    git('config', 'user.name', 'Fixture');
    git('config', 'user.email', 'fixture@example.test');
    for (const [file, content] of Object.entries({ '.mygitnotes.yaml': MANIFEST(4), 'notes/ex/a.md': '# Alpha\n', ...TEMPLATES })) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), content);
    }
    git('add', '.');
    git('commit', '-m', 'fixture');
    const source: WorkspaceConfigSource = { mode: 'local', settings: async () => ({ site: { type: 'local' }, members: [{ ref: repositoryRef({ type: 'local', path: root }), alias: deriveAlias(path.basename(root), new Set()), default: true, hidden: false, localPath: root }], manifest: (_member, inRepository) => inRepository() }) };
    const server = createMCPServer(root, source);
    const client = new Client({ name: 'fixture', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args });
      return { isError: result.isError === true, data: JSON.parse((result.content as { text: string; }[])[0].text) };
    };
    return { root, git, client, call, close: async () => void await Promise.all([client.close(), server.close()]) };
  }

  it('merges the templates of every worktree when no notebook is named', async () => {
    const worktree = (id: string) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-templates-'));
      roots.push(root);
      const git = (...args: string[]) => execFileSync('git', args, { cwd: root });
      git('init', '-b', 'main');
      git('config', 'user.name', 'Fixture');
      git('config', 'user.email', 'fixture@example.test');
      fs.mkdirSync(path.join(root, 'notes/shared/.templates'), { recursive: true });
      fs.writeFileSync(path.join(root, '.mygitnotes.yaml'), `schema_version: 4\nworkspace:\n  title: ${id}\n  default_notebook: ${id}\nnotebooks:\n  - id: ${id}\n    title: ${id}\n    root: notes/shared\n`);
      fs.writeFileSync(path.join(root, `notes/shared/.templates/${id}-plan.md`), '# {{title}}\n');
      git('add', '.');
      git('commit', '-m', 'fixture');
      return root;
    };
    const home = worktree('home'), other = worktree('other');
    const members = [{ ref: repositoryRef({ type: 'local', path: home }), alias: 'home', default: true, hidden: false, localPath: home }, { ref: repositoryRef({ type: 'github', repository: 'owner/other', branch: 'main' }), alias: 'other', default: false, hidden: false, localPath: other }];
    const server = createMCPServer(home, { mode: 'local', settings: async () => ({ site: { type: 'local' }, members, manifest: (_member, inRepository) => inRepository() }) });
    const client = new Client({ name: 'fixture', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const result = await client.callTool({ name: 'list_templates', arguments: {} });
      const { templates } = JSON.parse((result.content as { text: string; }[])[0].text);
      expect(templates.map((template: { notebookId: string; id: string; }) => [template.notebookId, template.id])).toEqual([['home~home', 'home-plan'], ['other~other', 'other-plan']]);
      // One limit and one order hold across the worktrees: the template used last comes first, whichever worktree holds it.
      fs.writeFileSync(path.join(other, 'notes/shared/made.md'), STAMPED('other-plan', '2026-11-10T08:00:00.000Z'));
      const cut = JSON.parse(((await client.callTool({ name: 'list_templates', arguments: { limit: 1 } })).content as { text: string; }[])[0].text);
      expect(cut).toMatchObject({ templates: [{ notebookId: 'other~other', id: 'other-plan', lastUsed: '2026-11-10T08:00:00.000Z' }], total: 2, truncated: true });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('offers list_templates, and save_note with template and values and no required path', async () => {
    const mcp = await open();
    try {
      const { tools } = await mcp.client.listTools();
      const list = tools.find(tool => tool.name === 'list_templates')!;
      expect(list.inputSchema.properties).toMatchObject({ notebookId: { type: 'string' }, query: { type: 'string' }, templateId: { type: 'string' }, limit: { type: 'integer', maximum: 100 } });
      const save = tools.find(tool => tool.name === 'save_note')!;
      expect(save.inputSchema.properties).toMatchObject({ template: { type: 'string' }, values: { type: 'object' } });
      expect(save.inputSchema.required ?? []).not.toContain('path');
      // The rule of checking for a fitting template first is the product's: both tools and the server's instructions say it.
      for (const text of [list.description, save.description, mcp.client.getInstructions()]) expect(text).toMatch(/list_templates.*ask the user/s);
    } finally {
      await mcp.close();
    }
  });

  it('lists the manifest and .templates templates of a notebook with their placeholders, named by notebook key', async () => {
    const mcp = await open();
    try {
      const listed = (await mcp.call('list_templates', {})).data.templates;
      expect(listed.map((template: { id: string; source: string; name: string; lastUsed: unknown; }) => [template.id, template.source, template.name, template.lastUsed])).toEqual([['meeting', 'file', 'meeting', null], ['reading', 'file', 'Reading', null], ['registered', 'manifest', 'Registered', null]]);
      const reading = listed[1];
      expect(reading.notebookId).toMatch(/~ex$/);
      expect(reading).toMatchObject({ description: 'Notes on a book', path: 'reading/{{book}}.md', file: 'notes/ex/.templates/reading.md' });
      expect(reading.placeholders).toEqual([{ name: 'title', description: expect.any(String), declared: false, builtin: true }, { name: 'date', description: expect.any(String), declared: false, builtin: true }, { name: 'time', description: expect.any(String), declared: false, builtin: true }, { name: 'book', description: 'The book', declared: true }, { name: 'author', description: 'Who wrote it', default: 'Unknown', declared: true }, { name: 'takeaway', declared: false }]);
      expect((await mcp.call('list_templates', { notebookId: 'ex' })).data.templates).toHaveLength(3);
      expect((await mcp.call('list_notes', {})).data.notes.map((note: { path: string; }) => note.path)).toEqual(['notes/ex/a.md']);
    } finally {
      await mcp.close();
    }
  });

  it('filters by the words of a query, orders by the last use, cuts at the limit, and answers one template with its file text', async () => {
    const mcp = await open();
    try {
      const ids = async (args: Record<string, unknown>) => (await mcp.call('list_templates', args)).data.templates.map((template: { id: string; }) => template.id);
      expect(await ids({ query: 'BOOK notes' })).toEqual(['reading']);
      expect(await ids({ query: 'regist' })).toEqual(['registered']);
      expect(await ids({ query: 'book meeting' })).toEqual([]);

      // A note created from a template carries its id, which dates the template's last use; only its frontmatter is read.
      await mcp.call('save_note', { path: 'notes/ex/sync.md', template: 'meeting', values: { who: 'Ann' } });
      fs.writeFileSync(path.join(mcp.root, 'notes/ex/old.md'), STAMPED('registered', '2020-01-01T00:00:00.000Z'));
      // A note that merely names a template is no template: the .templates files and the manifest's are the only ones.
      const listed = (await mcp.call('list_templates', { notebookId: 'ex' })).data;
      expect(listed.templates.map((template: { id: string; }) => template.id)).toEqual(['meeting', 'registered', 'reading']);
      expect(listed.templates[0].lastUsed).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(listed.templates.slice(1).map((template: { lastUsed: unknown; }) => template.lastUsed)).toEqual(['2020-01-01T00:00:00.000Z', null]);
      expect(listed).toMatchObject({ total: 3, truncated: false });
      expect((await mcp.call('list_templates', { limit: 2 })).data).toMatchObject({ templates: [{ id: 'meeting' }, { id: 'registered' }], total: 3, truncated: true });
      expect((await mcp.call('list_templates', { limit: 1, query: 're' })).data).toMatchObject({ templates: [{ id: 'registered' }], total: 2, truncated: true });

      const one = (await mcp.call('list_templates', { notebookId: 'ex', templateId: 'reading' })).data;
      expect(one).toMatchObject({ templates: [{ id: 'reading', name: 'Reading', content: READING, lastUsed: null }], total: 1, truncated: false });
      expect(one.templates[0].notebookId).toMatch(/~ex$/);
      expect(listed.templates[0]).not.toHaveProperty('content');
      expect(await mcp.call('list_templates', { templateId: 'reading' })).toMatchObject({ isError: true, data: { error: expect.stringContaining('notebookId') } });
      expect(await mcp.call('list_templates', { notebookId: 'ex', templateId: 'nope' })).toMatchObject({ isError: true, data: { error: expect.stringMatching(/no template 'nope'.*registered, meeting, reading/) } });

      // An edited template file is listed as it now reads, at once.
      fs.writeFileSync(path.join(mcp.root, 'notes/ex/.templates/meeting.md'), '---\ntemplate:\n  name: Stand-up\n---\n# {{title}}\n');
      expect((await mcp.call('list_templates', { query: 'stand-up' })).data.templates.map((template: { id: string; }) => template.id)).toEqual(['meeting']);
    } finally {
      await mcp.close();
    }
  });

  it('creates a note from a template: path from its pattern, values filled, the template block dropped, unfilled reported, one agent commit', async () => {
    const mcp = await open();
    try {
      const saved = await mcp.call('save_note', { notebookId: 'ex', template: 'reading', values: { book: 'Dune' } });
      expect(saved.isError).toBe(false);
      expect(saved.data).toMatchObject({ success: true, path: 'notes/ex/reading/Dune.md', template: 'reading', unfilled: ['takeaway'] });
      const written = parseNoteContent(fs.readFileSync(path.join(mcp.root, 'notes/ex/reading/Dune.md'), 'utf8'));
      // The template block stays behind; the note records the id of the template it came from.
      expect(written.metadata).toMatchObject({ title: 'Dune', tags: ['reading'], author: 'Unknown', template: 'reading' });
      expect(written.content).toBe('# Dune\n\n> {{takeaway}}\n');
      expect(mcp.git('status', '--short')).toBe('');
      expect(mcp.git('log', '-1', '--format=%B')).toContain('Agent-Edit');

      // The same path again is refused: a template creates, it never overwrites.
      const again = await mcp.call('save_note', { notebookId: 'ex', template: 'reading', values: { book: 'Dune' } });
      expect(again).toMatchObject({ isError: true, data: { error: expect.stringContaining('already exists') } });
    } finally {
      await mcp.close();
    }
  });

  it('lets the caller’s path, title, content, metadata, tags and status win over the template', async () => {
    const mcp = await open();
    try {
      const saved = await mcp.call('save_note', { path: 'notes/ex/own.md', template: 'reading', title: 'Mine', values: { book: 'Dune', takeaway: 'Fear is the mind-killer' }, metadata: { author: 'Me' }, tags: ['sf'], status: 'done' });
      expect(saved.data).toMatchObject({ path: 'notes/ex/own.md', unfilled: [] });
      const written = parseNoteContent(fs.readFileSync(path.join(mcp.root, 'notes/ex/own.md'), 'utf8'));
      expect(written.metadata).toMatchObject({ title: 'Mine', author: 'Me', tags: ['sf'], status: 'done' });
      expect(written.content).toBe('# Mine\n\n> Fear is the mind-killer\n');
      const body = await mcp.call('save_note', { path: 'notes/ex/body.md', template: 'meeting', content: 'My own body.' });
      expect(body.data).toMatchObject({ unfilled: [] });
      expect(fs.readFileSync(path.join(mcp.root, 'notes/ex/body.md'), 'utf8')).toContain('My own body.');
    } finally {
      await mcp.close();
    }
  });

  it('refuses an unknown value, a path value left out, an unknown template, a template without a path pattern and no path, and values without a template', async () => {
    const mcp = await open();
    try {
      expect(await mcp.call('save_note', { notebookId: 'ex', template: 'reading', values: { boook: 'Dune' } })).toMatchObject({ isError: true, data: { error: expect.stringMatching(/no placeholder 'boook'.*book, author, takeaway/) } });
      expect(await mcp.call('save_note', { notebookId: 'ex', template: 'reading', values: { author: 'Frank' } })).toMatchObject({ isError: true, data: { error: expect.stringContaining('needs a value for book') } });
      expect(await mcp.call('save_note', { notebookId: 'ex', template: 'nope', values: {} })).toMatchObject({ isError: true, data: { error: expect.stringContaining("'nope' is not configured") } });
      expect(await mcp.call('save_note', { notebookId: 'ex', template: 'meeting' })).toMatchObject({ isError: true, data: { error: expect.stringContaining('path is required') } });
      expect(await mcp.call('save_note', { path: 'notes/ex/x.md', content: 'x', values: { who: 'Ann' } })).toMatchObject({ isError: true, data: { error: expect.stringContaining('name one as template') } });
      expect(await mcp.call('save_note', { path: 'notes/ex/.templates/x.md', template: 'meeting' })).toMatchObject({ isError: true });
      expect(mcp.git('status', '--short')).toBe('');
      // A manifest-registered template serves save_note like a file one, and a plain save_note is unchanged.
      expect((await mcp.call('save_note', { path: 'notes/ex/reg.md', template: 'registered', title: 'Reg' })).data.note).toMatchObject({ title: 'Reg', status: 'unread' });
      expect((await mcp.call('save_note', { path: 'notes/ex/plain.md', content: '# Plain\n' })).data).toMatchObject({ success: true, path: 'notes/ex/plain.md' });
    } finally {
      await mcp.close();
    }
  });
});

describe('remote MCP templates', () => {
  const source = { type: 'gitlab' as const, url: 'https://gitlab.example.test/gitlab', repository: 'group/subgroup/project', branch: 'main' };
  const fixture = () => gitlabFixture(undefined, { 'notes/.github-notes.yaml': MANIFEST(1), ...TEMPLATES, 'notes/ex/.other/secret.md': '# Secret\n' });
  const reader = (f: ReturnType<typeof gitlabFixture>) => openRemoteRepository(source, 'fixture-token', f.request).reader;

  it('declares list_templates with query, templateId and limit and save_note with template and values, and keeps render_template for old callers only', () => {
    const tool = (name: string) => remoteTools.find(candidate => candidate.name === name)!;
    expect(tool('list_templates').inputSchema.required).toEqual([]);
    expect(tool('list_templates').inputSchema.properties).toMatchObject({ notebookId: { type: 'string' }, query: { type: 'string' }, templateId: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } });
    expect(tool('list_templates').outputSchema?.properties).toMatchObject({ total: { type: 'integer' }, truncated: { type: 'boolean' } });
    expect(tool('save_note').inputSchema.required).toEqual(['revision']);
    expect(tool('save_note').inputSchema.properties).toMatchObject({ template: { type: 'string' }, values: { type: 'object' } });
    for (const name of ['list_templates', 'save_note']) expect(tool(name).description).toMatch(/list_templates.*ask the user/s);
    // A client that creates notes with write still meets the rule.
    expect(tool('write').description).toMatch(/list_templates/);
    // render_template is no longer offered: list_templates with templateId shows a template and save_note creates from it.
    expect(remoteTools.map(candidate => candidate.name)).not.toContain('render_template');
    const legacy = legacyRemoteTools.find(candidate => candidate.name === 'render_template')!;
    expect(legacy.inputSchema.properties).toHaveProperty('values');
    expect(legacy.outputSchema?.properties).toHaveProperty('unfilled');
  });

  it('lists templates with placeholders and renders one with values', async () => {
    const f = fixture();
    const listed = (await callRemoteTool(reader(f), 'list_templates', {}, false)).templates as { id: string; source: string; placeholders: { name: string; }[]; }[];
    expect(listed.map(template => [template.id, template.source])).toEqual([['meeting', 'file'], ['reading', 'file'], ['registered', 'manifest']]);
    expect(listed[1].placeholders.map(placeholder => placeholder.name)).toEqual(['title', 'date', 'time', 'book', 'author', 'takeaway']);
    expect(await callRemoteTool(reader(f), 'render_template', { notebookId: 'ex', templateId: 'reading', title: 'Dune', values: { author: 'Frank Herbert' } }, false)).toEqual({ metadata: { tags: ['reading'], author: 'Frank Herbert', title: 'Dune' }, content: '# Dune\n\n> {{takeaway}}\n', unfilled: ['takeaway'] });
    await expect(callRemoteTool(reader(f), 'render_template', { notebookId: 'ex', templateId: 'reading', title: 'Dune', values: { nope: 1 } }, false)).rejects.toThrow(/no placeholder 'nope'/);
  });

  it('filters by the words of a query, orders by the last use, cuts at the limit, and answers one template with its file text', async () => {
    const f = gitlabFixture(undefined, { 'notes/.github-notes.yaml': MANIFEST(1), ...TEMPLATES, 'notes/ex/old.md': STAMPED('registered', '2020-01-01T00:00:00.000Z'), 'notes/ex/sync.md': STAMPED('meeting', '2026-11-10T08:00:00.000Z'), 'notes/ex/sync-2.md': STAMPED('meeting', '2026-11-12T08:00:00.000Z') });
    const list = async (args: Record<string, unknown>) => await callRemoteTool(reader(f), 'list_templates', args, false) as { templates: { id: string; lastUsed: string | null; content?: string; }[]; total: number; truncated: boolean; };
    const listed = await list({ notebookId: 'ex' });
    expect(listed.templates.map(template => [template.id, template.lastUsed])).toEqual([['meeting', '2026-11-12T08:00:00.000Z'], ['registered', '2020-01-01T00:00:00.000Z'], ['reading', null]]);
    expect(listed).toMatchObject({ total: 3, truncated: false });
    expect(listed.templates[0]).not.toHaveProperty('content');
    expect((await list({ query: 'BOOK notes' })).templates.map(template => template.id)).toEqual(['reading']);
    expect((await list({ query: 'book meeting' })).templates).toEqual([]);
    expect(await list({ limit: 2 })).toMatchObject({ templates: [{ id: 'meeting' }, { id: 'registered' }], total: 3, truncated: true });
    await expect(list({ limit: 101 })).rejects.toThrow(/limit/);

    expect(await list({ notebookId: 'ex', templateId: 'reading' })).toMatchObject({ templates: [{ id: 'reading', content: READING, lastUsed: null }], total: 1, truncated: false });
    await expect(list({ templateId: 'reading' })).rejects.toThrow(/notebookId/);
    await expect(list({ notebookId: 'ex', templateId: 'nope' })).rejects.toMatchObject({ status: 404 });
  });

  it('creates a note from a template in one commit and refuses what a template cannot serve', async () => {
    const f = fixture();
    const saved = await callRemoteTool(reader(f), 'save_note', { notebookId: 'ex', template: 'reading', values: { book: 'Dune' }, revision: f.head }, true);
    expect(saved).toMatchObject({ path: 'notes/ex/reading/Dune.md', template: 'reading', unfilled: ['takeaway'], changedPaths: ['notes/ex/reading/Dune.md'] });
    const written = parseNoteContent(f.files.get('notes/ex/reading/Dune.md')!);
    // The template block stays behind; the note records the id of the template it came from.
    expect(written.metadata).toMatchObject({ title: 'Dune', tags: ['reading'], author: 'Unknown', template: 'reading' });
    expect(written.content).toBe('# Dune\n\n> {{takeaway}}\n');
    expect(f.writes).toBe(1);

    await expect(callRemoteTool(reader(f), 'save_note', { notebookId: 'ex', template: 'reading', values: { book: 'Dune' }, revision: f.head }, true)).rejects.toMatchObject({ status: 409 });
    await expect(callRemoteTool(reader(f), 'save_note', { notebookId: 'ex', template: 'reading', values: { boook: 'Dune' }, revision: f.head }, true)).rejects.toThrow(/no placeholder 'boook'.*book, author, takeaway/);
    await expect(callRemoteTool(reader(f), 'save_note', { notebookId: 'ex', template: 'reading', values: {}, revision: f.head }, true)).rejects.toThrow(/needs a value for book/);
    await expect(callRemoteTool(reader(f), 'save_note', { notebookId: 'ex', template: 'meeting', revision: f.head }, true)).rejects.toThrow(/path is required/);
    await expect(callRemoteTool(reader(f), 'save_note', { notebookId: 'ex', template: 'nope', revision: f.head }, true)).rejects.toMatchObject({ status: 404 });
    await expect(callRemoteTool(reader(f), 'save_note', { content: 'x', revision: f.head }, true)).rejects.toThrow(/path is required/);
    await expect(callRemoteTool(reader(f), 'save_note', { notebookId: 'ex', template: 'reading', values: { book: 'Dune' }, revision: f.head }, false)).rejects.toThrow(/read-only/);
    // A template's note is a note: a path into .templates/ or another dot folder is refused, as the local tool refuses it.
    for (const path of ['notes/ex/.templates/made.md', 'notes/ex/.other/made.md']) await expect(callRemoteTool(reader(f), 'save_note', { path, template: 'meeting', revision: f.head }, true)).rejects.toThrow(/not a note path/);
    expect(f.writes).toBe(1);

    const own = await callRemoteTool(reader(f), 'save_note', { path: 'notes/ex/own.md', template: 'meeting', title: 'Sync', values: { who: 'Ann' }, tags: ['team'], revision: f.head }, true);
    expect(own).toMatchObject({ path: 'notes/ex/own.md', unfilled: [] });
    expect(parseNoteContent(f.files.get('notes/ex/own.md')!)).toMatchObject({ metadata: { title: 'Sync', tags: ['team'] }, content: '# Sync\n\nWith Ann.\n' });
  });

  it('reads, writes and removes a .templates file through read, write and rm, and no other dot path', async () => {
    const f = fixture();
    expect((await callRemoteTool(reader(f), 'read', { path: 'notes/ex/.templates/meeting.md' }, false)).content).toBe(MEETING);
    await callRemoteTool(reader(f), 'write', { path: 'notes/ex/.templates/weekly.md', content: '# {{title}}\n', revision: f.head, createOnly: true }, true);
    expect(f.files.get('notes/ex/.templates/weekly.md')).toBe('# {{title}}\n');
    expect(((await callRemoteTool(reader(f), 'list_templates', { notebookId: 'ex' }, false)).templates as { id: string; }[]).map(template => template.id)).toContain('weekly');
    await callRemoteTool(reader(f), 'rm', { paths: ['notes/ex/.templates/weekly.md'], revision: f.head }, true);
    expect(f.files.has('notes/ex/.templates/weekly.md')).toBe(false);
    await expect(callRemoteTool(reader(f), 'read', { path: 'notes/ex/.other/secret.md' }, false)).rejects.toMatchObject({ status: 404 });
    await expect(callRemoteTool(reader(f), 'write', { path: 'notes/ex/.other/new.md', content: 'x', revision: f.head }, true)).rejects.toMatchObject({ status: 403 });
    await expect(callRemoteTool(reader(f), 'rm', { paths: ['notes/ex/.other/secret.md'], revision: f.head }, true)).rejects.toMatchObject({ status: 403 });
  });

  it('routes a workspace call by notebook key: templates named by key, a templated save without a path', async () => {
    const f = fixture();
    const workspace = createWorkspaceRepositories<{ reader: RemoteSource; }>({ members: [{ ref: repositoryRef(source), alias: 'qa', default: true, hidden: false }], openRepository: async ({ ref }, scope) => ({ reader: createRemoteSource(ref.source, 'fixture-token', f.request, undefined, scope) }), manifest: (_member, handle) => new RemoteManifest(handle.reader) });
    const listed = await callWorkspaceRemoteTool(workspace, 'list_templates', {}, false);
    expect((listed.templates as { notebookId: string; id: string; }[]).map(template => [template.notebookId, template.id])).toEqual([['qa~ex', 'meeting'], ['qa~ex', 'reading'], ['qa~ex', 'registered']]);
    expect(await callWorkspaceRemoteTool(workspace, 'list_templates', { notebookId: 'qa~ex', templateId: 'reading' }, false)).toMatchObject({ templates: [{ notebookId: 'qa~ex', id: 'reading', content: READING }], total: 1 });
    const saved = await callWorkspaceRemoteTool(workspace, 'save_note', { notebookId: 'qa~ex', template: 'reading', values: { book: 'Dune' }, revision: listed.revision }, true);
    expect(saved).toMatchObject({ path: 'notes/ex/reading/Dune.md', unfilled: ['takeaway'] });
    expect(f.files.has('notes/ex/reading/Dune.md')).toBe(true);
    await expect(callWorkspaceRemoteTool(workspace, 'save_note', { template: 'reading', values: { book: 'Other' }, revision: saved.revision }, true)).rejects.toThrow(/Name a notebook or a path/);
  });
});
