import path from 'node:path';
import { differsOnlyInCase } from './case-collision.js';
import { type CommitAuthor, commitAuthor } from './commit-author.js';
import { isNotebookContent } from './folders.js';
import { parseNoteContent } from './frontmatter.js';
import { SourceError } from './github-api.js';
import { isEmptyLiveDraft, isLiveId, isLiveNotePath, LIVE_MAX_BYTES, liveAdapterError, type LiveCheckout, liveCheckoutOf, type LiveConflict, liveContentHash, type LiveEditor, liveEditorOf, type LiveLease, LiveLeasedError, type LiveNotes, type LiveNotice, LiveNotLiveError, type LiveRelease, type LiveText, liveTextOf, LiveUnavailableError, normalizeLiveText } from './live-notes.js';
import { mergeLiveText } from './live-merge.js';
import { parseNotebookKey } from './notebook-key.js';
import { appendTrailers, utcDay } from './note-versions.js';
import { formatTemplateDate, formatTemplateTime, safeFileName, templateFileId, templateSettings, templateTimeZone } from './note-template.js';
import { gitBlobId } from './remote-cache.js';
import type { RemoteSnapshot, RemoteSource } from './remote-source.js';
import { type RepositoryId, StaleRevisionError } from './repository.js';
import type { NotebookConfig, NoteMetadata } from './types.js';

/*
 * The check-in engine (docs/specs/2026-11-15-live-notes/spec.md §5): it commits a live note's text to Git with every
 * editor named, merging Git's changes since the checkout into the live note first, and then closes the live note. It
 * keeps no state: link state lives in the adapter, whose lease makes each link single-flight across processes, and a
 * repeat finds the live text already in Git and only acknowledges it.
 */

/**
 * Why a check-in left the note open, or did not start; with `discarded`, why a pending note was discarded instead:
 * `empty`, an empty draft ({@link isEmptyLiveDraft}), or `untyped`, one nobody typed in (a sweep only).
 */
export type LiveCheckInReason = 'leased' | 'released' | 'unfiled' | 'active' | 'changed' | 'not-synced' | 'empty' | 'untyped';

export interface LiveCheckInResult {
  id: string;
  /** The note's Git path; null for a pending note still unfiled, or a link this run never read. */
  path: string | null;
  /** Whether this run made a commit; a text Git already held is only acknowledged. */
  committed: boolean;
  commit?: string;
  /** Whether the live note was closed. */
  released: boolean;
  reason?: LiveCheckInReason;
  /** With `active`: the people still editing. */
  activeEditors?: number;
  conflict?: LiveConflict;
  /** Editors whose name or email cannot be written into a commit, left out of it. */
  skippedEditors?: string[];
  /** A pending note this run filed at `path`. */
  filed?: true;
  /** A pending note this run discarded (§19): nothing was committed, and the link is gone. */
  discarded?: true;
}

export interface LiveCheckInOptions {
  /** A manual check-in (「立即簽回」) retries a release refused as active; a scheduled one leaves it for the retry ticks. */
  mode: 'manual' | 'scheduled';
  /** Milliseconds since the epoch; the clock of the deadline, of conflict records and of agent trailers. */
  now?: () => number;
  /** Where a pending note's `{{date}}` and `{{time}}` fall when its frontmatter gives none; `MYGITNOTES_TIMEZONE` by default. */
  timeZone?: string;
  sleep?: (ms: number) => Promise<void>;
  /** A sweep's check-in: a pending note nobody typed in is discarded too, not only an empty one, where the adapter can discard. */
  discardUntyped?: boolean;
}

/** Each link is checked in within 4 minutes, inside its 5-minute lease; nothing is committed after that. */
const DEADLINE_MS = 4 * 60_000;
/** A manual check-in asks for the release again this many times, this far apart, while the web closes its frame. */
const RELEASE_RETRIES = 3;
const RELEASE_RETRY_MS = 2_000;
/** Most co-authors one commit lists (`withCoAuthors` refuses more). */
const MAX_CO_AUTHORS = 50;
/** A collision takes `-2` up to this suffix before the note stays pending. */
const MAX_COLLISION_SUFFIX = 99;
const PLACEHOLDERS = /\{\{\s*([A-Za-z_][A-Za-z0-9_-]*)\s*\}\}/g;

const adapter = async <T>(run: () => Promise<T>): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    throw liveAdapterError(error);
  }
};
const sleeping = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const isTime = (value: unknown): value is string => typeof value === 'string' && value.length <= 64 && !Number.isNaN(Date.parse(value));

/** The editors a detail listed, each checked; one that is not an editor at all is dropped. */
function editorsOf(value: unknown): LiveEditor[] {
  if (!Array.isArray(value)) throw new LiveUnavailableError();
  return value.filter((editor): editor is LiveEditor => {
    if (!editor || typeof editor !== 'object') return false;
    const { name, email, agent, firstAt, lastAt } = editor as Record<string, unknown>;
    return typeof name === 'string' && name.length <= 256 && (email === undefined || typeof email === 'string') && typeof agent === 'boolean' && isTime(firstAt) && isTime(lastAt);
  });
}

