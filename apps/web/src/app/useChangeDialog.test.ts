// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { NoteItem } from '../lib/types.js';
import type { PendingDocument } from '../lib/use-workspace-document.js';
import type { WorkingNotes } from '../lib/working-notes.js';
import { useChangeDialog } from './useChangeDialog.js';

const note: NoteItem = { id: 'a', path: 'notes/life/a.md', notebookId: 'notes~life', title: 'A', tags: [], metadata: {}, content: '# A\n' };
const focusDraft: PendingDocument = { repository: 'github:me/notes@main', file: '.github-notes-focus.yaml', page: {}, base: {}, diff: '-a\n+b\n' };
const dialog = (activeWorkingNotes: WorkingNotes, pendingDocuments: PendingDocument[], remote = true) => renderHook(() => useChangeDialog({ activeTab: 'notes', agentSystemRef: { current: null }, remote, documents: [], setActionError: () => {}, activeWorkingNotes, pendingDocuments, canWriteNotebook: () => true, repositoryFor: () => undefined })).result.current;

it('counts a note draft as something leaving the page would leave behind, and not a Focus layout', () => {
  expect(dialog({}, [focusDraft]).leaveLoses).toBe(false);
  expect(dialog({ 'notes~life:notes/life/a.md': { note: { ...note, content: '# A\nTyped.\n' }, base: note } }, [focusDraft]).leaveLoses).toBe(true);
  expect(dialog({}, [], false).leaveLoses).toBe(false);
});
