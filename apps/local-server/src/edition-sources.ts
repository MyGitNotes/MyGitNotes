import type { EditionSourceConfig, RemoteCache, RemoteSource, RepositoryScope, WorkspacePerson, WorkspaceRequest } from '@mygitnotes/core';

/** Repositories an edition keeps itself, opened without a provider credential. */
export interface EditionSources {
  /** Opens an edition repository for the request's person; throws RepositoryUnavailableError('no-access') for one they may not reach. */
  open(source: EditionSourceConfig, context: { person: WorkspacePerson | undefined; request: WorkspaceRequest; }, cache: RemoteCache | undefined, scope: RepositoryScope): RemoteSource;
}