/**
 * The editors of two detail reads as one list: an editor in both (by email, else name, and by whether it is an agent)
 * keeps its earliest `firstAt` and latest `lastAt`.
 */
export function unionLiveEditors(first: readonly LiveEditor[], second: readonly LiveEditor[]): LiveEditor[] {
  const keyOf = (editor: LiveEditor) => `${editor.agent ? 'agent' : 'person'}:${editor.email?.toLowerCase() ?? `name:${editor.name}`}`;
  const merged = new Map<string, LiveEditor>();
  for (const editor of [...first, ...second]) {
    const known = merged.get(keyOf(editor));
    if (!known) {
      merged.set(keyOf(editor), { ...editor });
      continue;
    }
    if (Date.parse(editor.firstAt) < Date.parse(known.firstAt)) known.firstAt = editor.firstAt;
    if (Date.parse(editor.lastAt) > Date.parse(known.lastAt)) known.lastAt = editor.lastAt;
  }
  return [...merged.values()];
}

/** Who a check-in commit names, from the editors since the last sync. */
export interface LiveAuthorship {
  author?: CommitAuthor;
  coAuthors: CommitAuthor[];
  /** Editors left out: `commitAuthor` refused them, or they have no email. */
  skipped: string[];
  /** Whether an agent edited in the window. */
  agent: boolean;
}

/**
 * The author is the earliest person `commitAuthor` accepts, else the earliest agent, else none (the credential's
 * account); every other accepted editor is a co-author, once per email. An editor whose name or email cannot be written
 * into a commit is skipped, never cleaned up.
 */
export function liveAuthorship(editors: readonly LiveEditor[]): LiveAuthorship {
  const sorted = [...editors].sort((a, b) => Date.parse(a.firstAt) - Date.parse(b.firstAt));
  const accepted: { editor: LiveEditor; author: CommitAuthor; }[] = [];
  const skipped: string[] = [];
  for (const editor of sorted) {
    let author: CommitAuthor | undefined;
    try {
      author = commitAuthor({ name: editor.name, email: editor.email }, 'A live editor');
    } catch {
      author = undefined;
    }
    if (author) accepted.push({ editor, author });
    else skipped.push(editor.name);
  }
  const lead = accepted.find(entry => !entry.editor.agent) ?? accepted[0];
  const named = new Set(lead ? [lead.author.email.toLowerCase()] : []);
  const coAuthors: CommitAuthor[] = [];
  for (const { author } of accepted) {
    if (named.has(author.email.toLowerCase())) continue;
    named.add(author.email.toLowerCase());
    if (coAuthors.length < MAX_CO_AUTHORS) coAuthors.push(author);
  }
  return { ...(lead ? { author: lead.author } : {}), coAuthors, skipped, agent: sorted.some(editor => editor.agent) };
}

/** The value a pending note's frontmatter gives a placeholder, as text. */
const scalar = (value: unknown): string | undefined => typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : undefined;
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

/** Where a pending note is filed, or why it stays pending. */
export type LiveFiling = { path: string; } | { unfiled: string; };

/** Most UTF-8 bytes in one part of a filed path, so `-99` still fits a file system's 255. */
const MAX_FILED_PART_BYTES = 200;
/** Most UTF-8 bytes in a whole filed path. */
const MAX_FILED_PATH_BYTES = 1024;

interface LiveFilingRequest {
  rule: string;
  notebook: NotebookConfig;
  content: string;
  since: string;
  timeZone?: string;
}

/**
 * The Git paths a pending note's rule renders (§5.5), in the order a filing tries them: `title` is the note's title,
 * `date`/`time` its frontmatter value when valid, else `since` in `timeZone`, and any other name its frontmatter value;
 * each made safe as one file name. After the rendered path come its `-2` … `-99` variants before the extension.
 */
