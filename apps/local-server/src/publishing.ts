import type express from 'express';
import { isCompilationPath, isNotebookContent, isNoteFile, parseNoteContent, type RemoteSource, type WorkspacePerson } from '@mygitnotes/core';
import { type GistAccess, noteGist, type PublishedNote, syncGists } from './gists.js';
import type { RemoteHandle } from './request-workspace.js';

/** What an edition's publishing service reports for one committed note; the web app shows `error` and `notices` beside the commit result. */
export interface PublishSync {
  path: string;
  /** Where the note is published, when it is. */
  url?: string;
  error?: string;
  /** Things that did not stop the publication but the person should know, such as an image left out. */
  notices?: string[];
}

/** What an edition's publishing service is handed after a commit or save succeeded. */
export interface PublishingRequest {
  req: express.Request;
  res: express.Response;
  /** The repository the notes were committed to. */
  repository: RemoteHandle;
  /** The committed notes (deletions excluded), in the shape Gists receive: the body without frontmatter, and the metadata. */
  notes: PublishedNote[];
}

/**
 * What an edition's publishing service is handed after a commit that no commit route of the app made: a live check-in,
 * an `/mcp` write or a tag commit. No request stands behind it, since a scheduled check-in has none.
 */
export interface CommittedNotes {
  /**
   * The repository the notes were committed to, read with the credential that made the commit. It is all of that
   * credential the service gets: a person's token stays with the server, which updates Gists itself.
   */
  repository: RemoteHandle;
  /** The notes whose text the commit wrote, in the shape `sync` receives; a moved, copied or deleted note is not among them. */
  notes: PublishedNote[];
  /**
   * Whom the commit was made for, where the server knows: the person of an `/mcp` grant, or the one signed in for a tag
   * commit. A check-in names none, as it commits with the deployment's own credential.
   */
  person?: WorkspacePerson;
}

/**
 * Publishes committed notes beyond the repository, such as to a public page. It runs after the commit has succeeded,
 * as Gist updates do, so a failure belongs to its note and never undoes the commit. The community edition has none.
 */
export interface PublishingService {
  /** After `/api/notes/commit` and `/api/notes`; its answer is shown beside the commit result. */
  sync(request: PublishingRequest): Promise<PublishSync[]>;
  /**
   * After every other commit of note text (see {@link CommittedNotes}), so a published note follows live check-ins and
   * agents' writes too. Nobody waits for it and nobody is shown its answer: an `error` is logged with the note's path,
   * so it must not quote the note. Left out, such commits publish nothing through the service.
   */
  syncCommitted?(committed: CommittedNotes): Promise<PublishSync[]>;
}

/** The committed notes as a service takes them; entries that are not notes are dropped. */
export function publishableNotes(notes: unknown): PublishedNote[] {
  if (!Array.isArray(notes)) return [];
  return notes.flatMap((note): PublishedNote[] => {
    if (!note || typeof note !== 'object' || (note as { delete?: unknown; }).delete === true) return [];
    const { path, content, metadata } = note as { path?: unknown; content?: unknown; metadata?: unknown; };
    if (typeof path !== 'string' || typeof content !== 'string') return [];
    return [{ path, content, metadata: metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata as Record<string, unknown> : {} }];
  });
}

/** Runs the service for committed notes and returns the `published` entry of the answer; nothing without a service or notes. */
export async function publishNotes(service: PublishingService | undefined, request: Omit<PublishingRequest, 'notes'> & { notes: unknown; }): Promise<{ published?: PublishSync[]; }> {
  const notes = publishableNotes(request.notes);
  if (!service || !notes.length) return {};
  try {
    return { published: await service.sync({ ...request, notes }) };
  } catch (error) {
    console.error(`[publishing] ${error instanceof Error ? error.message : 'sync failed'}`);
    return { published: notes.map(note => ({ path: note.path, error: 'Publishing failed. Commit the note again to retry.' })) };
  }
}

/** A note's text as a commit wrote it, frontmatter included. */
export interface CommittedText {
  path: string;
  content: string;
}

/**
 * The note texts among a commit's changes: the files `reader` serves as notes of its notebooks, so no agent file,
 * template, compilation or excluded path, and no change without text (a move, a copy, a deletion).
 */
