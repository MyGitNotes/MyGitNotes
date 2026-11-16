// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NoteInfoPanel } from './NoteInfoPanel.js';
import { noteLocation, NoteLocationProvider } from '../../lib/note-location.js';
import { createdGistConfirmations } from '../../lib/created-gists.js';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

const note = { notebookId: 'notes~life', path: 'notes/life/a.md' };
const repository = { id: 'github:me/notes@main', type: 'github' as const, repository: 'me/notes', branch: 'main', write: true };

function Panel() {
  const [metadata, setMetadata] = useState<Record<string, unknown>>({});
  return (
    <NoteLocationProvider locate={() => noteLocation('Life', repository, note.path)}>
      <NoteInfoPanel note={note} content='Body' metadata={metadata} setMetadata={setMetadata} locked={false} />
    </NoteLocationProvider>
  );
}

// The commit confirms the Gist this browser created for the note, kept outside the draft an agent tool can change.
it('remembers the Gist it creates for the note in this repository, and forgets it when unpublished', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/gists' && init?.method === 'POST') return new Response(JSON.stringify({ id: 'new456', url: 'https://gist.github.com/new456' }));
    if (url === '/api/gists/new456' && init?.method === 'DELETE') return new Response(JSON.stringify({ success: true }));
    throw new Error(`Unexpected request ${url}`);
  }));
  render(<Panel />);
  fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
  await screen.findByRole('button', { name: 'Unpublish' });
  expect(createdGistConfirmations(repository.id, [{ path: note.path, metadata: { gist: 'new456' } }])).toEqual([{ path: note.path, gist: 'new456' }]);
  expect(createdGistConfirmations('github:me/other@main', [{ path: note.path, metadata: { gist: 'new456' } }])).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'Unpublish' }));
  await screen.findByRole('button', { name: 'Publish' });
  await waitFor(() => expect(createdGistConfirmations(repository.id, [{ path: note.path, metadata: { gist: 'new456' } }])).toEqual([]));
});