function livePathCandidates(request: LiveFilingRequest): { candidates: string[]; } | { unfiled: string; } {
  const { rule, notebook, content, since, timeZone = 'UTC' } = request;
  const { metadata, title } = parseNoteContent(content);
  const at = new Date(since);
  const value = (name: string): string | undefined => {
    if (name === 'title') return title;
    const given = metadata[name] instanceof Date ? (metadata[name] as Date).toISOString().slice(0, name === 'date' ? 10 : 16) : scalar(metadata[name]);
    if (name === 'date') return given !== undefined && validDate(given) ? given : formatTemplateDate(at, timeZone);
    if (name === 'time') return given !== undefined && /^([01]\d|2[0-3]):[0-5]\d$/.test(given) ? given : formatTemplateTime(at, timeZone);
    return given;
  };
  const missing = new Set<string>();
  const filled = rule.replace(PLACEHOLDERS, (written, name: string) => {
    const safe = safeFileName(value(name) ?? '');
    if (!safe) missing.add(name);
    return safe || written;
  });
  if (missing.size) return { unfiled: `No value for ${[...missing].join(', ')}.` };
  const relative = /\.(md|markdown)$/i.test(filled) ? filled : `${filled}.md`;
  if (relative.split('/').some(part => !part || part === '.' || part === '..') || relative.includes('\\') || !isLiveNotePath(relative, notebook) || templateFileId(relative) !== undefined || (notebook.templates ?? []).some(template => template.file === relative)) return { unfiled: 'The path rule does not name a note of the notebook.' };
  const extension = /\.(md|markdown)$/i.exec(relative)![0];
  const stem = `${notebook.root}/${relative.slice(0, -extension.length)}`;
  const longest = `${stem}-${MAX_COLLISION_SUFFIX}${extension}`;
  if (Buffer.byteLength(longest, 'utf8') > MAX_FILED_PATH_BYTES || longest.split('/').some(part => Buffer.byteLength(part, 'utf8') > MAX_FILED_PART_BYTES)) return { unfiled: 'The path its rule renders is too long; shorten the title or the values it names.' };
  return { candidates: Array.from({ length: MAX_COLLISION_SUFFIX }, (_, i) => i === 0 ? `${stem}${extension}` : `${stem}-${i + 1}${extension}`) };
}

/** Whether a repository path is taken among `existing`: by itself, by the same name in another case, or as a folder. */
const occupiedIn = (existing: readonly string[], taken: ReadonlySet<string>) => (file: string) => taken.has(file) || differsOnlyInCase(existing, file) || existing.some(entry => entry.startsWith(`${file}/`));

/**
 * The Git path a pending note's rule renders (§5.5, see `livePathCandidates`); a path that is taken, or names the same
 * file in another case, gets `-2` … `-99` before its extension.
 */
export function fileLivePath(request: LiveFilingRequest & { existing: readonly string[]; }): LiveFiling {
  const plan = livePathCandidates(request);
  if ('unfiled' in plan) return plan;
  const occupied = occupiedIn(request.existing, new Set(request.existing));
  const free = plan.candidates.find(candidate => !occupied(candidate));
  return free ? { path: free } : { unfiled: `Every path from ${plan.candidates[0]} to its -${MAX_COLLISION_SUFFIX} variant is taken.` };
}

/**
 * The path rule a new live note keeps until its first check-in (§5.5): the template's `path` pattern with every
 * placeholder filled from `values` and its declared defaults, each made safe as one file name, except `title`, `date`,
 * `time` and placeholders without a value, which stay as `{{name}}` for the check-in to fill from the note.
 */
export function livePathRule(template: { metadata: NoteMetadata; }, values: Readonly<Record<string, string>>): string | undefined {
  const settings = templateSettings(template.metadata);
  if (!settings.path) return undefined;
  return settings.path.replace(PLACEHOLDERS, (_written, name: string) => {
    if (name === 'title' || name === 'date' || name === 'time') return `{{${name}}}`;
    const value = Object.hasOwn(values, name) ? values[name] : settings.placeholders[name]?.default;
    return safeFileName(value ?? '') || `{{${name}}}`;
  });
}

/** What moving or renaming a pending note changes (§20.2 of the built-in editor spec): its folder, its file name, or both. */
export interface LiveRetarget {
  /** The folder relative to the notebook root; '' is the root. */
  folder?: string;
  /** A fixed file name; `.md` is added when missing. */
  name?: string;
}

/** A pending note's rule split at its last `/`: the folder ('' at the notebook root) and the file-name pattern. */
export function livePathRuleParts(rule: string): { folder: string; name: string; } {
  const slash = rule.lastIndexOf('/');
  return slash < 0 ? { folder: '', name: rule } : { folder: rule.slice(0, slash), name: rule.slice(slash + 1) };
}

const PLACEHOLDER = new RegExp(PLACEHOLDERS.source);
const MAX_RULE_LENGTH = 1024;
const MAX_FOLDER_LENGTH = 512;

/**
 * The path rule of a moved or renamed pending note, built from its old `rule`: `folder` replaces the folder part and
 * keeps the name pattern, so the title still names the file; `name` fixes the file name, made safe by `safeFileName`,
 * with no placeholder. A folder must be notebook content with no dot folder or parent step. A destination that exists
 * already is not refused: the filing still adds `-2` … `-99`. Answers why a change is refused instead of a rule.
 */
