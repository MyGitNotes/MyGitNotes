import { createHash } from 'node:crypto';
import { isBuiltinEditor, type LiveCheckout, type LiveContext, LiveLeasedError, type LiveNotes, LiveNotLiveError, LiveStaleError, type NotebookKey, type RepositoryId } from '@mygitnotes/core';
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

    it('lists the editors since the last sync for the service, with email and an agent flag, and attributes a merge to nobody', async () => {
      const { id } = await checkout('# Editors\n');
      await fixture.type(id, '# Editors\nhand\n', fixture.person(1));
      const text = await as(2).read(fixture.repository, id);
      await as(2).write(fixture.repository, id, { content: '# Editors\nhand\nagent\n', baseRevision: text.liveRevision, agent: true });
      const lease = await service().lease(fixture.repository, id);
      const detail = await service().detail(fixture.repository, id, lease);
      const editors = [...detail.editors].sort((a, b) => Date.parse(a.firstAt) - Date.parse(b.firstAt) || Number(a.agent) - Number(b.agent));
      expect(editors).toEqual([{ name: expect.any(String), email: fixture.person(1).author!.email, agent: false, firstAt: expect.stringMatching(ISO), lastAt: expect.stringMatching(ISO) }, { name: expect.any(String), email: fixture.person(2).author!.email, agent: true, firstAt: expect.stringMatching(ISO), lastAt: expect.stringMatching(ISO) }]);
      for (const editor of editors) expect(Date.parse(editor.firstAt)).toBeLessThanOrEqual(Date.parse(editor.lastAt));
      expect(detail.checkout).toMatchObject<Partial<LiveCheckout>>({ id, contentHash: detail.contentHash });
      await service().mergeIn(fixture.repository, id, lease, { content: '# Editors\nhand\nagent\nmerged\n', baseRevision: detail.liveRevision });
      const after = await service().detail(fixture.repository, id, lease);
      expect(after.content).toBe('# Editors\nhand\nagent\nmerged\n');
      expect(after.editors.map(editor => editor.email).sort()).toEqual(editors.map(editor => editor.email).sort());
    });
  });
}
