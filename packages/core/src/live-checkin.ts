import path from 'node:path';
import { differsOnlyInCase } from './case-collision.js';
import { type CommitAuthor, commitAuthor } from './commit-author.js';
import { isNotebookContent } from './folders.js';
import { parseNoteContent } from './frontmatter.js';
import { SourceError } from './github-api.js';
import { relocateLinks } from './folder-plan.js';
import { announceLiveCommit, isEmptyLiveDraft, isLiveId, isLiveNotePath, LIVE_MAX_BYTES, liveAdapterError, type LiveCheckout, liveCheckoutOf, type LiveConflict, liveContentHash, LiveCredentialError, type LiveEditor, liveEditorOf, type LiveIdentity, liveInitialTextOf, type LiveLease, LiveLeasedError, type LiveNotes, type LiveNotice, LiveNotLiveError, type LiveRelease, liveRowBase, type LiveText, liveTextOf, LiveUnavailableError, type LiveUnmovedReason, normalizeLiveText } from './live-notes.js';
import { mergeLiveText } from './live-merge.js';
import { parseNotebookKey } from './notebook-key.js';
import { appendTrailers, utcDay } from './note-versions.js';
import { formatTemplateDate, formatTemplateTime, safeFileName, templateFileId, templateSettings, templateTimeZone } from './note-template.js';
import { gitBlobId } from './remote-cache.js';
import { planRemoteNoteMove } from './remote-file-plan.js';
import type { RemoteSnapshot, RemoteSource } from './remote-source.js';
import { type RepositoryId, StaleRevisionError } from './repository.js';
import type { NotebookConfig, NoteMetadata } from './types.js';
import type { WorkspacePerson } from './workspace-config-source.js';

/*
 * The check-in engine (docs/specs/2026-11-15-live-notes/spec.md §5): it commits a live note's text to Git with every
 * editor named, merging Git's changes since the checkout into the live note first, and then closes the live note. It
 * keeps no state: link state lives in the adapter, whose lease makes each link single-flight across processes, and a
 * repeat finds the live text already in Git and only acknowledges it.
 */

/**
 * Why a check-in left the note open, or did not start; with `discarded`, why a pending note was discarded instead:
 * `empty`, an empty draft ({@link isEmptyLiveDraft}), or `untyped`, one nobody typed in (a sweep only).
 * `uncommittable`: no credential the check-in could try may commit the note.
 */
export type LiveCheckInReason = 'leased' | 'released' | 'unfiled' | 'active' | 'changed' | 'not-synced' | 'empty' | 'untyped' | 'uncommittable';

/** Someone a check-in may commit as: their own credential, and how the commit names them. */
export interface LiveCommitter {
  person: WorkspacePerson;
  /** Named as the commit's author when `commitAuthor` accepts it; else the commit is authored by the credential's account. */
  author?: LiveIdentity;
}

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
  /** A filed note this run moved to `path` (§20.4 of the built-in editor spec), from the Git path it had. */
  moved?: { from: string; };
  /** The target this run did not move the note to, since Git held that path, or as `unmovedReason` says: the note stays at `path`. */
  unmoved?: string;
  /** Why the note did not move to `unmoved`, when not because Git held that path: `too-large`, the move would change too much. */
  unmovedReason?: LiveUnmovedReason;
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
  /**
   * Who asked for the check-in (「立即簽回」, `check_in_note`): the last credential it tries, after every editor's was
   * refused, so someone who may write can still check in a note whose editors no longer can. When it commits, they
   * author the commit and every editor is a co-author.
   */
  requester?: LiveCommitter;
  /**
   * Whether to send a notice; every notice is sent when absent. The idle check-in sends an uncommittable or unfiled
   * notice once per link and text, and every other notice each time.
   */
  shouldNotify?: (notice: Omit<LiveNotice, 'repository' | 'editors'>) => boolean;
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
  }).map(editor => {
    if (editor.person === undefined) return editor;
    // A person that is not one names nobody to commit as: the editor keeps its credit and loses the credential.
    const { person, ...rest } = editor;
    const known = personOf(person);
    return known ? { ...rest, person: known } : rest;
  });
}