export function retargetLivePathRule(rule: string, change: LiveRetarget, notebook: NotebookConfig): { pathRule: string; } | { invalid: string; } {
  if (change.folder === undefined && change.name === undefined) return { invalid: 'Give a folder, a name, or both.' };
  const old = livePathRuleParts(rule);
  const folder = change.folder ?? old.folder;
  if (change.folder !== undefined && folder !== '' && (folder.length > MAX_FOLDER_LENGTH || /[\\\p{Cc}]/u.test(folder) || folder.split('/').some(part => !part || part.startsWith('.')) || !isNotebookContent(`${folder}/note.md`, notebook))) return { invalid: 'The folder must be a folder of the notebook.' };
  let name = old.name;
  if (change.name !== undefined) {
    const safe = safeFileName(change.name);
    if (!safe || PLACEHOLDER.test(safe)) return { invalid: 'The name must be a file name, without {{placeholders}}.' };
    name = /\.(md|markdown)$/i.test(safe) ? safe : `${safe}.md`;
    const extension = /\.(md|markdown)$/i.exec(name)![0];
    if (Buffer.byteLength(`${name.slice(0, -extension.length)}-${MAX_COLLISION_SUFFIX}${extension}`, 'utf8') > MAX_FILED_PART_BYTES) return { invalid: 'The name is too long.' };
  }
  const pathRule = folder ? `${folder}/${name}` : name;
  if (pathRule.length > MAX_RULE_LENGTH) return { invalid: 'The path is too long.' };
  // A fixed name is checked now; one with placeholders when the filing renders it.
  if (!PLACEHOLDER.test(name) && (!isLiveNotePath(pathRule, notebook) || templateFileId(pathRule) !== undefined || (notebook.templates ?? []).some(template => template.file === pathRule))) return { invalid: 'The name must name a note of the notebook.' };
  return { pathRule };
}

/** The local id a link's notebook key names; a bare id names itself. */
const localPart = (key: string) => parseNotebookKey(key)?.localId ?? key;

/** The receipt `synced` takes. */
interface SyncReceipt {
  commit: string;
  blob: string;
  contentHash: string;
  path: string;
  conflict: LiveConflict | null;
}
type Attempt = { kind: 'discard'; reason: 'empty' | 'untyped'; contentHash: string; } | { kind: 'synced'; receipt: SyncReceipt; committed: boolean; filed: boolean; notice?: Omit<LiveNotice, 'repository' | 'editors'>; editors: LiveEditor[]; skipped: string[]; } | { kind: 'unfiled'; notice: Omit<LiveNotice, 'repository' | 'editors'>; editors: LiveEditor[]; skipped: string[]; };

/** The commit message of a check-in: its subject and the live trailers; `commitChanges` adds the co-authors after them. */
function checkInMessage(file: string, id: string, text: string, { filing, overwrote, agentDay }: { filing: boolean; overwrote?: string; agentDay?: string; }): string {
  const name = path.posix.basename(file).replace(/[\r\n]/g, ' ');
  const subject = filing ? `docs(notes): file live note ${name}` : `docs(notes): live edit ${name}`;
  return appendTrailers(subject, [`Live-Link: ${id}`, `Live-Content: sha256:${liveContentHash(text)}`, ...(overwrote ? [`Live-Overwrote: ${overwrote}`] : []), ...(agentDay ? [`Agent-Edit: ${agentDay}`] : [])]);
}

/** The newest commit that touched `file` on the head; the head itself where history says nothing. */
async function newestTouching(source: RemoteSource, snapshot: RemoteSnapshot, file: string): Promise<string> {
  try {
    return (await source.fileHistory(file, 1, 1)).entries[0]?.commit ?? snapshot.sha;
  } catch {
    return snapshot.sha;
  }
}

/**
 * Whether Git's text of `file` is a check-in of link `id`: the newest commit that touched it carries the link's
 * `Live-Link` and a `Live-Content` of `text`. A source without history says no.
 */
async function checkedInBy(source: RemoteSource, file: string, id: string, text: () => Promise<string>): Promise<boolean> {
  let newest;
  try {
    newest = (await source.fileHistory(file, 1, 1)).entries[0];
  } catch (error) {
    if (error instanceof SourceError && error.status === 501) return false;
    throw error;
  }
  const trailers = newest?.body.split('\n') ?? [];
  return trailers.includes(`Live-Link: ${id}`) && trailers.includes(`Live-Content: sha256:${liveContentHash(await text())}`);
}

const releaseOf = (value: unknown): LiveRelease => {
  const answer = value as { released?: unknown; reason?: unknown; activeEditors?: unknown; } | null;
  if (answer?.released === true) return { released: true };
  if (answer?.released === false && (answer.reason === 'active' || answer.reason === 'changed' || answer.reason === 'not-synced')) {
    const active = answer.activeEditors;
    return { released: false, reason: answer.reason, ...(typeof active === 'number' && Number.isInteger(active) && active >= 0 && active <= 10_000 ? { activeEditors: active } : {}) };
  }
  throw new LiveUnavailableError();
};
const leaseOf = (value: unknown): LiveLease => {
  const { token, until } = (value ?? {}) as Record<string, unknown>;
  if (typeof token !== 'string' || !token || token.length > 1024 || !isTime(until)) throw new LiveUnavailableError();
  return { token, until };
};

