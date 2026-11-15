import { createHash, timingSafeEqual } from 'node:crypto';
import express from 'express';
import { formatTemplateDate, formatTemplateTime, isBuiltinEditor, isLiveNotePath, isNotebookContent, isNoteFile, LIVE_MAX_BYTES, type LiveCheckout, type LiveNotes, livePathRule, livePendingPath, LiveTooLargeError, normalizeLiveText, type NotebookConfig, type NotebookKey, noteWebPath, parseLivePendingPath, parseNotebookKey, parseNoteContent, serializeNoteContent, SourceError, sweepLive, TemplateError, templateTimeZone, templateValues } from '@mygitnotes/core';
import { liveDueInstant, liveScheduleSetting } from './live-schedule.js';
import { asRemote, notebookRepository, noteRepository, requestPerson, workspaceOf } from './request-workspace.js';
import { fail } from './route-errors.js';

/*
 * The live editor's routes (docs/specs/2026-11-15-live-notes/spec.md §6): check out, create a live note, check in now,
 * the external sweep trigger, and the redirect the embedded editor's links go through. A deployment without
 * `liveNotes` mounts none of them.
 */

/** What a checkout or a new live note answers the web: the link with the path reads know it by. */
export interface LiveCheckoutView {
  id: string;
  notebookId: NotebookKey;
  /** The Git path, or a pending note's virtual path. */
  path: string;
  pending: boolean;
  /** A framed editor's page of the note, or the built-in editor's note page in the app. */
  editorUrl: string;
  /** A framed editor only. */
  embedUrl?: string;
  since: string;
  activeEditors: number;
  conflict: LiveCheckout['conflict'];
}

const viewOf = (checkout: LiveCheckout, key: NotebookKey, notebook: NotebookConfig): LiveCheckoutView => ({ id: checkout.id, notebookId: key, path: checkout.path ?? livePendingPath(notebook.root, checkout.id), pending: checkout.path === null, editorUrl: checkout.editorUrl!, ...(checkout.embedUrl !== undefined ? { embedUrl: checkout.embedUrl } : {}), since: checkout.since, activeEditors: checkout.activeEditors, conflict: checkout.conflict });

/** A refusal the web tells apart: the note or repository opens in the direct editor instead. */
class NotLiveError extends SourceError {
  readonly code = 'not-live';
  constructor(message: string) {
    super(message, 400);
  }
}
const notLive = (message: string) => new NotLiveError(message);
/** A note that is not live (yet): the socket opens only on a checked-out note. */
class NotOpenLiveError extends SourceError {
  readonly code = 'not-live';
  constructor() {
    super('The note is not open in the live editor.', 409);
  }
}
const liveFail = (res: express.Response, error: unknown) => fail(res, error, error instanceof LiveTooLargeError ? { code: 'too-large' } : error instanceof NotLiveError || error instanceof NotOpenLiveError ? { code: error.code } : {});

/** The sweep secret of an environment: at least 32 characters, else none, and the sweep route answers 404. */
export function liveSweepSecret(env: Record<string, string | undefined>): string | undefined {
  const secret = env.MYGITNOTES_LIVE_SWEEP_SECRET;
  return secret && secret.length >= 32 ? secret : undefined;
}

/** Whether a bearer token is the secret, compared in constant time whatever their lengths: both are hashed first. */
export function isSweepSecret(given: string, secret: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();
  return timingSafeEqual(digest(given), digest(secret));
}

/** What the routes are given. */
export interface LiveRoutesOptions {
  liveNotes: LiveNotes;
  /** Keeps a sweep alive after the 202 answer, as `AppServices.defer` does. */
  defer?: (work: Promise<unknown>) => void;
  env?: Record<string, string | undefined>;
}

/**
 * `POST /api/live/sweep` with `Authorization: Bearer <MYGITNOTES_LIVE_SWEEP_SECRET>`: checks in every link due at the
 * latest check-in instant (every link when the nightly check-in is off). It opens no workspace, so it is mounted before
 * the workspace routes. 202 at once, or the report with `?wait=1`. The secret is never logged. With `?mode=all` every
 * live link is due whatever its `since`, and a release refused for active editors is retried as 「立即簽回」 does: an
 * edition runs it before it switches a framed editor for the built-in one.
 */
