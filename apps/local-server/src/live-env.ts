import { type CommitAuthor, LiveCredentialError, type LiveOpenAs, openRemoteRepository, type RemoteCache, type RemoteSource, type RemoteSourceConfig, type RepositoryId, sourceIdentity, type WorkspaceConfigSource, type WorkspaceSite } from '@mygitnotes/core';
import { type AppServices, checkBuiltinLiveHost } from './app.js';
import { CredentialRejected } from './auth.js';
import { storedSessions } from './browser-sessions.js';
import { type IdentityService, providerIdentity } from './identity.js';
import { type BuiltinLiveNotes, builtinLiveNotes, redisLiveStore } from './live-builtin/index.js';
import { createRecordStore, storageMode } from './record-store/index.js';
import { createRemoteCache } from './remote-cache-store.js';
import { cookieWorkspaceChoices } from './workspace-choice.js';

/*
 * The built-in live editor of a self-hosted deployment, from its environment (docs/specs/2026-11-16-collab-first-self-host
 * A8, A6). `MYGITNOTES_LIVE_EDITOR=builtin` turns it on; unset or `off` leaves the server exactly as it was. Its notes
 * are checked in with the editors' own stored provider credentials, never a shared one: the provider enforces each
 * person's access when the commit is made, and no secret exists that could write to every repository.
 */

/** What `MYGITNOTES_LIVE_EDITOR` asks for: `builtin`, or `off` when unset, empty or `off`. Any other value is a thrown Error. */
export function liveEditorSetting(env: Record<string, string | undefined> = process.env): 'builtin' | 'off' {
  const value = env.MYGITNOTES_LIVE_EDITOR?.trim().toLowerCase() || 'off';
  if (value !== 'builtin' && value !== 'off') throw new Error(`MYGITNOTES_LIVE_EDITOR '${env.MYGITNOTES_LIVE_EDITOR}' is not builtin or off. Set it to builtin to turn the built-in live editor on, or remove it.`);
  return value;
}

/**
 * The provider repository an id names on the deployment's site; null for any other id: an edition's, a local one, or
 * one of another platform or site. The id is rebuilt from the parts read, so only an id this site writes passes.
 */
export function providerSourceOf(site: WorkspaceSite, repository: RepositoryId): RemoteSourceConfig | null {
  if (site.type === 'local' || (site.type === 'gitlab' && !site.url)) return null;
  const prefix = site.url ? `${site.type}:${site.url}/` : `${site.type}:`;
  if (typeof repository !== 'string' || !repository.startsWith(prefix)) return null;
  const rest = repository.slice(prefix.length), at = rest.indexOf('@');
  if (at <= 0 || at === rest.length - 1) return null;
  const name = rest.slice(0, at), branch = rest.slice(at + 1);
  if (!/^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)+$/.test(name)) return null;
  const source: RemoteSourceConfig = site.type === 'github' ? { type: 'github', repository: name, branch, ...(site.url ? { url: site.url } : {}) } : { type: 'gitlab', url: site.url!, repository: name, branch };
  return sourceIdentity(source) === repository ? source : null;
}

/** What opens a repository for a check-in as one of its editors. */
export interface LiveOpenOptions {
  site: WorkspaceSite;
  identity: Pick<IdentityService, 'personToken'>;
  cache?: RemoteCache;
}

/**
 * `service.open` of the community's composition: the repository with the token the person's own sign-in stored, so
 * the provider decides, as the commit is made, whether they may still write. A repository that is not the site's
 * provider's, nobody to commit as, and a person whose credential is missing, refused, revoked or expired are a
 * `LiveCredentialError`, which sends the check-in on to the next editor.
 */
export function liveOpen({ site, identity, cache }: LiveOpenOptions): (repository: RepositoryId, author?: CommitAuthor, as?: LiveOpenAs) => Promise<RemoteSource> {
  return async (repository, author, as) => {
    const source = providerSourceOf(site, repository);
    if (!source || !as?.person || !identity.personToken) throw new LiveCredentialError();
    let token: string | undefined;
    try {
      token = await identity.personToken(as.person, site);
    } catch (error) {
      if (error instanceof CredentialRejected) throw new LiveCredentialError();
      throw error;
    }
    if (!token) throw new LiveCredentialError();
    return openRemoteRepository(source, token, fetch, cache, author).reader;
  };
}