/** The initial text a detail gave a pending note, if a usable one. */
const initialTextOf = (detail: unknown): string | undefined => {
  const initial = (detail as { initialText?: unknown; } | null)?.initialText;
  return typeof initial === 'string' && Buffer.byteLength(initial, 'utf8') <= LIVE_MAX_BYTES ? initial : undefined;
};

/** Why a pending note is discarded rather than filed: an empty draft, or with `untyped` one nobody typed in; undefined to file it. */
function draftDiscard(detail: unknown, live: string, editors: readonly LiveEditor[], untyped: boolean): 'empty' | 'untyped' | undefined {
  if (isEmptyLiveDraft(live, initialTextOf(detail))) return 'empty';
  return untyped && editors.length === 0 ? 'untyped' : undefined;
}

/**
 * Asks the adapter for `run` (a release or a discard), and in a manual check-in again while it is refused as active: the
 * web has just closed its editor, which the adapter may still count as an active editor for a moment.
 */
async function retried(options: Pick<LiveCheckInOptions, 'mode' | 'sleep'>, run: () => Promise<LiveRelease>): Promise<LiveRelease> {
  const sleep = options.sleep ?? sleeping;
  let answer = await run();
  for (let retry = 0; options.mode === 'manual' && !answer.released && answer.reason === 'active' && retry < RELEASE_RETRIES; retry++) {
    await sleep(RELEASE_RETRY_MS);
    answer = await run();
  }
  return answer;
}

const discardOf = async (liveNotes: LiveNotes, repository: RepositoryId, id: string, lease: LiveLease, contentHash: string) => releaseOf(await adapter(() => liveNotes.service.discard!(repository, id, lease, { contentHash })));

/** What 「捨棄草稿」 answers: the draft is gone, or why it is kept. */
export type LiveDiscardResult = { id: string; discarded: true; } | { id: string; discarded: false; reason: 'leased' | 'released' | 'has-edits' | 'active' | 'changed' | 'not-synced'; activeEditors?: number; };

export interface LiveDiscardOptions extends Pick<LiveCheckInOptions, 'sleep'> {
  /** The person confirmed dropping what was typed: without it, a draft someone typed content in is kept (`has-edits`). */
  confirm: boolean;
}

/**
 * 「捨棄草稿」 (§19): drops a pending note without a commit. A draft someone typed in that is not empty needs `confirm`; a
 * release refused as active is asked again as a manual check-in does. A note with a path is never discarded.
 */
export async function discardLink(liveNotes: LiveNotes, repository: RepositoryId, id: string, options: LiveDiscardOptions): Promise<LiveDiscardResult> {
  const editor = liveEditorOf(liveNotes, repository);
  if (!editor || !isLiveId(id) || typeof liveNotes.service.discard !== 'function') throw new LiveNotLiveError();
  let lease: LiveLease;
  try {
    lease = leaseOf(await liveNotes.service.lease(repository, id));
  } catch (error) {
    const known = liveAdapterError(error);
    if (known instanceof LiveLeasedError) return { id, discarded: false, reason: 'leased' };
    if (known instanceof LiveNotLiveError) return { id, discarded: false, reason: 'released' };
    throw known;
  }
  const detail = await adapter(() => liveNotes.service.detail(repository, id, lease));
  const text = liveTextOf(detail);
  const checkout = (detail as { checkout?: { id?: unknown; path?: unknown; }; }).checkout;
  if (!checkout || checkout.id !== id) throw new LiveUnavailableError();
  if (checkout.path !== null) throw new LiveNotLiveError('Only a live note not yet filed can be discarded.');
  const typed = editorsOf((detail as { editors?: unknown; }).editors).length > 0;
  if (typed && !options.confirm && !isEmptyLiveDraft(normalizeLiveText(text.content), initialTextOf(detail))) return { id, discarded: false, reason: 'has-edits' };
  const answer = await retried({ mode: 'manual', ...(options.sleep ? { sleep: options.sleep } : {}) }, () => discardOf(liveNotes, repository, id, lease, text.contentHash));
  return answer.released ? { id, discarded: true } : { id, discarded: false, reason: answer.reason, ...(answer.activeEditors !== undefined ? { activeEditors: answer.activeEditors } : {}) };
}

export interface LiveRetargetOptions extends Pick<LiveCheckInOptions, 'sleep'> {
  /** The new rule, as {@link retargetLivePathRule} builds it. */
  pathRule: string;
}

/**
 * Moves or renames a pending note (§20.2): takes its lease, asked again three times two seconds apart while a check-in
 * holds it, then has the adapter set `pathRule`. Throws {@link LiveLeasedError} when the lease stays taken and
 * {@link LiveNotLiveError} for a link that is gone or filed. Answers the adapter's row, for the caller to check.
 */
