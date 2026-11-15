import { type LiveConflict, liveContentHash, type RepositoryId } from '@mygitnotes/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { type EditorRef, type LinkInit, LIVE_PRESENCE_MS, LIVE_TICKET_MS, type LiveStore, type StoredTicket, type SyncReceipt } from './store.js';

const T0 = Date.parse('2026-11-15T00:00:00.000Z');
const LEASE_MS = 5 * 60_000;
const IDLE_MS = 10 * 60_000;
const repository: RepositoryId = 'edition:hosted:p1/notes@main';
const other: RepositoryId = 'edition:hosted:p1/other@main';
const notebook = 'notes~life';
const note = 'notes/life/a.md';
/** No link has this id. */
const unknown = 'A'.repeat(22);
const bytes = (text: string) => new TextEncoder().encode(text);
/** A content hash that is no text's. */
const hash = (letter: string) => letter.repeat(64);
const pat: EditorRef = { key: 'person:pat@example.test', name: 'Pat', email: 'pat@example.test', agent: false };
const sam: EditorRef = { key: 'person:sam@example.test', name: 'Sam', email: 'sam@example.test', agent: false };
/** An agent without a verified email. */
const bot: EditorRef = { key: 'agent:Robo', name: 'Robo', agent: true };
const kim = 'person:kim@example.test';

/**
 * The behavior every {@link LiveStore} must keep (docs/specs/2026-11-15-builtin-live-editor §3). An edition runs it
 * against its own store: `liveStoreContract('postgres', () => postgresLiveStore(pool))`. `makeStore` is called once per
 * test and should start empty. Every time the kit passes is its own, from a fixed instant, so nothing waits on a clock.
 */
