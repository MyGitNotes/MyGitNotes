import { createContext, type ReactNode, useContext } from 'react';
import type { NoteRef } from '@mygitnotes/core/note-query';
import type { RepositoryStatus } from '@mygitnotes/core/repository';

/** Why a note cannot be edited. */
export type ReadOnlyReason = 'unavailable' | 'core' | 'branch' | 'no-push';

/** Where a note lives, as the note Info tab shows it. */
export interface NoteLocation {
  notebook: string;
  /** The platform repository, or the worktree path of a local repository. */
  repository: string;
  /** The id of the repository that serves the note, which keys what this browser keeps of it. */
  repositoryId: string;
  branch: string;
  path: string;
  readOnly?: ReadOnlyReason;
  /** Whether the note may be published as a Gist: a writable note of a GitHub repository. */
  gists: boolean;
  /** Whether an edition's publish rows apply: a writable note that is not a demo's, whatever the repository type. */
  publishable: boolean;
}

const NoteLocationContext = createContext<(note: NoteRef) => NoteLocation | undefined>(() => undefined);

export function NoteLocationProvider({ locate, children }: { locate: (note: NoteRef) => NoteLocation | undefined; children: ReactNode; }) {
  return <NoteLocationContext.Provider value={locate}>{children}</NoteLocationContext.Provider>;
}

export const useNoteLocation = (note: NoteRef) => useContext(NoteLocationContext)(note);

/** The reason a repository refuses edits: unavailable, the product `core` branch, another branch, or no push access. */
export function readOnlyReason(repository: { unavailable?: unknown; branch: string; write: boolean; demo?: boolean; } | undefined): ReadOnlyReason | undefined {
  if (!repository || repository.unavailable) return 'unavailable';
  if (repository.write || repository.demo === true) return undefined;
  if (repository.branch === 'core') return 'core';
  if (repository.branch && repository.branch !== 'main') return 'branch';
  return 'no-push';
}

/** Where a note of the notebook titled `notebook` lives, given the repository that serves the notebook. */
export function noteLocation(notebook: string, repository: Pick<RepositoryStatus, 'id' | 'type' | 'repository' | 'branch' | 'write' | 'demo' | 'unavailable'> | undefined, path: string): NoteLocation {
  const name = repository?.repository ?? (repository?.id.startsWith('local:') ? repository.id.slice('local:'.length) : repository?.id ?? '');
  const readOnly = readOnlyReason(repository);
  const publishable = Boolean(repository) && !readOnly && !repository?.demo;
  return { notebook, repository: name, repositoryId: repository?.id ?? '', branch: repository?.branch ?? '', path, readOnly, gists: publishable && repository?.type === 'github', publishable };
}