async function committedNotes(reader: RemoteSource, changes: readonly { path: string; content?: string; }[]): Promise<CommittedText[]> {
  const texts = changes.filter((change): change is CommittedText => typeof change.content === 'string' && isNoteFile(change.path) && !isCompilationPath(change.path));
  if (!texts.length) return [];
  const { notebooks } = await reader.config();
  return texts.filter(({ path: file }) => notebooks.some(notebook => file.startsWith(`${notebook.root}/`) && isNotebookContent(file.slice(notebook.root.length + 1), notebook)));
}

/** A commit made outside the commit routes, as the server publishes it. */
export interface PublishedCommit {
  /** The repository committed to, opened with the credential that made the commit. */
  repository: RemoteHandle;
  /** The note texts the commit wrote ({@link committedNotes}). */
  notes: readonly CommittedText[];
  /** Whom the commit was made for, where known. */
  person?: WorkspacePerson;
  /** The Gist access of the person the commit was made for; a check-in has none. */
  gists?: GistAccess;
}
/**
 * Starts the publication of a commit. It answers what a request that made the commit waits for before it answers, so
 * the work is done where nothing keeps it alive afterwards: nothing when the deployment's `defer` holds the work, or
 * when there was nothing to publish. A check-in never waits.
 */
export type CommitPublisher = (commit: PublishedCommit) => Promise<void> | undefined;

/**
 * Publishes the notes of commits that answer no commit route (a live check-in, an `/mcp` write, a tag commit) as those
 * routes publish theirs: each note that names a Gist is pushed to it where a person's GitHub token made the commit,
 * and the service's `syncCommitted` hears every note. The commit stands and its answer is the same whatever comes of
 * it. A failure is logged with its repository and path, never with note text. Without a service that has
 * `syncCommitted` and without a note that names a Gist, nothing is called.
 */
export function commitPublisher({ publishing, defer }: { publishing?: PublishingService; defer?: (work: Promise<unknown>) => void; }): CommitPublisher {
  return ({ repository, notes: texts, person, gists }) => {
    const notes = texts.map((text): PublishedNote => {
      const { metadata, content } = parseNoteContent(text.content);
      return { path: text.path, content, metadata };
    });
    const named = notes.filter(note => noteGist(note.metadata));
    const service = publishing?.syncCommitted && notes.length ? publishing : undefined;
    if (!named.length && !service) return undefined;
    const where = (file: string) => `${repository.id}/${file}`;
    const failed = (action: string, files: string[]) => (error: unknown) => console.warn(`[publishing] ${files.map(where).join(', ')}: ${action} failed (${(error as Error)?.name ?? 'error'})`);
    const report = (results: { path: string; error?: string; }[]) => {
      for (const result of results) if (result.error) console.warn(`[publishing] ${where(result.path)}: ${result.error}`);
    };
    const work: Promise<unknown>[] = [];
    if (named.length && gists) work.push(syncGists(gists.token, named, gists.url).then(report).catch(failed('the Gist update', named.map(note => note.path))));
    // The Gist keeps its last text until a person commits the note in the app, which updates it as before.
    else for (const note of named) console.info(`[publishing] ${where(note.path)}: the Gist it names was not updated, as no person's GitHub token made this commit; the next commit of the note in the app updates it`);
    // What a service throws may quote the note, so only the error's class is logged.
    if (service) work.push(Promise.resolve().then(() => service.syncCommitted!({ repository, notes, ...(person ? { person } : {}) })).then(report).catch(failed('publishing', notes.map(note => note.path))));
    if (!work.length) return undefined;
    const done = Promise.all(work).then(() => undefined);
    if (!defer) return done;
    defer(done);
    return undefined;
  };
}

/**
 * Publishes the note texts among the changes of a commit a request made, and answers what that request waits for
 * ({@link CommitPublisher}). It never rejects: the commit has landed, so whatever fails here is only logged.
 */
export async function publishChanges(publish: CommitPublisher, { repository, changes, ...by }: Omit<PublishedCommit, 'notes'> & { changes: readonly { path: string; content?: string; }[]; }): Promise<void> {
  try {
    await publish({ repository, notes: await committedNotes(repository.reader, changes), ...by });
  } catch (error) {
    console.warn(`[publishing] ${repository.id}: publishing failed (${(error as Error)?.name ?? 'error'})`);
  }
}
