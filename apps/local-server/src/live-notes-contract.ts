import { createHash } from 'node:crypto';
import { checkInLink, type CommitAuthor, isBuiltinEditor, type LiveCheckout, type LiveContext, LiveCredentialError, LiveLeasedError, type LiveNotes, type LiveNotice, LiveNotLiveError, LiveStaleError, type NotebookKey, type RepositoryId, type WorkspacePerson } from '@mygitnotes/core';
import { beforeEach, describe, expect, it } from 'vitest';

/** What a {@link LiveNotes} adapter needs to be exercised: one repository it covers, a notebook of it, and the hooks of its editor. */
export interface LiveNotesFixture {
  liveNotes: LiveNotes;
  /** A repository `liveNotes.editor` covers. */
  repository: RepositoryId;
  /** A notebook of that repository, by the key the community sends. */
  notebook: NotebookKey;
  /** The notebook's root, repository-relative; the kit checks out notes below it that need not exist in Git. */
  root: string;
  /** Who the n-th person (1 or 2) is when they call the adapter. */
  person(n: number): LiveContext;
  /** The n-th person types in the editor until the note reads `text`, as their keystrokes would. */
  type(id: string, text: string, person: LiveContext): void | Promise<void>;
  /** Sets how many connected, non-idle editors the note has. */
  setActive(id: string, n: number): void | Promise<void>;
  /** Moves the adapter's clock on. */
  advance(ms: number): void | Promise<void>;
  /**
   * Whether the adapter's check-ins commit with the editors' own credentials, so it must list each editor's `person`.
   * Left out, the credential cases run when the adapter lists them and are passed over when it lists none, as a 0.20
   * adapter that commits with the deployment's credential does.
   */
  ownCredentials?: boolean;
  /** Whether the adapter must have `merge`. Left out, the merge cases run when it has the call and are passed over when it has none. */
  merges?: boolean;
}

const sha256 = (text: string) => createHash('sha256').update(Buffer.from(text.replace(/[\r\0]/g, ''), 'utf8')).digest('hex');
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const LEASE_MS = 5 * 60_000;

/**
 * The behavior every {@link LiveNotes} adapter must keep. An edition runs it against its own adapter:
 * `liveNotesContract('editor', async () => ({ liveNotes, repository, notebook, root, person, type, setActive, advance }))`.
 * `makeFixture` is called once per test and should start with no live links.
 */
