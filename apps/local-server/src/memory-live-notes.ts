import { randomBytes } from 'node:crypto';
import { type EditionSourceConfig, isBuiltinEditor, LIVE_FORMER_PATHS, LIVE_MAX_BYTES, type LiveCheckout, type LiveConflict, liveContentHash, type LiveContext, type LiveEditor, type LiveEditorInfo, type LiveIdentity, liveIdentityOf, type LiveLease, LiveLeasedError, type LiveMergeAnswer, type LiveMergeRequest, type LiveNotes, type LiveNotice, LiveNotLiveError, type LiveRelease, type LiveRetargetRequest, type LiveSocketTicket, LiveStaleError, LiveTooLargeError, LiveUnavailableError, type LiveUnmovedReason, MANIFEST_FILES, type NotebookKey, parseWorkspaceConfig, rebaseLiveText, type RemoteCache, type RepositoryId, type RepositoryScope, SourceError, sourceIdentity, type WorkspacePerson } from '@mygitnotes/core';
import { memoryCommitCounter, MemoryEditionSource, type MemoryFiles } from './memory-edition-source.js';

/** The clock the memory adapter reads, which a test moves on. */
export interface MemoryLiveClock {
  now(): number;
  advance(ms: number): void;
}

/** A clock that stands still until advanced. */
export function memoryLiveClock(start = Date.parse('2026-11-15T00:00:00.000Z')): MemoryLiveClock {
  let time = start;
  return { now: () => time, advance: ms => void (time += ms) };
}

/** A repository the memory adapter covers: its Git files, shared with the edition sources that serve people. */
export interface MemoryLiveRepository {
  source: EditionSourceConfig;
  files: MemoryFiles;
  /** The notebooks the repository serves; left out, read from the manifest among its files. */
  scope?: RepositoryScope;
  cache?: RemoteCache;
}

export interface MemoryLiveNotesOptions {
  /** A framed editor, whose rows carry URLs on its origin, or the built-in one, whose rows carry none and which issues socket tickets. */
  editor: LiveEditorInfo;
  repositories: MemoryLiveRepository[];
  clock?: MemoryLiveClock;
  /** The largest text the editor takes, in UTF-8 bytes; 5 MiB by default. */
  maxBytes?: number;
  /** How long a lease holds; 5 minutes by default. */
  leaseMs?: number;
  /** Whether the service implements `discard` (§19 of the built-in editor spec); left out, it does not, as a 0.19 adapter. */
  discard?: boolean;
  /** Whether the service implements `retarget` (§20.2 of the built-in editor spec); left out, it does not, as a 0.19 adapter. */
  retarget?: boolean;
  /**
   * Whether each editor is listed with the person they signed in as, as an adapter whose check-ins commit with the
   * editors' own credentials lists them; left out, none is, as a 0.20 adapter. Its `service.open` commits to the same
   * memory files whoever it is asked to open them as.
   */
  persons?: boolean;
  /** Whether the person calls implement `merge` (A4 of the collab-first spec); left out, they do not, as a 0.20 adapter. */
  merge?: boolean;
}

/** The memory adapter, with the hooks of its editor that a test drives. */
export interface MemoryLiveNotes extends LiveNotes {
  /** Every notice `notify` was given, oldest first. */
  readonly notices: LiveNotice[];
  /** A person types in the editor until the note reads `text`; it opens a session when none is open. */
  type(repository: RepositoryId, id: string, text: string, person: LiveContext): void;
  /** Sets the connected, non-idle editors; a session opens with the first and ends when none is left. */
  setActive(repository: RepositoryId, id: string, n: number): void;
  notify(notice: LiveNotice): Promise<void>;
  /**
   * Takes a ticket `socketTicket` issued, once and within 60 s: who it was issued to and for which document; null for
   * an unknown, used or expired ticket.
   */
  redeemTicket(ticket: string): { repository: RepositoryId; id: string; document: string; context: LiveContext; } | null;
}

/** How long a socket ticket holds. */
const TICKET_MS = 60_000;
/** How long a merge's answer is kept for a repeat of it. */
const MERGE_MS = 24 * 60 * 60_000;

