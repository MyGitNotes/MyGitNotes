import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef, useState } from 'react';
import { workspaceKey } from '../agent-workspaces.js';
import type { PiLocation } from './session.js';

const DRAFT_PREFIX = 'mygitnotes.piAgent.draft.';
/** How long typing pauses before the draft is written; a reload or closing the panel inside it still writes at once. */
export const DRAFT_SAVE_MS = 300;

/** The localStorage key of the message box for the agent workspace Pi runs in, so two workspaces keep separate drafts. */
export const draftKey = (location: PiLocation | undefined) => `${DRAFT_PREFIX}${location ? workspaceKey(location) : ''}`;

/** Removes every stored message-box draft, which sign-out does so the next person on this browser never sees what was typed. */
export function clearAgentDrafts() {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(DRAFT_PREFIX)) localStorage.removeItem(key);
  } catch { /* Storage that is unavailable holds no draft to clear. */ }
}

function loadDraft(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

/** An empty draft is removed rather than stored; storage that is full or unavailable just means the draft is not kept. */
function storeDraft(key: string, text: string) {
  try {
    if (text) localStorage.setItem(key, text);
    else localStorage.removeItem(key);
  } catch { /* The text stays in the message box; only surviving a reload is lost. */ }
}

/**
 * The message box's text, kept in localStorage under `key` as it changes. It comes back after a reload, a remount or
 * the panel closing and opening again, and another key (another workspace) has its own. Only setting it to empty
 * clears it, which the panel does after a send went through.
 */
export function useAgentDraft(key: string): [string, Dispatch<SetStateAction<string>>, { retain: () => void; settle: () => void; }] {
  const [state, setState] = useState(() => ({ key, text: loadDraft(key) }));
  let current = state;
  // Another workspace shows its own draft; the one left behind stays stored under its key.
  if (state.key !== key) {
    current = { key, text: loadDraft(key) };
    setState(current);
  }
  const keyRef = useRef(current.key), textRef = useRef(current.text);
  useEffect(() => {
    keyRef.current = current.key;
    textRef.current = current.text;
  });
  const setText = useCallback<Dispatch<SetStateAction<string>>>(next => setState(previous => ({ ...previous, text: typeof next === 'function' ? next(previous.text) : next })), []);

  /** The write the debounce has not made yet. */
  const unsaved = useRef<{ key: string; text: string; } | null>(null);
  /** The key whose stored draft the next emptying leaves alone, while the message it holds waits to be written to the socket. */
  const retained = useRef<string | null>(null);
  const retain = useCallback(() => {
    retained.current = keyRef.current;
  }, []);
  const settle = useCallback(() => {
    const kept = retained.current;
    retained.current = null;
    if (kept && !textRef.current) storeDraft(kept, '');
  }, []);
  const flush = useCallback(() => {
    const waiting = unsaved.current;
    unsaved.current = null;
    if (waiting) storeDraft(waiting.key, waiting.text);
  }, []);

  useEffect(() => {
    // Emptying the box is a send (or a deliberate clear), so the stored draft goes with it at once.
    if (!current.text) {
      unsaved.current = null;
      if (retained.current !== current.key) storeDraft(current.key, '');
      return;
    }
    if (retained.current === current.key) retained.current = null;
    unsaved.current = { key: current.key, text: current.text };
    const timer = setTimeout(flush, DRAFT_SAVE_MS);
    return () => clearTimeout(timer);
  }, [current.key, current.text, flush]);

  // Leaving the workspace, closing the panel or the page writes what typing had not yet.
  useEffect(() => {
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [key, flush]);

  return [current.text, setText, { retain, settle }];
}