export function liveNotesContract(name: string, makeFixture: () => LiveNotesFixture | Promise<LiveNotesFixture>) {
  describe(`${name} live notes contract`, () => {
    let fixture: LiveNotesFixture;
    let notes = 0;
    beforeEach(async () => {
      fixture = await makeFixture();
    });
    const as = (n: number) => fixture.liveNotes.person(fixture.person(n));
    const service = () => fixture.liveNotes.service;
    /** A fresh path below the notebook root, so tests never share a link. */
    const notePath = () => `${fixture.root}/live-contract-${Date.now().toString(36)}-${++notes}.md`;
    const base = (content: string, n = 1) => ({ commit: String(n % 10).repeat(40), blob: 'b'.repeat(39) + String(n % 10), content });
    const checkout = async (content = '# Live\n', path = notePath(), n = 1) => (await as(n).checkout(fixture.repository, { notebook: fixture.notebook, path, base: base(content) })).checkout;
    const row = async (id: string) => (await service().checkouts(fixture.repository)).find(entry => entry.id === id);
    /** Syncs the note at its current text and releases it, as a check-in that found nothing to commit would. */
    const checkIn = async (id: string, path?: string) => {
      const lease = await service().lease(fixture.repository, id);
      const detail = await service().detail(fixture.repository, id, lease);
      await service().synced(fixture.repository, id, lease, { commit: 'c'.repeat(40), blob: 'd'.repeat(40), contentHash: detail.contentHash, path: path ?? detail.checkout.path!, conflict: null });
      return { lease, detail, release: await service().release(fixture.repository, id, lease, { contentHash: detail.contentHash }) };
    };

    it('joins concurrent checkouts of one note into one link, and reopens a released link with the new base', async () => {
      const path = notePath();
      const results = await Promise.all([1, 2].map(n => as(n).checkout(fixture.repository, { notebook: fixture.notebook, path, base: base('# One\n') })));
      expect(results.map(result => result.outcome).sort()).toEqual(['created', 'joined']);
      expect(results[1].checkout.id).toBe(results[0].checkout.id);
      const { id } = results[0].checkout;
      expect((await service().checkouts(fixture.repository)).filter(entry => entry.path === path)).toHaveLength(1);
      expect((await checkIn(id)).release).toEqual({ released: true });
      const reopened = await as(2).checkout(fixture.repository, { notebook: fixture.notebook, path, base: base('# Two\n', 2) });
      expect(reopened.outcome).toBe('reopened');
      expect(reopened.checkout.id).toBe(id);
      expect(reopened.checkout.base).toEqual({ commit: base('', 2).commit, blob: base('', 2).blob, contentHash: sha256('# Two\n') });
      expect((await as(1).read(fixture.repository, id)).content).toBe('# Two\n');
    });

    it('hashes the normal form with sha256 and gives the text back exactly', async () => {
      const content = '---\ntitle: 中文 😀\n---\n\n  indented\ttab  \ntrailing spaces   \nno newline at the end';
      const { id, contentHash } = await checkout(content);
      expect(contentHash).toBe(sha256(content));
      const text = await as(1).read(fixture.repository, id);
      expect(text).toMatchObject({ content, contentHash: sha256(content) });
      const written = '# Rewritten 中文\n\n- a\n- b\n';
      const { changed } = await as(2).write(fixture.repository, id, { content: written, baseRevision: text.liveRevision, agent: true });
      expect(changed).toBe(true);
      expect(await as(1).read(fixture.repository, id)).toMatchObject({ content: written, contentHash: sha256(written) });
      expect((await row(id))?.contentHash).toBe(sha256(written));
    });

    it('answers no change for a write of the text it holds', async () => {
      const { id } = await checkout('# Same\n');
      const text = await as(1).read(fixture.repository, id);
      expect((await as(1).write(fixture.repository, id, { content: '# Same\n', baseRevision: text.liveRevision, agent: false })).changed).toBe(false);
      expect((await as(1).read(fixture.repository, id)).content).toBe('# Same\n');
    });

    it('rebases a write on an older revision of the same session, keeping the typing since', async () => {
      const { id } = await checkout('first\nsecond\nthird\n');
      await fixture.setActive(id, 1);
      const read = await as(1).read(fixture.repository, id);
      await fixture.type(id, 'first\nsecond\nthird\nfourth\n', fixture.person(2));
      const { liveRevision } = await as(1).write(fixture.repository, id, { content: 'FIRST\nsecond\nthird\n', baseRevision: read.liveRevision, agent: true });
      const after = await as(1).read(fixture.repository, id);
      expect(after.content).toBe('FIRST\nsecond\nthird\nfourth\n');
      expect(after.liveRevision).toBe(liveRevision);
    });

    it('refuses a write on a base it can no longer reconstruct, and never refuses an append', async () => {
      const { id } = await checkout('one\n');
      await fixture.setActive(id, 1);
      await fixture.type(id, 'one\ntwo\n', fixture.person(2));
      const read = await as(1).read(fixture.repository, id);
      await fixture.type(id, 'one\ntwo\nthree\n', fixture.person(2));
      // Everyone leaves: the session's history is gone, and the text moved on after the read.
      await fixture.setActive(id, 0);
      await fixture.type(id, 'one\ntwo\nthree\nfour\n', fixture.person(2));
      await fixture.setActive(id, 0);
      await expect(as(1).write(fixture.repository, id, { content: 'replaced\n', baseRevision: read.liveRevision, agent: true })).rejects.toBeInstanceOf(LiveStaleError);
      await expect(as(1).write(fixture.repository, id, { content: 'replaced\n', baseRevision: 'not-a-revision-of-this-note', agent: true })).rejects.toBeInstanceOf(LiveStaleError);
      expect((await as(1).read(fixture.repository, id)).content).toBe('one\ntwo\nthree\nfour\n');
      const appended = await as(1).append(fixture.repository, id, { text: 'five\n', agent: true });
      const after = await as(1).read(fixture.repository, id);
      expect(after).toMatchObject({ content: 'one\ntwo\nthree\nfour\nfive\n', liveRevision: appended.liveRevision });
    });

    it('lists live links with every field, on the editor origin, and resets since on reopen', async () => {
      const editor = fixture.liveNotes.editor(fixture.repository);
      expect(editor).not.toBeNull();
      const path = notePath();
      const created = await checkout('# Fields\n', path);
      const listed = (await as(2).checkouts(fixture.repository)).find(entry => entry.id === created.id);
      expect(await service().repositories()).toContain(fixture.repository);
      for (const entry of [created, listed!]) {
        const fields = { id: expect.stringMatching(/^[A-Za-z0-9_-]{1,64}$/), notebook: fixture.notebook, path, since: expect.stringMatching(ISO), contentHash: sha256('# Fields\n'), activeEditors: 0, lastEditAt: null, syncedAt: null, base: { commit: base('').commit, blob: base('').blob, contentHash: sha256('# Fields\n') }, conflict: null };
        // The built-in editor's notes are edited in the app itself: its rows carry no URL.
        if (isBuiltinEditor(editor!)) {
          expect(entry).toEqual(fields);
          continue;
        }
        expect(entry).toEqual({ ...fields, editorUrl: expect.any(String), embedUrl: expect.any(String) });
        for (const url of [entry.editorUrl!, entry.embedUrl!]) {
          expect(new URL(url).origin).toBe(editor!.origin);
          expect(new URL(url).username + new URL(url).password).toBe('');
        }
      }
      await fixture.setActive(created.id, 2);
      await fixture.type(created.id, '# Fields\nmore\n', fixture.person(2));
      expect(await row(created.id)).toMatchObject({ activeEditors: 2, lastEditAt: expect.stringMatching(ISO), contentHash: sha256('# Fields\nmore\n') });
      await fixture.setActive(created.id, 0);
      await checkIn(created.id);
      expect(await row(created.id)).toBeUndefined();
      await fixture.advance(60_000);
      const reopened = await checkout('# Again\n', path);
      expect(reopened.id).toBe(created.id);
      expect(Date.parse(reopened.since)).toBeGreaterThan(Date.parse(created.since));
      expect(reopened).toMatchObject({ syncedAt: null, conflict: null, contentHash: sha256('# Again\n') });
    });

    it('issues a distinct socket ticket per call for a live link of a built-in editor, and none for a released one', async () => {
      const editor = fixture.liveNotes.editor(fixture.repository)!;
      if (!isBuiltinEditor(editor)) return;
      expect(typeof fixture.liveNotes.socketTicket).toBe('function');
      const path = notePath();
      const { id } = await checkout('# Ticket\n', path);
      const first = await fixture.liveNotes.socketTicket!(fixture.person(1), fixture.repository, id);
      const second = await fixture.liveNotes.socketTicket!(fixture.person(2), fixture.repository, id);
      for (const ticket of [first, second]) expect(ticket).toEqual({ ticket: expect.stringMatching(/^[A-Za-z0-9_-]{32,128}$/), document: expect.stringMatching(new RegExp(`^${id}\\.[1-9][0-9]{0,9}$`)) });
      expect(second.ticket).not.toBe(first.ticket);
      expect(second.document).toBe(first.document);
      expect((await checkIn(id)).release).toEqual({ released: true });
      await expect(fixture.liveNotes.socketTicket!(fixture.person(1), fixture.repository, id)).rejects.toBeInstanceOf(LiveNotLiveError);
      // A reopened link is a new epoch: its document is another.
      await checkout('# Again\n', path);
      expect((await fixture.liveNotes.socketTicket!(fixture.person(1), fixture.repository, id)).document).not.toBe(first.document);
    });

    it('leases a link to one holder until the lease expires, and refuses lease-bound calls without it', async () => {
      const { id } = await checkout();
      const first = await service().lease(fixture.repository, id);
      expect(first).toEqual({ token: expect.any(String), until: expect.stringMatching(ISO) });
      await expect(service().lease(fixture.repository, id)).rejects.toBeInstanceOf(LiveLeasedError);
      const forged = { token: `${first.token}x`, until: first.until };
      const text = await as(1).read(fixture.repository, id);
      await expect(service().mergeIn(fixture.repository, id, forged, { content: 'x\n', baseRevision: text.liveRevision })).rejects.toBeInstanceOf(LiveLeasedError);
      await expect(service().synced(fixture.repository, id, forged, { commit: 'c'.repeat(40), blob: 'd'.repeat(40), contentHash: text.contentHash, path: (await row(id))!.path!, conflict: null })).rejects.toBeInstanceOf(LiveLeasedError);
      await expect(service().release(fixture.repository, id, forged, { contentHash: text.contentHash })).rejects.toBeInstanceOf(LiveLeasedError);
      const merged = await service().mergeIn(fixture.repository, id, first, { content: '# Merged\n', baseRevision: text.liveRevision });
      expect(await as(1).read(fixture.repository, id)).toMatchObject({ content: '# Merged\n', liveRevision: merged.liveRevision });
      await fixture.advance(LEASE_MS + 1000);
      const second = await service().lease(fixture.repository, id);
      expect(second.token).not.toBe(first.token);
      await expect(service().release(fixture.repository, id, first, { contentHash: sha256('# Merged\n') })).rejects.toBeInstanceOf(LiveLeasedError);
    });

    it('takes a merge under a key once, over typing since, and answers a repeat under that key as repeated, also after a release and a reopen', async () => {
      const once = service().mergeInOnce?.bind(service());
      if (!once) return;
      const path = notePath();
      const { id } = await checkout('# Once\nlink\n', path);
      const read = await as(1).read(fixture.repository, id);
      await fixture.type(id, '# Once\nlink\ntyped\n', fixture.person(1));
      const lease = await service().lease(fixture.repository, id);
      await expect(once(fixture.repository, id, { token: `${lease.token}x`, until: lease.until }, { content: '# Once\nLINK\n', baseRevision: read.liveRevision, key: 'move-1' })).rejects.toBeInstanceOf(LiveLeasedError);
      expect(await once(fixture.repository, id, lease, { content: '# Once\nLINK\n', baseRevision: read.liveRevision, key: 'move-1' })).toMatchObject({ repeated: false, liveRevision: expect.any(String) });
      expect((await as(1).read(fixture.repository, id)).content).toBe('# Once\nLINK\ntyped\n');
      // The same key takes nothing again; another key does.
      const now = await as(1).read(fixture.repository, id);
      expect(await once(fixture.repository, id, lease, { content: '# Once\nLINK!\ntyped\n', baseRevision: now.liveRevision, key: 'move-1' })).toMatchObject({ repeated: true });
      expect((await as(1).read(fixture.repository, id)).content).toBe('# Once\nLINK\ntyped\n');
      await fixture.advance(LEASE_MS + 1000);
      expect((await checkIn(id)).release).toEqual({ released: true });
      const reopened = (await as(2).checkout(fixture.repository, { notebook: fixture.notebook, path, base: base('# Once\nLINK\ntyped\n', 2) })).checkout;
      expect(reopened.id).toBe(id);
      const again = await service().lease(fixture.repository, id);
      const text = await as(1).read(fixture.repository, id);
      expect(await once(fixture.repository, id, again, { content: '# Once\nLINK!\ntyped\n', baseRevision: text.liveRevision, key: 'move-1' })).toMatchObject({ repeated: true });
      expect(await once(fixture.repository, id, again, { content: '# Once\nLINK!\ntyped\n', baseRevision: text.liveRevision, key: 'move-2' })).toMatchObject({ repeated: false });
      expect((await as(1).read(fixture.repository, id)).content).toBe('# Once\nLINK!\ntyped\n');
    });

    it('takes a sync receipt twice without harm, and keeps listing who typed after it', async () => {
      const { id } = await checkout('# Sync\n');
      await fixture.type(id, '# Sync\none\n', fixture.person(1));
      const lease = await service().lease(fixture.repository, id);
      const detail = await service().detail(fixture.repository, id, lease);
      expect(detail.editors.map(editor => editor.email)).toEqual([fixture.person(1).author!.email]);
      const receipt = { commit: 'c'.repeat(40), blob: 'd'.repeat(40), contentHash: detail.contentHash, path: detail.checkout.path!, conflict: null };
      // Someone types between the read the commit was made from and its receipt.
      await fixture.type(id, '# Sync\none\ntwo\n', fixture.person(2));
      await service().synced(fixture.repository, id, lease, receipt);
      await service().synced(fixture.repository, id, lease, receipt);
      expect(await row(id)).toMatchObject({ syncedAt: expect.stringMatching(ISO), base: { commit: receipt.commit, blob: receipt.blob, contentHash: receipt.contentHash }, conflict: null });
      const after = await service().detail(fixture.repository, id, lease);
      expect(after.editors.map(editor => editor.email)).toEqual([fixture.person(2).author!.email]);
      expect(after.content).toBe('# Sync\none\ntwo\n');
    });

    it('records the conflict a receipt names', async () => {
      const { id } = await checkout('# Conflict\n');
      const lease = await service().lease(fixture.repository, id);
      const detail = await service().detail(fixture.repository, id, lease);
      const conflict = { kind: 'overwrote' as const, overwritten: 'e'.repeat(40), commit: 'c'.repeat(40), at: new Date(Date.parse(detail.checkout.since) + 1000).toISOString() };
      await service().synced(fixture.repository, id, lease, { commit: 'c'.repeat(40), blob: 'd'.repeat(40), contentHash: detail.contentHash, path: detail.checkout.path!, conflict });
      expect((await row(id))?.conflict).toEqual(conflict);
    });

    it('releases only a synced, unchanged link nobody is editing', async () => {
      const { id } = await checkout('# Release\n');
      const lease = await service().lease(fixture.repository, id);
      const detail = await service().detail(fixture.repository, id, lease);
      expect(await service().release(fixture.repository, id, lease, { contentHash: detail.contentHash })).toEqual({ released: false, reason: 'not-synced' });
      await service().synced(fixture.repository, id, lease, { commit: 'c'.repeat(40), blob: 'd'.repeat(40), contentHash: detail.contentHash, path: detail.checkout.path!, conflict: null });
      await fixture.setActive(id, 1);
      expect(await service().release(fixture.repository, id, lease, { contentHash: detail.contentHash })).toMatchObject({ released: false, reason: 'active', activeEditors: 1 });
      await fixture.type(id, '# Release\nchanged\n', fixture.person(2));
      await fixture.setActive(id, 0);
      expect(await service().release(fixture.repository, id, lease, { contentHash: detail.contentHash })).toMatchObject({ released: false, reason: 'changed' });
      expect(await row(id)).toBeDefined();
      const next = await service().detail(fixture.repository, id, lease);
      await service().synced(fixture.repository, id, lease, { commit: 'f'.repeat(40), blob: 'd'.repeat(40), contentHash: next.contentHash, path: next.checkout.path!, conflict: null });
      expect(await service().release(fixture.repository, id, lease, { contentHash: next.contentHash })).toEqual({ released: true });
      expect(await row(id)).toBeUndefined();
      await expect(as(1).read(fixture.repository, id)).rejects.toBeInstanceOf(LiveNotLiveError);
      await expect(as(1).write(fixture.repository, id, { content: 'x', baseRevision: next.liveRevision, agent: true })).rejects.toBeInstanceOf(LiveNotLiveError);
      await expect(service().lease(fixture.repository, id)).rejects.toBeInstanceOf(LiveNotLiveError);
    });

    it('keeps a pending note without a path until its receipt files it, then keeps that path', async () => {
      const pending = await as(1).createPending(fixture.repository, { notebook: fixture.notebook, pathRule: 'meetings/{{date}} {{title}}.md', content: '# Pending\n' });
      expect(pending).toMatchObject({ notebook: fixture.notebook, path: null, pathRule: 'meetings/{{date}} {{title}}.md', base: null, contentHash: sha256('# Pending\n') });
      expect((await row(pending.id))?.path).toBeNull();
      expect(await as(1).filed(fixture.repository, pending.id)).toBeNull();
      const filed = notePath();
      const lease = await service().lease(fixture.repository, pending.id);
      const detail = await service().detail(fixture.repository, pending.id, lease);
      const receipt = { commit: 'c'.repeat(40), blob: 'd'.repeat(40), contentHash: detail.contentHash, path: filed, conflict: null };
      await service().synced(fixture.repository, pending.id, lease, receipt);
      expect((await row(pending.id))?.path).toBe(filed);
      await service().synced(fixture.repository, pending.id, lease, receipt);
      await service().synced(fixture.repository, pending.id, lease, { ...receipt, path: notePath() }).catch(() => undefined);
      expect((await row(pending.id))?.path).toBe(filed);
      expect(await service().release(fixture.repository, pending.id, lease, { contentHash: detail.contentHash })).toEqual({ released: true });
      expect(await as(2).filed(fixture.repository, pending.id)).toBe(filed);
    });

    it('discards a pending note nobody typed in: no path, gone from the list, filed nowhere, and keeps its initial text until then', async () => {
      const discard = service().discard?.bind(service());
      if (!discard) return;
      const content = '---\ntitle: Draft\n---\n\nStart here.\n';
      const pending = await as(1).createPending(fixture.repository, { notebook: fixture.notebook, pathRule: '{{title}}.md', content });
      const lease = await service().lease(fixture.repository, pending.id);
      const detail = await service().detail(fixture.repository, pending.id, lease);
      expect(detail.editors).toEqual([]);
      if (detail.initialText !== undefined) expect(detail.initialText).toBe(content);
      expect(await discard(fixture.repository, pending.id, lease, { contentHash: detail.contentHash })).toEqual({ released: true });
      expect(await row(pending.id)).toBeUndefined();
      expect(await as(2).filed(fixture.repository, pending.id)).toBeNull();
      await expect(as(1).read(fixture.repository, pending.id)).rejects.toBeInstanceOf(LiveNotLiveError);
      await expect(service().lease(fixture.repository, pending.id)).rejects.toBeInstanceOf(LiveNotLiveError);
    });

    it('keeps the initial text of a pending note while people type in it', async () => {
      if (!service().discard) return;
      const content = '---\ntitle: Typed\n---\n';
      const pending = await as(1).createPending(fixture.repository, { notebook: fixture.notebook, pathRule: '{{title}}.md', content });
      await fixture.type(pending.id, `${content}\nWords.\n`, fixture.person(2));
      const lease = await service().lease(fixture.repository, pending.id);
      const detail = await service().detail(fixture.repository, pending.id, lease);
      expect(detail.content).toBe(`${content}\nWords.\n`);
      expect(detail.editors.map(editor => editor.email)).toEqual([fixture.person(2).author!.email]);
      if (detail.initialText !== undefined) expect(detail.initialText).toBe(content);
    });

    it('refuses to discard a note with a path, one being edited, and one whose text changed, and keeps each live', async () => {
      const discard = service().discard?.bind(service());
      if (!discard) return;
      const filed = await checkout('# Filed\n');
      const filedLease = await service().lease(fixture.repository, filed.id);
      await expect(discard(fixture.repository, filed.id, filedLease, { contentHash: filed.contentHash })).rejects.toThrow();
      expect((await row(filed.id))?.path).toBe(filed.path);
      const pending = await as(1).createPending(fixture.repository, { notebook: fixture.notebook, pathRule: '{{title}}.md', content: '# Pending\n' });
      const lease = await service().lease(fixture.repository, pending.id);
      const detail = await service().detail(fixture.repository, pending.id, lease);
      await fixture.setActive(pending.id, 1);
      expect(await discard(fixture.repository, pending.id, lease, { contentHash: detail.contentHash })).toMatchObject({ released: false, reason: 'active', activeEditors: 1 });
      await fixture.type(pending.id, '# Pending\nmore\n', fixture.person(2));
      await fixture.setActive(pending.id, 0);
      expect(await discard(fixture.repository, pending.id, lease, { contentHash: detail.contentHash })).toMatchObject({ released: false, reason: 'changed' });
      expect(await row(pending.id)).toMatchObject({ path: null, contentHash: sha256('# Pending\nmore\n') });
      expect((await as(1).read(fixture.repository, pending.id)).content).toBe('# Pending\nmore\n');
      await expect(discard(fixture.repository, pending.id, { token: `${lease.token}x`, until: lease.until }, { contentHash: sha256('# Pending\nmore\n') })).rejects.toBeInstanceOf(LiveLeasedError);
      expect(await discard(fixture.repository, pending.id, lease, { contentHash: sha256('# Pending\nmore\n') })).toEqual({ released: true });
      expect(await row(pending.id)).toBeUndefined();
    });

    it('retargets a pending note to the rule given, placeholders and all, leaves its text and editors, and ends the lease', async () => {
      const retarget = service().retarget?.bind(service());
      if (!retarget) return;
      const pending = await as(1).createPending(fixture.repository, { notebook: fixture.notebook, pathRule: 'inbox/{{title}}.md', content: '# Pending\n' });
      await fixture.type(pending.id, '# Pending\nwords\n', fixture.person(2));
      const lease = await service().lease(fixture.repository, pending.id);
      expect(await retarget(fixture.repository, pending.id, lease, { pathRule: 'moved/{{date}} {{title}}.md' })).toMatchObject({ id: pending.id, notebook: fixture.notebook, path: null, pathRule: 'moved/{{date}} {{title}}.md', base: null, contentHash: sha256('# Pending\nwords\n') });
      expect(await row(pending.id)).toMatchObject({ path: null, pathRule: 'moved/{{date}} {{title}}.md' });
      expect((await as(1).read(fixture.repository, pending.id)).content).toBe('# Pending\nwords\n');
      // The lease ended with the call: a check-in can take the note at once.
      const next = await service().lease(fixture.repository, pending.id);
      expect((await service().detail(fixture.repository, pending.id, next)).editors.map(editor => editor.email)).toEqual([fixture.person(2).author!.email]);
      expect(await retarget(fixture.repository, pending.id, next, { pathRule: 'moved/Fixed.md' })).toMatchObject({ path: null, pathRule: 'moved/Fixed.md' });
      expect(await row(pending.id)).toMatchObject({ pathRule: 'moved/Fixed.md' });
    });

    it('retargets a pending note someone has open: its text is not touched, so open editors do not hold it', async () => {
      const retarget = service().retarget?.bind(service());
      if (!retarget) return;
      const pending = await as(1).createPending(fixture.repository, { notebook: fixture.notebook, pathRule: '{{title}}.md', content: '# Open\n' });
      await fixture.setActive(pending.id, 1);
      const lease = await service().lease(fixture.repository, pending.id);
      expect(await retarget(fixture.repository, pending.id, lease, { pathRule: 'elsewhere/{{title}}.md' })).toMatchObject({ path: null, pathRule: 'elsewhere/{{title}}.md', activeEditors: 1 });
    });

    it('refuses to retarget a note with a path, and a call without the lease, and leaves each as it was', async () => {
      const retarget = service().retarget?.bind(service());
      if (!retarget) return;
      const filed = await checkout('# Filed\n');
      const filedLease = await service().lease(fixture.repository, filed.id);
      await expect(retarget(fixture.repository, filed.id, filedLease, { pathRule: 'moved/{{title}}.md' })).rejects.toBeInstanceOf(LiveNotLiveError);
      expect(await row(filed.id)).toMatchObject({ path: filed.path });
      expect(await row(filed.id)).not.toHaveProperty('pathRule');
      // A refused retarget ends its lease too, so it never holds a check-in off.
      await service().lease(fixture.repository, filed.id);
      const pending = await as(1).createPending(fixture.repository, { notebook: fixture.notebook, pathRule: '{{title}}.md', content: '# Pending\n' });
      const lease = await service().lease(fixture.repository, pending.id);
      await expect(retarget(fixture.repository, pending.id, { token: `${lease.token}x`, until: lease.until }, { pathRule: 'moved/{{title}}.md' })).rejects.toBeInstanceOf(LiveLeasedError);
      await fixture.advance(LEASE_MS + 1000);
      await expect(retarget(fixture.repository, pending.id, lease, { pathRule: 'moved/{{title}}.md' })).rejects.toBeInstanceOf(LiveLeasedError);
      expect(await row(pending.id)).toMatchObject({ path: null, pathRule: '{{title}}.md' });
    });

    it('names the note that left a path last, live or released, and none while it is read there again', async () => {
      const retarget = service().retarget?.bind(service());
      const leftFrom = (path: string, n = 2) => as(n).leftFrom!(fixture.repository, path);
      if (!retarget || !as(1).leftFrom) return;
      const filed = await checkout('# Moving\n');
      const first = notePath(), second = notePath();
      expect(await leftFrom(filed.path!)).toBeNull();
      await retarget(fixture.repository, filed.id, await service().lease(fixture.repository, filed.id), { target: first });
      expect(await leftFrom(filed.path!)).toBeNull();
      await retarget(fixture.repository, filed.id, await service().lease(fixture.repository, filed.id), { target: second });
      expect(await leftFrom(first)).toBe(filed.id);
      // Checked in at its target and released, it still left both paths, and is filed where it went.
      expect((await checkIn(filed.id, second)).release).toEqual({ released: true });
      expect(await leftFrom(filed.path!, 1)).toBe(filed.id);
      expect(await leftFrom(first)).toBe(filed.id);
      expect(await as(1).filed(fixture.repository, filed.id)).toBe(second);
      // A later note that leaves the same path is named instead.
      const later = await checkout('# Later\n');
      await retarget(fixture.repository, later.id, await service().lease(fixture.repository, later.id), { target: first });
      await retarget(fixture.repository, later.id, await service().lease(fixture.repository, later.id), { target: null });
      expect(await leftFrom(first)).toBe(later.id);
      expect(await leftFrom(notePath())).toBeNull();
      // Forgotten for the note that left it last, and only for that one, it names none (FLM-F004).
      const forget = as(2).forgetLeft?.bind(as(2));
      if (!forget) return;
      await forget(fixture.repository, first, filed.id);
      expect(await leftFrom(first)).toBe(later.id);
      await forget(fixture.repository, first, later.id);
      expect(await leftFrom(first)).toBeNull();
      expect(await leftFrom(filed.path!, 1)).toBe(filed.id);
    });

    it('lists the editors since the last sync for the service, with email and an agent flag, and attributes a merge to nobody', async () => {
      const { id } = await checkout('# Editors\n');
      await fixture.type(id, '# Editors\nhand\n', fixture.person(1));
      const text = await as(2).read(fixture.repository, id);
      await as(2).write(fixture.repository, id, { content: '# Editors\nhand\nagent\n', baseRevision: text.liveRevision, agent: true });
      const lease = await service().lease(fixture.repository, id);
      const detail = await service().detail(fixture.repository, id, lease);
      const editors = [...detail.editors].sort((a, b) => Date.parse(a.firstAt) - Date.parse(b.firstAt) || Number(a.agent) - Number(b.agent));
      // An adapter that commits with the editors' own credentials also lists who each signed in as; any other lists none.
      const signedIn = (n: number) => editors.some(editor => editor.person !== undefined) ? { person: fixture.person(n).person } : {};
      expect(editors).toEqual([{ name: expect.any(String), email: fixture.person(1).author!.email, agent: false, firstAt: expect.stringMatching(ISO), lastAt: expect.stringMatching(ISO), ...signedIn(1) }, { name: expect.any(String), email: fixture.person(2).author!.email, agent: true, firstAt: expect.stringMatching(ISO), lastAt: expect.stringMatching(ISO), ...signedIn(2) }]);
      for (const editor of editors) expect(Date.parse(editor.firstAt)).toBeLessThanOrEqual(Date.parse(editor.lastAt));
      expect(detail.checkout).toMatchObject<Partial<LiveCheckout>>({ id, contentHash: detail.contentHash });
      await service().mergeIn(fixture.repository, id, lease, { content: '# Editors\nhand\nagent\nmerged\n', baseRevision: detail.liveRevision });
      const after = await service().detail(fixture.repository, id, lease);
      expect(after.content).toBe('# Editors\nhand\nagent\nmerged\n');
      expect(after.editors.map(editor => editor.email).sort()).toEqual(editors.map(editor => editor.email).sort());
    });

    /*
     * An adapter with `merge` (docs/specs/2026-11-16-collab-first-self-host A4) takes a text written on a base the
     * writer names, such as a draft made offline, into the live note as a three-way merge. One without it is passed over.
     */
    const merging = (n: number) => {
      const calls = as(n);
      if (!calls.merge && fixture.merges) throw new Error('The adapter has no merge.');
      return calls.merge?.bind(calls);
    };
    let merges = 0;
    const mergeId = () => `kit-merge-${Date.now().toString(36)}-${++merges}`;

    it('merges a text written on an older base into the live note while people type, keeps their typing, and credits the writer', async () => {
      const merge = merging(1);
      if (!merge) return;
      const base = 'one\ntwo\nthree\n';
      const { id } = await checkout(base);
      await fixture.setActive(id, 2);
      await fixture.type(id, 'one\ntwo\nthree\nfour\n', fixture.person(2));
      const answer = await merge(fixture.repository, id, { base, text: 'ONE\ntwo\nthree\n', mergeId: mergeId() });
      expect(answer).toEqual({ applied: true, contentHash: sha256('ONE\ntwo\nthree\nfour\n') });
      expect(await as(2).read(fixture.repository, id)).toMatchObject({ content: 'ONE\ntwo\nthree\nfour\n', contentHash: sha256('ONE\ntwo\nthree\nfour\n') });
      // They type on: the merge is one more edit among theirs.
      await fixture.type(id, 'ONE\ntwo\nthree\nfour\nfive\n', fixture.person(2));
      expect((await as(1).read(fixture.repository, id)).content).toBe('ONE\ntwo\nthree\nfour\nfive\n');
      const lease = await service().lease(fixture.repository, id);
      const detail = await service().detail(fixture.repository, id, lease);
      expect(detail.editors.map(editor => editor.email).sort()).toEqual([fixture.person(1).author!.email, fixture.person(2).author!.email].sort());
      expect(detail.editors.every(editor => editor.agent === false)).toBe(true);
      expect(Date.parse((await row(id))!.lastEditAt!)).not.toBeNaN();
    });

    it('answers a conflict for a merge that changed what the live note changed too, and changes nothing', async () => {
      const merge = merging(1);
      if (!merge) return;
      const base = 'one\ntwo\nthree\n';
      const { id } = await checkout(base);
      await fixture.type(id, 'one\nxxx\nthree\n', fixture.person(2));
      const before = await as(1).read(fixture.repository, id);
      expect(await merge(fixture.repository, id, { base, text: 'one\nyyy\nthree\n', mergeId: mergeId() })).toEqual({ conflict: true });
      expect(await as(1).read(fixture.repository, id)).toEqual(before);
      const lease = await service().lease(fixture.repository, id);
      expect((await service().detail(fixture.repository, id, lease)).editors.map(editor => editor.email)).toEqual([fixture.person(2).author!.email]);
    });

    it('answers a repeated merge with its first answer and adds no second copy, while the same id of another person is their own merge', async () => {
      const merge = merging(1);
      if (!merge) return;
      const base = 'a\nb\n';
      const { id } = await checkout(base);
      const request = { base, text: 'a\nb\nmerged\n', mergeId: mergeId() };
      const first = await merge(fixture.repository, id, request);
      expect(first).toEqual({ applied: true, contentHash: sha256('a\nb\nmerged\n') });
      await fixture.type(id, 'a\nb\nmerged\nmore\n', fixture.person(2));
      // The request again, as a client that never saw the answer sends it: the note has moved on, and takes nothing twice.
      expect(await merge(fixture.repository, id, request)).toEqual(first);
      expect(await Promise.all([merge(fixture.repository, id, request), merge(fixture.repository, id, request)])).toEqual([first, first]);
      expect((await as(1).read(fixture.repository, id)).content).toBe('a\nb\nmerged\nmore\n');
      // An id is one person's: someone else's merge under the same id is not answered with this one.
      const theirs = await merging(2)!(fixture.repository, id, { base: 'a\nb\nmerged\nmore\n', text: 'a\nb\nmerged\nmore\ntheirs\n', mergeId: request.mergeId });
      expect(theirs).toEqual({ applied: true, contentHash: sha256('a\nb\nmerged\nmore\ntheirs\n') });
      expect((await as(1).read(fixture.repository, id)).content).toBe('a\nb\nmerged\nmore\ntheirs\n');
    });

    it('applies a merge that changes nothing without an edit, takes the text of a note nobody else touched, and refuses a released note', async () => {
      const merge = merging(1);
      if (!merge) return;
      const base = '# Same\n';
      const { id } = await checkout(base);
      expect(await merge(fixture.repository, id, { base, text: base, mergeId: mergeId() })).toEqual({ applied: true, contentHash: sha256(base) });
      expect((await row(id))?.lastEditAt).toBeNull();
      // Written in CRLF on the same base: the live note takes it in normal form.
      expect(await merge(fixture.repository, id, { base: '# Same\r\n', text: '# Same\r\nmine\r\n', mergeId: mergeId() })).toEqual({ applied: true, contentHash: sha256('# Same\nmine\n') });
      expect((await as(2).read(fixture.repository, id)).content).toBe('# Same\nmine\n');
      await checkIn(id);
      await expect(merge(fixture.repository, id, { base, text: '# Same\nlate\n', mergeId: mergeId() })).rejects.toBeInstanceOf(LiveNotLiveError);
    });

    /*
     * An adapter whose check-ins commit with the editors' own credentials (docs/specs/2026-11-16-collab-first-self-host
     * A6) lists each editor's `person`, and its `service.open` takes `as`. One that commits with the deployment's own
     * credential lists none, as in 0.20, and these cases do not apply to it.
     */
    const samePerson = (a: WorkspacePerson | undefined, b: WorkspacePerson) => a?.realm === b.realm && a.userId === b.userId;
    /** Two people typed in a note; answers its id, or undefined for an adapter that lists no person. */
    const typedByTwo = async () => {
      const { id } = await checkout('# Credentials\n');
      await fixture.type(id, '# Credentials\none\n', fixture.person(1));
      await fixture.advance(1000);
      await fixture.type(id, '# Credentials\none\ntwo\n', fixture.person(2));
      const lease = await service().lease(fixture.repository, id);
      const { editors } = await service().detail(fixture.repository, id, lease);
      // The lease is left to run out, as a check-in that died would leave it.
      await fixture.advance(LEASE_MS + 1000);
      if (!fixture.ownCredentials && editors.every(editor => editor.person === undefined)) return undefined;
      expect(editors.map(editor => editor.person)).toEqual([fixture.person(1).person, fixture.person(2).person]);
      return id;
    };
    /** The adapter with `open` refusing the people `refused` names, every open it was asked for, and every notice. */
    const refusing = (refused: (person: WorkspacePerson | undefined) => boolean) => {
      const opens: { author: CommitAuthor | undefined; person: WorkspacePerson | undefined; refused: boolean; }[] = [];
      const notices: LiveNotice[] = [];
      const { liveNotes } = fixture;
      const wrapped: LiveNotes = {
        editors: liveNotes.editors,
        editor: repository => liveNotes.editor(repository),
        person: context => liveNotes.person(context),
        ...(liveNotes.socketTicket ? { socketTicket: (context, repository, id) => liveNotes.socketTicket!(context, repository, id) } : {}),
        notify: async notice => void notices.push(notice),
        service: {
          ...liveNotes.service,
          open: async (repository, author, as) => {
            opens.push({ author, person: as?.person, refused: refused(as?.person) });
            if (refused(as?.person)) throw new LiveCredentialError();
            return liveNotes.service.open(repository, author, as);
          },
        },
      };
      return { liveNotes: wrapped, opens, notices };
    };

    it("commits with the second editor's credential when the first editor's is refused: the second authors it and the first is still a co-author", async () => {
      const id = await typedByTwo();
      if (!id) return;
      const [first, second] = [fixture.person(1), fixture.person(2)];
      const { liveNotes, opens, notices } = refusing(person => samePerson(person, first.person));
      const result = await checkInLink(liveNotes, fixture.repository, id, { mode: 'manual', sleep: async () => {} });
      expect(result).toMatchObject({ id, committed: true, released: true, commit: expect.stringMatching(/^[0-9a-f]{40,64}$/) });
      expect(opens).toEqual([{ author: first.author, person: first.person, refused: true }, { author: second.author, person: second.person, refused: false }]);
      // The commit as Git holds it, read with the credential that made it.
      const source = await fixture.liveNotes.service.open(fixture.repository, undefined, { person: second.person });
      const [commit] = (await source.fileHistory(result.path!, 1, 1)).entries;
      expect(commit.commit).toBe(result.commit);
      expect(commit.author).toBe(second.author!.name);
      expect(commit.body.split('\n')).toContain(`Co-authored-by: ${first.author!.name} <${first.author!.email}>`);
      expect(commit.body).not.toContain(`Co-authored-by: ${second.author!.name}`);
      expect(notices.filter(notice => notice.kind === 'uncommittable')).toEqual([]);
    });

    it('commits nothing when every editor is refused: the text stays live, its lease is given back, and uncommittable is notified', async () => {
      const id = await typedByTwo();
      if (!id) return;
      const { liveNotes, opens, notices } = refusing(() => true);
      const result = await checkInLink(liveNotes, fixture.repository, id, { mode: 'scheduled', sleep: async () => {} });
      expect(result).toMatchObject({ id, committed: false, released: false, reason: 'uncommittable' });
      expect(result).not.toHaveProperty('commit');
      expect(opens.map(open => open.person)).toEqual([fixture.person(1).person, fixture.person(2).person]);
      expect(notices).toEqual([expect.objectContaining({ kind: 'uncommittable', repository: fixture.repository, id, editors: [{ name: fixture.person(1).author!.name }, { name: fixture.person(2).author!.name }] })]);
      // Nothing was lost: the text is live, both are still listed, and the next check-in need not wait for the lease.
      expect((await as(1).read(fixture.repository, id)).content).toBe('# Credentials\none\ntwo\n');
      if (!service().unlease) await fixture.advance(LEASE_MS + 1000);
      const lease = await service().lease(fixture.repository, id);
      expect((await service().detail(fixture.repository, id, lease)).editors.map(editor => editor.person)).toEqual([fixture.person(1).person, fixture.person(2).person]);
    });
  });
}