/** One change to a document: `text` replaces `from` to `to`. */
interface Splice {
  from: number;
  to: number;
  text: string;
}
interface EditorRef {
  key: string;
  name: string;
  email?: string;
  agent: boolean;
  person?: WorkspacePerson;
}
interface Edit {
  /** Null for a merge, which is attributed to nobody. */
  editor: EditorRef | null;
  at: number;
  hash: string;
}
interface Link {
  id: string;
  notebook: NotebookKey;
  path: string | null;
  pathRule?: string;
  /** A filed note: where its next check-in moves it. */
  target?: string;
  /** With `target`: who moved it there. */
  movedBy?: LiveIdentity;
  /** A filed note: the target its last check-in did not move it to. */
  unmoved?: string;
  unmovedReason?: LiveUnmovedReason;
  /** A filed note: the paths it was read at earlier in this session, as {@link LiveCheckout.formerPaths}. */
  formerPaths?: string[];
  /** A pending note: the text it was created with. */
  initial?: string;
  since: number;
  text: string;
  /** The checkout count: one per check-out or reopen; a built-in editor's document is `<id>.<checkouts>`. */
  checkouts: number;
  /** The session count; a session's revisions are `e<epoch>:<n>`. */
  epoch: number;
  /** The texts of the open session, from the one it opened on; null while no session is open. */
  log: string[] | null;
  active: number;
  lastEditAt: number | null;
  syncedAt: number | null;
  syncedHash: string | null;
  base: LiveCheckout['base'];
  conflict: LiveConflict | null;
  /** Edits since the last sync. */
  edits: Edit[];
  live: boolean;
  lease: { token: string; until: number; } | null;
}

/** Remembers `left` as a path the note was read at, last, and forgets `current`, keeping the latest {@link LIVE_FORMER_PATHS}. */
function former(link: Link, left: string | undefined, current: string) {
  const kept = (link.formerPaths ?? []).filter(path => path !== left && path !== current);
  if (left !== undefined && left !== current) kept.push(left);
  if (kept.length) link.formerPaths = kept.slice(-LIVE_FORMER_PATHS);
  else delete link.formerPaths;
}

