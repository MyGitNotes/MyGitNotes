import { describe, expect, it } from 'vitest';
import { type NotebookFacets, type NoteListItem, noteRefKey } from '@mygitnotes/core/note-query';
import { composeCommitted, overlayDraftFacets, overlayDraftLookup } from './draft-overlay.js';
import type { CommittedLayer } from './local-commits.js';
import type { NoteItem } from './types.js';
import type { WorkingNotes } from './working-notes.js';

const note = (path: string, extra: Partial<NoteItem> = {}): NoteItem => ({ id: path, path, notebookId: 'demo~kb', title: path, content: '# x\n', metadata: {}, tags: [], status: 'open', ...extra });
const facets = (): Record<string, NotebookFacets> => ({ 'demo~kb': { total: 2, hidden: 0, statuses: { open: 2 }, tags: { red: 1 }, directories: { notes: 2 }, compilations: { total: 0, statuses: {}, tags: {} }, outlines: { total: 0, statuses: {}, tags: {} } } });
const server = note('notes/a.md', { tags: ['red'] });
const committed = (entry: Partial<CommittedLayer[string]> & { note: NoteItem; }): CommittedLayer => ({ [noteRefKey(entry.note)]: { server: null, ...entry } });

describe('composeCommitted', () => {
  it('returns the working changes themselves when nothing is committed', () => {
    const working: WorkingNotes = {};
    expect(composeCommitted({}, working)).toBe(working);
  });

  it('overlays a committed note like a draft whose base is the server note, so counts subtract the server version', () => {
    const edited = note('notes/a.md', { tags: ['blue'], status: 'done' });
    const composed = composeCommitted(committed({ note: edited, server }), {});
    const counts = overlayDraftFacets(facets(), composed, false)['demo~kb'];
    expect(counts.total).toBe(2);
    expect(counts.tags).toEqual({ blue: 1 });
    expect(counts.statuses).toEqual({ open: 1, done: 1 });
  });

  it('counts a note made in the demo as new', () => {
    const composed = composeCommitted(committed({ note: note('notes/new.md') }), {});
    expect(overlayDraftFacets(facets(), composed, false)['demo~kb'].total).toBe(3);
  });

  it('keeps a working change over a committed note and takes the server note as its base', () => {
    const edited = note('notes/a.md', { content: '# committed\n' });
    const typing = note('notes/a.md', { content: '# typing\n' });
    const working: WorkingNotes = { [noteRefKey(typing)]: { note: typing, base: edited } };
    const composed = composeCommitted(committed({ note: edited, server }), working);
    expect(composed[noteRefKey(typing)].note.content).toBe('# typing\n');
    expect(composed[noteRefKey(typing)].base).toBe(server);
    expect(overlayDraftLookup([typing], [server as NoteListItem], composed)[0].content).toBe('# typing\n');
  });

  it('removes a note a local commit deleted from lookups and counts', () => {
    const composed = composeCommitted(committed({ note: server, server, deleted: true }), {});
    expect(overlayDraftLookup([server], [server as NoteListItem], composed)).toEqual([]);
    expect(overlayDraftFacets(facets(), composed, false)['demo~kb'].total).toBe(1);
  });
});
