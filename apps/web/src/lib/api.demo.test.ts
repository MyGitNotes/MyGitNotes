// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, readNote } from './api.js';
import { registerDemoRepositories } from './demo-storage.js';
import { appendLocalCommit } from './local-commits.js';

const REPO = 'edition:demo:scenarios@main', SCOPE = `demo:${REPO}:main`, NOTEBOOK = 'demo~trpg-en', HEAD = 'a'.repeat(40);
const notFound = () => new Response(JSON.stringify({ error: 'Notebook is not configured.' }), { status: 404 });

beforeEach(() => {
  localStorage.clear();
  registerDemoRepositories([{ id: REPO, branch: 'main', alias: 'demo', demo: true, revision: HEAD, notebooks: [NOTEBOOK] }]);
});
afterEach(() => vi.unstubAllGlobals());

describe('reading a note in the demo', () => {
  it('does not report a note the server cannot find as moved or deleted, since a demo repository never changes', async () => {
    // The demo cookie went (24 hours, cleared, another tab's language), so the server no longer serves this notebook.
    vi.stubGlobal('fetch', vi.fn(async () => notFound()));
    const failure = await readNote('trpg-en/handouts.md', NOTEBOOK).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(ApiError);
    expect((failure as Error).message).toBe('Notebook is not configured.');
  });

  it('still reports a note a local commit deleted as gone', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => notFound()));
    await appendLocalCommit(SCOPE, HEAD, { message: 'Drop it', author: 'You (demo)', notes: { 'trpg-en/handouts.md': { notebookId: NOTEBOOK, server: null, deleted: true } }, documents: {} });
    await expect(readNote('trpg-en/handouts.md', NOTEBOOK)).rejects.toMatchObject({ status: 404 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps a missing note of any other notebook a 404 the editor treats as moved or deleted', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => notFound()));
    await expect(readNote('notes/a.md', 'github~notes')).rejects.toMatchObject({ status: 404 });
  });
});