/** The one splice that turns `a` into `b`: their common start and end kept, the middle replaced. */
function spliceOf(a: string, b: string): Splice {
  const shorter = Math.min(a.length, b.length);
  let start = 0;
  while (start < shorter && a[start] === b[start]) start++;
  let end = 0;
  while (end < shorter - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  return { from: start, to: a.length - end, text: b.slice(start, b.length - end) };
}
const apply = (doc: string, splice: Splice) => doc.slice(0, splice.from) + splice.text + doc.slice(splice.to);

/**
 * `mine`, made on `doc`, moved past `theirs`, made on the same `doc` and applied first. Apart, `mine` keeps its place;
 * overlapping, `mine` replaces the span both touched with its own version of it.
 */
function transform(mine: Splice, theirs: Splice, doc: string): Splice {
  const shift = theirs.text.length - (theirs.to - theirs.from);
  if (mine.to <= theirs.from) return mine;
  if (mine.from >= theirs.to) return { from: mine.from + shift, to: mine.to + shift, text: mine.text };
  const from = Math.min(mine.from, theirs.from), to = Math.max(mine.to, theirs.to);
  const grown = mine.text.length - (mine.to - mine.from);
  return { from, to: to + shift, text: apply(doc, mine).slice(from, to + grown) };
}

const iso = (time: number) => new Date(time).toISOString();

/**
 * The in-memory reference {@link LiveNotes}: one link per repository and path, created, joined and reopened; pending
 * links; exclusive leases; idempotent sync receipts; editors recorded per write. Revisions are `e<epoch>:<n>` while a
 * session is open and `h:<hash>` otherwise, and a write on an older revision of the open session is rebased over the
 * typing since. Its service opens a memory Git source over the same files that records each commit's author and message.
 */
export function memoryLiveNotes({ editor, repositories, clock = { now: () => Date.now(), advance: () => {} }, maxBytes = LIVE_MAX_BYTES, leaseMs = 5 * 60_000, discard = false, retarget = false, persons = false, merge = false }: MemoryLiveNotesOptions): MemoryLiveNotes {
  const covered = new Map(repositories.map(entry => [sourceIdentity(entry.source), entry]));
  /** Per repository: its links, the link of each path, and the link that left each path last (`leftFrom`). */
  const state = new Map<RepositoryId, { links: Map<string, Link>; byPath: Map<string, string>; lefts: Map<string, string>; }>();
  const notices: LiveNotice[] = [];
  const tickets = new Map<string, { repository: RepositoryId; id: string; document: string; context: LiveContext; until: number; }>();
  /** What each merge answered, by who merged, into which link, under which id. */
  const merged = new Map<string, { answer: LiveMergeAnswer; until: number; }>();
  /** Until when each key a `mergeInOnce` took counts, by repository, link and key. */
  const takenOnce = new Map<string, number>();
  let created = 0;

  const repositoryState = (repository: RepositoryId) => {
    if (!covered.has(repository)) throw new LiveUnavailableError();
    let entry = state.get(repository);
    if (!entry) state.set(repository, entry = { links: new Map(), byPath: new Map(), lefts: new Map() });
    return entry;
  };
  const linkOf = (repository: RepositoryId, id: string) => {
    const link = repositoryState(repository).links.get(id);
    if (!link?.live) throw new LiveNotLiveError();
    return link;
  };
  const fits = (text: string) => {
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new LiveTooLargeError();
    return text;
  };
  const revision = (link: Link) => link.log ? `e${link.epoch}:${link.log.length - 1}` : `h:${liveContentHash(link.text)}`;
  const text = (link: Link) => ({ content: link.text, liveRevision: revision(link), contentHash: liveContentHash(link.text) });
  const row = (link: Link): LiveCheckout => ({ id: link.id, notebook: link.notebook, path: link.path, ...(link.path === null && link.pathRule !== undefined ? { pathRule: link.pathRule } : {}), ...(link.path !== null && link.target !== undefined ? { target: link.target, ...(link.movedBy ? { movedBy: { ...link.movedBy } } : {}) } : {}), ...(link.path !== null && link.unmoved !== undefined ? { unmoved: link.unmoved, ...(link.unmovedReason ? { unmovedReason: link.unmovedReason } : {}) } : {}), ...(link.path !== null && link.formerPaths?.length ? { formerPaths: [...link.formerPaths] } : {}), since: iso(link.since), ...(isBuiltinEditor(editor) ? {} : { editorUrl: `${editor.origin}/n/${link.id}`, embedUrl: `${editor.origin}/n/${link.id}?embed=1` }), contentHash: liveContentHash(link.text), activeEditors: link.active, lastEditAt: link.lastEditAt === null ? null : iso(link.lastEditAt), syncedAt: link.syncedAt === null ? null : iso(link.syncedAt), base: link.base, conflict: link.conflict });
  const live = (repository: RepositoryId) => [...repositoryState(repository).links.values()].filter(link => link.live);
  const editorOf = (context: LiveContext, agent: boolean): EditorRef => {
    const { person } = context, shown = liveIdentityOf(context);
    const name = shown?.name || `${person.realm}:${person.userId}`;
    return { key: `${agent ? 'agent' : 'person'}:${shown?.email ?? name}`, name, ...(shown?.email ? { email: shown.email } : {}), agent, ...(persons ? { person } : {}) };
  };
  const openSession = (link: Link) => {
    if (link.log) return;
    link.epoch += 1;
    link.log = [link.text];
  };
  /** Sets the text, as one edit of `editor`; whether it changed. */
  const record = (link: Link, next: string, editorRef: EditorRef | null) => {
    if (next === link.text) return false;
    link.text = next;
    link.log?.push(next);
    const at = clock.now();
    link.edits.push({ editor: editorRef, at, hash: liveContentHash(next) });
    if (editorRef) link.lastEditAt = at;
    return true;
  };
  /** `content`, written on `baseRevision`, over the typing since; a base the link cannot reconstruct is stale. */
  const rebase = (link: Link, baseRevision: string, content: string) => {
    if (baseRevision === revision(link)) return content;
    const log = link.log;
    let start = -1;
    const session = /^e(\d+):(\d+)$/.exec(baseRevision);
    if (log && session && Number(session[1]) === link.epoch && Number(session[2]) < log.length) start = Number(session[2]);
    else if (log && baseRevision === `h:${liveContentHash(log[0])}`) start = 0;
    if (start < 0) throw new LiveStaleError();
    let mine = spliceOf(log![start], content);
    for (let i = start; i < log!.length - 1; i++) mine = transform(mine, spliceOf(log![i], log![i + 1]), log![i]);
    return apply(log![log!.length - 1], mine);
  };
  const editors = (link: Link): LiveEditor[] => {
    const listed = new Map<string, LiveEditor>();
    for (const { editor: ref, at } of link.edits) {
      if (!ref) continue;
      const known = listed.get(ref.key);
      if (known) known.lastAt = iso(at);
      else listed.set(ref.key, { name: ref.name, ...(ref.email ? { email: ref.email } : {}), agent: ref.agent, firstAt: iso(at), lastAt: iso(at), ...(ref.person ? { person: ref.person } : {}) });
    }
    return [...listed.values()];
  };
  const held = (repository: RepositoryId, id: string, lease: LiveLease) => {
    const link = linkOf(repository, id);
    if (!link.lease || link.lease.token !== lease.token || link.lease.until <= clock.now()) throw new LiveLeasedError();
    return link;
  };
  const newLink = (notebook: NotebookKey, path: string | null, content: string): Link => ({ id: `live-${++created}`, notebook, path, since: clock.now(), text: content, checkouts: 1, epoch: 0, log: null, active: 0, lastEditAt: null, syncedAt: null, syncedHash: null, base: null, conflict: null, edits: [], live: true, lease: null });

  const liveNotes: MemoryLiveNotes = {
    editors: [editor],
    notices,
    editor: repository => covered.has(repository) ? editor : null,
    person(context) {
      return {
        async checkouts(repository) {
          return live(repository).map(row);
        },
        async read(repository, id) {
          const link = linkOf(repository, id);
          return { ...text(link), ...(link.path === null && link.initial !== undefined ? { initialText: link.initial } : {}) };
        },
        async write(repository, id, change) {
          const link = linkOf(repository, id);
          const changed = record(link, fits(rebase(link, change.baseRevision, change.content)), editorOf(context, change.agent));
          return { liveRevision: revision(link), changed };
        },
        async append(repository, id, change) {
          const link = linkOf(repository, id);
          record(link, fits(link.text + change.text), editorOf(context, change.agent));
          return { liveRevision: revision(link) };
        },
        async checkout(repository, { notebook, path, base }) {
          fits(base.content);
          const { links, byPath } = repositoryState(repository);
          const known = byPath.has(path) ? links.get(byPath.get(path)!) : undefined;
          if (known?.live) return { checkout: row(known), outcome: 'joined' };
          const link = known ?? newLink(notebook, path, base.content);
          if (known) link.checkouts += 1;
          Object.assign(link, { notebook, since: clock.now(), text: base.content, log: null, active: 0, lastEditAt: null, syncedAt: null, syncedHash: null, base: { commit: base.commit, blob: base.blob, contentHash: liveContentHash(base.content) }, conflict: null, edits: [], live: true, lease: null });
          delete link.target;
          delete link.movedBy;
          delete link.unmoved;
          delete link.unmovedReason;
          delete link.formerPaths;
          links.set(link.id, link);
          byPath.set(path, link.id);
          return { checkout: row(link), outcome: known ? 'reopened' : 'created' };
        },
        async createPending(repository, { notebook, pathRule, content }) {
          const link = { ...newLink(notebook, null, fits(content)), pathRule, initial: content };
          repositoryState(repository).links.set(link.id, link);
          return row(link);
        },
        async filed(repository, id) {
          const link = repositoryState(repository).links.get(id);
          return link && !link.live ? link.path : null;
        },
        async leftFrom(repository, path) {
          const { links, lefts } = repositoryState(repository);
          const link = links.get(lefts.get(path) ?? '');
          return link && link.path !== null && link.path !== path && link.target !== path ? link.id : null;
        },
        async forgetLeft(repository, path, id) {
          const { lefts } = repositoryState(repository);
          if (lefts.get(path) === id) lefts.delete(path);
        },
        ...(merge
          ? {
            async merge(repository: RepositoryId, id: string, request: LiveMergeRequest): Promise<LiveMergeAnswer> {
              const link = linkOf(repository, id);
              const key = JSON.stringify([context.person.realm, context.person.userId, id, request.mergeId]);
              const known = merged.get(key);
              if (known && known.until > clock.now()) return known.answer;
              // As the built-in editor merges: by character, over what the note became since the base.
              const next = rebaseLiveText(request.base.replace(/[\r\0]/g, ''), link.text, request.text.replace(/[\r\0]/g, ''));
              if (next === null) return { conflict: true };
              if (!record(link, fits(next), editorOf(context, false))) return { applied: true, contentHash: liveContentHash(link.text) };
              const answer: LiveMergeAnswer = { applied: true, contentHash: liveContentHash(next) };
              merged.set(key, { answer, until: clock.now() + MERGE_MS });
              return answer;
            },
          }
          : {}),
      };
    },
    service: {
      async repositories() {
        return [...covered.keys()].filter(repository => live(repository).length > 0);
      },
      async checkouts(repository) {
        return live(repository).map(row);
      },
      async open(repository, author) {
        const entry = covered.get(repository);
        if (!entry) throw new LiveUnavailableError();
        const { source, files, cache } = entry;
        const scope = entry.scope ?? (async () => {
          const manifest = MANIFEST_FILES.find(file => files.has(file));
          if (!manifest) throw new SourceError('The repository has no manifest.', 404);
          return parseWorkspaceConfig(files.get(manifest)!);
        });
        return new MemoryEditionSource(source, files, true, memoryCommitCounter(files), cache, scope, author);
      },
      async lease(repository, id) {
        const link = linkOf(repository, id);
        if (link.lease && link.lease.until > clock.now()) throw new LiveLeasedError();
        link.lease = { token: randomBytes(16).toString('hex'), until: clock.now() + leaseMs };
        return { token: link.lease.token, until: iso(link.lease.until) };
      },
      async detail(repository, id, lease) {
        const link = held(repository, id, lease);
        return { ...text(link), checkout: row(link), editors: editors(link), ...(link.path === null && link.initial !== undefined ? { initialText: link.initial } : {}) };
      },
      async mergeIn(repository, id, lease, change) {
        const link = held(repository, id, lease);
        record(link, fits(rebase(link, change.baseRevision, change.content)), null);
        return { liveRevision: revision(link) };
      },
      async mergeInOnce(repository, id, lease, change) {
        const link = held(repository, id, lease);
        const key = JSON.stringify([repository, id, change.key]);
        if ((takenOnce.get(key) ?? -Infinity) > clock.now()) return { liveRevision: revision(link), repeated: true };
        record(link, fits(rebase(link, change.baseRevision, change.content)), null);
        takenOnce.set(key, clock.now() + MERGE_MS);
        return { liveRevision: revision(link), repeated: false };
      },
      async synced(repository, id, lease, receipt) {
        const link = held(repository, id, lease);
        if (link.path !== null && link.path !== receipt.path && link.target !== receipt.path) throw new SourceError('A live note keeps the path it was filed at.', 409);
        if (link.path === null) {
          link.path = receipt.path;
          delete link.pathRule;
          delete link.initial;
          repositoryState(repository).byPath.set(receipt.path, link.id);
        } else if (link.target !== undefined) {
          // Moved, the link is named by its new path alone; kept in place, it remembers the target it did not take.
          const { byPath, lefts } = repositoryState(repository);
          if (receipt.path === link.target) {
            if (byPath.get(link.path) === link.id) byPath.delete(link.path);
            former(link, link.path, receipt.path);
            lefts.set(link.path, link.id);
            link.path = receipt.path;
            byPath.set(receipt.path, link.id);
            delete link.unmoved;
            delete link.unmovedReason;
          } else {
            link.unmoved = link.target;
            if (receipt.unmovedReason) link.unmovedReason = receipt.unmovedReason;
            else delete link.unmovedReason;
          }
          delete link.target;
          delete link.movedBy;
        }
        link.base = { commit: receipt.commit, blob: receipt.blob, contentHash: receipt.contentHash };
        link.syncedAt = clock.now();
        link.syncedHash = receipt.contentHash;
        link.conflict = receipt.conflict;
        // The edits the receipt's text holds are synced; anyone who typed after it stays listed for the next check-in.
        const last = link.edits.map(edit => edit.hash).lastIndexOf(receipt.contentHash);
        if (last >= 0) link.edits = link.edits.slice(last + 1);
        else if (liveContentHash(link.text) === receipt.contentHash) link.edits = [];
      },
      async release(repository, id, lease, check) {
        const link = held(repository, id, lease);
        if (link.syncedAt === null || link.syncedHash !== check.contentHash) return { released: false, reason: 'not-synced' };
        if (liveContentHash(link.text) !== check.contentHash) return { released: false, reason: 'changed' };
        if (link.active > 0) return { released: false, reason: 'active', activeEditors: link.active };
        Object.assign(link, { live: false, lease: null, log: null });
        return { released: true };
      },
      ...(discard
        ? {
          async discard(repository: RepositoryId, id: string, lease: LiveLease, check: { contentHash: string; }): Promise<LiveRelease> {
            const link = held(repository, id, lease);
            if (link.path !== null) throw new SourceError('Only a pending note can be discarded.', 409);
            if (liveContentHash(link.text) !== check.contentHash) return { released: false, reason: 'changed' };
            if (link.active > 0) return { released: false, reason: 'active', activeEditors: link.active };
            // The link and its text are gone: nothing names it again, and `filed` knows nothing of it.
            repositoryState(repository).links.delete(id);
            for (const [ticket, issued] of tickets) if (issued.repository === repository && issued.id === id) tickets.delete(ticket);
            return { released: true };
          },
        }
        : {}),
      ...(retarget
        ? {
          async retarget(repository: RepositoryId, id: string, lease: LiveLease, request: LiveRetargetRequest): Promise<LiveCheckout> {
            const link = held(repository, id, lease);
            // The lease ends with the call, retargeted or refused: it never holds a check-in off.
            link.lease = null;
            if ('pathRule' in request) {
              if (link.path !== null) throw new LiveNotLiveError('Only a pending note can be moved or renamed by its path rule.');
              link.pathRule = request.pathRule;
              return row(link);
            }
            if (link.path === null) throw new LiveNotLiveError('A pending note moves by its path rule.');
            former(link, link.target, request.target ?? link.path);
            delete link.movedBy;
            if (link.target !== undefined && link.target !== (request.target ?? link.path)) repositoryState(repository).lefts.set(link.target, link.id);
            if (request.target === null) delete link.target;
            else {
              link.target = request.target;
              if (request.movedBy) link.movedBy = { ...request.movedBy };
            }
            delete link.unmoved;
            delete link.unmovedReason;
            return row(link);
          },
        }
        : {}),
    },
    async notify(notice) {
      notices.push(notice);
    },
    ...(isBuiltinEditor(editor)
      ? {
        async socketTicket(context: LiveContext, repository: RepositoryId, id: string): Promise<LiveSocketTicket> {
          const link = linkOf(repository, id);
          const ticket = randomBytes(32).toString('base64url');
          const document = `${link.id}.${link.checkouts}`;
          tickets.set(ticket, { repository, id, document, context, until: clock.now() + TICKET_MS });
          return { ticket, document };
        },
      }
      : {}),
    redeemTicket(ticket) {
      const issued = tickets.get(ticket);
      tickets.delete(ticket);
      if (!issued || issued.until <= clock.now()) return null;
      const { until: _until, ...rest } = issued;
      return rest;
    },
    type(repository, id, next, person) {
      const link = linkOf(repository, id);
      openSession(link);
      record(link, fits(next), editorOf(person, false));
    },
    setActive(repository, id, n) {
      const link = linkOf(repository, id);
      link.active = n;
      if (n > 0) openSession(link);
      else link.log = null;
    },
  };
  return liveNotes;
}
