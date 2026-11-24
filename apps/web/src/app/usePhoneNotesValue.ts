import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import type { PhoneNotes } from '../lib/phone-notes.js';

export function usePhoneNotesValue(setView: (view: 'browse') => void, changesCount: number, remove: PhoneNotes['deleteNote']): PhoneNotes {
  const latest = useRef(remove);
  useLayoutEffect(() => { latest.current = remove; }, [remove]);
  const dispatchDelete = useCallback<NonNullable<PhoneNotes['deleteNote']>>(note => latest.current?.(note), []);
  const deleteNote = remove ? dispatchDelete : undefined;
  return useMemo(() => ({ back: () => setView('browse'), changesCount, deleteNote }), [setView, changesCount, deleteNote]);
}
