import { retitleNoteFile } from '../file-manager.js';
import { relocateLinks } from '../folder-plan.js';
import { templateFileId } from '../templates.js';
import { NotebookConfig } from '../types.js';
import { SourceError } from '../github-api.js';
import { hashJson, REMOTE_CACHE_MAX_VALUE, REMOTE_CACHE_TTL } from '../remote-cache.js';
import { CASE_COLLISION_ERROR, differsOnlyInCase } from '../case-collision.js';
import { CheckedOutError, isLiveNotePath, LIVE_MAX_BYTES, liveContentHash, LiveNotLiveError, LiveStaleError, LiveTooLargeError, normalizeLiveText, parseLivePendingPath } from '../live-notes.js';
import type { LiveLink, LiveRecord, LiveRepository } from '../live-repository.js';
import { notebookOfPath } from '../workspace-links.js';
import type { LiveMoveResult, LiveRelocationLeft } from './types.js';
import { SnapshotSource } from './snapshot.js';

/** Shared-cache keys of live texts, each value the text whose sha256 the key ends with. */
const LIVE_TEXT_VERSION = 'v1';
/**
 * Adapter reads of one live link in flight in this process, by repository, link id and listed hash, so concurrent
 * misses read it once. A read is shared only with requests that listed the same link: two links with equal text never
 * share one, since either may change after it was listed.
 */
const liveReadsInFlight = new Map<string, Promise<{ content: string; contentHash: string; }>>();

