// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { PhoneNotes } from '../lib/phone-notes.js';
import type { NoteItem } from '../lib/types.js';
import { usePhoneNotesValue } from './usePhoneNotesValue.js';

it('keeps the provider stable while dispatching to the latest delete handler', () => {
  const setView = vi.fn(), first = vi.fn(), next = vi.fn();
  const hook = renderHook<PhoneNotes, { remove: PhoneNotes['deleteNote'] }>(({ remove }) => usePhoneNotesValue(setView, 0, remove), { initialProps: { remove: first } });
  const previous = hook.result.current;
  hook.rerender({ remove: next });
  expect(hook.result.current).toBe(previous);
  previous.deleteNote!({ path: 'notes/a.md' } as NoteItem);
  expect(next).toHaveBeenCalledOnce();
  expect(first).not.toHaveBeenCalled();
  hook.rerender({ remove: undefined });
  expect(hook.result.current.deleteNote).toBeUndefined();
});
