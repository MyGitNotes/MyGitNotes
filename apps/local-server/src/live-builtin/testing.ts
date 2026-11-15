import { type LiveContext, LiveNotLiveError, LiveUnavailableError, normalizeLiveText, type RepositoryId } from '@mygitnotes/core';
import { type BuiltinLiveNotes, type BuiltinLiveNotesOptions, type BuiltinLiveParts, createBuiltinLiveNotes, liveEditorRef } from './adapter.js';
import { textUpdate } from './documents.js';

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

/** The hooks over an adapter's parts. */
export function withLiveHooks({ liveNotes, documents, store, clock, process }: BuiltinLiveParts): BuiltinLiveNotesWithHooks {
  const live = async (repository: RepositoryId, id: string) => {
    await liveNotes.started.catch(() => Promise.reject(new LiveUnavailableError()));
    const link = await store.link(id);
    if (!link?.live || link.repository !== repository) throw new LiveNotLiveError();
    return link;
  };
  const hooks: BuiltinLiveHooks = {
    async type(repository, id, text, person) {
      const link = await live(repository, id);
      const held = await documents.open(link);
      try {
        const update = textUpdate(held.document, normalizeLiveText(text));
        if (update) await documents.accept(link, update, liveEditorRef(person, false));
      } finally {
        await held.close();
      }
    },
    async setActive(repository, id, n) {
      const link = await live(repository, id);
      const now = clock();
      // The people of these hooks are their own entry among the processes, beside the sockets' (N4).
      await store.presence(link.id, `${process}:hooks`, Object.fromEntries(Array.from({ length: n }, (_, i) => [`hooks:${i + 1}`, now])), now);
      if (n === 0) await documents.unload(link);
    },
  };
  return Object.assign(liveNotes, hooks);
}

/** `builtinLiveNotes(options)` with the hooks a test drives it by. */
export function builtinLiveNotesWithHooks(options: BuiltinLiveNotesOptions): BuiltinLiveNotesWithHooks {
  return withLiveHooks(createBuiltinLiveNotes(options));
}
