// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handOverDraft } from './live-handover.js';
import type { NoteItem } from './types.js';

/*
 * Offline handover, draft → live (docs/specs/2026-11-16-collab-first-self-host A3.2): a draft made offline in the direct
 * editor is merged into the live note; a note made offline becomes a pending live note that keeps its text.
 */

const base: NoteItem = { id: 'a', path: 'notes/life/a.md', notebookId: 'notes~life', title: 'Alpha', tags: [], metadata: { title: 'Alpha', status: 'inbox', updated: '2026-11-16T01:00:00.000Z' }, content: '# Alpha\n\nFirst line.\n', revision: 'r1' };
const edited: NoteItem = { ...base, content: '# Alpha\n\nFirst line.\nTyped offline.\n' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const view = { id: 'abc', notebookId: 'notes~life', path: 'notes/life/a.md', pending: false, editorUrl: 'http://localhost/notebooks/notes~life/a.md', since: '2026-11-16T02:00:00.000Z', activeEditors: 0, conflict: null };
const context = { scope: 'edition:hosted:p1/notes@main', notebookRoot: 'notes/life' };

let fetchMock: ReturnType<typeof vi.fn>;
let mergeAnswer: () => Response;
beforeEach(() => {
  mergeAnswer = () => json({ applied: true, contentHash: 'h'.repeat(64), checkout: view, outcome: 'created' });
  fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/live/merge') return mergeAnswer();
    if (url === '/api/live/new') return json({ checkout: { ...view, id: 'new1', path: 'notes/life/.live/new1.md', pending: true } });
    return json({ error: 'unexpected' }, 500);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const bodies = (url: string) => fetchMock.mock.calls.filter(([called]) => called === url).map(([, init]) => JSON.parse(String((init as RequestInit).body)));

describe('a draft of a note that exists', () => {
  it('is merged into the live note on the text it was made from, and answers applied', async () => {
    await expect(handOverDraft({ note: edited, base }, context)).resolves.toEqual({ kind: 'applied' });
    const [body] = bodies('/api/live/merge');
    expect(body).toEqual({ notebookId: 'notes~life', path: 'notes/life/a.md', base: expect.any(String), text: expect.any(String), mergeId: expect.stringMatching(/^[A-Za-z0-9_-]{8,128}$/) });
    expect(body.base).toContain('First line.');
    expect(body.base).not.toContain('Typed offline.');
    expect(body.text).toContain('Typed offline.');
    // Only the person's own change differs between the two: the frontmatter is written the same way in both.
    expect(body.text.replace('Typed offline.\n', '')).toBe(body.base);
  });

  it('names the same merge for the same draft, so a retry never applies it twice, and another for another draft', async () => {
    await handOverDraft({ note: edited, base }, context);
    await handOverDraft({ note: edited, base }, context);
    await handOverDraft({ note: { ...edited, content: `${edited.content}More.\n` }, base }, context);
    const ids = bodies('/api/live/merge').map(body => body.mergeId);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
  });

  it('answers conflict when the merge conflicts, and failed when the server cannot be reached', async () => {
    mergeAnswer = () => json({ error: 'conflict', code: 'merge-conflict', checkout: view }, 409);
    await expect(handOverDraft({ note: edited, base }, context)).resolves.toEqual({ kind: 'conflict' });
    fetchMock.mockImplementation(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(handOverDraft({ note: edited, base }, context)).resolves.toEqual({ kind: 'failed', error: expect.any(TypeError) });
  });
});

describe('a note made offline', () => {
  const made: NoteItem = { id: 'untitled', path: 'notes/life/trips/untitled.md', notebookId: 'notes~life', title: 'Trip plan', tags: [], metadata: { title: 'Trip plan', status: 'inbox' }, content: '# Trip plan\n\nPack the tent.\n' };

  it('becomes a pending live note in its folder, and its text is merged in as typing, so no check-in takes it for an empty draft', async () => {
    const answer = await handOverDraft({ note: made, base: null }, context);
    expect(answer).toEqual({ kind: 'created', checkout: expect.objectContaining({ path: 'notes/life/.live/new1.md', pending: true }) });
    const [created] = bodies('/api/live/new');
    expect(created).toEqual({ notebookId: 'notes~life', folder: 'trips', title: 'Trip plan', content: expect.any(String) });
    // Created with a title alone: the person's text is not the note's initial text.
    expect(created.content).not.toContain('Pack the tent.');
    const [merged] = bodies('/api/live/merge');
    expect(merged).toEqual({ notebookId: 'notes~life', path: 'notes/life/.live/new1.md', base: created.content, text: expect.stringContaining('Pack the tent.'), mergeId: expect.stringMatching(/^[A-Za-z0-9_-]{8,128}$/) });
  });

  it('is not created twice when its merge is retried after a failure', async () => {
    mergeAnswer = () => {
      throw new TypeError('Failed to fetch');
    };
    await expect(handOverDraft({ note: made, base: null }, context)).resolves.toEqual({ kind: 'failed', error: expect.any(TypeError) });
    mergeAnswer = () => json({ applied: true, contentHash: 'h'.repeat(64), checkout: view, outcome: 'joined' });
    await expect(handOverDraft({ note: made, base: null }, context)).resolves.toEqual(expect.objectContaining({ kind: 'created' }));
    expect(bodies('/api/live/new')).toHaveLength(1);
    expect(bodies('/api/live/merge').map(body => body.path)).toEqual(['notes/life/.live/new1.md', 'notes/life/.live/new1.md']);
  });
});
