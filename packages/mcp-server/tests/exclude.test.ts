import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { deploymentConfigSource } from '@mygitnotes/core';
import { createMCPServer } from '../src/server.js';

let root: string | undefined;
afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = undefined;
});

it('keeps notes under the manifest exclude globs out of the list, the search, the folders and the note tools', async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-exclude-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root });
  git('init', '-b', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.test');
  const files: Record<string, string> = { '.mygitnotes.yaml': 'schema_version: 4\nworkspace:\n  title: T\n  default_notebook: docs\nexclude:\n  - "**/analysis/**"\nnotebooks:\n  - id: docs\n    title: Docs\n    root: docs\n    exclude:\n      - "*.draft.md"\n', 'docs/keep.md': '# Keep\n\nkeyword\n', 'docs/guide/kept.md': '# Kept\n\nkeyword\n', 'docs/analysis/report.md': '# Report\n\nkeyword\n', 'docs/guide/analysis/deep.md': '# Deep\n\nkeyword\n', 'docs/wip.draft.md': '# Draft\n\nkeyword\n', 'docs/schema.sql': 'keyword\n' };
  const write = (written: Record<string, string>) => {
    for (const [file, content] of Object.entries(written)) {
      fs.mkdirSync(path.dirname(path.join(root!, file)), { recursive: true });
      fs.writeFileSync(path.join(root!, file), content);
    }
    git('add', '.');
    git('commit', '-m', 'fixture');
  };
  write(files);
  const server = createMCPServer(root, deploymentConfigSource(root, { MYGITNOTES_SOURCE: 'local', MYGITNOTES_LOCAL_PATH: root }));
  const client = new Client({ name: 'fixture', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    return { ...result, data: JSON.parse((result.content as { text: string; }[])[0].text) };
  };
  try {
    expect((await call('list_notes', {})).data.notes.map((note: { path: string; }) => note.path).sort()).toEqual(['docs/guide/kept.md', 'docs/keep.md']);
    expect((await call('search_notes', { query: 'keyword' })).data.matches.map((match: { path: string; }) => match.path).sort()).toEqual(['docs/guide/kept.md', 'docs/keep.md']);
    expect((await call('list_folders', {})).data.folders.map((folder: { path: string; }) => folder.path)).toEqual(['guide']);
    // An excluded path, a plain file, an image, a file of the assets folder and an agent's file are no notes to the note
    // tools either, as on the hosted server; nothing is written.
    const refused = { isError: true, data: { error: 'Path is not a configured note.' } };
    const head = () => git('rev-parse', 'HEAD').toString().trim();
    write({ 'docs/pic.png': '\x89PNG', 'docs/analysis/pic.png': '\x89PNG', 'docs/assets/x.md': '# Asset\n', 'docs/analysis/AGENTS.md': '# Rules\n', 'docs/guide/docs/agent/x.md': '# Agent\n' });
    const before = head();
    for (const file of ['docs/analysis/report.md', 'docs/guide/analysis/deep.md', 'docs/wip.draft.md', 'docs/schema.sql', 'docs/pic.png', 'docs/analysis/pic.png', 'docs/assets/x.md', 'docs/analysis/AGENTS.md', 'docs/guide/docs/agent/x.md']) {
      const content = fs.readFileSync(path.join(root!, file), 'utf8');
      expect([file, await call('read_note', { path: file })]).toMatchObject([file, refused]);
      expect([file, await call('read_note', { path: file, metadataOnly: true })]).toMatchObject([file, refused]);
      expect([file, await call('save_note', { path: file, content: 'overwritten' })]).toMatchObject([file, refused]);
      expect([file, await call('save_note', { path: file, status: 'done' })]).toMatchObject([file, refused]);
      expect([file, await call('delete_note', { path: file })]).toMatchObject([file, refused]);
      expect(fs.readFileSync(path.join(root!, file), 'utf8')).toBe(content);
    }
    expect(await call('save_note', { path: 'docs/analysis/new.md', content: 'new' })).toMatchObject(refused);
    expect(fs.existsSync(path.join(root!, 'docs/analysis/new.md'))).toBe(false);
    expect(head()).toBe(before);
    // A note is still read and saved as one.
    expect((await call('read_note', { path: 'docs/keep.md' })).data.note.path).toBe('docs/keep.md');
    expect(await call('save_note', { path: 'docs/guide/new.md', content: 'new' })).toMatchObject({ data: { success: true } });
  } finally {
    await client.close();
    await server.close();
  }
});
