import type { LiveContext, RepositoryId } from '@mygitnotes/core';
import { type BuiltinLiveNotes, type BuiltinLiveNotesOptions, type BuiltinLiveParts, createBuiltinLiveNotes } from './adapter.js';

/**
 * The hooks of the built-in editor that a test drives in place of browsers, as the memory adapter has them: an edition
 * hands them to `liveNotesContract` to run the kit over its own wiring.
 */
export interface BuiltinLiveHooks {
  /**
   * A person types until the note reads `text`: the difference travels as one Yjs update of a client that held the
   * document, the way a socket's does, so it is in the store before the document takes it and names the person.
   */
  type(repository: RepositoryId, id: string, text: string, person: LiveContext): Promise<void>;
  /** Sets how many people are connected and active; with none, the document is compacted and let go, as when the last tab closes. */
  setActive(repository: RepositoryId, id: string, n: number): Promise<void>;
}
export type BuiltinLiveNotesWithHooks = BuiltinLiveNotes & BuiltinLiveHooks;

/** The hooks over an adapter's parts. Not built yet: every call fails. */
export function withLiveHooks(parts: BuiltinLiveParts): BuiltinLiveNotesWithHooks {
  const refuse = async (): Promise<never> => {
    throw new Error('The built-in live hooks are not built yet.');
  };
  return Object.assign(parts.liveNotes, { type: refuse, setActive: refuse });
}

/** `builtinLiveNotes(options)` with the hooks a test drives it by. */
export function builtinLiveNotesWithHooks(options: BuiltinLiveNotesOptions): BuiltinLiveNotesWithHooks {
  return withLiveHooks(createBuiltinLiveNotes(options));
}
