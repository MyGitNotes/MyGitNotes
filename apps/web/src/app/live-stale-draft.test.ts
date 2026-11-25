// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { dismissConflictDraftNotice, getLocalDraft, saveLocalDraft } from '../lib/storage.js';
import type { NoteItem } from '../lib/types.js';
import { discardShownWorkingNote, readWorkingNotes, updateWorkingNote, type WorkingNote, workingNotesKey } from '../lib/working-notes.js';
import { liveStaleDraft } from './live-stale-draft.js';

const store = { scope: 'repo:main', alias: 'kb' };
const conflictScope = `${store.scope}:conflict`;
const base: NoteItem = { id: 'a', path: 'notes/ex/a.md', notebookId: 'kb~ex', title: 'A', content: '# A\n', metadata: { title: 'A' }, tags: [], revision: 'one' };
const edited = (content: string): WorkingNote => ({ base, note: { ...base, content } });
const stored = () => readWorkingNotes(store)[base.path];
/** What a page offers of the note now, its drafts read as another tab may have left them. */
const offer = (draft = stored()) => liveStaleDraft({ note: base, draft, conflictScope, discardShown: shown => shown ? discardShownWorkingNote(store, base.path, shown).dropped : false });

afterEach(() => localStorage.clear());

describe('the older draft the live editor offers', () => {
  it('discards only the draft it showed: one another tab wrote since stays, with the conflict draft beside it', () => {
    updateWorkingNote(store, base.path, edited('# A\n\nD1\n'));
    saveLocalDraft(conflictScope, base.path, '# A\n\nD1\n', base.metadata);
    const shown = offer()!;
    // Another tab saves D2 before this one hears of it.
    const raw = JSON.parse(localStorage.getItem(workingNotesKey(store.scope))!);
    raw[base.path].note.content = '# A\n\nD2\n';
    localStorage.setItem(workingNotesKey(store.scope), JSON.stringify(raw));
    shown.discard();
    expect(stored()?.note.content).toBe('# A\n\nD2\n');
    expect(getLocalDraft(conflictScope, base.path)?.content).toBe('# A\n\nD1\n');
    // The notice offers what is kept now; discarding that drops it, and the conflict draft of D1 stays, its own.
    const next = offer()!;
    expect(next.text).toContain('D2');
    next.discard();
    expect(stored()).toBeUndefined();
    expect(getLocalDraft(conflictScope, base.path)?.content).toBe('# A\n\nD1\n');
  });

  it('discards the draft it showed with the conflict draft that holds the same text', () => {
    updateWorkingNote(store, base.path, edited('# A\n\nD1\n'));
    saveLocalDraft(conflictScope, base.path, '# A\n\nD1\n', base.metadata);
    offer()!.discard();
    expect(stored()).toBeUndefined();
    expect(getLocalDraft(conflictScope, base.path)).toBeNull();
  });

  it('drops a draft that holds nothing but its base only while it still does, and keeps a conflict draft that holds text', () => {
    const untouched: WorkingNote = { base, note: base, blocked: 'editor.remoteNoteMovedOrDeleted' };
    localStorage.setItem(workingNotesKey(store.scope), JSON.stringify({ [base.path]: { ...untouched, note: { ...base, notebookId: 'ex' }, base: { ...base, notebookId: 'ex' } } }));
    saveLocalDraft(conflictScope, base.path, '# A\n\nTyped before the conflict.\n', base.metadata);
    const shown = offer()!;
    expect(shown.differs).toBe(false);
    // Another tab types into it before the drop runs.
    updateWorkingNote(store, base.path, edited('# A\n\nD2\n'));
    shown.discard();
    expect(stored()?.note.content).toBe('# A\n\nD2\n');
    // Once it holds the base again, it goes; the conflict draft holds text of its own and is offered next.
    localStorage.setItem(workingNotesKey(store.scope), JSON.stringify({ [base.path]: { ...untouched, note: { ...base, notebookId: 'ex' }, base: { ...base, notebookId: 'ex' } } }));
    offer()!.discard();
    expect(stored()).toBeUndefined();
    const backup = offer(undefined)!;
    expect(backup.differs).toBe(true);
    expect(backup.text).toContain('Typed before the conflict.');
  });

  it('offers a conflict draft kept without a working note, and discards only that one', () => {
    saveLocalDraft(conflictScope, base.path, '# A\n\nMine.\n', base.metadata);
    const shown = offer(undefined)!;
    expect(shown.differs).toBe(true);
    expect(shown.savedAt).toBe(getLocalDraft(conflictScope, base.path)!.savedAt);
    expect(shown.text).toContain('Mine.');
    // A newer conflict draft written meanwhile stays.
    localStorage.setItem(`gh_notes_draft:${conflictScope}:${base.path}`, JSON.stringify({ ...getLocalDraft(conflictScope, base.path), content: '# A\n\nNewer.\n' }));
    shown.discard();
    expect(getLocalDraft(conflictScope, base.path)?.content).toBe('# A\n\nNewer.\n');
    offer(undefined)!.discard();
    expect(getLocalDraft(conflictScope, base.path)).toBeNull();
    expect(offer(undefined)).toBeUndefined();
  });

  it('offers no conflict draft whose notice the person dismissed', () => {
    saveLocalDraft(conflictScope, base.path, '# A\n\nMine.\n', base.metadata);
    dismissConflictDraftNotice(conflictScope, base.path, getLocalDraft(conflictScope, base.path)!.savedAt);
    expect(offer(undefined)).toBeUndefined();
  });
});