/** The built-in editor a deployment's environment turned on, with the services `createApp` runs it with. */
export interface EnvironmentLive {
  live: BuiltinLiveNotes;
  /** Handed to `createApp`: the editor, and the identity, stores and cache it shares with the app. */
  services: Pick<AppServices, 'liveNotes' | 'identity' | 'recordStore' | 'sessions' | 'workspaceChoices' | 'remoteCache'>;
}

export interface EnvironmentLiveOptions {
  /** Tests only: the clock of every time the editor records. */
  clock?: () => number;
}

/**
 * The built-in live editor as `MYGITNOTES_LIVE_EDITOR` asks for it; undefined when it is off, and nothing is built or
 * read then. With `builtin`, the deployment must be able to run it, or this throws and names what to change:
 * a remote source; sign-ins kept in Redis on the server, since a check-in commits with a credential a sign-in stored; a native
 * Redis for the live store (`MYGITNOTES_LIVE_REDIS_URL`, else `REDIS_URL`); a long-running server, not Vercel; and
 * `APP_URL` as the app's bare origin.
 */
export async function environmentLive(base: string, configSource: WorkspaceConfigSource, options: EnvironmentLiveOptions = {}): Promise<EnvironmentLive | undefined> {
  if (liveEditorSetting() === 'off') return undefined;
  if (configSource.mode === 'local') throw new Error('MYGITNOTES_LIVE_EDITOR=builtin needs a remote source (MYGITNOTES_SOURCE=github or gitlab): a local workspace has no live editor. Remove MYGITNOTES_LIVE_EDITOR, or serve a remote repository.');
  if (storageMode() === 'cookie') throw new Error('MYGITNOTES_LIVE_EDITOR=builtin needs sign-ins kept on the server: a check-in commits with the credential a sign-in stored, and MYGITNOTES_STORAGE=cookie stores none. Remove MYGITNOTES_STORAGE=cookie and set REDIS_URL, or remove MYGITNOTES_LIVE_EDITOR.');
  const url = process.env.MYGITNOTES_LIVE_REDIS_URL || process.env.REDIS_URL;
  if (!url || !/^rediss?:\/\//.test(url)) throw new Error('MYGITNOTES_LIVE_EDITOR=builtin needs a native Redis for live notes: set MYGITNOTES_LIVE_REDIS_URL (or REDIS_URL) to a redis:// or rediss:// URL. A Redis reached over REST cannot hold them.');
  if (storageMode() === 'directory') throw new Error("MYGITNOTES_LIVE_EDITOR=builtin needs sign-ins kept in Redis: a check-in commits with the credential a sign-in stored, and without REDIS_URL they are kept in the container's directory and lost when it is recreated. Set REDIS_URL, or remove MYGITNOTES_LIVE_EDITOR.");
  checkBuiltinLiveHost();
  const { site } = await configSource.settings({ headers: {} });
  // The same stores, sessions and choices `createApp` would make by itself, made here because the editor commits with
  // the credentials the identity keeps in them.
  const recordStore = createRecordStore(base), sessions = storedSessions(recordStore), workspaceChoices = cookieWorkspaceChoices();
  const identity = providerIdentity({ store: recordStore, sessions, configSource, choices: workspaceChoices }, { live: true });
  const remoteCache = createRemoteCache();
  const live = builtinLiveNotes({ covers: repository => providerSourceOf(site, repository) !== null, open: liveOpen({ site, identity, cache: remoteCache }), store: redisLiveStore({ url }), ...(options.clock ? { clock: options.clock } : {}) });
  return { live, services: { liveNotes: live, identity, recordStore, sessions, workspaceChoices, remoteCache } };
}
