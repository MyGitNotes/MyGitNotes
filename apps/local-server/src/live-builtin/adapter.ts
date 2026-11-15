import type { CommitAuthor, LiveContext, LiveNotes, LiveNotice, LiveServiceCalls, LiveSocketTicket, RemoteSource, RepositoryId } from '@mygitnotes/core';
import type { LiveDocuments } from './documents.js';
import type { EditorRef, LiveStore } from './store.js';

/** The limits of the built-in editor that the adapter itself keeps (docs/specs/2026-11-15-builtin-live-editor §4.6). */
export interface BuiltinLiveLimits {
  /** The largest live text, in UTF-8 bytes. */
  maxBytes: number;
  /** How long after their last activity a connected person still counts as editing. */
  idleMs: number;
  /** How long a check-in's lease holds. */
  leaseMs: number;
  /** The texts handed out that a document keeps as bases for writes: at most this many. */
  ringTexts: number;
  /** And at most this many UTF-8 bytes of them; the newest is always kept. */
  ringBytes: number;
}

export interface BuiltinLiveNotesOptions {
  /** Whether the built-in editor covers a repository. */
  covers(repository: RepositoryId): boolean;
  /**
   * `service.open`: the repository with the deployment's own write credential, its commits authored by `author`
   * (none: the credential's account). The check-in engine is its only caller.
   */
  open(repository: RepositoryId, author?: CommitAuthor): Promise<RemoteSource>;
  /** `redisLiveStore({ url })`, or `memoryLiveStore()` for a deployment that accepts losing live text on restart. */
  store: LiveStore;
  notify?(notice: LiveNotice): Promise<void>;
  /** Tests only: the clock of every time the adapter records, in milliseconds. */
  clock?: () => number;
  limits?: Partial<BuiltinLiveLimits>;
}

/** The built-in live editor as `AppServices.liveNotes` takes it. */
export interface BuiltinLiveNotes extends LiveNotes {
  service: Required<LiveServiceCalls>;
  socketTicket(context: LiveContext, repository: RepositoryId, id: string): Promise<LiveSocketTicket>;
  /**
   * Resolves once the store passed its start-up check, and rejects with the store's refusal (an eviction policy that
   * could drop typing). A composition may await it before it listens; one that does not is stopped by the unhandled
   * rejection. Until it resolves every call waits, and after a refusal every call fails.
   */
  readonly started: Promise<void>;
  /** Compacts every document this process holds into the store and lets it go. */
  shutdown(): Promise<void>;
}

/** The adapter with what drives it from inside: its documents, store and clock. */
export interface BuiltinLiveParts {
  liveNotes: BuiltinLiveNotes;
  documents: LiveDocuments;
  store: LiveStore;
  clock: () => number;
  /** This process's name among those that share the store. */
  process: string;
}

/** Who an edit is recorded for: a person or an agent, by verified email, else by sign-in. */
export function liveEditorRef(_context: LiveContext, _agent: boolean): EditorRef {
  throw new Error('liveEditorRef is not built yet.');
}

/** The built-in adapter with its parts. Not built yet: every call fails. */
export function createBuiltinLiveNotes(options: BuiltinLiveNotesOptions): BuiltinLiveParts {
  const calls = <T extends object>(what: string) =>
    new Proxy({}, {
      get: (_target, name) =>
        name === 'then' ? undefined : async () => {
          throw new Error(`builtinLiveNotes ${what}.${String(name)} is not built yet.`);
        },
    }) as T;
  const refuse = async (): Promise<never> => {
    throw new Error('builtinLiveNotes is not built yet.');
  };
  return { liveNotes: { editors: [], editor: () => null, person: () => calls('person'), service: calls('service'), socketTicket: refuse, started: Promise.resolve(), shutdown: async () => {} }, documents: calls('documents'), store: options.store, clock: options.clock ?? Date.now, process: 'not-built' };
}