/** A remote reader's view of the live editor: live notes read, written, moved, checked in and laid over Git listings. */
export abstract class LiveSource extends SnapshotSource {
  /** The request's view of the repository's live editor; none for a signed-out request or a repository no editor covers. */
  protected live?: LiveRepository;
  /** Live texts this request read, by path (real or virtual). */
  protected liveLoaded = new Map<string, { content: string; contentHash: string; }>();
  /** The revision and hash this request last read or wrote of each live note, by path. */
  private liveSeen = new Map<string, LiveRecord>();
  /**
   * Hands the request's view of the live editor to this reader: from then on every read of a checked-out note by path
   * answers its live text, and Git writes that touch one are refused (docs/specs/2026-11-15-live-notes/spec.md §3, §4).
   */
  useLive(view: LiveRepository) {
    this.live = view;
  }
  /** The request's view of the repository's live editor, which routes reach the editor through; none when no editor is in use. */
  get liveView(): LiveRepository | undefined {
    return this.live;
  }
  /**
   * 「立即簽回」: checks the live note at `file` into Git now and closes it, or says why it stayed open. Any writer may;
   * the person who asks authors the commit, and the note's other editors are its co-authors.
   */
  async checkInLive(file: string) {
    const snapshot = await this.getSnapshot();
    if (!this.canWrite(snapshot)) throw new SourceError('Write access on the main workspace branch is required.', 403);
    const link = await this.liveLinkAt(file);
    if (!link) throw new LiveNotLiveError('This note is not being edited live (編輯中).');
    return this.checkInLink(link, 'manual');
  }
  /** Checks a link in; the check-in may have moved the head, and closed, filed or moved the note, so this request reads them again. */
  private async checkInLink(link: LiveLink, mode: 'manual' | 'scheduled') {
    const result = await this.live!.checkIn(link.path, mode);
    for (const file of [link.path, link.checkout.path, result.path]) {
      if (!file) continue;
      this.liveLoaded.delete(file);
      this.liveSeen.delete(file);
    }
    this.snapshot = undefined;
    return { ...result, revision: (await this.getSnapshot(true)).sha };
  }
  /**
   * 「捨棄草稿」: drops the pending note at its virtual path `file` without a commit (docs/specs/2026-11-15-builtin-live-editor
   * §19), or says why it is kept; a draft someone typed content in needs `confirm`. Any writer may.
   */
  async discardLive(file: string, confirm: boolean) {
    if (!this.canWrite(await this.getSnapshot())) throw new SourceError('Write access on the main workspace branch is required.', 403);
    const link = await this.liveLink(file);
    if (!link) throw new LiveNotLiveError('This note is not being edited live (編輯中).');
    try {
      return await this.live!.discard(link.path, confirm);
    } finally {
      this.liveLoaded.delete(link.path);
      this.liveSeen.delete(link.path);
    }
  }
  /**
   * Moves or renames the filed live note (編輯中) at `file` (as reads know it, or its Git path while it moves) to
   * `destination` (docs/specs/2026-11-15-builtin-live-editor §20.4): any writer may, whoever edits it. Nothing is
   * committed: the note's next check-in moves it there, in one commit with the links to it rewritten, and until then it
   * is read at `destination`. A destination where it lies already takes the move back. When nobody but the mover has it
   * open, idle or not (where the adapter cannot tell, nobody but the mover is active: `editing`, the mover has it open),
   * it is checked in at once, so the move lands now. `title` retitles its live text as a rename does. A destination Git
   * holds, or another live note holds or goes to, is refused (409); where the live editor cannot retarget, the move is
   * refused as 編輯中, as before.
   */
  async moveLive(file: string, destination: string, options: { title?: string; editing?: boolean; checkIn?: boolean; } = {}): Promise<LiveMoveResult> {
    const snapshot = await this.getSnapshot(true);
    if (!this.canWrite(snapshot)) throw new SourceError('Write access on the main workspace branch is required.', 403);
    const link = await this.liveLinkAt(file);
    if (!link || link.checkout.path === null) throw new LiveNotLiveError('This note is not being edited live (編輯中).');
    if (!this.live!.retargets) throw new CheckedOutError([file]);
    const from = link.checkout.path, root = link.notebook.root;
    const relative = typeof destination === 'string' && destination.startsWith(`${root}/`) ? destination.slice(root.length + 1) : '';
    if (!relative || !isLiveNotePath(relative, link.notebook) || templateFileId(relative) !== undefined || (link.notebook.templates ?? []).some(template => template.file === relative) || /[\\\p{Cc}]/u.test(relative) || relative.split('/').some(part => !part || part === '.' || part === '..')) throw new SourceError('Choose a note path in the same notebook.', 400);
    if (destination !== from) {
      const existing = snapshot.entries.map(entry => entry.path);
      if (existing.includes(destination) || existing.some(entry => entry.startsWith(`${destination}/`))) throw new SourceError('Destination already exists.', 409);
      if (differsOnlyInCase(existing, destination, entry => entry === from)) throw new SourceError(CASE_COLLISION_ERROR, 409);
      const others = (await this.live!.links()).filter(other => other.checkout.id !== link.checkout.id);
      if (others.some(other => other.path === destination || other.checkout.path === destination)) throw new SourceError('Destination already exists.', 409);
    }
    if (options.title !== undefined) {
      // A rename retitles the live text as it would a file: written on the text just read, over typing since. The title is
      // checked and written on that one read before anything moves, so a block that cannot be read refuses the rename
      // (`retitleNoteFile` throws) with the note where it was, however its text changed since the checks above (FM-F004).
      const read = await this.live!.read(link.checkout.id);
      const retitled = normalizeLiveText(retitleNoteFile(read.content, destination, options.title));
      if (retitled !== read.content) await this.live!.write(link.checkout.id, retitled, read.liveRevision, false);
    }
    const target = destination === from ? null : destination;
    let checkout = target === (link.checkout.target ?? null) ? link.checkout : await this.live!.move(link.path, target);
    for (const path of [link.path, from, destination]) {
      this.liveLoaded.delete(path);
      this.liveSeen.delete(path);
    }
    // Nobody else has it open: it is checked in now, which moves it. The adapter tells who besides the mover is connected,
    // idle or not; one that cannot is judged by who is active, the mover among them when they edit it.
    const changed = target !== (link.checkout.target ?? null) || options.title !== undefined;
    const alone = async () => {
      const others = await this.live!.othersEditing(checkout.id);
      return others !== null ? others === 0 : checkout.activeEditors - (options.editing ? 1 : 0) <= 0;
    };
    if (changed && options.checkIn !== false && await alone()) {
      const moved = (await this.live!.links()).find(entry => entry.checkout.id === checkout.id);
      if (moved) {
        const checkIn = await this.checkInLink(moved, 'scheduled');
        const path = checkIn.path ?? destination;
        const left = (await this.live!.links()).find(entry => entry.checkout.id === checkout.id)?.checkout;
        if (left) checkout = left;
        return { path: left?.path ?? path, target: left?.target ?? null, checkIn };
      }
    }
    return { path: from, target: checkout.target ?? null };
  }
  /**
   * The live notes (編輯中) a Git relocation moves, as `relocate` maps a path (itself when it stays): each filed note,
   * by the path reads know it by, with where it goes. A note already moving elsewhere follows its target. A relocation
   * commits none of them: their Git files stay where they lie (`kept`, the planner's `stays`), so the links to them keep
   * naming them there until each check-in moves it and rewrites those links, and once the commit landed
   * {@link followLiveRelocation} takes them along. Throws a {@link CheckedOutError} for them where the live editor cannot
   * retarget, as before, and a 409 for a destination another live note holds or goes to.
   */
  async liveRelocations(relocate: (file: string) => string): Promise<{ moves: { file: string; destination: string; }[]; kept: Set<string>; }> {
    if (!this.live) return { moves: [], kept: new Set() };
    const links = (await this.live.links()).filter(link => link.checkout.path !== null);
    const moving = links.filter(link => relocate(link.path) !== link.path || relocate(link.checkout.path!) !== link.checkout.path);
    if (!moving.length) return { moves: [], kept: new Set() };
    if (!this.live.retargets) throw new CheckedOutError(moving.map(link => link.checkout.path!));
    const moves = moving.filter(link => relocate(link.path) !== link.path).map(link => ({ file: link.path, destination: relocate(link.path) }));
    const held = new Set(links.filter(link => !moving.includes(link)).flatMap(link => [link.path, link.checkout.path!]));
    const going = new Set<string>();
    for (const { destination } of moves) {
      if (held.has(destination) || going.has(destination)) throw new SourceError('Destination already exists.', 409);
      going.add(destination);
    }
    return { moves, kept: new Set(moving.map(link => link.checkout.path!)) };
  }
  /**
   * Takes the live notes of {@link liveRelocations} along once the relocation's commit landed: each kept note's own links
   * to the files the commit relocated (`relocate`) are rewritten in its live text from where it lies, so they hold there
   * and at its check-in (LM-F002), tried again once on a fresh read when typing or the editor refuses the write; then
   * each of `moves` records where it goes, without a check-in. A note either step fails for is answered in `left` with
   * why, for the caller to say, and the commit stands either way (LM-F003): `linksBroken` when its links to the relocated
   * files still lead where those were, and `moved` when it goes to its destination all the same; without `moved` it
   * stays where it lies, where the links to it lead.
   */
  async followLiveRelocation({ moves, kept }: Awaited<ReturnType<LiveSource['liveRelocations']>>, relocate: (file: string) => string): Promise<{ moved: { file: string; destination: string; }[]; left: LiveRelocationLeft[]; }> {
    const moved: { file: string; destination: string; }[] = [], left: LiveRelocationLeft[] = [];
    if (!this.live || !kept.size) return { moved, left };
    const live = this.live;
    const relink = (file: string) => kept.has(file) ? file : relocate(file);
    const why = (error: unknown) => error instanceof Error ? error.message : 'The live note could not be taken along.';
    const links = (await live.links()).filter(link => link.checkout.path !== null && kept.has(link.checkout.path));
    for (const link of links) {
      const from = link.checkout.path!;
      const destination = moves.find(entry => entry.file === link.path)?.destination;
      const relinkOnce = async () => {
        const read = await live.read(link.checkout.id);
        const relinked = normalizeLiveText(relocateLinks(read.content, from, from, relink));
        if (relinked !== read.content) await live.write(link.checkout.id, relinked, read.liveRevision, false);
      };
      let linksBroken: string | undefined, stays: string | undefined;
      try {
        await relinkOnce().catch(relinkOnce);
      } catch (error) {
        linksBroken = why(error);
        console.warn(`[live-notes] ${link.checkout.id} keeps its links to the notes a relocation moved from ${from}: ${(error as Error)?.name ?? 'error'}`);
      }
      this.liveLoaded.delete(link.path);
      if (destination !== undefined) {
        try {
          await this.moveLive(link.path, destination, { checkIn: false });
          moved.push({ file: link.path, destination });
        } catch (error) {
          stays = why(error);
          console.warn(`[live-notes] ${link.checkout.id} stays at ${from} after a relocation: ${(error as Error)?.name ?? 'error'}`);
        }
      }
      if (linksBroken === undefined && stays === undefined) continue;
      const reasons = [...(stays !== undefined ? [`It stays where it is: ${stays}`] : []), ...(linksBroken !== undefined ? [`Its links to the notes moved still lead where they were: ${linksBroken}`] : [])];
      left.push({ path: link.path, ...(destination !== undefined ? { destination } : {}), reason: reasons.join(' '), ...(linksBroken !== undefined ? { linksBroken: true as const } : {}), ...(destination !== undefined && stays === undefined ? { moved: true as const } : {}) });
    }
    return { moved, left };
  }
  /**
   * Where a pending note's virtual path went once it was checked in: its Git path, or null when the editor does not
   * know. Undefined for any other path, and for a pending note that is still live.
   */
  async liveFiled(file: string): Promise<string | null | undefined> {
    if (!this.live || typeof file !== 'string') return undefined;
    // A filed note moving elsewhere (§20.4) is read at its target: its Git path leads there until its check-in.
    const at = await this.liveAt(file);
    if (at && 'link' in at) return at.link.path !== file ? at.link.path : undefined;
    // A path a note left while live leads where it went once it is no longer live, as long as Git holds that.
    if (at) return at.left;
    const pending = parseLivePendingPath(file, (await this.config()).notebooks);
    if (!pending) return undefined;
    return this.live.filed(pending.id);
  }
  /** The live link of a path: a checked-out note's or a pending note's virtual path; undefined without one. */
  protected async liveLink(file: string): Promise<LiveLink | undefined> {
    if (!this.live || typeof file !== 'string' || !/\.(md|markdown)$/i.test(file)) return undefined;
    return (await this.live.links()).find(link => link.path === file);
  }
  /**
   * The live link at `file` as reads know it, or at the Git path of a note moving elsewhere; else the one that was read
   * at `file` earlier while live (its `formerPaths`: a target a later move replaced, or the path a check-in moved it
   * from), so a tab, address or open editor still there finds it, unless Git holds a file at `file` now, which is that
   * file's. Undefined without one.
   */
  private async liveLinkAt(file: string): Promise<LiveLink | undefined> {
    const at = await this.liveAt(file);
    return at && 'link' in at ? at.link : undefined;
  }
  /**
   * The live link at `file`, as {@link liveLinkAt} finds it; or, for a path a note left that is no longer live, where it
   * went (`left`): the path it was filed at, a note of the same notebook that Git holds. When several notes left
   * `file`, the one that left it last counts (the adapter's `leftFrom`); an adapter that cannot tell is asked only for
   * its live links' former paths, and a path two of them left leads nowhere. Undefined without one.
   */
  private async liveAt(file: string): Promise<{ link: LiveLink; } | { left: string; } | undefined> {
    if (!this.live || typeof file !== 'string' || !/\.(md|markdown)$/i.test(file)) return undefined;
    const links = await this.live.links();
    const at = links.find(link => link.path === file) ?? links.find(link => link.checkout.target !== undefined && link.checkout.path === file);
    if (at) return { link: at };
    const snapshot = await this.getSnapshot();
    const holds = (path: string) => snapshot.entries.some(entry => entry.path === path);
    if (holds(file)) {
      await this.forgetLeft(file, links, holds);
      return undefined;
    }
    const id = await this.live.leftFrom(file);
    if (id === undefined) {
      const listed = links.filter(link => link.checkout.formerPaths?.includes(file));
      return listed.length === 1 ? { link: listed[0] } : undefined;
    }
    if (id === null) return undefined;
    const link = links.find(entry => entry.checkout.id === id);
    if (link) return { link };
    const filed = await this.live.filed(id);
    const notebook = notebookOfPath(file, (await this.config()).notebooks);
    return filed !== null && filed !== file && notebook && notebookOfPath(filed, (await this.config()).notebooks)?.id === notebook.id && holds(filed) ? { left: filed } : undefined;
  }
  /**
   * A file Git holds at `file`, a path a note left, is that file's: the path stops leading to the note for good, so it
   * does not lead there again once the file is deleted or moved away (FLM-F004). Forgotten only while Git also holds the
   * note where it went, live at its Git path or filed: a snapshot read before the note's move holds its old file there.
   */
  private async forgetLeft(file: string, links: readonly LiveLink[], holds: (path: string) => boolean) {
    const id = await this.live!.leftFrom(file);
    if (!id) return;
    const where = links.find(entry => entry.checkout.id === id)?.checkout.path ?? await this.live!.filed(id);
    if (where && where !== file && holds(where)) await this.live!.forgetLeft(file, id);
  }
  /**
   * The live link of a checked-out note or pending note at `file`, also by the Git path of a note moving elsewhere;
   * undefined when it is not live or no editor is in use.
   */
  async liveCheckout(file: string) {
    return (await this.liveLinkAt(file))?.checkout;
  }
  /** The path reads know the live note at `file` by: a moving note's target for its Git path, else `file`; undefined when it is not live. */
  async livePath(file: string) {
    return (await this.liveLinkAt(file))?.path;
  }
  /** What this request last read or wrote of the live note at `file`. */
  liveRecord(file: string): LiveRecord | undefined {
    return this.liveSeen.get(file);
  }
  private liveTextKey(hash: string) {
    return `mgn:live:${LIVE_TEXT_VERSION}:${this.cacheRepository()}:${hash}`;
  }
  /** Keeps live texts in the shared cache, each under its own hash. */
  private async storeLiveTexts(texts: { content: string; contentHash: string; }[]) {
    if (!this.cache) return;
    const values = texts.filter(text => liveContentHash(text.content) === text.contentHash && Buffer.byteLength(text.content) <= REMOTE_CACHE_MAX_VALUE).map(text => [this.liveTextKey(text.contentHash), text.content] as [string, string]);
    if (values.length) await this.cache.set(values, REMOTE_CACHE_TTL);
  }
  /** The live text of a link, fresh from the adapter, kept for this request and in the shared cache. */
  protected async readLiveLink(link: LiveLink) {
    const text = await this.live!.read(link.checkout.id);
    this.liveLoaded.set(link.path, text);
    this.liveSeen.set(link.path, { id: link.checkout.id, liveRevision: text.liveRevision, contentHash: text.contentHash });
    await this.storeLiveTexts([text]);
    return text;
  }
  /** The live text of a link: as this request already read it, else fresh. */
  protected async liveTextOf(link: LiveLink) {
    return this.liveLoaded.get(link.path) ?? this.readLiveLink(link);
  }
  /** The live note at `file`, read fresh from the adapter; undefined when it is not live. */
  async readLive(file: string) {
    const link = await this.liveLink(file);
    return link ? this.readLiveLink(link) : undefined;
  }
  /**
   * Loads the live texts of links for a bulk read: from the shared cache by each link's hash, checked against it, and
   * from the adapter only for a text no one has read since it last changed.
   */
  protected async loadLiveTexts(links: LiveLink[]) {
    const missing = links.filter(link => !this.liveLoaded.has(link.path));
    if (!missing.length) return;
    const hits = this.cache ? await this.cache.get(missing.map(link => this.liveTextKey(link.checkout.contentHash))) : missing.map(() => null);
    const unread: LiveLink[] = [];
    missing.forEach((link, i) => {
      const hit = hits[i];
      // A live text is trusted only when it hashes to the key this request's own list of links named.
      if (hit !== null && liveContentHash(hit) === link.checkout.contentHash) this.liveLoaded.set(link.path, { content: hit, contentHash: link.checkout.contentHash });
      else unread.push(link);
    });
    for (let i = 0; i < unread.length; i += 6) {
      await Promise.all(
        unread.slice(i, i + 6).map(async link => {
          const key = `${this.liveTextKey(link.checkout.contentHash)}:${link.checkout.id}`;
          let pending = liveReadsInFlight.get(key);
          if (!pending) {
            pending = this.live!.read(link.checkout.id).then(async text => {
              await this.storeLiveTexts([text]);
              return { content: text.content, contentHash: text.contentHash };
            });
            liveReadsInFlight.set(key, pending);
            void pending.then(() => liveReadsInFlight.delete(key), () => liveReadsInFlight.delete(key));
          }
          this.liveLoaded.set(link.path, await pending);
        }),
      );
    }
  }
  /** Loads the live texts of those of `files` that are live, for a bulk read that then reads each by path. */
  async prefetchLive(files: string[]) {
    if (!this.live) return;
    const wanted = new Set(files);
    await this.loadLiveTexts((await this.live.links()).filter(link => wanted.has(link.path)));
  }
  /** The live links of one notebook. */
  private async notebookLinks(nb: NotebookConfig): Promise<LiveLink[]> {
    return this.live ? (await this.live.links()).filter(link => link.notebook.id === nb.id) : [];
  }
  /**
   * Refuses, with the checked-out paths, a Git write that would touch a checked-out note or a pending note's virtual
   * path. It is a guard before any commit; the merge at check-in resolves a Git change that races a checkout. Only a
   * note can be live, so a write that touches none asks the editor nothing and goes ahead while it is down.
   */
  async refuseCheckedOut(paths: readonly string[], refusal?: (touched: string[]) => CheckedOutError) {
    if (!this.live || !paths.some(file => /\.(md|markdown)$/i.test(file))) return;
    // A note moving elsewhere holds both its Git path and its target until its check-in moves it.
    const live = new Set((await this.live.links()).flatMap(link => link.checkout.path !== null && link.checkout.path !== link.path ? [link.path, link.checkout.path] : [link.path]));
    const touched = [...new Set(paths.filter(file => live.has(file)))].sort();
    if (touched.length) throw refusal?.(touched) ?? new CheckedOutError(touched);
  }
  /**
   * Writes a whole note text into the live editor on the base a read returned (`live:` revisions, never shown to a
   * caller): the editor rebases it over typing since. The receipt says nothing was committed.
   */
  async writeLive(file: string, content: string, base: LiveRecord, agent: boolean) {
    const snapshot = await this.getSnapshot();
    if (!this.canWrite(snapshot)) throw new SourceError('Write access on the main workspace branch is required.', 403);
    const link = await this.liveLink(file);
    // A note released or checked out again since the read: the caller reads it again.
    if (!link || link.checkout.id !== base.id) throw new LiveStaleError();
    const text = normalizeLiveText(content);
    if (Buffer.byteLength(text) > LIVE_MAX_BYTES) throw new LiveTooLargeError();
    const { liveRevision } = await this.live!.write(link.checkout.id, text, base.liveRevision, agent);
    // The editor may have rebased the text over typing since, so later reads in this request read it again.
    this.liveLoaded.delete(link.path);
    this.liveSeen.set(link.path, { id: link.checkout.id, liveRevision, contentHash: liveContentHash(text) });
    return { success: true as const, committed: false as const, pushed: false as const, live: true as const, liveRevision, repository: this.repository, branch: this.branch, revision: snapshot.sha, changedPaths: [file] };
  }
  /** Appends text to a checked-out note in the live editor; never stale, since nothing is replaced. */
  async appendLive(file: string, content: string, agent: boolean) {
    const snapshot = await this.getSnapshot();
    if (!this.canWrite(snapshot)) throw new SourceError('Write access on the main workspace branch is required.', 403);
    const link = await this.liveLink(file);
    if (!link) throw new LiveStaleError();
    if (Buffer.byteLength(content) > LIVE_MAX_BYTES) throw new LiveTooLargeError();
    const { liveRevision } = await this.live!.append(link.checkout.id, content, agent);
    this.liveLoaded.delete(link.path);
    return { success: true as const, committed: false as const, pushed: false as const, live: true as const, liveRevision, repository: this.repository, branch: this.branch, revision: snapshot.sha, changedPaths: [file] };
  }

