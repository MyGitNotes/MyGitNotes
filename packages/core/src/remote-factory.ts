import { GitHubSource } from './github-source.js';
import { GitLabSource } from './gitlab-source.js';
import { SourceError } from './github-api.js';
import { RemoteManifest } from './remote-manifest.js';
import type { RemoteSource } from './remote-source.js';
import type { RemoteSourceConfig } from './source-config.js';
import type { RemoteCache } from './remote-cache.js';
import type { RepositoryScope } from './repository.js';
import type { CommitAuthor } from './commit-author.js';

/**
 * Opens a repository that serves the notebooks `scope` supplies. `author` is whom its commits are authored by when
 * `token` is a credential the deployment shares; without one the author is the token's account.
 */
export function createRemoteSource(source: RemoteSourceConfig, token: string | undefined, request: typeof fetch, cache: RemoteCache | undefined, scope: RepositoryScope, author?: CommitAuthor): RemoteSource {
  if (source.type === 'edition') throw new SourceError(`Edition platform ${source.platform} is opened only by the server that composes it.`, 400);
  return source.type === 'github' ? new GitHubSource(source.repository, source.branch, token, request, cache, scope, source.url, author) : new GitLabSource(source.url, source.repository, source.branch, token, request, cache, scope, author);
}

/** Opens a repository that serves every notebook of its own workspace manifest. */
export function openRemoteRepository(source: RemoteSourceConfig, token?: string, request: typeof fetch = fetch, cache?: RemoteCache, author?: CommitAuthor): { reader: RemoteSource; manifest: RemoteManifest; } {
  const reader = createRemoteSource(source, token, request, cache, async () => (await manifest.load()).config, author);
  const manifest = new RemoteManifest(reader);
  return { reader, manifest };
}
