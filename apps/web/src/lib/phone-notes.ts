import { createContext, useContext } from 'react';

/** What a phone's note screen needs from the page around it: the way back to the list, and the count the Changes tool shows. */
export interface PhoneNotes {
  /** Leaves the note screen for the list screen. */
  back: () => void;
  /** Pending changes, as the Changes tool counts them. */
  changesCount: number;
}

const PhoneNotesContext = createContext<PhoneNotes>({ back: () => {}, changesCount: 0 });

export const PhoneNotesProvider = PhoneNotesContext.Provider;

export function usePhoneNotes(): PhoneNotes {
  return useContext(PhoneNotesContext);
}

/**
 * Which of a phone's two Notes screens is showing: the list, or one note. A note shows only where there is a Focus with a tab to show and
 * the person has not gone back to the list, so the two never share the screen.
 */
export function phoneNotesScreen({ hasFocus, hasActiveTab, view }: { hasFocus: boolean; hasActiveTab: boolean; view: 'focus' | 'browse'; }): 'list' | 'note' {
  return hasFocus && hasActiveTab && view === 'focus' ? 'note' : 'list';
}