  /** A file of the branch head; a checked-out note, or a pending note's virtual path, answers its live text. */
  async readFile(file: string): Promise<Buffer> {
    const link = await this.liveLink(file);
    if (link) return Buffer.from((await this.liveTextOf(link)).content, 'utf8');
    return this.readSnapshotFile(await this.getSnapshot(), file);
  }
  /**
   * How the live links of a notebook change its Git listing: the Git paths of notes moving elsewhere leave it (`away`),
   * and pending notes and moving notes join it at the paths reads know them by (`added`).
   */
  protected async liveOverlay(nb: NotebookConfig) {
    const links = await this.notebookLinks(nb);
    const moving = links.filter(link => link.checkout.path !== null && link.checkout.target !== undefined);
    return { links, away: new Set(moving.map(link => link.checkout.path!)), added: links.filter(link => link.checkout.path === null || link.checkout.target !== undefined) };
  }

  /** What a memo key adds for the live links of `notebooks`: nothing without any. */
  protected async liveMemoKey(notebooks: NotebookConfig[]): Promise<string> {
    const links = (await Promise.all(notebooks.map(nb => this.notebookLinks(nb)))).flat();
    if (!links.length) return '';
    return `:live:${hashJson(links.map(link => [link.checkout.id, link.path, link.checkout.contentHash]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))))}`;
  }
}