export function createLiveSweepRouter({ liveNotes, defer, env = process.env }: LiveRoutesOptions): express.Router {
  const router = express.Router();
  router.post('/api/live/sweep', async (req, res) => {
    const secret = liveSweepSecret(env);
    if (!secret) return res.status(404).json({ error: 'Not found.' });
    const header = req.headers.authorization;
    const given = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!isSweepSecret(given, secret)) return res.status(401).json({ error: 'Unauthorized.' });
    const all = req.query.mode === 'all';
    if (req.query.mode !== undefined && !all) return res.status(400).json({ error: 'mode must be all, or left out.' });
    try {
      const setting = liveScheduleSetting(env);
      const now = new Date();
      const timeZone = setting?.timeZone ?? templateTimeZone(env);
      const work = sweepLive(liveNotes, all ? { instant: new Date(now.getTime() + 1), timeZone, mode: 'manual' } : { instant: setting ? liveDueInstant(now, setting) : now, timeZone });
      if (req.query.wait === '1') return res.json(await work);
      const logged = work.then(report => console.info(`[live-notes] sweep: ${report.results.filter(result => result.committed).length} committed, ${report.failed.length} failed of ${report.due} due`), error => console.warn(`[live-notes] sweep failed: ${(error as Error)?.name ?? 'error'}`));
      if (defer) defer(logged);
      res.status(202).json({ accepted: true });
    } catch (error) {
      fail(res, error);
    }
  });
  return router;
}

/** A signed-in writer's live editor of a repository, refused for anyone else. */
async function writerOf(res: express.Response, handle: Parameters<typeof asRemote>[0]) {
  const remote = asRemote(handle);
  if (!remote.authenticated) throw new SourceError('Sign in with write permission to edit notes live.', 403);
  const snapshot = await remote.reader.getSnapshot(true);
  if (!remote.reader.canWrite(snapshot)) throw new SourceError('Write access on the main workspace branch is required.', 403);
  const view = remote.reader.liveView;
  if (!view) throw notLive('This repository has no live editor.');
  return { reader: remote.reader, snapshot, view };
}

const signedIn = (res: express.Response) => {
  if (!requestPerson(res)) throw new SourceError('Sign in with write permission to edit notes live.', 403);
};

