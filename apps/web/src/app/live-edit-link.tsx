import type { NoteRef } from '@mygitnotes/core/note-query';
import { createContext, type ReactNode, useContext } from 'react';

interface LiveEditLink {
  /** The `noteRefKey` of the note the address asks to edit live, once its editor shows it; null otherwise. */
  target: string | null;
  /** Takes the request for the note `key`: true once per arrival, and `edit` leaves the address. */
  claim: (key: string) => boolean;
}

const LiveEditLinkContext = createContext<LiveEditLink | null>(null);

/** Where the note the address asks to edit live shows: inputs of {@link liveEditLinkTarget}. */
export interface LiveEditLinkArrival {
  search: string;
  state: unknown;
  routedNote: NoteRef | null;
  zoomOpen: boolean;
  inFocus: boolean;
  focusPending: boolean;
  activeNotePath: string | undefined;
}

export function liveEditLinkTarget(_arrival: LiveEditLinkArrival): string | null {
  return null;
}

export function LiveEditLinkProvider({ children }: { target: string | null; children: ReactNode; }) {
  return <>{children}</>;
}

export function useLiveEditLink(): LiveEditLink | null {
  return useContext(LiveEditLinkContext);
}