export async function retargetLink(liveNotes: LiveNotes, repository: RepositoryId, id: string, options: LiveRetargetOptions): Promise<unknown> {
  const editor = liveEditorOf(liveNotes, repository);
  if (!editor || !isLiveId(id) || typeof liveNotes.service.retarget !== 'function') throw new LiveNotLiveError();
  const sleep = options.sleep ?? sleeping;
  let lease: LiveLease | undefined;
  for (let retry = 0; !lease; retry++) {
    try {
      lease = leaseOf(await liveNotes.service.lease(repository, id));
    } catch (error) {
      const known = liveAdapterError(error);
      if (!(known instanceof LiveLeasedError) || retry >= RELEASE_RETRIES) throw known;
      await sleep(RELEASE_RETRY_MS);
    }
  }
  const held = lease;
  return adapter(() => liveNotes.service.retarget!(repository, id, held, { pathRule: options.pathRule }));
}

/**
 * Checks one live link in (§5.3): lease, read, merge, commit, acknowledge, release. A link someone else holds is
 * skipped; a provider refusing the commit because the head moved is retried once within the lease. Errors other than
 * those are thrown, for the caller to report; a notify hook's error is only logged.
 */
export async function checkInLink(liveNotes: LiveNotes, repository: RepositoryId, id: string, options: LiveCheckInOptions): Promise<LiveCheckInResult> {
  const now = options.now ?? Date.now;
  const editor = liveEditorOf(liveNotes, repository);
  if (!editor || !isLiveId(id)) throw new LiveNotLiveError();
  const { service } = liveNotes;
  let lease: LiveLease;
  try {
    lease = leaseOf(await service.lease(repository, id));
  } catch (error) {
    const known = liveAdapterError(error);
    if (known instanceof LiveLeasedError) return { id, path: null, committed: false, released: false, reason: 'leased' };
    if (known instanceof LiveNotLiveError) return { id, path: null, committed: false, released: false, reason: 'released' };
    throw known;
  }
  const deadline = now() + DEADLINE_MS;

  const attempt = async (): Promise<Attempt> => {
    const detail = await adapter(() => service.detail(repository, id, lease));
    const text: LiveText = liveTextOf(detail);
    const live = normalizeLiveText(text.content);
    let editors = editorsOf((detail as { editors?: unknown; }).editors);
    let { author, coAuthors, skipped, agent } = liveAuthorship(editors);
    let source = await adapter(() => service.open(repository, author));
    const snapshot = await source.getSnapshot(true);
    const notebooks = (await source.config()).notebooks;
    const notebookOf = (key: string) => notebooks.find(entry => entry.id === localPart(key));
    const row: LiveCheckout | null = liveCheckoutOf((detail as { checkout?: unknown; }).checkout, { editor, notebook: notebookOf });
    if (!row || row.id !== id) throw new LiveUnavailableError();
    const notebook = notebookOf(row.notebook)!;
    // An empty draft, or in a sweep one nobody typed in, is discarded rather than filed where the adapter can (§19).
    const discard = row.path === null && typeof service.discard === 'function' ? draftDiscard(detail, live, editors, options.discardUntyped === true) : undefined;
    if (discard) return { kind: 'discard', reason: discard, contentHash: text.contentHash };
    let agentDay = agent ? utcDay(new Date(now())) : undefined;
    const blobOf = (content: string) => gitBlobId(Buffer.from(content, 'utf8'), snapshot.sha.length);
    const commit = async (file: string, content: string, message: string) => {
      if (now() > deadline) throw new SourceError('The check-in ran past its deadline; nothing was committed.', 504);
      return (await source.commitChanges([{ path: file, content }], snapshot.sha, 'write', 'notes', message, snapshot, coAuthors)).revision;
    };
    const synced = (file: string, sha: string, blob: string, content: string, conflict: LiveConflict | null, committed: boolean, filed = false, notice?: Omit<LiveNotice, 'repository' | 'editors'>): Attempt => ({ kind: 'synced', receipt: { commit: sha, blob, contentHash: liveContentHash(content), path: file, conflict }, committed, filed, ...(notice ? { notice } : {}), editors, skipped });

    // A pending note is filed at the path its rule renders, at a path no entry takes.
    if (row.path === null) {
      const unfiled = (reason: string): Attempt => ({ kind: 'unfiled', notice: { kind: 'unfiled', notebook: row.notebook, path: null, id, message: `A live note could not be filed: ${reason} It stays open and is tried again at the next check-in.` }, editors, skipped });
      const plan = livePathCandidates({ rule: row.pathRule!, notebook, content: live, since: row.since, timeZone: options.timeZone ?? templateTimeZone() });
      if ('unfiled' in plan) return unfiled(plan.unfiled);
      const existing = snapshot.entries.map(entry => entry.path);
      const occupied = occupiedIn(existing, new Set(existing));
      // An earlier run may have filed this note and lost its acknowledgement: that filing is acknowledged, never repeated.
      for (const candidate of plan.candidates) {
        if (!occupied(candidate)) break;
        const entry = snapshot.entries.find(item => item.path === candidate && item.type === 'blob');
        if (!entry) continue;
        // Only this note's own filing counts: another note that merely holds the same text (an untouched template) is not it.
        if (!await checkedInBy(source, candidate, id, async () => normalizeLiveText((await source.readSnapshotFile(snapshot, candidate)).toString('utf8')))) continue;
        if (entry.sha === blobOf(live)) return synced(candidate, snapshot.sha, entry.sha, live, null, false, true);
        // The newest commit touching it is this note's own filing, so Git holds what was filed: the typing since commits over it.
        const sha = await commit(candidate, live, checkInMessage(candidate, id, live, { filing: false, ...(agentDay ? { agentDay } : {}) }));
        return synced(candidate, sha, blobOf(live), live, null, true, true);
      }
      const free = plan.candidates.find(candidate => !occupied(candidate));
      if (!free) return unfiled(`Every path from ${plan.candidates[0]} to its -${MAX_COLLISION_SUFFIX} variant is taken.`);
      const sha = await commit(free, live, checkInMessage(free, id, live, { filing: true, ...(agentDay ? { agentDay } : {}) }));
      return synced(free, sha, blobOf(live), live, null, true, true);
    }
    const file = row.path;
    const entry = snapshot.entries.find(candidate => candidate.path === file && candidate.type === 'blob');
    // Deleted in Git meanwhile: the live text is written back, and the deletion is what it overwrote.
    if (!entry) {
      const overwritten = await newestTouching(source, snapshot, file);
      const sha = await commit(file, live, checkInMessage(file, id, live, { filing: false, overwrote: overwritten, ...(agentDay ? { agentDay } : {}) }));
      const conflict: LiveConflict = { kind: 'deleted', overwritten, commit: sha, at: new Date(now()).toISOString() };
      return synced(file, sha, blobOf(live), live, conflict, true, false, { kind: 'deleted', notebook: row.notebook, path: file, id, commit: sha, overwritten, message: `${file} was deleted in Git while it was edited live; the check-in wrote it back.` });
    }
    const git = normalizeLiveText((await source.readSnapshotFile(snapshot, file)).toString('utf8'));
    // Git already holds the live text: a commit whose acknowledgement was lost, or nothing typed. Only acknowledge.
    if (git === live) return synced(file, snapshot.sha, entry.sha, live, null, false);
    const overwrite = async () => {
      const overwritten = await newestTouching(source, snapshot, file);
      const sha = await commit(file, live, checkInMessage(file, id, live, { filing: false, overwrote: overwritten, ...(agentDay ? { agentDay } : {}) }));
      const conflict: LiveConflict = { kind: 'overwrote', overwritten, commit: sha, at: new Date(now()).toISOString() };
      return synced(file, sha, blobOf(live), live, conflict, true, false, { kind: 'conflict', notebook: row.notebook, path: file, id, commit: sha, overwritten, message: `${file} changed in Git and in the live editor at the same lines; the live text was committed over ${overwritten.slice(0, 12)}.` });
    };
    // Git holds this link's own last check-in, whose acknowledgement was lost: the live text descends from it.
    if ((row.base && entry.sha === row.base.blob) || await checkedInBy(source, file, id, async () => git)) {
      const sha = await commit(file, live, checkInMessage(file, id, live, { filing: false, ...(agentDay ? { agentDay } : {}) }));
      return synced(file, sha, blobOf(live), live, null, true);
    }
    // Git moved since the checkout: merge its changes in, or let the live text win.
    const base = row.base ? await source.readHistoryBlob(row.base.blob, undefined, LIVE_MAX_BYTES) : undefined;
    if (!base || !('content' in base)) return overwrite();
    const merged = mergeLiveText(normalizeLiveText(base.content), live, git);
    if (merged.conflict) return overwrite();
    let text2 = live;
    if (merged.text !== live) {
      // The live note takes Git's changes before the base moves, or the next check-in would revert them.
      await adapter(() => service.mergeIn(repository, id, lease, { content: merged.text, baseRevision: text.liveRevision }));
      const after = await adapter(() => service.detail(repository, id, lease));
      text2 = normalizeLiveText(liveTextOf(after).content);
      // Whoever typed between the two reads is in the text committed, and `synced` clears them: they are named too.
      editors = unionLiveEditors(editors, editorsOf((after as { editors?: unknown; }).editors));
      const named = liveAuthorship(editors);
      if (named.author?.email !== author?.email || named.author?.name !== author?.name) source = await adapter(() => service.open(repository, named.author));
      ({ author, coAuthors, skipped, agent } = named);
      agentDay = agent ? utcDay(new Date(now())) : undefined;
    }
    if (text2 === git) return synced(file, snapshot.sha, entry.sha, git, null, false);
    const sha = await commit(file, text2, checkInMessage(file, id, text2, { filing: false, ...(agentDay ? { agentDay } : {}) }));
    return synced(file, sha, blobOf(text2), text2, null, true);
  };

  let tried: Attempt;
  for (let tries = 0;; tries++) {
    try {
      tried = await attempt();
      break;
    } catch (error) {
      // The head moved between the snapshot and the commit: read everything again, once.
      if (error instanceof StaleRevisionError && tries === 0) continue;
      throw error;
    }
  }
  if (tried.kind === 'discard') {
    const { reason, contentHash } = tried;
    const discarded = await retried(options, () => discardOf(liveNotes, repository, id, lease, contentHash));
    return discarded.released ? { id, path: null, committed: false, released: true, discarded: true, reason } : { id, path: null, committed: false, released: false, reason: discarded.reason, ...(discarded.activeEditors !== undefined ? { activeEditors: discarded.activeEditors } : {}) };
  }
  const outcome = tried;
  const notify = async (notice: Omit<LiveNotice, 'repository' | 'editors'>) => {
    if (!liveNotes.notify) return;
    try {
      await liveNotes.notify({ ...notice, repository, editors: outcome.editors.map(entry => ({ name: entry.name })) });
    } catch (error) {
      console.warn(`[live-notes] notify for ${id} failed: ${(error as Error)?.name ?? 'error'}`);
    }
  };
  const skippedEditors = outcome.skipped.length ? { skippedEditors: outcome.skipped } : {};
  if (outcome.kind === 'unfiled') {
    await notify(outcome.notice);
    return { id, path: null, committed: false, released: false, reason: 'unfiled', ...skippedEditors };
  }
  const { receipt } = outcome;
  if (outcome.notice) await notify(outcome.notice);
  await adapter(() => service.synced(repository, id, lease, receipt));
  const released = await retried(options, async () => releaseOf(await adapter(() => service.release(repository, id, lease, { contentHash: receipt.contentHash }))));
  return { id, path: receipt.path, committed: outcome.committed, ...(outcome.committed ? { commit: receipt.commit } : {}), released: released.released, ...(released.released ? {} : { reason: released.reason, ...(released.activeEditors !== undefined ? { activeEditors: released.activeEditors } : {}) }), ...(receipt.conflict && outcome.committed ? { conflict: receipt.conflict } : {}), ...skippedEditors, ...(outcome.filed ? { filed: true as const } : {}) };
}

