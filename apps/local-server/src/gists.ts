import path from 'node:path';
import { type Response, Router } from 'express';
import { githubSite, isNoteFile, parseNoteContent, type RemoteSource, SourceError } from '@mygitnotes/core';
import { asRemote, namedRepository, requestSite, requestToken } from './request-workspace.js';

/** A Gist request refused because the sign-in grant lacks the `gist` scope; signing in again grants it. */
export class GistAuthorizationError extends SourceError {
  constructor() {
    super('GitHub has not granted Gist access. Sign in again to publish Gists.', 403);
  }
}

/** The outcome of pushing one committed note to the Gist its `gist` frontmatter names. */
export interface GistSync {
  path: string;
  gist: string;
  error?: string;
  reauthorize?: boolean;
}

/** A published note as a commit or save carries it: the body without frontmatter, and its metadata. */
export interface PublishedNote {
  path: string;
  content: string;
  metadata: Record<string, unknown>;
}

const GIST_ID = /^[A-Za-z0-9]{1,64}$/;

/** The Gist id a note's frontmatter names, when it names a well-formed one. */
export function noteGist(metadata: Record<string, unknown> | undefined): string | undefined {
  const id = metadata?.gist;
  return typeof id === 'string' && GIST_ID.test(id) ? id : undefined;
}