export function liveStoreContract(name: string, makeStore: () => LiveStore | Promise<LiveStore>) {
  describe(`${name} live store contract`, () => {
    let store: LiveStore;
    let leases = 0;
    beforeEach(async () => {
      store = await makeStore();
    });
    const init = (text: string, n = 1): LinkInit => ({ notebook, base: { commit: String(n % 10).repeat(40), blob: 'b'.repeat(39) + String(n % 10), contentHash: liveContentHash(text) }, contentHash: liveContentHash(text) });
    const checkout = (path: string, text: string, now: number, n = 1, where = repository) => store.checkout(where, { ...init(text, n), path }, bytes(text), now);
    const open = async (path = note, text = '# A\n', now = T0) => (await checkout(path, text, now)).link;
    const pending = (text = '# Draft\n', now = T0, where = repository) => store.createPending(where, { notebook, base: null, contentHash: liveContentHash(text), pathRule: '{{title}}.md', initialText: text }, bytes(text), now);
    const receipt = (contentHash: string, path = note, conflict: LiveConflict | null = null): SyncReceipt => ({ commit: 'c'.repeat(40), blob: 'd'.repeat(40), contentHash, path, conflict });
    const synced = (contentHash: string) => ({ base: { commit: 'c'.repeat(40), blob: 'd'.repeat(40), contentHash }, syncedHash: contentHash });
    const ticket = (id: string, epoch: number): StoredTicket => ({ repository, id, epoch, document: `${id}.${epoch}`, editor: pat, display: 'Pat' });
    /** Takes the link's lease, which must be free. */
    const leased = async (id: string, now: number) => {
      const token = `lease-${++leases}`;
      expect(await store.lease(id, token, now + LEASE_MS, now)).toBe('leased');
      return token;
    };
    /** Syncs the link at its current sequence and releases it, as a check-in that nobody typed through. */
    const checkIn = async (id: string, now: number) => {
      const token = await leased(id, now);
      const link = (await store.link(id))!;
      expect(await store.leaseRead(id, token, link.seq, hash('f'), now)).toBe(true);
      expect(await store.synced(id, token, receipt(hash('f'), link.path ?? note), now)).toBe('ok');
      return store.release(id, token, { seq: link.seq, contentHash: hash('f') }, now);
    };
    const editorKeys = async (id: string) => (await store.editors(id)).map(editor => editor.key);

    it('passes its own check', async () => {
      await expect(store.check()).resolves.toBeUndefined();
    });

    it('creates one link for concurrent checkouts of a path, and joins the others without reseeding it', async () => {
      const texts = ['# One\n', '# Two\n', '# Three\n'];
      const results = await Promise.all(texts.map((text, n) => checkout(note, text, T0 + n, n + 1)));
      expect(results.map(result => result.outcome).sort()).toEqual(['created', 'joined', 'joined']);
      const created = results.find(result => result.outcome === 'created')!;
      const n = results.indexOf(created);
      expect(created.link).toEqual({ id: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/), repository, notebook, path: note, since: T0 + n, epoch: 1, live: true, base: init(texts[n], n + 1).base, syncedAt: null, syncedHash: null, lastEditAt: null, conflict: null, seq: 0, gen: 0, contentHash: liveContentHash(texts[n]), contentSeq: 0 });
      for (const result of results) expect(result.link).toEqual(created.link);
      const { id } = created.link;
      expect(await store.document(id, 1)).toEqual({ state: bytes(texts[n]), log: [], gen: 0, seq: 0 });
      expect(await store.link(id)).toEqual(created.link);
      expect(await store.links(repository)).toEqual([created.link]);
      expect(await store.repositories()).toEqual([repository]);
      // The same path of another repository is another link.
      const elsewhere = await checkout(note, '# One\n', T0, 1, other);
      expect(elsewhere.outcome).toBe('created');
      expect(elsewhere.link.id).not.toBe(id);
      expect(await store.links(other)).toEqual([elsewhere.link]);
      expect((await store.repositories()).sort()).toEqual([repository, other].sort());
    });

    it('reopens a released link under its id as the next epoch, with the new base and text and nothing of the old epoch', async () => {
      const first = await open(note, '# One\n');
      expect(await store.append(first.id, 1, bytes('typed'), pat, T0 + 10)).toEqual({ seq: 1, length: 1 });
      // Its check-in overwrote a change in Git, and released it.
      const conflict: LiveConflict = { kind: 'overwrote', overwritten: 'e'.repeat(40), commit: 'c'.repeat(40), at: new Date(T0 + 20).toISOString() };
      const token = await leased(first.id, T0 + 20);
      expect(await store.synced(first.id, token, receipt(hash('a'), note, conflict), T0 + 20)).toBe('ok');
      expect(await store.release(first.id, token, { seq: 1, contentHash: hash('a') }, T0 + 21)).toBe('released');
      expect(await store.link(first.id)).toEqual({ ...first, live: false, seq: 1, lastEditAt: T0 + 10, ...synced(hash('a')), syncedAt: T0 + 20, conflict });
      const again = await checkout(note, '# Two\n', T0 + 60_000, 2);
      expect(again.outcome).toBe('reopened');
      expect(again.link).toEqual({ ...first, since: T0 + 60_000, epoch: 2, base: init('# Two\n', 2).base, seq: 1, contentHash: liveContentHash('# Two\n'), contentSeq: 1 });
      expect(await store.document(first.id, 2)).toEqual({ state: bytes('# Two\n'), log: [], gen: 0, seq: 1 });
      expect(await store.document(first.id, 1)).toBeNull();
      expect(await store.editors(first.id)).toEqual([]);
      expect(await store.links(repository)).toEqual([again.link]);
      // The lease of the check-in that released it is gone with that epoch.
      expect(await store.lease(first.id, 'next', T0 + 60_001 + LEASE_MS, T0 + 60_001)).toBe('leased');
      // A second checkout of the reopened path joins it.
      expect(await checkout(note, '# Three\n', T0 + 60_002, 3)).toMatchObject({ outcome: 'joined', link: { id: first.id, epoch: 2 } });
    });

    it('keeps a pending link without a path, with its path rule and the text it was created with', async () => {
      const text = '---\ntitle: Draft\n---\n\nStart here.\n';
      const link = await pending(text);
      expect(link).toEqual({ id: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/), repository, notebook, path: null, pathRule: '{{title}}.md', since: T0, epoch: 1, live: true, base: null, syncedAt: null, syncedHash: null, lastEditAt: null, conflict: null, seq: 0, gen: 0, contentHash: liveContentHash(text), contentSeq: 0 });
      expect(await store.link(link.id)).toEqual(link);
      expect(await store.initialText(link.id)).toBe(text);
      expect(await store.document(link.id, 1)).toEqual({ state: bytes(text), log: [], gen: 0, seq: 0 });
      // Each pending note is its own link, and one created without an initial text has none.
      const second = await store.createPending(repository, { notebook, base: null, contentHash: liveContentHash(''), pathRule: 'meetings/{{date}}.md' }, bytes(''), T0 + 1);
      expect(second.id).not.toBe(link.id);
      expect(await store.initialText(second.id)).toBeNull();
      expect(await store.document(second.id, 1)).toEqual({ state: bytes(''), log: [], gen: 0, seq: 0 });
      const filed = await open(note, '# A\n', T0 + 2);
      expect(await store.initialText(filed.id)).toBeNull();
      expect(await store.links(repository)).toEqual([link, second, filed]);
      expect(await store.link(unknown)).toBeNull();
      expect(await store.initialText(unknown)).toBeNull();
    });

    it('appends the updates of the live epoch in order, numbers them, and records who typed and when', async () => {
      const { id } = await open();
      const binary = new Uint8Array([0, 255, 1, 128, 10, 13, 0]);
      expect(await store.append(id, 1, binary, pat, T0 + 1000)).toEqual({ seq: 1, length: 1 });
      expect(await store.append(id, 1, bytes('two'), sam, T0 + 2000)).toEqual({ seq: 2, length: 2 });
      expect(await store.append(id, 1, bytes('three'), bot, T0 + 2500)).toEqual({ seq: 3, length: 3 });
      expect(await store.append(id, 1, bytes('four'), pat, T0 + 3000)).toEqual({ seq: 4, length: 4 });
      // A merge is attributed to nobody, and is no edit.
      expect(await store.append(id, 1, bytes('merge'), null, T0 + 4000)).toEqual({ seq: 5, length: 5 });
      expect(await store.document(id, 1)).toEqual({ state: bytes('# A\n'), log: [binary, bytes('two'), bytes('three'), bytes('four'), bytes('merge')], gen: 0, seq: 5 });
      expect(await store.link(id)).toMatchObject({ seq: 5, lastEditAt: T0 + 3000, gen: 0, contentHash: liveContentHash('# A\n'), contentSeq: 0 });
      const editors = await store.editors(id);
      expect(editors).toEqual([{ ...pat, firstAt: T0 + 1000, lastAt: T0 + 3000, lastSeq: 4 }, { ...sam, firstAt: T0 + 2000, lastAt: T0 + 2000, lastSeq: 2 }, { ...bot, firstAt: T0 + 2500, lastAt: T0 + 2500, lastSeq: 3 }]);
      expect(editors[2]).not.toHaveProperty('email');
      expect(await store.editors(unknown)).toEqual([]);
    });

    it('numbers concurrent appends one by one and keeps every one', async () => {
      const { id } = await open();
      const results = await Promise.all(Array.from({ length: 25 }, (_, n) => store.append(id, 1, bytes(`update ${n}`), n % 2 ? pat : sam, T0 + n)));
      expect(results.map(result => (result as { seq: number; }).seq).sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, n) => n + 1));
      for (const result of results) expect(result).toEqual({ seq: expect.any(Number), length: (result as { seq: number; }).seq });
      const document = (await store.document(id, 1))!;
      expect(document.seq).toBe(25);
      expect(document.log.map(update => new TextDecoder().decode(update)).sort()).toEqual(Array.from({ length: 25 }, (_, n) => `update ${n}`).sort());
    });

    it('refuses an append to another epoch, to a released link and to an unknown one, and keeps nothing of it', async () => {
      const { id } = await open();
      expect(await store.append(id, 2, bytes('next epoch'), pat, T0 + 1)).toBe('not-live');
      expect(await store.append(unknown, 1, bytes('nowhere'), pat, T0 + 1)).toBe('not-live');
      expect(await store.link(id)).toMatchObject({ seq: 0, lastEditAt: null });
      expect(await store.editors(id)).toEqual([]);
      expect((await store.document(id, 1))!.log).toEqual([]);
      expect(await store.document(id, 2)).toBeNull();
      expect(await store.document(unknown, 1)).toBeNull();
      expect(await checkIn(id, T0 + 10)).toBe('released');
      expect(await store.append(id, 1, bytes('after release'), pat, T0 + 20)).toBe('not-live');
      expect(await store.link(id)).toMatchObject({ live: false, seq: 0, lastEditAt: null });
      expect(await store.editors(id)).toEqual([]);
      // Reopened, the tab of the earlier epoch is still refused and the new epoch takes updates.
      expect((await checkout(note, '# Again\n', T0 + 30, 2)).outcome).toBe('reopened');
      expect(await store.append(id, 1, bytes('old tab'), pat, T0 + 40)).toBe('not-live');
      expect(await store.append(id, 2, bytes('new tab'), sam, T0 + 50)).toEqual({ seq: 1, length: 1 });
      expect((await store.document(id, 2))!.log).toEqual([bytes('new tab')]);
      expect(await editorKeys(id)).toEqual([sam.key]);
    });

    it('compacts exactly the entries read: a stale generation changes nothing, and an update appended after the read stays', async () => {
      const { id } = await open();
      await store.append(id, 1, bytes('a'), pat, T0 + 1);
      await store.append(id, 1, bytes('b'), pat, T0 + 2);
      // Two processes read the document here, at generation 0 with two entries.
      const read = (await store.document(id, 1))!;
      expect(read).toMatchObject({ gen: 0, seq: 2 });
      // An update lands between the read and the first process's compaction.
      await store.append(id, 1, bytes('c'), sam, T0 + 3);
      expect(await store.compact(id, 1, read.gen, read.log.length, bytes('state a b'), hash('1'), read.seq)).toBe(true);
      expect(await store.document(id, 1)).toEqual({ state: bytes('state a b'), log: [bytes('c')], gen: 1, seq: 3 });
      expect(await store.link(id)).toMatchObject({ gen: 1, seq: 3, contentHash: hash('1'), contentSeq: 2 });
      await store.append(id, 1, bytes('d'), sam, T0 + 4);
      // The second process still holds generation 0. Trimming its two entries now would drop c and d, which it never applied.
      const compacted = { state: bytes('state a b'), log: [bytes('c'), bytes('d')], gen: 1, seq: 4 };
      expect(await store.compact(id, 1, read.gen, read.log.length, bytes('stale'), hash('2'), read.seq)).toBe(false);
      expect(await store.compact(id, 2, 1, 2, bytes('another epoch'), hash('2'), 4)).toBe(false);
      expect(await store.compact(id, 1, 1, 3, bytes('more than the log holds'), hash('2'), 4)).toBe(false);
      expect(await store.compact(unknown, 1, 0, 0, bytes('nowhere'), hash('2'), 0)).toBe(false);
      expect(await store.document(id, 1)).toEqual(compacted);
      expect(await store.link(id)).toMatchObject({ gen: 1, seq: 4, contentHash: hash('1'), contentSeq: 2 });
      // Compaction is not an edit: the editors and the sequence stay.
      expect(await editorKeys(id)).toEqual([pat.key, sam.key]);
      expect(await store.compact(id, 1, 1, 2, bytes('state a b c d'), hash('3'), 4)).toBe(true);
      expect(await store.document(id, 1)).toEqual({ state: bytes('state a b c d'), log: [], gen: 2, seq: 4 });
      // With nothing to trim it still replaces the state.
      expect(await store.compact(id, 1, 2, 0, bytes('state again'), hash('4'), 4)).toBe(true);
      expect(await store.document(id, 1)).toEqual({ state: bytes('state again'), log: [], gen: 3, seq: 4 });
      expect(await checkIn(id, T0 + 10)).toBe('released');
      expect(await store.compact(id, 1, 3, 0, bytes('after release'), hash('5'), 4)).toBe(false);
      expect(await store.document(id, 1)).toBeNull();
      expect(await store.link(id)).toMatchObject({ gen: 3, contentHash: hash('4') });
    });

    it('leases a link to one token until the time given, by the clock it is given', async () => {
      const { id } = await open();
      // Without a lease nothing lease-bound passes.
      expect(await store.synced(id, 'nobody', receipt(hash('a')), T0)).toBe('leased');
      expect(await store.lease(id, 'first', T0 + LEASE_MS, T0)).toBe('leased');
      expect(await store.lease(id, 'second', T0 + 1000 + LEASE_MS, T0 + 1000)).toBe('held');
      expect(await store.lease(id, 'first', T0 + 1000 + LEASE_MS, T0 + 1000)).toBe('held');
      expect(await store.lease(id, 'second', T0 + 2 * LEASE_MS, T0 + LEASE_MS - 1)).toBe('held');
      // Only the holder's token passes a lease-bound call.
      expect(await store.leaseRead(id, 'second', 0, hash('a'), T0 + 1000)).toBe(false);
      expect(await store.synced(id, 'second', receipt(hash('a')), T0 + 1000)).toBe('leased');
      expect(await store.release(id, 'second', { seq: 0, contentHash: hash('a') }, T0 + 1000)).toBe('leased');
      expect(await store.discard(id, 'second', { seq: 0 }, T0 + 1000)).toBe('leased');
      expect(await store.link(id)).toMatchObject({ live: true, syncedAt: null, base: init('# A\n').base });
      expect(await store.leaseRead(id, 'first', 0, hash('a'), T0 + 1000)).toBe(true);
      // Run out, the old token holds nothing, and another may lease.
      const later = T0 + LEASE_MS;
      expect(await store.leaseRead(id, 'first', 0, hash('a'), later)).toBe(false);
      expect(await store.synced(id, 'first', receipt(hash('a')), later)).toBe('leased');
      expect(await store.release(id, 'first', { seq: 0, contentHash: hash('a') }, later)).toBe('leased');
      expect(await store.lease(id, 'second', later + LEASE_MS, later)).toBe('leased');
      expect(await store.synced(id, 'first', receipt(hash('a')), later + 1)).toBe('leased');
      expect(await store.link(id)).toMatchObject({ syncedAt: null });
      expect(await store.synced(id, 'second', receipt(hash('a')), later + 1)).toBe('ok');
      expect(await store.lease(unknown, 'second', later + LEASE_MS, later)).toBe('not-live');
      expect(await store.leaseRead(unknown, 'second', 0, hash('a'), later)).toBe(false);
      // A released link has no lease to take or to hold.
      expect(await store.release(id, 'second', { seq: 0, contentHash: hash('a') }, later + 2)).toBe('released');
      expect(await store.lease(id, 'third', later + 3 + LEASE_MS, later + 3)).toBe('not-live');
      expect(await store.leaseRead(id, 'second', 0, hash('a'), later + 3)).toBe(false);
      expect(await store.synced(id, 'second', receipt(hash('b')), later + 3)).toBe('leased');
      expect(await store.release(id, 'second', { seq: 0, contentHash: hash('a') }, later + 3)).toBe('leased');
      expect(await store.link(id)).toMatchObject({ live: false, syncedHash: hash('a') });
    });

    it('tells whether a token holds the lease at a time, and changes nothing by asking', async () => {
      const { id } = await open();
      await store.append(id, 1, bytes('pat 1'), pat, T0);
      expect(await store.leaseHeld(id, 'first', T0)).toBe(false);
      expect(await store.lease(id, 'first', T0 + LEASE_MS, T0)).toBe('leased');
      expect(await store.leaseRead(id, 'first', 1, hash('a'), T0)).toBe(true);
      expect(await store.leaseHeld(id, 'first', T0 + 1)).toBe(true);
      expect(await store.leaseHeld(id, 'second', T0 + 1)).toBe(false);
      expect(await store.leaseHeld(unknown, 'first', T0 + 1)).toBe(false);
      expect(await store.leaseHeld(id, 'first', T0 + LEASE_MS - 1)).toBe(true);
      // Run out, it holds nothing; asked again within its time, it still does.
      expect(await store.leaseHeld(id, 'first', T0 + LEASE_MS)).toBe(false);
      expect(await store.leaseHeld(id, 'first', T0 + 2)).toBe(true);
      expect(await store.lease(id, 'second', T0 + 2 + LEASE_MS, T0 + 2)).toBe('held');
      // What the lease read is kept: its receipt still clears by that sequence.
      expect(await store.synced(id, 'first', receipt(hash('a')), T0 + 3)).toBe('ok');
      expect(await store.editors(id)).toEqual([]);
      expect(await store.release(id, 'first', { seq: 1, contentHash: hash('a') }, T0 + 4)).toBe('released');
      expect(await store.leaseHeld(id, 'first', T0 + 5)).toBe(false);
    });

    it('clears the editors a receipt covers by sequence, twice without harm, and keeps who typed after its read', async () => {
      const { id } = await open();
      await store.append(id, 1, bytes('pat 1'), pat, T0 + 1);
      await store.append(id, 1, bytes('sam 1'), sam, T0 + 2);
      const token = await leased(id, T0 + 2);
      // The check-in reads at sequence 2. The agent then writes in the very millisecond of that read: only a sequence tells them apart.
      expect(await store.leaseRead(id, token, 2, hash('a'), T0 + 2)).toBe(true);
      await store.append(id, 1, bytes('bot 1'), bot, T0 + 2);
      await store.append(id, 1, bytes('pat 2'), pat, T0 + 3);
      expect(await store.synced(id, token, receipt(hash('a')), T0 + 5)).toBe('ok');
      const kept = [{ ...pat, firstAt: T0 + 1, lastAt: T0 + 3, lastSeq: 4 }, { ...bot, firstAt: T0 + 2, lastAt: T0 + 2, lastSeq: 3 }];
      expect(await store.editors(id)).toEqual(kept);
      expect(await store.link(id)).toMatchObject({ ...synced(hash('a')), syncedAt: T0 + 5, conflict: null, seq: 4, live: true });
      expect(await store.synced(id, token, receipt(hash('a')), T0 + 6)).toBe('ok');
      expect(await store.editors(id)).toEqual(kept);
      expect(await store.link(id)).toMatchObject({ ...synced(hash('a')), syncedAt: T0 + 6 });
      // The next check-in reads everything, and its receipt clears everyone.
      expect(await store.leaseRead(id, token, 4, hash('b'), T0 + 7)).toBe(true);
      expect(await store.synced(id, token, receipt(hash('b')), T0 + 8)).toBe('ok');
      expect(await store.editors(id)).toEqual([]);
      expect(await store.link(id)).toMatchObject({ ...synced(hash('b')), syncedAt: T0 + 8 });
    });

    it('cuts at the current sequence for a receipt of the stored text, and clears nobody for a text it cannot place', async () => {
      const { id } = await open(note, '# A\n');
      await store.append(id, 1, bytes('pat 1'), pat, T0 + 1);
      const token = await leased(id, T0 + 2);
      // No read was recorded, and the stored hash is the checkout's, one append behind.
      expect(await store.synced(id, token, receipt(liveContentHash('# A\n')), T0 + 3)).toBe('ok');
      expect(await editorKeys(id)).toEqual([pat.key]);
      // A read of another text does not place the receipt either.
      expect(await store.leaseRead(id, token, 1, hash('b'), T0 + 4)).toBe(true);
      expect(await store.synced(id, token, receipt(hash('c')), T0 + 5)).toBe('ok');
      expect(await editorKeys(id)).toEqual([pat.key]);
      expect(await store.link(id)).toMatchObject({ ...synced(hash('c')), syncedAt: T0 + 5 });
      // Compacted at the current sequence, the stored hash is the current text's: the receipt covers everyone so far.
      expect(await store.compact(id, 1, 0, 1, bytes('state'), hash('c'), 1)).toBe(true);
      await store.append(id, 1, bytes('sam 1'), sam, T0 + 6);
      expect(await store.synced(id, token, receipt(hash('c')), T0 + 7)).toBe('ok');
      expect(await editorKeys(id)).toEqual([pat.key, sam.key]);
      expect(await store.compact(id, 1, 1, 1, bytes('state 2'), hash('d'), 2)).toBe(true);
      expect(await store.synced(id, token, receipt(hash('d')), T0 + 8)).toBe('ok');
      expect(await store.editors(id)).toEqual([]);
    });

    it('records the conflict a receipt names, and drops it with the next receipt', async () => {
      const { id } = await open();
      const token = await leased(id, T0);
      const conflict: LiveConflict = { kind: 'overwrote', overwritten: 'e'.repeat(40), commit: 'c'.repeat(40), at: new Date(T0 + 1).toISOString() };
      expect(await store.synced(id, token, receipt(hash('a'), note, conflict), T0 + 1)).toBe('ok');
      expect((await store.link(id))!.conflict).toEqual(conflict);
      expect((await store.links(repository))[0].conflict).toEqual(conflict);
      expect(await store.synced(id, token, receipt(hash('b')), T0 + 2)).toBe('ok');
      expect((await store.link(id))!.conflict).toBeNull();
    });

    it('files a pending link at the path of its first receipt, once, and joins a checkout of that path', async () => {
      const link = await pending();
      const token = await leased(link.id, T0 + 1);
      expect(await store.synced(link.id, token, receipt(hash('a'), 'notes/life/filed.md'), T0 + 2)).toBe('ok');
      const filed = (await store.link(link.id))!;
      expect(filed).toEqual({ ...link, path: 'notes/life/filed.md', pathRule: undefined, ...synced(hash('a')), syncedAt: T0 + 2 });
      expect(filed).not.toHaveProperty('pathRule');
      expect(await store.initialText(link.id)).toBeNull();
      expect(await store.links(repository)).toEqual([filed]);
      // The same receipt again is harmless; one that names another path is refused whole.
      expect(await store.synced(link.id, token, receipt(hash('a'), 'notes/life/filed.md'), T0 + 3)).toBe('ok');
      expect(await store.synced(link.id, token, receipt(hash('b'), 'notes/life/elsewhere.md'), T0 + 4)).toBe('path-fixed');
      expect(await store.link(link.id)).toEqual({ ...filed, syncedAt: T0 + 3 });
      expect(await checkout('notes/life/filed.md', '# Other\n', T0 + 5)).toMatchObject({ outcome: 'joined', link: { id: link.id, epoch: 1 } });
      expect((await checkout('notes/life/elsewhere.md', '# Other\n', T0 + 6)).outcome).toBe('created');
      // A link checked out at a path keeps it too.
      const fixed = await open(note, '# A\n', T0 + 7);
      const fixedToken = await leased(fixed.id, T0 + 8);
      expect(await store.synced(fixed.id, fixedToken, receipt(hash('a'), 'notes/life/moved.md'), T0 + 9)).toBe('path-fixed');
      expect(await store.link(fixed.id)).toEqual(fixed);
    });

    it('releases only a synced link whose sequence did not move, then deletes its document, log, editors and presence and keeps the link and its path', async () => {
      const link = await open();
      const { id } = link;
      await store.append(id, 1, bytes('pat 1'), pat, T0 + 1);
      await store.presence(id, 'process-1', { [pat.key]: T0 + 1 }, T0 + 1);
      await store.putTicket(hash('1'), ticket(id, 1), T0 + 1 + LIVE_TICKET_MS);
      const token = await leased(id, T0 + 2);
      expect(await store.leaseRead(id, token, 1, hash('a'), T0 + 2)).toBe(true);
      expect(await store.release(id, token, { seq: 1, contentHash: hash('a') }, T0 + 3)).toBe('not-synced');
      expect(await store.synced(id, token, receipt(hash('a')), T0 + 4)).toBe('ok');
      expect(await store.release(id, token, { seq: 1, contentHash: hash('b') }, T0 + 5)).toBe('not-synced');
      // Someone types between the check-in's read and its release.
      await store.append(id, 1, bytes('sam 1'), sam, T0 + 6);
      expect(await store.release(id, token, { seq: 1, contentHash: hash('a') }, T0 + 7)).toBe('changed');
      expect(await store.link(id)).toMatchObject({ live: true, seq: 2 });
      expect((await store.document(id, 1))!.log).toEqual([bytes('pat 1'), bytes('sam 1')]);
      expect(await editorKeys(id)).toEqual([sam.key]);
      expect(await store.activePeople(id, T0, T0 + 7)).toBe(1);
      // The next check-in reads again, and releases.
      expect(await store.leaseRead(id, token, 2, hash('b'), T0 + 8)).toBe(true);
      expect(await store.synced(id, token, receipt(hash('b')), T0 + 9)).toBe('ok');
      expect(await store.release(id, token, { seq: 2, contentHash: hash('b') }, T0 + 10)).toBe('released');
      expect(await store.link(id)).toEqual({ ...link, live: false, seq: 2, lastEditAt: T0 + 6, ...synced(hash('b')), syncedAt: T0 + 9 });
      expect(await store.document(id, 1)).toBeNull();
      expect(await store.editors(id)).toEqual([]);
      expect(await store.activePeople(id, T0, T0 + 10)).toBe(0);
      expect(await store.takeTicket(hash('1'), T0 + 10)).toBeNull();
      expect(await store.links(repository)).toEqual([]);
      expect(await store.repositories()).toEqual([]);
      // Presence written for a released link is not kept.
      await store.presence(id, 'process-1', { [pat.key]: T0 + 11 }, T0 + 11);
      expect(await store.activePeople(id, T0, T0 + 11)).toBe(0);
      // Its path still names it.
      expect(await checkout(note, '# Again\n', T0 + 12, 2)).toMatchObject({ outcome: 'reopened', link: { id, epoch: 2, path: note } });
    });

    it('discards a pending link whose sequence did not move, with everything it had, and never a filed one', async () => {
      const filed = await open();
      const filedToken = await leased(filed.id, T0);
      expect(await store.discard(filed.id, filedToken, { seq: 0 }, T0 + 1)).toBe('not-pending');
      expect(await store.link(filed.id)).toEqual(filed);
      const { id } = await pending('# Draft\n', T0 + 1);
      await store.append(id, 1, bytes('pat 1'), pat, T0 + 2);
      await store.presence(id, 'process-1', { [pat.key]: T0 + 2 }, T0 + 2);
      await store.putTicket(hash('1'), ticket(id, 1), T0 + 2 + LIVE_TICKET_MS);
      await store.putTicket(hash('2'), ticket(filed.id, 1), T0 + 2 + LIVE_TICKET_MS);
      const token = await leased(id, T0 + 3);
      // Someone typed since the caller read it.
      expect(await store.discard(id, token, { seq: 0 }, T0 + 4)).toBe('changed');
      expect(await store.link(id)).toMatchObject({ live: true, path: null, seq: 1 });
      expect(await store.initialText(id)).toBe('# Draft\n');
      expect((await store.document(id, 1))!.log).toEqual([bytes('pat 1')]);
      expect(await store.discard(id, token, { seq: 1 }, T0 + 5)).toBe('discarded');
      expect(await store.link(id)).toBeNull();
      expect(await store.document(id, 1)).toBeNull();
      expect(await store.editors(id)).toEqual([]);
      expect(await store.initialText(id)).toBeNull();
      expect(await store.activePeople(id, T0, T0 + 5)).toBe(0);
      expect(await store.takeTicket(hash('1'), T0 + 5)).toBeNull();
      expect(await store.discard(id, token, { seq: 1 }, T0 + 6)).toBe('leased');
      expect(await store.lease(id, 'again', T0 + 6 + LEASE_MS, T0 + 6)).toBe('not-live');
      expect(await store.append(id, 1, bytes('late'), pat, T0 + 6)).toBe('not-live');
      // The other link keeps what is its own.
      expect(await store.links(repository)).toEqual([filed]);
      expect(await store.takeTicket(hash('2'), T0 + 6)).toEqual(ticket(filed.id, 1));
      // A repository whose only link was discarded has no live link left.
      const lone = await pending('# Lone\n', T0 + 7, other);
      expect(await store.repositories()).toContain(other);
      expect(await store.discard(lone.id, await leased(lone.id, T0 + 8), { seq: 0 }, T0 + 9)).toBe('discarded');
      expect(await store.repositories()).toEqual([repository]);
      expect(await store.links(other)).toEqual([]);
    });

    it('sets the path rule of a pending link under its lease and ends the lease, retargeted or refused for a filed link', async () => {
      const link = await pending('# Draft\n');
      await store.append(link.id, 1, bytes('pat 1'), pat, T0 + 1);
      await store.presence(link.id, 'process-1', { [pat.key]: T0 + 1 }, T0 + 1);
      const token = await leased(link.id, T0 + 2);
      // Another token changes nothing, and the holder keeps the lease.
      expect(await store.retarget(link.id, 'other', 'moved/{{title}}.md', T0 + 3)).toBe('leased');
      expect(await store.link(link.id)).toMatchObject({ path: null, pathRule: '{{title}}.md' });
      expect(await store.leaseHeld(link.id, token, T0 + 3)).toBe(true);
      expect(await store.retarget(link.id, token, 'moved/{{date}} {{title}}.md', T0 + 4)).toBe('retargeted');
      // Only the rule changed: the text, who typed, who is there and the text it began with stay.
      expect(await store.link(link.id)).toEqual({ ...link, pathRule: 'moved/{{date}} {{title}}.md', seq: 1, lastEditAt: T0 + 1 });
      expect((await store.links(repository)).map(entry => entry.pathRule)).toEqual(['moved/{{date}} {{title}}.md']);
      expect((await store.document(link.id, 1))!.log).toEqual([bytes('pat 1')]);
      expect(await editorKeys(link.id)).toEqual([pat.key]);
      expect(await store.initialText(link.id)).toBe('# Draft\n');
      expect(await store.activePeople(link.id, T0, T0 + 4)).toBe(1);
      // The lease ended with the call, so a check-in can take the link at once.
      expect(await store.leaseHeld(link.id, token, T0 + 4)).toBe(false);
      expect(await store.retarget(link.id, token, 'again/{{title}}.md', T0 + 5)).toBe('leased');
      const next = await leased(link.id, T0 + 5);
      // A lease that ran out retargets nothing.
      expect(await store.retarget(link.id, next, 'late/{{title}}.md', T0 + 5 + LEASE_MS)).toBe('leased');
      expect(await store.link(link.id)).toMatchObject({ pathRule: 'moved/{{date}} {{title}}.md' });
      // Filed, the link keeps its path: the retarget is refused, and its lease ends all the same.
      const filing = await leased(link.id, T0 + 6 + LEASE_MS);
      expect(await store.synced(link.id, filing, receipt(hash('a'), 'notes/life/moved/draft.md'), T0 + 7 + LEASE_MS)).toBe('ok');
      const filed = (await store.link(link.id))!;
      expect(await store.retarget(link.id, filing, 'elsewhere/{{title}}.md', T0 + 8 + LEASE_MS)).toBe('not-pending');
      expect(await store.link(link.id)).toEqual(filed);
      expect(filed).not.toHaveProperty('pathRule');
      expect(await store.leaseHeld(link.id, filing, T0 + 8 + LEASE_MS)).toBe(false);
      expect(await store.lease(link.id, 'after', T0 + 9 + 2 * LEASE_MS, T0 + 9 + LEASE_MS)).toBe('leased');
      // No link, or a released one, has no lease to retarget under.
      expect(await store.retarget(unknown, 'after', 'nowhere/{{title}}.md', T0)).toBe('leased');
      expect(await store.release(link.id, 'after', { seq: 1, contentHash: hash('a') }, T0 + 10 + LEASE_MS)).toBe('released');
      expect(await store.retarget(link.id, 'after', 'released/{{title}}.md', T0 + 11 + LEASE_MS)).toBe('leased');
    });

    it('gives a ticket out once, and never after it ran out', async () => {
      const { id } = await open();
      const issued = ticket(id, 1), agent: StoredTicket = { ...issued, editor: bot, display: 'Robo' };
      await store.putTicket(hash('1'), issued, T0 + LIVE_TICKET_MS);
      await store.putTicket(hash('2'), agent, T0 + LIVE_TICKET_MS);
      await store.putTicket(hash('3'), issued, T0 + LIVE_TICKET_MS);
      expect(await store.takeTicket(hash('9'), T0 + 1)).toBeNull();
      expect(await store.takeTicket(hash('1'), T0 + 1)).toEqual(issued);
      expect(await store.takeTicket(hash('1'), T0 + 2)).toBeNull();
      expect(await store.takeTicket(hash('2'), T0 + LIVE_TICKET_MS - 1)).toEqual(agent);
      // At its last instant it is run out, and asking spent it.
      expect(await store.takeTicket(hash('3'), T0 + LIVE_TICKET_MS)).toBeNull();
      expect(await store.takeTicket(hash('3'), T0 + 3)).toBeNull();
      // Two sockets with one ticket: one gets in.
      await store.putTicket(hash('4'), issued, T0 + LIVE_TICKET_MS);
      const taken = await Promise.all([store.takeTicket(hash('4'), T0 + 4), store.takeTicket(hash('4'), T0 + 4)]);
      expect(taken.filter(Boolean)).toEqual([issued]);
    });

    it('counts the distinct people of every process active within the window, and forgets a process that stopped writing', async () => {
      const { id } = await open();
      const now = T0 + IDLE_MS;
      await store.presence(id, 'process-1', { [pat.key]: now - 1000, [sam.key]: now - IDLE_MS - 1 }, now);
      await store.presence(id, 'process-2', { [pat.key]: now - 5, [kim]: now - 10 }, now);
      // Pat is on both processes and counts once; Sam has been idle a millisecond too long.
      expect(await store.activePeople(id, now - IDLE_MS, now)).toBe(2);
      expect(await store.activePeople(id, now - IDLE_MS - 1, now)).toBe(3);
      // A process replaces its own entry, and leaves the other's alone.
      await store.presence(id, 'process-2', { [kim]: now + 1000 }, now + 1000);
      expect(await store.activePeople(id, now + 1000 - IDLE_MS, now + 1000)).toBe(2);
      expect(await store.activePeople(id, now + 500, now + 1000)).toBe(1);
      await store.presence(id, 'process-2', {}, now + 2000);
      expect(await store.activePeople(id, now + 2000 - IDLE_MS, now + 2000)).toBe(1);
      // Process 1 crashed after its write at `now`: its entry counts until it is LIVE_PRESENCE_MS old, and no longer.
      expect(await store.activePeople(id, now - IDLE_MS, now + LIVE_PRESENCE_MS - 1)).toBe(1);
      expect(await store.activePeople(id, now - IDLE_MS, now + LIVE_PRESENCE_MS)).toBe(0);
      expect(await store.activePeople(unknown, T0, now)).toBe(0);
    });
  });
}