/** A person an adapter listed, checked and reduced to its fields. */
function personOf(value: unknown): WorkspacePerson | undefined {
  const { realm, userId } = (value ?? {}) as Record<string, unknown>;
  const id = (typeof userId === 'string' && userId !== '' && userId.length <= 512) || (typeof userId === 'number' && Number.isFinite(userId));
  return typeof realm === 'string' && realm !== '' && realm.length <= 512 && id ? { realm, userId: userId as string | number } : undefined;
}
const personKey = (person: WorkspacePerson) => JSON.stringify([person.realm, person.userId]);
/** How a commit names someone, when `commitAuthor` accepts their name and email; undefined otherwise, never cleaned up. */
function acceptedAuthor(value: { name: string; email?: string; } | undefined): CommitAuthor | undefined {
  try {
    return value ? commitAuthor({ name: value.name, email: value.email }, 'A live editor') : undefined;
  } catch {
    return undefined;
  }
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
 *
 * With `committer`, the commit is made with that person's own credential: they are its author, by `committer.author`
 * or, without one, as the account of their credential, and every accepted editor but them is a co-author, whoever was
 * first. An editor who is the committer is not skipped for lacking an email: the commit is theirs.
 */
export function liveAuthorship(editors: readonly LiveEditor[], committer?: { person: WorkspacePerson; author?: CommitAuthor; }): LiveAuthorship {
  const sorted = [...editors].sort((a, b) => Date.parse(a.firstAt) - Date.parse(b.firstAt));
  const accepted: { editor: LiveEditor; author: CommitAuthor; }[] = [];
  const skipped: string[] = [];
  const own = committer ? personKey(committer.person) : undefined;
  for (const editor of sorted) {
    const author = acceptedAuthor(editor);
    if (author) accepted.push({ editor, author });
    else if (!(own !== undefined && editor.person && personKey(editor.person) === own)) skipped.push(editor.name);
  }
  const lead = committer ? committer.author : (accepted.find(entry => !entry.editor.agent) ?? accepted[0])?.author;
  const named = new Set(lead ? [lead.email.toLowerCase()] : []);
  const coAuthors: CommitAuthor[] = [];
  for (const { author } of accepted) {
    if (named.has(author.email.toLowerCase())) continue;
    named.add(author.email.toLowerCase());
    if (coAuthors.length < MAX_CO_AUTHORS) coAuthors.push(author);
  }
  return { ...(lead ? { author: lead } : {}), coAuthors, skipped, agent: sorted.some(editor => editor.agent) };
}

/** A credential a check-in may commit with: a person's own, or with no person the deployment's (0.20). */
interface Committer {
  person?: WorkspacePerson;
  author?: CommitAuthor;
}
/** The one name a check-in knows a committer by while it runs. */
const committerKey = (committer: Committer) => committer.person ? personKey(committer.person) : 'deployment';

/**
 * The credentials a check-in tries, in order (docs/specs/2026-11-16-collab-first-self-host A6): each editor who signed
 * in as someone, people before agents and each group by who typed first, a person once however many of their entries
 * typed. Where no editor names a person (a 0.20 adapter, or a note nobody typed in), the deployment's own credential,
 * with the author of {@link liveAuthorship}. Last, whoever asked for the check-in, unless they are among the editors.
 */
function liveCommitters(editors: readonly LiveEditor[], requester?: LiveCommitter): Committer[] {
  const sorted = [...editors].sort((a, b) => Date.parse(a.firstAt) - Date.parse(b.firstAt));
  const committers: Committer[] = [];
  const seen = new Set<string>();
  for (const editor of [...sorted.filter(entry => !entry.agent), ...sorted.filter(entry => entry.agent)]) {
    if (!editor.person || seen.has(personKey(editor.person))) continue;
    seen.add(personKey(editor.person));
    const author = acceptedAuthor(editor);
    committers.push({ person: editor.person, ...(author ? { author } : {}) });
  }
  if (!committers.length) {
    const { author } = liveAuthorship(editors);
    committers.push(author ? { author } : {});
  }
  const asked = requester ? personOf(requester.person) : undefined;
  if (asked && !seen.has(personKey(asked))) {
    const author = acceptedAuthor(requester!.author);
    committers.push({ person: asked, ...(author ? { author } : {}) });
  }
  return committers;
}

/**
 * Whether an error says the committer's credential may not commit: the adapter's {@link LiveCredentialError}, or for a
 * person's own credential the provider's 401, 403 or 404 while reading or committing. The deployment's own credential
 * keeps failing as it did in 0.20, by the error thrown.
 */
const credentialRefused = (error: unknown, committer: Committer) => error instanceof LiveCredentialError || (committer.person !== undefined && error instanceof SourceError && [401, 403, 404].includes(error.status));

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

/** A note's text moved from `from` to `to`: its own relative links rewritten for its new place, as the move planner rewrites them. */
const ownLinksMoved = (content: string, from: string, to: string) => relocateLinks(content, from, to, file => file === from ? to : file);

/**
 * Whether `live`, the text of a note whose move commit landed with `git` as its text, still lacks the move's rewrite of
 * its own links (`rewritten`, which only changes lines in place). The lines the rewrite changes tell: Git holds them as
 * rewritten when the live note never took the rewrite, and as they are when it did, so the rewrite is taken only once.
 */
function missedRewrite(live: string, rewritten: string, git: string) {
  const held = new Set(git.split('\n'));
  const before = live.split('\n'), after = rewritten.split('\n');
  if (before.length !== after.length) return false;
  let missed = 0, taken = 0;
  for (let line = 0; line < before.length; line++) {
    if (before[line] === after[line]) continue;
    if (held.has(after[line]!)) missed++;
    else if (held.has(before[line]!)) taken++;
  }
  return missed > taken;
}

/** The receipt `synced` takes. */
interface SyncReceipt {
  commit: string;
  blob: string;
  contentHash: string;
  path: string;
  conflict: LiveConflict | null;
  unmovedReason?: LiveUnmovedReason;
}
type Attempt = { kind: 'discard'; reason: 'empty' | 'untyped'; contentHash: string; } | { kind: 'synced'; receipt: SyncReceipt; committed: boolean; filed: boolean; notice?: Omit<LiveNotice, 'repository' | 'editors'>; editors: LiveEditor[]; skipped: string[]; moved?: string; unmoved?: string; unmovedReason?: LiveUnmovedReason; } | { kind: 'unfiled'; notice: Omit<LiveNotice, 'repository' | 'editors'>; editors: LiveEditor[]; skipped: string[]; } | { kind: 'uncommittable'; path: string | null; notice: Omit<LiveNotice, 'repository' | 'editors'>; editors: LiveEditor[]; skipped: string[]; };

/** The commit message of a check-in: its subject and the live trailers; `commitChanges` adds the co-authors after them. */
function checkInMessage(file: string, id: string, text: string, { filing, overwrote, agentDay, moved }: { filing: boolean; overwrote?: string; agentDay?: string; moved?: string; }): string {
  const name = path.posix.basename(file).replace(/[\r\n]/g, ' ');
  const subject = filing ? `docs(notes): file live note ${name}` : moved ? `docs(notes): move live note ${path.posix.basename(moved).replace(/[\r\n]/g, ' ')} to ${file.replace(/[\r\n]/g, ' ')}` : `docs(notes): live edit ${name}`;
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

/**
 * Whether someone typed in a pending note, by the adapter's raw word: any editor entry, even one {@link editorsOf}
 * drops, or a last edit. A typed draft is always filed unless empty (§19).
 */
function typedDraft(detail: unknown): boolean {
  const { editors, checkout } = (detail ?? {}) as { editors?: unknown; checkout?: { lastEditAt?: unknown; }; };
  return (Array.isArray(editors) && editors.length > 0) || (checkout?.lastEditAt !== null && checkout?.lastEditAt !== undefined);
}

/** Why a pending note is discarded rather than filed: an empty draft, or with `untyped` one nobody typed in; undefined to file it. */
function draftDiscard(detail: unknown, live: string, untyped: boolean): 'empty' | 'untyped' | undefined {
  if (isEmptyLiveDraft(live, liveInitialTextOf(detail))) return 'empty';
  return untyped && !typedDraft(detail) ? 'untyped' : undefined;
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
  const typed = typedDraft(detail);
  if (typed && !options.confirm && !isEmptyLiveDraft(normalizeLiveText(text.content), liveInitialTextOf(detail))) return { id, discarded: false, reason: 'has-edits' };
  const answer = await retried({ mode: 'manual', ...(options.sleep ? { sleep: options.sleep } : {}) }, () => discardOf(liveNotes, repository, id, lease, text.contentHash));
  return answer.released ? { id, discarded: true } : { id, discarded: false, reason: answer.reason, ...(answer.activeEditors !== undefined ? { activeEditors: answer.activeEditors } : {}) };
}

/**
 * A retarget: a pending note's new rule, as {@link retargetLivePathRule} builds it, or the path a filed note moves to at
 * its next check-in (null: where it lies).
 */
export type LiveRetargetOptions = Pick<LiveCheckInOptions, 'sleep'> & ({ pathRule: string; } | { target: string | null; });

/**
 * Moves or renames a pending note (§20.2), or sets where a filed note moves at its next check-in (§20.4): takes its
 * lease, asked again three times two seconds apart while a check-in holds it, then has the adapter set `pathRule` or
 * `target`. Throws {@link LiveLeasedError} when the lease stays taken and {@link LiveNotLiveError} for a link that is
 * gone, or of the other kind. Answers the adapter's row, for the caller to check.
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
  try {
    return await adapter(() => liveNotes.service.retarget!(repository, id, held, 'pathRule' in options ? { pathRule: options.pathRule } : { target: options.target }));
  } catch (error) {
    // A retarget that failed may have left the lease held: it is given back where the adapter can, so no check-in waits it out.
    if (typeof liveNotes.service.unlease === 'function') await liveNotes.service.unlease(repository, id, held).catch(() => {});
    throw error;
  }
}

/**
 * Checks one live link in (§5.3): lease, read, merge, commit, acknowledge, release. A link someone else holds is
 * skipped; a provider refusing the commit because the head moved is retried once within the lease. Errors other than
 * those are thrown, for the caller to report; a notify hook's error is only logged. A check-in that leaves the note live
 * ends its lease where the adapter has `unlease`; elsewhere the lease runs out on its own.
 */
export async function checkInLink(liveNotes: LiveNotes, repository: RepositoryId, id: string, options: LiveCheckInOptions): Promise<LiveCheckInResult> {
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
  let result: LiveCheckInResult | undefined;
  try {
    return result = await checkInLeased(liveNotes, repository, id, options, editor, lease);
  } finally {
    // A note the check-in left live gives its lease back where the adapter can, so the next check-in need not wait it out.
    if (!result?.released && typeof service.unlease === 'function') {
      try {
        await service.unlease(repository, id, lease);
      } catch (error) {
        console.warn(`[live-notes] unlease of ${id} failed: ${(error as Error)?.name ?? 'error'}`);
      }
    }
  }
}

/** The check-in of {@link checkInLink} once the link's lease is held. */
async function checkInLeased(liveNotes: LiveNotes, repository: RepositoryId, id: string, options: LiveCheckInOptions, editor: NonNullable<ReturnType<typeof liveEditorOf>>, lease: LiveLease): Promise<LiveCheckInResult> {
  const now = options.now ?? Date.now;
  const { service } = liveNotes;
  const deadline = now() + DEADLINE_MS;
  /** The committers whose credential was refused in this check-in, and the one the running attempt commits as. */
  const refused = new Set<string>();
  let committing: Committer | undefined;

  const attempt = async (): Promise<Attempt> => {
    committing = undefined;
    const detail = await adapter(() => service.detail(repository, id, lease));
    const text: LiveText = liveTextOf(detail);
    let live = normalizeLiveText(text.content);
    let editors = editorsOf((detail as { editors?: unknown; }).editors);
    // What commits nothing needs no repository, and so nobody's credential: a draft to discard, and a note whose text is
    // still the one its base holds, which Git therefore has (a note only viewed, or typed in and typed back). The latter
    // still takes Git's newer text, or is written back if deleted in Git, as in 0.20, when a credential opens the
    // repository; it settles on its base only when none can (cf14-F003).
    const bare = (detail as { checkout?: { id?: unknown; }; }).checkout?.id === id ? liveRowBase((detail as { checkout?: unknown; }).checkout) : null;
    if (bare?.path === null && typeof service.discard === 'function') {
      const early = draftDiscard(detail, live, options.discardUntyped === true);
      if (early) return { kind: 'discard', reason: early, contentHash: text.contentHash };
    }
    // A note moving elsewhere is never settled without a commit: the move is one.
    const moving = (detail as { checkout?: { target?: unknown; }; }).checkout?.target !== undefined;
    const atBase: Attempt | undefined = bare && bare.path !== null && !moving && bare.base?.contentHash === text.contentHash ? { kind: 'synced', receipt: { commit: bare.base.commit, blob: bare.base.blob, contentHash: text.contentHash, path: bare.path, conflict: null }, committed: false, filed: false, editors, skipped: [] } : undefined;
    const committer = liveCommitters(editors, options.requester).find(candidate => !refused.has(committerKey(candidate)));
    if (!committer && atBase) return atBase;
    // Nobody is left to commit as: the text stays live, and the next check-in tries everyone again.
    if (!committer) return { kind: 'uncommittable', path: bare?.path ?? null, notice: { kind: 'uncommittable', notebook: bare?.notebook ?? '', path: bare?.path ?? null, id, message: 'A live note could not be committed: no credential of its editors may write to the repository. It stays open and is tried again at the next check-in.' }, editors, skipped: liveAuthorship(editors).skipped };
    committing = committer;
    /** Who the commit names, for the credential it is made with. */
    const authorship = (listed: readonly LiveEditor[]) => committer.person ? liveAuthorship(listed, { person: committer.person, ...(committer.author ? { author: committer.author } : {}) }) : liveAuthorship(listed);
    let { author, coAuthors, skipped, agent } = authorship(editors);
    const as = committer.person;
    let source = await adapter(() => as ? service.open(repository, author, { person: as }) : service.open(repository, author));
    const snapshot = await source.getSnapshot(true);
    const notebooks = (await source.config()).notebooks;
    const notebookOf = (key: string) => notebooks.find(entry => entry.id === localPart(key));
    const row: LiveCheckout | null = liveCheckoutOf((detail as { checkout?: unknown; }).checkout, { editor, notebook: notebookOf });
    if (!row || row.id !== id) throw new LiveUnavailableError();
    const notebook = notebookOf(row.notebook)!;
    // An empty draft, or in a sweep one nobody typed in, is discarded rather than filed where the adapter can (§19).
    const discard = row.path === null && typeof service.discard === 'function' ? draftDiscard(detail, live, options.discardUntyped === true) : undefined;
    if (discard) return { kind: 'discard', reason: discard, contentHash: text.contentHash };
    let agentDay = agent ? utcDay(new Date(now())) : undefined;
    const blobOf = (content: string) => gitBlobId(Buffer.from(content, 'utf8'), snapshot.sha.length);
    const commit = async (file: string, content: string, message: string) => {
      if (now() > deadline) throw new SourceError('The check-in ran past its deadline; nothing was committed.', 504);
      const { revision } = await source.commitChanges([{ path: file, content }], snapshot.sha, 'write', 'notes', message, snapshot, coAuthors);
      announceLiveCommit(liveNotes, { repository, path: file, content, commit: revision, source, ...(author ? { author } : {}), ...(as ? { person: as } : {}) });
      return revision;
    };
    /** Why this attempt committed a moving note in place though its target was free: the move would change too much (LM-F005). */
    let unmovedReason: LiveUnmovedReason | undefined;
    // A note moving elsewhere (§20.4) says whether this check-in moved it: its receipt names the target, or its path and why.
    const synced = (file: string, sha: string, blob: string, content: string, conflict: LiveConflict | null, committed: boolean, filed = false, notice?: Omit<LiveNotice, 'repository' | 'editors'>): Attempt => {
      const unmoved = row.path !== null && row.target !== undefined && file !== row.target;
      return { kind: 'synced', receipt: { commit: sha, blob, contentHash: liveContentHash(content), path: file, conflict, ...(unmoved && unmovedReason ? { unmovedReason } : {}) }, committed, filed, ...(notice ? { notice } : {}), editors, skipped, ...(row.path !== null && row.target !== undefined ? unmoved ? { unmoved: row.target, ...(unmovedReason ? { unmovedReason } : {}) } : { moved: row.path } : {}) };
    };

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
    let file = row.path;
    // A note moving elsewhere (§20.4) moves with this check-in, in one commit, to its target; one Git holds by now stays
    // where it is, its target never overwritten.
    let moveTo: string | undefined;
    /** The Git path this link's own move commit, whose acknowledgement was lost, moved the note from. */
    let landedFrom: string | undefined;
    if (row.target !== undefined) {
      const target = row.target, from = file;
      const existing = snapshot.entries.map(candidate => candidate.path);
      const landed = snapshot.entries.some(candidate => candidate.path === target && candidate.type === 'blob');
      // An earlier run moved it there and lost its acknowledgement: this run goes on at the target.
      if (landed && await checkedInBy(source, target, id, async () => normalizeLiveText((await source.readSnapshotFile(snapshot, target)).toString('utf8')))) {
        file = target;
        landedFrom = from;
      } else if (!existing.includes(target) && !differsOnlyInCase(existing, target, candidate => candidate === from) && !existing.some(candidate => candidate.startsWith(`${target}/`))) moveTo = target;
    }
    /** The live note's revision now: what a merge into it is made on. */
    let revisionNow = text.liveRevision;
    /** Takes the editors of a detail read after a merge into the live note: whoever typed between the reads is in the text committed. */
    const retake = async (after: unknown) => {
      const read = liveTextOf(after);
      revisionNow = read.liveRevision;
      editors = unionLiveEditors(editors, editorsOf((after as { editors?: unknown; }).editors));
      const named = authorship(editors);
      // Only the deployment's own credential follows the author; a person's own names that person, whoever typed since.
      if (named.author?.email !== author?.email || named.author?.name !== author?.name) source = await adapter(() => service.open(repository, named.author));
      ({ author, coAuthors, skipped, agent } = named);
      agentDay = agent ? utcDay(new Date(now())) : undefined;
      return normalizeLiveText(read.content);
    };
    /** Merges `content`, made on the live text at `revisionNow`, into the live note, and reads it again. */
    const mergeLive = async (content: string) => {
      await adapter(() => service.mergeIn(repository, id, lease, { content, baseRevision: revisionNow }));
      return retake(await adapter(() => service.detail(repository, id, lease)));
    };
    // The move landed but the live note may not have taken its rewrite of the note's own links, which follows the commit:
    // it takes it now, once (LM-F001).
    if (landedFrom !== undefined) {
      const rewritten = ownLinksMoved(live, landedFrom, file);
      if (rewritten !== live && missedRewrite(live, rewritten, normalizeLiveText((await source.readSnapshotFile(snapshot, file)).toString('utf8')))) live = await mergeLive(rewritten);
    }
    /**
     * Commits `content` as the note's text: where it lies, or moved to its target in one commit that rewrites the links
     * to it as a move does, and the note's own relative links for its new place. The live note takes that rewrite only
     * once the commit landed, so an attempt tried again plans from the text as typed (LM-F001). A move the planner refuses
     * as too large commits the note where it lies instead, marked unmoved for that (LM-F005).
     */
    const commitNote = async (content: string, overwrote?: string): Promise<{ sha: string; text: string; at: string; }> => {
      if (moveTo) {
        if (now() > deadline) throw new SourceError('The check-in ran past its deadline; nothing was committed.', 504);
        let planned: Awaited<ReturnType<typeof planRemoteNoteMove>> | undefined;
        try {
          planned = await planRemoteNoteMove(source, snapshot, notebook.id, file, moveTo, content);
        } catch (error) {
          if (!(error instanceof SourceError) || error.status !== 413) throw error;
          console.warn(`[live-notes] check-in of ${id} commits it in place: its move to its target is too large (${error.message})`);
          unmovedReason = 'too-large';
        }
        if (planned) {
          const message = checkInMessage(moveTo, id, planned.content, { filing: false, ...(overwrote ? { overwrote } : {}), ...(agentDay ? { agentDay } : {}), moved: file });
          const { revision } = await source.commitChanges(planned.changes, snapshot.sha, 'move', 'files', message, snapshot, coAuthors);
          announceLiveCommit(liveNotes, { repository, path: moveTo, content: planned.content, commit: revision, source, ...(author ? { author } : {}), ...(as ? { person: as } : {}) });
          if (planned.content !== content) await adapter(() => service.mergeIn(repository, id, lease, { content: planned.content, baseRevision: revisionNow }));
          return { sha: revision, text: planned.content, at: moveTo };
        }
      }
      return { sha: await commit(file, content, checkInMessage(file, id, content, { filing: false, ...(overwrote ? { overwrote } : {}), ...(agentDay ? { agentDay } : {}) })), text: content, at: file };
    };
    const entry = snapshot.entries.find(candidate => candidate.path === file && candidate.type === 'blob');
    // Deleted in Git meanwhile: the live text is written back, at its target when it moves, with its own links rewritten for
    // that place, and the deletion is what it overwrote.
    if (!entry) {
      const at = moveTo ?? file;
      const written = moveTo ? ownLinksMoved(live, file, moveTo) : live;
      const overwritten = await newestTouching(source, snapshot, file);
      const sha = await commit(at, written, checkInMessage(at, id, written, { filing: false, overwrote: overwritten, ...(agentDay ? { agentDay } : {}), ...(moveTo ? { moved: file } : {}) }));
      if (written !== live) await adapter(() => service.mergeIn(repository, id, lease, { content: written, baseRevision: revisionNow }));
      const conflict: LiveConflict = { kind: 'deleted', overwritten, commit: sha, at: new Date(now()).toISOString() };
      return synced(at, sha, blobOf(written), written, conflict, true, false, { kind: 'deleted', notebook: row.notebook, path: at, id, commit: sha, overwritten, message: `${file} was deleted in Git while it was edited live; the check-in wrote it back${moveTo ? ` at ${moveTo}` : ''}.` });
    }
    const git = normalizeLiveText((await source.readSnapshotFile(snapshot, file)).toString('utf8'));
    // Git already holds the live text: a commit whose acknowledgement was lost, or nothing typed. Only acknowledge, unless it moves.
    if (git === live && !moveTo) return synced(file, snapshot.sha, entry.sha, live, null, false);
    const overwrite = async () => {
      const overwritten = await newestTouching(source, snapshot, file);
      const done = await commitNote(live, overwritten);
      const conflict: LiveConflict = { kind: 'overwrote', overwritten, commit: done.sha, at: new Date(now()).toISOString() };
      return synced(done.at, done.sha, blobOf(done.text), done.text, conflict, true, false, { kind: 'conflict', notebook: row.notebook, path: done.at, id, commit: done.sha, overwritten, message: `${file} changed in Git and in the live editor at the same lines; the live text was committed over ${overwritten.slice(0, 12)}.` });
    };
    // Git holds this link's own last check-in, whose acknowledgement was lost, or the live text: the live text descends from it.
    if (git === live || (row.base && entry.sha === row.base.blob) || await checkedInBy(source, file, id, async () => git)) {
      const done = await commitNote(live);
      return synced(done.at, done.sha, blobOf(done.text), done.text, null, true);
    }
    // Git moved since the checkout: merge its changes in, or let the live text win.
    const base = row.base ? await source.readHistoryBlob(row.base.blob, undefined, LIVE_MAX_BYTES) : undefined;
    if (!base || !('content' in base)) return overwrite();
    const merged = mergeLiveText(normalizeLiveText(base.content), live, git);
    if (merged.conflict) return overwrite();
    // The live note takes Git's changes before the base moves, or the next check-in would revert them.
    const text2 = merged.text !== live ? await mergeLive(merged.text) : live;
    if (text2 === git && !moveTo) return synced(file, snapshot.sha, entry.sha, git, null, false);
    const done = await commitNote(text2);
    return synced(done.at, done.sha, blobOf(done.text), done.text, null, true);
  };

  let tried: Attempt;
  for (let tries = 0;;) {
    try {
      tried = await attempt();
      break;
    } catch (error) {
      // This credential may not commit here: the next attempt reads everything again and commits as the next candidate.
      if (committing && credentialRefused(error, committing)) {
        refused.add(committerKey(committing));
        continue;
      }
      // The head moved between the snapshot and the commit: read everything again, once.
      if (error instanceof StaleRevisionError && tries++ === 0) continue;
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
    if (!liveNotes.notify || options.shouldNotify?.(notice) === false) return;
    try {
      await liveNotes.notify({ ...notice, repository, editors: outcome.editors.map(entry => ({ name: entry.name })) });
    } catch (error) {
      console.warn(`[live-notes] notify for ${id} failed: ${(error as Error)?.name ?? 'error'}`);
    }
  };
  const skippedEditors = outcome.skipped.length ? { skippedEditors: outcome.skipped } : {};
  if (outcome.kind === 'uncommittable') {
    console.warn(`[live-notes] check-in of ${id} committed nothing: no credential of its editors may write`);
    await notify(outcome.notice);
    return { id, path: outcome.path, committed: false, released: false, reason: 'uncommittable', ...skippedEditors };
  }
  if (outcome.kind === 'unfiled') {
    await notify(outcome.notice);
    return { id, path: null, committed: false, released: false, reason: 'unfiled', ...skippedEditors };
  }
  const { receipt } = outcome;
  if (outcome.notice) await notify(outcome.notice);
  await adapter(() => service.synced(repository, id, lease, receipt));
  const released = await retried(options, async () => releaseOf(await adapter(() => service.release(repository, id, lease, { contentHash: receipt.contentHash }))));
  return { id, path: receipt.path, committed: outcome.committed, ...(outcome.committed ? { commit: receipt.commit } : {}), released: released.released, ...(released.released ? {} : { reason: released.reason, ...(released.activeEditors !== undefined ? { activeEditors: released.activeEditors } : {}) }), ...(receipt.conflict && outcome.committed ? { conflict: receipt.conflict } : {}), ...skippedEditors, ...(outcome.filed ? { filed: true as const } : {}), ...(outcome.moved !== undefined ? { moved: { from: outcome.moved } } : {}), ...(outcome.unmoved !== undefined ? { unmoved: outcome.unmoved, ...(outcome.unmovedReason ? { unmovedReason: outcome.unmovedReason } : {}) } : {}) };
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

/** Checks in every live link `isDue` picks, in each repository the adapter has live links in; what both sweeps share. */
async function sweepDue(liveNotes: LiveNotes, isDue: (row: Record<string, unknown>) => boolean, options: Pick<LiveSweepOptions, 'mode' | 'now' | 'timeZone' | 'concurrency' | 'max' | 'sleep'>, perLink?: (row: Record<string, unknown>) => Pick<LiveCheckInOptions, 'shouldNotify'>): Promise<LiveSweepReport> {
  const { concurrency = 2, max = 500 } = options;
  const repositories = await adapter(() => liveNotes.service.repositories());
  if (!Array.isArray(repositories)) throw new LiveUnavailableError();
  const due: { repository: RepositoryId; id: string; row: Record<string, unknown>; }[] = [];
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
      const { id } = (row ?? {}) as { id?: unknown; };
      if (isLiveId(id) && isDue(row as Record<string, unknown>) && due.length < max) due.push({ repository, id, row: row as Record<string, unknown> });
    }
  }
  const report: LiveSweepReport = { due: due.length, results: [], failed: [] };
  let next = 0;
  const worker = async () => {
    while (next < due.length) {
      const { repository, id, row } = due[next++];
      try {
        report.results.push(await checkInLink(liveNotes, repository, id, { ...perLink?.(row), mode: options.mode ?? 'scheduled', discardUntyped: true, ...(options.now ? { now: options.now } : {}), ...(options.timeZone ? { timeZone: options.timeZone } : {}), ...(options.sleep ? { sleep: options.sleep } : {}) }));
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

/**
 * A scheduled check-in of every due link (§5.1): those whose `since` is before `instant`, in each repository the
 * adapter has live links in. A link's failure is logged by id and reason and never stops the others. Where the adapter
 * can discard, a pending note nobody typed in, or an empty one, is discarded instead of filed (§19).
 */
export function sweepLive(liveNotes: LiveNotes, options: LiveSweepOptions): Promise<LiveSweepReport> {
  const instant = options.instant.getTime();
  return sweepDue(liveNotes, ({ since }) => isTime(since) && Date.parse(since) < instant, options);
}

/** How long after its last edit a live note nobody is active on is checked in, unless the deployment says otherwise. */
export const LIVE_IDLE_CHECKIN_MS = 5 * 60_000;

export interface LiveIdleSweepOptions {
  /** Milliseconds since the epoch: the clock the rows' times are compared with, and each check-in's; `Date.now` by default. */
  now?: () => number;
  /** How long nobody typed in a link before it is due; {@link LIVE_IDLE_CHECKIN_MS} by default. */
  idleMs?: number;
  timeZone?: string;
  /** Check-ins at a time in this process; 2 by default. */
  concurrency?: number;
  /** Links one sweep handles; 500 by default. */
  max?: number;
  sleep?: (ms: number) => Promise<void>;
  /** What earlier ticks learnt about links that could not be checked in; one per `liveNotes` by default. */
  backoff?: LiveIdleBackoff;
}

/** The first wait before the idle check-in tries a link again that it could not check in; it doubles each time. */
export const LIVE_IDLE_BACKOFF_MS = 60_000;
/** The longest wait between two tries of such a link. */
export const LIVE_IDLE_BACKOFF_MAX_MS = 30 * 60_000;

/**
 * Per link, for the idle check-in only: when a link that was `uncommittable`, `unfiled` or failed may be tried again,
 * and whether its uncommittable or unfiled notice went out, both for its text (`contentHash`) and last edit at the
 * time. A new edit or text starts afresh, and a link the adapter no longer lists is forgotten. The nightly sweep and
 * 「立即簽回」 do not read it (cf14-F002, cf15-F002).
 */
export interface LiveIdleBackoff {
  links: Map<string, { key: string; next: number; wait: number; notified: boolean; }>;
}

export function createLiveIdleBackoff(): LiveIdleBackoff {
  return { links: new Map() };
}

const idleBackoffs = new WeakMap<LiveNotes, LiveIdleBackoff>();

/**
 * The idle check-in (docs/specs/2026-11-16-collab-first-self-host A5): checks in every live link nobody is active on
 * (`activeEditors` 0, by the adapter's own idle rule) whose last edit, or whose checkout when nobody typed, is at least
 * `idleMs` ago. Each runs as a scheduled check-in of a sweep: a note Git already holds is released without a commit, a
 * pending note nobody typed in, or an empty one, is discarded where the adapter can, and a release refused because
 * someone came back is left for the next tick.
 */
export async function sweepIdleLive(liveNotes: LiveNotes, options: LiveIdleSweepOptions = {}): Promise<LiveSweepReport> {
  const { now = Date.now, idleMs = LIVE_IDLE_CHECKIN_MS } = options;
  let backoff = options.backoff ?? idleBackoffs.get(liveNotes);
  if (!backoff) idleBackoffs.set(liveNotes, backoff = createLiveIdleBackoff());
  const { links } = backoff;
  const at = now();
  const keyOf = ({ contentHash, lastEditAt }: Record<string, unknown>) => `${String(contentHash)}\u0000${String(lastEditAt)}`;
  const keys = new Map<string, string>();
  /** Every link the adapter listed, due or not: what is held of any other is dropped (cf15-F002). */
  const listed = new Set<string>();
  /** The links whose uncommittable or unfiled notice went out in this sweep. */
  const told = new Set<string>();
  const isDue = (row: Record<string, unknown>) => {
    const { id, since, activeEditors, lastEditAt } = row;
    listed.add(String(id));
    if (activeEditors !== 0) return false;
    const last = lastEditAt === null || lastEditAt === undefined ? since : lastEditAt;
    if (!isTime(last) || at - Date.parse(last) < idleMs) return false;
    const key = keyOf(row), held = links.get(String(id));
    if (held && held.key !== key) links.delete(String(id));
    else if (held && at < held.next) return false;
    keys.set(String(id), key);
    return true;
  };
  // Only the notices of a link stuck on the same text repeat at every try; a conflict or a deletion is always told.
  const shouldNotify = (row: Record<string, unknown>) => ({
    shouldNotify: (notice: Omit<LiveNotice, 'repository' | 'editors'>) => {
      if (notice.kind !== 'uncommittable' && notice.kind !== 'unfiled') return true;
      const held = links.get(String(row.id));
      if (held && held.key === keyOf(row) && held.notified) return false;
      told.add(String(row.id));
      return true;
    },
  });
  const report = await sweepDue(liveNotes, isDue, { ...options, mode: 'scheduled' }, shouldNotify);
  const stuck = (id: string) => {
    const key = keys.get(id)!, held = links.get(id);
    const same = held?.key === key;
    const wait = same ? Math.min(held!.wait * 2, LIVE_IDLE_BACKOFF_MAX_MS) : LIVE_IDLE_BACKOFF_MS;
    // Notified only once a notice went out for this text: a try that threw, or found no `notify`, told nobody.
    links.set(id, { key, next: at + wait, wait, notified: told.has(id) || (same && held!.notified) });
  };
  for (const result of report.results) {
    if (result.reason === 'uncommittable' || result.reason === 'unfiled') stuck(result.id);
    // An earlier try still holds the lease: nothing was learnt.
    else if (result.reason !== 'leased') links.delete(result.id);
  }
  for (const { id } of report.failed) stuck(id);
  for (const id of links.keys()) if (!listed.has(id)) links.delete(id);
  return report;
}