const CLOCK_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const isFolder = (value: string) => value === '' || (value.length <= 512 && !/[\\\p{Cc}]/u.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..'));

/** The person-side routes, mounted after the workspace routes resolve the request's workspace. */
export function createLiveRouter(): express.Router {
  const router = express.Router();

  router.post('/api/live/checkout', async (req, res) => {
    try {
      signedIn(res);
      const { notebookId, path: file } = req.body ?? {};
      const { handle, notebook, key } = await noteRepository(res, file, notebookId);
      const { reader, snapshot, view } = await writerOf(res, handle);
      // A pending note has no Git text to check out: its virtual path answers the link it already is, while it is pending.
      if (parseLivePendingPath(file as string, [notebook])) {
        const pending = await reader.liveCheckout(file as string);
        if (!pending || pending.path !== null) throw new SourceError('Note not found.', 404);
        return res.json({ checkout: viewOf(pending, key, notebook), outcome: 'joined' });
      }
      const relative = (file as string).slice(notebook.root.length + 1);
      // Outlines, template files and compilations keep the direct editor.
      if (!isLiveNotePath(relative, notebook) || (notebook.templates ?? []).some(template => template.file === relative)) throw notLive('This note opens in the direct editor.');
      const entry = snapshot.entries.find(candidate => candidate.path === file && candidate.type === 'blob' && candidate.mode !== '120000');
      if (!entry) throw new SourceError('Note not found.', 404);
      const content = (await reader.readSnapshotFile(snapshot, file)).toString('utf8');
      const { checkout, outcome } = await view.checkout(key, file, { commit: snapshot.sha, blob: entry.sha, content: normalizeLiveText(content) });
      res.json({ checkout: viewOf(checkout, key, notebook), outcome });
    } catch (error) {
      liveFail(res, error);
    }
  });

  router.post('/api/live/new', async (req, res) => {
    try {
      signedIn(res);
      const { notebookId, folder = '', title, templateId, values, content, clock } = req.body ?? {};
      const { handle, notebook, key } = await notebookRepository(res, notebookId);
      const { reader, view } = await writerOf(res, handle);
      if (typeof title !== 'string' || !title.trim() || title.length > 256 || /\p{Cc}/u.test(title)) throw new SourceError('A title of at most 256 characters is required.');
      if (typeof folder !== 'string' || !isFolder(folder) || (folder && !isNotebookContent(`${folder}/note.md`, notebook))) throw new SourceError('folder must be a folder of the notebook.');
      const now = new Date();
      const date = clock && typeof clock === 'object' && typeof clock.date === 'string' && CLOCK_DATE.test(clock.date) ? clock.date : formatTemplateDate(now);
      const time = clock && typeof clock === 'object' && typeof clock.time === 'string' && CLOCK_TIME.test(clock.time) ? clock.time : formatTemplateTime(now);
      let text: string, rule: string;
      if (templateId !== undefined) {
        if (typeof templateId !== 'string' || !templateId) throw new SourceError('templateId must be a template id.');
        const template = await reader.template(notebook.id, templateId);
        let given: Record<string, string>;
        try {
          given = templateValues(template, values);
        } catch (error) {
          throw new SourceError(error instanceof TemplateError ? error.message : 'Invalid template values.');
        }
        // As /api/templates/render fills it: the reader's date and time, the title and the given values.
        const rendered = await reader.renderTemplate(notebook.id, templateId, title.trim(), { date, time, values: given, defaults: false });
        text = serializeNoteContent({ ...rendered.metadata, template: templateId }, rendered.content, true, now);
        rule = livePathRule(template, given) ?? `${folder ? `${folder}/` : ''}{{title}}.md`;
      } else {
        if (values !== undefined) throw new SourceError('values fill a template: name one as templateId.');
        if (content !== undefined && typeof content !== 'string') throw new SourceError('content must be text.');
        const body = content ?? '';
        const parsed = parseNoteContent(body);
        // A note that names no title of its own takes the one given, so its first check-in files it under that title.
        text = typeof parsed.metadata.title === 'string' && parsed.metadata.title.trim() || /^#\s+\S/m.test(parsed.content) ? body : serializeNoteContent({ ...parsed.metadata, title: title.trim() }, parsed.content, true, now);
        rule = `${folder ? `${folder}/` : ''}{{title}}.md`;
      }
      if (Buffer.byteLength(text, 'utf8') > LIVE_MAX_BYTES) throw new LiveTooLargeError();
      if (rule.length > 1024 || /[\\\p{Cc}]/u.test(rule) || rule.split('/').some(part => !part || part === '.' || part === '..')) throw new SourceError("The template's path does not name a file inside the notebook.");
      const checkout = await view.createPending(key, rule, text);
      res.json({ checkout: viewOf(checkout, key, notebook) });
    } catch (error) {
      liveFail(res, error);
    }
  });

  /*
   * A ticket to open a live note's document over the built-in editor's socket: for a signed-in writer of a covered
   * repository whose editor is the built-in one, and a note that is live already (the web checks it out first).
   */
  router.post('/api/live/socket-ticket', async (req, res) => {
    try {
      signedIn(res);
      const { notebookId, path: file } = req.body ?? {};
      const { handle } = await noteRepository(res, file, notebookId);
      const { reader, view } = await writerOf(res, handle);
      if (!isBuiltinEditor(view.editor)) throw notLive('This repository has no built-in live editor.');
      const checkout = await reader.liveCheckout(file as string);
      if (!checkout) throw new NotOpenLiveError();
      res.json(await view.socketTicket(checkout.id));
    } catch (error) {
      liveFail(res, error);
    }
  });

  router.post('/api/live/checkin', async (req, res) => {
    try {
      signedIn(res);
      const { notebookId, path: file } = req.body ?? {};
      const { handle } = await noteRepository(res, file, notebookId);
      const { reader } = await writerOf(res, handle);
      res.json(await reader.checkInLive(file as string));
    } catch (error) {
      liveFail(res, error);
    }
  });

  /*
   * The embedded editor's relative note links and its "released" notice open here, top-level since the app refuses to
   * be framed. Only a same-origin note path built from validated parts is ever answered; anything else goes home, and
   * nothing from the query is reflected. The browser keeps a `#fragment` across the redirect.
   */
  router.get('/live/open', async (req, res) => {
    const home = () => res.redirect(302, '/');
    try {
      const { repository, notebook, path: file } = req.query;
      if (typeof repository !== 'string' || typeof notebook !== 'string' || typeof file !== 'string' || repository.length > 512 || notebook.length > 256 || file.length > 1024) return home();
      const entry = await workspaceOf(res).byId(repository);
      const local = parseNotebookKey(notebook)?.localId ?? notebook;
      const found = entry.notebooks.find(candidate => candidate.key === notebook) ?? entry.notebooks.find(candidate => candidate.id === local);
      if (!found || !file.startsWith(`${found.root}/`)) return home();
      const relative = file.slice(found.root.length + 1);
      if (/[\\\p{Cc}]/u.test(relative) || relative.split('/').some(part => !part || part === '.' || part === '..') || !isNoteFile(file) || !isNotebookContent(relative, found)) return home();
      res.redirect(302, noteWebPath(found.key, relative));
    } catch {
      home();
    }
  });
  return router;
}