/** The Gist API of the GitHub site `url` names, or of github.com when there is none. */
async function gistRequest(token: string, endpoint: string, init: RequestInit = {}, url?: string): Promise<globalThis.Response> {
  const response = await fetch(`${githubSite(url).api}/gists${endpoint}`, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'MyGitNotes', Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
  if (response.ok || response.status === 404 && init.method === 'DELETE') return response;
  // OAuth app tokens list their scopes; one without `gist` is answered 404 or 403 rather than with a scope error.
  const scopes = response.headers.get('x-oauth-scopes');
  if (scopes !== null && !scopes.split(',').map(scope => scope.trim()).includes('gist')) throw new GistAuthorizationError();
  const message = await response.json().then(body => (body as { message?: unknown; }).message, () => undefined);
  throw new SourceError(`GitHub Gist request failed (${response.status})${typeof message === 'string' ? `: ${message}` : ''}.`, response.status === 404 ? 404 : 502);
}

function gistFile(note: { path: string; content: string; }) {
  if (!note.content.trim()) throw new SourceError('An empty note cannot be published as a Gist.');
  return { filename: path.posix.basename(note.path), content: note.content };
}

function gistDescription(note: PublishedNote) {
  return typeof note.metadata.title === 'string' && note.metadata.title.trim() ? note.metadata.title.trim() : path.posix.basename(note.path);
}

/** Creates a secret Gist holding the note's body; `url` names the GitHub Enterprise site that holds it, if any. */
export async function createGist(token: string, note: PublishedNote, url?: string): Promise<{ id: string; url: string; }> {
  const file = gistFile(note);
  const response = await gistRequest(token, '', { method: 'POST', body: JSON.stringify({ description: gistDescription(note), public: false, files: { [file.filename]: { content: file.content } } }) }, url);
  const body = await response.json() as { id?: unknown; html_url?: unknown; };
  if (typeof body.id !== 'string' || typeof body.html_url !== 'string') throw new SourceError('GitHub returned an invalid Gist.', 502);
  return { id: body.id, url: body.html_url };
}

/** Deletes a Gist; one that is already gone counts as deleted. */
export async function deleteGist(token: string, id: string, url?: string): Promise<void> {
  if (!GIST_ID.test(id)) throw new SourceError('Invalid Gist id.');
  await gistRequest(token, `/${id}`, { method: 'DELETE' }, url);
}

/** Replaces the Gist's single file with the note's body, renaming the file when the note moved. */
async function updateGist(token: string, id: string, note: PublishedNote, url?: string): Promise<void> {
  const file = gistFile(note);
  const current = await (await gistRequest(token, `/${id}`, {}, url)).json() as { files?: Record<string, unknown>; };
  const [existing] = Object.keys(current.files || {});
  await gistRequest(token, `/${id}`, { method: 'PATCH', body: JSON.stringify({ description: gistDescription(note), files: { [existing || file.filename]: file } }) }, url);
}

/** A note and the Gist a person agreed to publish it to. */
export interface GistConfirmation {
  path: string;
  gist: string;
}

/** The confirmations a commit request carries (`confirmedGists`), as `path` and Gist id pairs; a malformed entry confirms nothing. */
export function gistConfirmations(value: unknown): Set<string> {
  const confirmed = new Set<string>();
  if (!Array.isArray(value)) return confirmed;
  for (const entry of value.slice(0, 200)) {
    if (entry && typeof entry.path === 'string' && typeof entry.gist === 'string' && GIST_ID.test(entry.gist)) confirmed.add(`${entry.path}\0${entry.gist}`);
  }
  return confirmed;
}

/**
 * Whether a commit may push `note` to `gist` without asking: the note's text in the commit's `parent` already named
 * that Gist, and an agent did not make the note's newest commit there. The second costs one history read. A read that
 * fails counts as no, so the note is listed to confirm instead.
 */
export async function gistKept(reader: RemoteSource, parent: string, note: PublishedNote, gist: string): Promise<boolean> {
  try {
    const before = await reader.readFileAt(parent, note.path);
    if (!before || !('content' in before) || before.content === undefined || noteGist(parseNoteContent(before.content).metadata) !== gist) return false;
    const [newest] = (await reader.fileHistory(note.path, 1, 1, parent)).entries;
    return Boolean(newest) && !newest.agent;
  } catch {
    return false;
  }
}

/**
 * Pushes the committed notes that name a Gist, each only when the person meant it: the request confirms that Gist for
 * that note, or {@link gistKept} holds for the commit's `parent`. The frontmatter is repository content an agent can
 * write, so any other note is pushed nothing and answered in `gistsNeedConfirm`; the commit stands either way.
 */
export async function publishCommittedGists(token: string, reader: RemoteSource, parent: string, notes: PublishedNote[], confirmed: Set<string>, url?: string): Promise<{ gists?: GistSync[]; gistsNeedConfirm?: GistConfirmation[]; }> {
  const ready: PublishedNote[] = [], unconfirmed: GistConfirmation[] = [];
  for (const note of notes) {
    const gist = noteGist(note.metadata);
    if (!gist) continue;
    if (confirmed.has(`${note.path}\0${gist}`) || await gistKept(reader, parent, note, gist)) ready.push(note);
    else unconfirmed.push({ path: note.path, gist });
  }
  return { ...(ready.length ? { gists: await syncGists(token, ready, url) } : {}), ...(unconfirmed.length ? { gistsNeedConfirm: unconfirmed } : {}) };
}

/**
 * Pushes notes a person confirmed after their commit: each note as `revision` holds it, to the Gist it names there,
 * which must be the confirmed one. A note that commit does not hold, or that names another Gist, is reported and pushed nothing.
 */
export async function syncConfirmedGists(token: string, reader: RemoteSource, revision: string, confirmations: GistConfirmation[], url?: string): Promise<GistSync[]> {
  const results: GistSync[] = [];
  for (const { path: file, gist } of confirmations) {
    try {
      const read = await reader.readFileAt(revision, file);
      if (!read || !('content' in read) || read.content === undefined) throw new SourceError('The note is not readable in that commit.', 404);
      const { metadata, content } = parseNoteContent(read.content);
      if (noteGist(metadata) !== gist) throw new SourceError('The note names another Gist in that commit.', 409);
      await updateGist(token, gist, { path: file, content, metadata }, url);
      results.push({ path: file, gist });
    } catch (error) {
      results.push({ path: file, gist, error: error instanceof Error ? error.message : 'Gist update failed.', ...(error instanceof GistAuthorizationError ? { reauthorize: true } : {}) });
    }
  }
  return results;
}

/** Pushes each note that names a Gist to that Gist, one at a time; a failure is reported for its note and never undoes the commit. */
export async function syncGists(token: string, notes: PublishedNote[], url?: string): Promise<GistSync[]> {
  const results: GistSync[] = [];
  for (const note of notes) {
    const gist = noteGist(note.metadata);
    if (!gist) continue;
    try {
      await updateGist(token, gist, note, url);
      results.push({ path: note.path, gist });
    } catch (error) {
      results.push({ path: note.path, gist, error: error instanceof Error ? error.message : 'Gist update failed.', ...(error instanceof GistAuthorizationError ? { reauthorize: true } : {}) });
    }
  }
  return results;
}

/** The signed-in GitHub token of a request whose workspace is on GitHub, or undefined for any other request. */
export function gistToken(res: Response): string | undefined {
  return requestSite(res).type === 'github' ? requestToken(res) : undefined;
}

/** The GitHub Enterprise site the request's workspace is on; undefined for github.com. */
export function gistSite(res: Response): string | undefined {
  const site = requestSite(res);
  return site.type === 'github' ? site.url : undefined;
}

/**
 * Whether `location` is a Gist page of the GitHub site `url` names: gist.github.com for github.com; for an Enterprise
 * site its `/gist/` path or the `gist.` subdomain of subdomain isolation, on the site's port.
 */
export function gistPageAllowed(location: URL, url?: string): boolean {
  if (location.protocol !== 'https:' || location.username || location.password) return false;
  if (!url) return location.hostname === 'gist.github.com' && !location.port;
  const site = new URL(url);
  if (location.port !== site.port) return false;
  return location.hostname === `gist.${site.hostname}` || location.hostname === site.hostname && location.pathname.startsWith(`${site.pathname.replace(/\/$/, '')}/gist/`);
}

/** Publishes note bodies as secret Gists of the signed-in GitHub account, and deletes them again. */
export function createGistRouter(): Router {
  const router = Router();
  const token = (res: Response) => {
    if (requestSite(res).type !== 'github') throw new SourceError('Gists require a GitHub workspace.');
    const value = requestToken(res);
    if (!value) throw new SourceError('Sign in with GitHub to publish Gists.', 401);
    return value;
  };
  const fail = (res: Response, error: unknown) => res.status(error instanceof SourceError ? error.status : 500).json({ error: error instanceof Error ? error.message : 'Gist request failed.', ...(error instanceof GistAuthorizationError ? { reauthorize: true } : {}) });
  router.post('/api/gists', async (req, res) => {
    try {
      const { path: file, content, metadata } = req.body ?? {};
      if (typeof file !== 'string' || !file || typeof content !== 'string') throw new SourceError('path and content are required.');
      res.json(await createGist(token(res), { path: file, content, metadata: metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {} }, gistSite(res)));
    } catch (error) {
      fail(res, error);
    }
  });
  // Pushes notes the person confirmed after a commit answered them in `gistsNeedConfirm`, from that commit.
  router.post('/api/gists/sync', async (req, res) => {
    try {
      const { repository, revision, notes } = req.body ?? {};
      if (typeof revision !== 'string' || !/^[a-f0-9]{40}([a-f0-9]{24})?$/.test(revision)) throw new SourceError('revision must name a commit.');
      if (!Array.isArray(notes) || !notes.length || notes.length > 200 || notes.some(note => typeof note?.path !== 'string' || !isNoteFile(note.path) || typeof note.gist !== 'string' || !GIST_ID.test(note.gist))) throw new SourceError('notes must list 1 to 200 notes, each with its path and Gist id.');
      const credential = token(res);
      const { reader } = asRemote((await namedRepository(res, repository)).handle);
      res.json({ gists: await syncConfirmedGists(credential, reader, revision, notes.map(note => ({ path: note.path as string, gist: note.gist as string })), gistSite(res)) });
    } catch (error) {
      fail(res, error);
    }
  });
  // Opens a Gist where its site keeps it. The address comes from the site's Gist API, never from the note, whose
  // frontmatter is repository content anyone with write access can change.
  router.get('/api/gists/:id/open', async (req, res) => {
    try {
      const id = req.params.id;
      if (!GIST_ID.test(id)) throw new SourceError('Invalid Gist id.');
      const site = gistSite(res);
      const body = await (await gistRequest(token(res), `/${id}`, {}, site)).json() as { html_url?: unknown; };
      const location = typeof body.html_url === 'string' ? URL.parse(body.html_url) : null;
      if (!location || !gistPageAllowed(location, site)) throw new SourceError('GitHub returned an unexpected Gist address.', 502);
      res.redirect(302, location.href);
    } catch (error) {
      fail(res, error);
    }
  });
  router.delete('/api/gists/:id', async (req, res) => {
    try {
      await deleteGist(token(res), req.params.id, gistSite(res));
      res.json({ success: true });
    } catch (error) {
      fail(res, error);
    }
  });
  return router;
}