export interface LiveSweepOptions {
  /** The scheduled instant: links checked out before it are due. */
  instant: Date;
  /** How each check-in runs; `scheduled` by default. `manual` retries a release refused for active editors, as 「立即簽回」 does. */
  mode?: LiveCheckInOptions['mode'];
  now?: () => number;
  timeZone?: string;
  /** Check-ins at a time in this process; 2 by default. */
  concurrency?: number;
  /** Links one sweep handles; 500 by default. */
  max?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface LiveSweepReport {
  /** Due links found. */
  due: number;
  results: LiveCheckInResult[];
  /** Links whose check-in failed, by id and a reason that holds no note text. */
  failed: { repository: RepositoryId; id: string; reason: string; }[];
}

const reasonOf = (error: unknown) => error instanceof SourceError ? `${error.status} ${error.message}` : 'unexpected error';

/**
 * A scheduled check-in of every due link (§5.1): those whose `since` is before `instant`, in each repository the
 * adapter has live links in. A link's failure is logged by id and reason and never stops the others. Where the adapter
 * can discard, a pending note nobody typed in, or an empty one, is discarded instead of filed (§19).
 */
export async function sweepLive(liveNotes: LiveNotes, options: LiveSweepOptions): Promise<LiveSweepReport> {
  const { instant, concurrency = 2, max = 500 } = options;
  const repositories = await adapter(() => liveNotes.service.repositories());
  if (!Array.isArray(repositories)) throw new LiveUnavailableError();
  const due: { repository: RepositoryId; id: string; }[] = [];
  for (const repository of repositories) {
    if (typeof repository !== 'string' || !liveEditorOf(liveNotes, repository)) continue;
    let rows: unknown;
    try {
      rows = await adapter(() => liveNotes.service.checkouts(repository));
    } catch (error) {
      console.warn(`[live-notes] listing live links failed: ${reasonOf(error)}`);
      continue;
    }
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const { id, since } = (row ?? {}) as { id?: unknown; since?: unknown; };
      if (isLiveId(id) && isTime(since) && Date.parse(since) < instant.getTime() && due.length < max) due.push({ repository, id });
    }
  }
  const report: LiveSweepReport = { due: due.length, results: [], failed: [] };
  let next = 0;
  const worker = async () => {
    while (next < due.length) {
      const { repository, id } = due[next++];
      try {
        report.results.push(await checkInLink(liveNotes, repository, id, { mode: options.mode ?? 'scheduled', discardUntyped: true, ...(options.now ? { now: options.now } : {}), ...(options.timeZone ? { timeZone: options.timeZone } : {}), ...(options.sleep ? { sleep: options.sleep } : {}) }));
      } catch (error) {
        const reason = reasonOf(error);
        console.warn(`[live-notes] check-in of ${id} failed: ${reason}`);
        report.failed.push({ repository, id, reason });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, due.length)) }, worker));
  return report;
}
