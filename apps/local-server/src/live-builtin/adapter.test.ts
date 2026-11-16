import { createHash } from 'node:crypto';
import { LIVE_MAX_BYTES, type LiveContext, liveEditorOf, LiveLeasedError, LiveNotLiveError, liveSocketTicketOf, LiveStaleError, LiveTooLargeError, LiveUnavailableError, validateLiveEditorInfo } from '@mygitnotes/core';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { liveNotesContract } from '../live-notes-contract.js';
import { liveEditorRef } from './adapter.js';
import { builtinLiveNotes } from './index.js';
import { memoryLiveStore } from './memory-store.js';
import type { LiveStore } from './store.js';
import { type BuiltinFixture, builtinFixture, gate, notebook, person, hugeDeletedUpdate, redisTestStores, repository, settle, sha256, shutdownFixtures, storedText, wrapStore } from './test-fixture.js';

/*
 * The built-in live editor's adapter and documents (docs/specs/2026-11-15-builtin-live-editor §2, §4, §5, §19, §20;
 * slice N3). The live-notes kit runs over it with the memory store always, and with a real Redis when
 * MYGITNOTES_TEST_REDIS_URL names a throwaway one. A person's typing goes the way a socket's update will (N4): into the
 * store first, then into the document.
 */

const url = process.env.MYGITNOTES_TEST_REDIS_URL;
const T0 = Date.parse('2026-11-15T00:00:00.000Z');
const iso = (time: number) => new Date(time).toISOString();
const elsewhere = 'edition:hosted:someone/else@main';
const note = 'notes/life/a.md';
/** No link has this id. */
const unknown = 'A'.repeat(22);
const base = (content: string, n = 1) => ({ commit: String(n % 10).repeat(40), blob: 'b'.repeat(39) + String(n % 10), content });
const editorOf = (n: number) => ({ key: `person:p${n}@example.test`, name: `Person ${n}`, email: `p${n}@example.test`, agent: false, person: { realm: 'edition', userId: `p${n}` } });
/** The n-th person as a detail lists them, having typed only at the fixture's first instant. */
const listed = (n: number) => ({ name: `Person ${n}`, email: `p${n}@example.test`, agent: false, firstAt: iso(T0), lastAt: iso(T0), person: { realm: 'edition', userId: `p${n}` } });
const ticketHash = (ticket: string) => createHash('sha256').update(ticket, 'utf8').digest('hex');

const checkout = async (f: BuiltinFixture, content = '# A\n', path = note, n = 1) => (await f.liveNotes.person(person(n)).checkout(repository, { notebook, path, base: base(content) })).checkout;
const draft = (f: BuiltinFixture, content = '# Draft\n', pathRule = '{{title}}.md') => f.liveNotes.person(person(1)).createPending(repository, { notebook, pathRule, content });
const read = (f: BuiltinFixture, id: string, n = 1) => f.liveNotes.person(person(n)).read(repository, id);
/** An agent of the third person writes the whole text on a revision it read. */
const write = (f: BuiltinFixture, id: string, content: string, baseRevision: string) => f.liveNotes.person(person(3)).write(repository, id, { content, baseRevision, agent: true });
const type = (f: BuiltinFixture, id: string, text: string, n = 1) => f.liveNotes.type(repository, id, text, person(n));
const row = async (f: BuiltinFixture, id: string) => (await f.liveNotes.service.checkouts(repository)).find(entry => entry.id === id);
const receipt = (contentHash: string, path: string) => ({ commit: 'c'.repeat(40), blob: 'd'.repeat(40), contentHash, path, conflict: null });
/** Syncs the note at its current text and releases it, as a check-in that found nothing to commit. */
const checkIn = async (f: BuiltinFixture, id: string, path?: string) => {
  const { service } = f.liveNotes;
  const lease = await service.lease(repository, id);
  const detail = await service.detail(repository, id, lease);
  await service.synced(repository, id, lease, receipt(detail.contentHash, path ?? detail.checkout.path!));
  return { lease, detail, release: await service.release(repository, id, lease, { contentHash: detail.contentHash }) };
};

afterEach(async () => {
  await shutdownFixtures();
  vi.restoreAllMocks();
});

const kit = (store: () => LiveStore) => () => {
  const { time, liveNotes } = builtinFixture({ store: store() });
  return { ownCredentials: true, merges: true, liveNotes, repository, notebook, root: 'notes/life', person, type: (id: string, text: string, who: LiveContext) => liveNotes.type(repository, id, text, who), setActive: (id: string, n: number) => liveNotes.setActive(repository, id, n), advance: (ms: number) => time.advance(ms) };
};

liveNotesContract('builtin (memory store)', kit(() => memoryLiveStore()));

describe('the built-in live notes', () => {
  it('records an editor under a name of at most 256 UTF-16 units, so the check-in engine never drops one', () => {
    const context = (name: string): LiveContext => ({ person: { realm: 'edition', userId: 'p9' }, author: { name, email: 'p9@example.test' }, request: { headers: {} } });
    expect(liveEditorRef(context('n'.repeat(300)), false)).toMatchObject({ name: 'n'.repeat(256), key: 'person:p9@example.test' });
    // A cut never splits a surrogate pair.
    const emoji = liveEditorRef(context(`${'n'.repeat(255)}😀😀`), false).name;
    expect(emoji).toBe('n'.repeat(255));
    expect(liveEditorRef(context('Pat'), true).name).toBe('Pat');
  });

  it('declares one built-in editor for the repositories it covers, with discard, retarget and socket tickets', async () => {
    const { liveNotes } = builtinFixture();
    expect(liveNotes.editors).toEqual([{ kind: 'builtin' }]);
    expect(validateLiveEditorInfo(liveNotes.editors[0])).toEqual({ kind: 'builtin' });
    expect(liveNotes.editor(repository)).toEqual({ kind: 'builtin' });
    expect(liveNotes.editor(elsewhere)).toBeNull();
    expect(liveEditorOf(liveNotes, repository)).toBe(liveNotes.editors[0]);
    expect([typeof liveNotes.service.discard, typeof liveNotes.service.retarget, typeof liveNotes.socketTicket, typeof liveNotes.notify]).toEqual(['function', 'function', 'function', 'function']);
    await expect(liveNotes.started).resolves.toBeUndefined();
    expect(await liveNotes.service.repositories()).toEqual([]);
    expect(await liveNotes.service.checkouts(repository)).toEqual([]);
    await expect(liveNotes.person(person(1)).checkouts(elsewhere)).rejects.toBeInstanceOf(LiveUnavailableError);
    await expect(liveNotes.person(person(1)).checkout(elsewhere, { notebook, path: note, base: base('# A\n') })).rejects.toBeInstanceOf(LiveUnavailableError);
  });

  it('is what the public factory builds, and hands notices to notify only when given one', async () => {
    const f = builtinFixture();
    await f.liveNotes.notify!({ kind: 'unfiled', repository, notebook, path: null, id: unknown, editors: [], message: 'Missing a title.' });
    expect(f.notices).toEqual([{ kind: 'unfiled', repository, notebook, path: null, id: unknown, editors: [], message: 'Missing a title.' }]);
    const plain = builtinLiveNotes({ covers: id => id === repository, open: async () => (await f.liveNotes.service.open(repository)), store: memoryLiveStore() });
    expect(plain.editors).toEqual([{ kind: 'builtin' }]);
    expect(plain.notify).toBeUndefined();
    expect(plain).not.toHaveProperty('type');
    // It opens the repository with the deployment's credential, as the edition gave it.
    expect((await plain.service.open(repository)).id).toBe(repository);
    await plain.shutdown();
  });

  it('holds every call until its store passed the start-up check', async () => {
    const inner = memoryLiveStore();
    const checked = gate();
    const calls: string[] = [];
    const f = builtinFixture({ store: wrapStore(inner, { check: () => checked.opened, checkout: (...args) => (calls.push('checkout'), inner.checkout(...args)), links: (...args) => (calls.push('links'), inner.links(...args)) }) });
    const opening = checkout(f), listing = f.liveNotes.service.checkouts(repository);
    await settle();
    expect(calls).toEqual([]);
    checked.open();
    await expect(f.liveNotes.started).resolves.toBeUndefined();
    expect((await opening).path).toBe(note);
    await listing;
    expect(calls.sort()).toEqual(['checkout', 'links']);
  });

  it('refuses every call when its store fails the start-up check, and says why through started', async () => {
    const refusal = 'Redis may evict any key (maxmemory-policy allkeys-lru); the built-in live editor would lose typing. Use noeviction or a volatile-* policy.';
    const f = builtinFixture({ store: wrapStore(memoryLiveStore(), { check: async () => Promise.reject(new Error(refusal)) }) });
    await expect(f.liveNotes.started).rejects.toThrow(refusal);
    await expect(checkout(f)).rejects.toBeInstanceOf(LiveUnavailableError);
    await expect(f.liveNotes.service.repositories()).rejects.toBeInstanceOf(LiveUnavailableError);
    await expect(f.liveNotes.service.lease(repository, unknown)).rejects.toBeInstanceOf(LiveUnavailableError);
    await expect(f.liveNotes.socketTicket(person(1), repository, unknown)).rejects.toBeInstanceOf(LiveUnavailableError);
    await expect(f.liveNotes.type(repository, unknown, 'x', person(1))).rejects.toBeInstanceOf(LiveUnavailableError);
  });
});

describe('seeding', () => {
  it('seeds the store in the call that checks a note out or creates one, in normal form, and never again', async () => {
    const f = builtinFixture();
    const text = '---\ntitle: 中文 😀\n---\n\n  indented\ttab  \nno newline at the end';
    const made = await checkout(f, text);
    expect(made).toEqual({ id: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/), notebook, path: note, since: iso(T0), contentHash: sha256(text), activeEditors: 0, lastEditAt: null, syncedAt: null, base: { commit: base('').commit, blob: base('').blob, contentHash: sha256(text) }, conflict: null });
    expect(await f.store.link(made.id)).toMatchObject({ epoch: 1, seq: 0, gen: 0, contentHash: sha256(text), contentSeq: 0, lastEditAt: null });
    const stored = (await f.store.document(made.id, 1))!;
    expect(stored).toMatchObject({ log: [], gen: 0, seq: 0 });
    expect(storedText(stored)).toBe(text);
    // A second checkout joins the live note: its own base text seeds nothing.
    const joined = await f.liveNotes.person(person(2)).checkout(repository, { notebook, path: note, base: base('# Other\n', 2) });
    expect(joined).toEqual({ outcome: 'joined', checkout: made });
    // Reading, listing and an unchanged write load the document from the store, and none of them writes one back.
    const live = await read(f, made.id);
    expect(live).toEqual({ content: text, liveRevision: `t:${sha256(text)}`, contentHash: sha256(text) });
    expect(await write(f, made.id, text, live.liveRevision)).toEqual({ changed: false, liveRevision: live.liveRevision });
    await f.liveNotes.setActive(repository, made.id, 0);
    expect(await f.store.document(made.id, 1)).toEqual(stored);
    // Every \r and NUL is gone before the text is seeded.
    const windows = await checkout(f, 'one\r\ntwo\0\r\n', 'notes/life/crlf.md');
    expect(windows.contentHash).toBe(sha256('one\ntwo\n'));
    expect(storedText(await f.store.document(windows.id, 1))).toBe('one\ntwo\n');
    const pending = await draft(f, '---\r\ntitle: Draft\r\n---\r\n');
    expect(storedText(await f.store.document(pending.id, 1))).toBe('---\ntitle: Draft\n---\n');
    expect(await f.store.initialText(pending.id)).toBe('---\ntitle: Draft\n---\n');
    expect((await f.store.link(pending.id))!.seq).toBe(0);
  });

  it('refuses a live note whose stored state is missing, names it in the log as lost, and never reseeds it', async () => {
    const inner = memoryLiveStore();
    let lost = false;
    const f = builtinFixture({ store: wrapStore(inner, { document: async (id, epoch) => lost ? null : inner.document(id, epoch) }) });
    const made = await checkout(f, '# Kept secret\n');
    lost = true;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(read(f, made.id)).rejects.toBeInstanceOf(LiveUnavailableError);
    await expect(write(f, made.id, '# Rewritten\n', `t:${sha256('# Kept secret\n')}`)).rejects.toBeInstanceOf(LiveUnavailableError);
    await expect(f.liveNotes.person(person(1)).append(repository, made.id, { text: 'more\n', agent: false })).rejects.toBeInstanceOf(LiveUnavailableError);
    await expect(type(f, made.id, '# Typed\n')).rejects.toBeInstanceOf(LiveUnavailableError);
    const logged = error.mock.calls.flat().map(String).join('\n');
    expect(logged).toContain(made.id);
    expect(logged).not.toContain('Kept secret');
    // A join does not seed it either, and the link stays as it was: the store still holds what it held.
    expect((await f.liveNotes.person(person(2)).checkout(repository, { notebook, path: note, base: base('# Reseed\n', 2) })).outcome).toBe('joined');
    expect(await inner.link(made.id)).toMatchObject({ live: true, epoch: 1, seq: 0, gen: 0, contentHash: sha256('# Kept secret\n') });
    expect(storedText(await inner.document(made.id, 1))).toBe('# Kept secret\n');
  });
});

describe('durable before acknowledged', () => {
  it('keeps typing out of the document until the store has it, and out for good when the store refuses it', async () => {
    const inner = memoryLiveStore();
    let before: (() => Promise<void>) | undefined;
    const f = builtinFixture({ store: wrapStore(inner, { append: async (...args) => (await before?.(), inner.append(...args)) }) });
    const made = await checkout(f, 'one\n');
    await type(f, made.id, 'one\ntwo\n', 1);
    // The store is slow to take the next update: nobody is shown it, or told it is saved, before the store has it.
    const slow = gate();
    before = () => slow.opened;
    let saved = false;
    const typing = type(f, made.id, 'one\ntwo\nthree\n', 2).then(() => void (saved = true));
    await settle();
    expect(saved).toBe(false);
    expect((await read(f, made.id)).content).toBe('one\ntwo\n');
    expect((await inner.link(made.id))!.seq).toBe(1);
    before = undefined;
    slow.open();
    await typing;
    expect((await read(f, made.id)).content).toBe('one\ntwo\nthree\n');
    expect((await inner.link(made.id))!.seq).toBe(2);
    // The store refuses: typing and server writes fail, and the document keeps the text the store holds.
    before = async () => Promise.reject(new LiveUnavailableError());
    await expect(type(f, made.id, 'one\ntwo\nthree\nlost\n', 1)).rejects.toBeInstanceOf(LiveUnavailableError);
    const text = await read(f, made.id);
    await expect(write(f, made.id, 'rewritten\n', text.liveRevision)).rejects.toBeInstanceOf(LiveUnavailableError);
    await expect(f.liveNotes.person(person(1)).append(repository, made.id, { text: 'lost too\n', agent: false })).rejects.toBeInstanceOf(LiveUnavailableError);
    before = undefined;
    expect((await read(f, made.id)).content).toBe('one\ntwo\nthree\n');
    // Compacted and let go, the refused text does not come back: the store never had it, and nobody is named for it.
    await f.liveNotes.setActive(repository, made.id, 0);
    expect(storedText(await inner.document(made.id, 1))).toBe('one\ntwo\nthree\n');
    expect((await read(f, made.id)).content).toBe('one\ntwo\nthree\n');
    expect(await inner.link(made.id)).toMatchObject({ seq: 2 });
    expect((await inner.editors(made.id)).map(editor => editor.key)).toEqual([editorOf(1).key, editorOf(2).key]);
  });

  it('appends an update once: what a reconnecting tab resends, the document already holds', async () => {
    const f = builtinFixture();
    const made = await checkout(f, 'one\n');
    const link = (await f.store.link(made.id))!;
    const held = await f.documents.open(link);
    // A tab that holds the document types.
    const tab = new Y.Doc();
    Y.applyUpdate(tab, Y.encodeStateAsUpdate(held.document));
    const updates: Uint8Array[] = [];
    tab.on('update', (update: Uint8Array) => void updates.push(update));
    tab.getText('content').insert(4, 'two\n');
    await f.documents.accept(link, updates[0], editorOf(1));
    expect(held.document.getText('content').toString()).toBe('one\ntwo\n');
    // Its socket drops before the acknowledgement: it sends the update again, and then everything it has, as another person's tab might.
    await f.documents.accept(link, updates[0], editorOf(1));
    await f.documents.accept(link, Y.encodeStateAsUpdate(tab), editorOf(2));
    await held.close();
    expect(await f.store.link(made.id)).toMatchObject({ seq: 1, lastEditAt: T0 });
    expect((await f.store.document(made.id, 1))!.log).toHaveLength(1);
    expect((await f.store.editors(made.id)).map(editor => editor.key)).toEqual([editorOf(1).key]);
    expect((await read(f, made.id)).content).toBe('one\ntwo\n');
  });

  it('refuses typing in a released note and in a document it does not hold, and stores none of it', async () => {
    const f = builtinFixture();
    const made = await checkout(f, 'one\n');
    const link = (await f.store.link(made.id))!;
    await expect(f.documents.accept(link, new Uint8Array([0, 0]), editorOf(1))).rejects.toBeInstanceOf(LiveNotLiveError);
    expect((await checkIn(f, made.id)).release).toEqual({ released: true });
    await expect(type(f, made.id, 'one\nlate\n')).rejects.toBeInstanceOf(LiveNotLiveError);
    await expect(f.liveNotes.setActive(repository, made.id, 1)).rejects.toBeInstanceOf(LiveNotLiveError);
    expect(await f.store.link(made.id)).toMatchObject({ live: false, seq: 0, lastEditAt: null });
    expect(await f.store.editors(made.id)).toEqual([]);
  });
});

/*
 * cf16-F001: typing a tab kept after its note was released is merged on what the ended document held, so what of it the
 * server already stored (an update whose acknowledgement never came back) lands once.
 */
describe('merging typing a tab kept', () => {
  /** A tab holds the note's document, types `stored`, which the server takes without the tab hearing so, then types `kept` offline. */
  const tabTyping = async (f: BuiltinFixture, id: string, stored: string, kept: string) => {
    const link = (await f.store.link(id))!;
    const held = await f.documents.open(link);
    const tab = new Y.Doc();
    Y.applyUpdate(tab, Y.encodeStateAsUpdate(held.document));
    const updates: Uint8Array[] = [];
    tab.on('update', (update: Uint8Array) => void updates.push(update));
    const text = tab.getText('content');
    text.insert(text.length, stored);
    await f.documents.accept(link, updates[0], editorOf(1));
    await held.close();
    text.insert(text.length, kept);
    return { document: `${id}.${link.epoch}`, update: Y.encodeStateAsUpdate(tab), text: text.toString() };
  };
  const merge = (f: BuiltinFixture, id: string, request: { base: string; text: string; mergeId: string; typedIn?: { document: string; update: Uint8Array; }; }) => f.liveNotes.person(person(1)).merge!(repository, id, request);

  it('takes what the server stored of it once, whatever base the tab names, the empty one included', async () => {
    for (const tabBase of ['# A\n', '']) {
      const f = builtinFixture();
      const made = await checkout(f, '# A\n');
      const tab = await tabTyping(f, made.id, 'stored ', 'and kept\n');
      expect((await checkIn(f, made.id)).release).toEqual({ released: true });
      await checkout(f, '# A\nstored ', note, 2);
      await type(f, made.id, 'Z\n# A\nstored ', 2);
      expect(await merge(f, made.id, { base: tabBase, text: tab.text, mergeId: `kept-${tabBase.length}-merge`, typedIn: { document: tab.document, update: tab.update } })).toMatchObject({ applied: true });
      expect((await read(f, made.id)).content).toBe('Z\n# A\nstored and kept\n');
    }
  });

  it('takes a repeat of the same kept typing once, under a new merge id too', async () => {
    const f = builtinFixture();
    const made = await checkout(f, '# A\n');
    const tab = await tabTyping(f, made.id, 'stored ', 'and kept\n');
    await checkIn(f, made.id);
    await checkout(f, '# A\nstored ', note, 2);
    const typedIn = { document: tab.document, update: tab.update };
    await merge(f, made.id, { base: '# A\n', text: tab.text, mergeId: 'kept-merge-one', typedIn });
    await merge(f, made.id, { base: '# A\n', text: tab.text, mergeId: 'kept-merge-two', typedIn });
    expect((await read(f, made.id)).content).toBe('# A\nstored and kept\n');
  });

  /** A tab that forked the note's document, so what the server takes after this never reaches it. */
  const forkedTab = async (f: BuiltinFixture, id: string) => {
    const link = (await f.store.link(id))!;
    const held = await f.documents.open(link);
    const tab = new Y.Doc();
    Y.applyUpdate(tab, Y.encodeStateAsUpdate(held.document));
    await held.close();
    const text = tab.getText('content');
    const kept = () => ({ document: `${id}.${link.epoch}`, update: Y.encodeStateAsUpdate(tab), text: text.toString() });
    return { text, kept };
  };
  const replace = (text: Y.Text, from: string, to: string) => {
    const at = text.toString().indexOf(from);
    text.delete(at, from.length);
    text.insert(at, to);
  };

  // Spec A3.1 and S6 (c): two people who replaced the same line, one of them cut off, conflict; Yjs would string both together.
  it('conflicts where someone else replaced the line the tab replaced while it was cut off', async () => {
    const f = builtinFixture();
    const made = await checkout(f, '# A\nThe plan.\n');
    const tab = await forkedTab(f, made.id), other = await forkedTab(f, made.id);
    const link = (await f.store.link(made.id))!;
    const updates: Uint8Array[] = [];
    other.text.doc!.on('update', (update: Uint8Array) => void updates.push(update));
    replace(other.text, 'The plan.', 'Their plan.');
    for (const update of updates) await f.documents.accept(link, update, editorOf(2));
    replace(tab.text, 'The plan.', 'My plan.');
    await checkIn(f, made.id);
    await checkout(f, '# A\nTheir plan.\n', note, 2);
    const kept = tab.kept();
    expect(await merge(f, made.id, { base: '# A\nThe plan.\n', text: kept.text, mergeId: 'kept-merge-same-line', typedIn: { document: kept.document, update: kept.update } })).toEqual({ conflict: true });
    expect((await read(f, made.id)).content).toBe('# A\nTheir plan.\n');
  });

  it('merges typing kept apart from what someone else changed meanwhile, what the server stored of it once', async () => {
    const f = builtinFixture();
    const made = await checkout(f, '# A\nOne.\n\nTwo.\n');
    const tab = await forkedTab(f, made.id);
    const link = (await f.store.link(made.id))!;
    const updates: Uint8Array[] = [];
    tab.text.doc!.on('update', (update: Uint8Array) => void updates.push(update));
    tab.text.insert(tab.text.toString().indexOf('Two.') + 4, ' stored');
    await f.documents.accept(link, updates[0], editorOf(1));
    await type(f, made.id, '# A\nOne, theirs.\n\nTwo. stored\n', 2);
    tab.text.insert(tab.text.toString().indexOf('stored') + 6, ' and kept');
    await checkIn(f, made.id);
    await checkout(f, '# A\nOne, theirs.\n\nTwo. stored\n', note, 2);
    const kept = tab.kept();
    for (const mergeId of ['kept-merge-apart', 'kept-merge-apart-again']) expect(await merge(f, made.id, { base: '# A\nOne.\n\nTwo.\n', text: kept.text, mergeId, typedIn: { document: kept.document, update: kept.update } })).toMatchObject({ applied: true });
    expect((await read(f, made.id)).content).toBe('# A\nOne, theirs.\n\nTwo. stored and kept\n');
  });

  it('conflicts rather than doubling text once it no longer knows the ended document', async () => {
    const f = builtinFixture();
    const made = await checkout(f, '# A\n');
    const tab = await tabTyping(f, made.id, 'stored ', 'and kept\n');
    await checkIn(f, made.id);
    f.time.advance(24 * 60 * 60_000 + 1);
    await checkout(f, '# A\nstored ', note, 2);
    expect(await merge(f, made.id, { base: '# A\n', text: tab.text, mergeId: 'kept-merge-late', typedIn: { document: tab.document, update: tab.update } })).toEqual({ conflict: true });
    expect((await read(f, made.id)).content).toBe('# A\nstored ');
  });

  // cfx-F001: a deleted run is stored as its length alone, so a few bytes can name any length; walking it unit by unit would hold the process.
  it('refuses with 400, at once, kept typing whose update claims a deleted run past any live text', async () => {
    const f = builtinFixture();
    const made = await checkout(f, '# A\n');
    const tab = await tabTyping(f, made.id, 'stored ', 'kept\n');
    await checkIn(f, made.id);
    await checkout(f, '# A\nstored ', note, 2);
    const update = hugeDeletedUpdate(3e8);
    expect(update.byteLength).toBeLessThan(64);
    const started = Date.now();
    await expect(merge(f, made.id, { base: '# A\n', text: 'x', mergeId: 'kept-merge-huge', typedIn: { document: tab.document, update } })).rejects.toMatchObject({ status: 400 });
    expect(Date.now() - started).toBeLessThan(250);
    expect((await read(f, made.id)).content).toBe('# A\nstored ');
  });

  it('refuses with 400, at once, kept typing of an epoch whose ended document claims a deleted run past any live text', async () => {
    const f = builtinFixture();
    const made = await checkout(f, '# A\n');
    // Planted straight in the store, as a process from before the bound might have; an honest tab then holds it too.
    await f.store.append(made.id, 1, hugeDeletedUpdate(3e8), editorOf(2), f.time.now());
    const tab = await forkedTab(f, made.id);
    tab.text.insert(tab.text.length, 'kept\n');
    await checkIn(f, made.id);
    await checkout(f, '# A\n', note, 2);
    const kept = tab.kept();
    const started = Date.now();
    await expect(merge(f, made.id, { base: '# A\n', text: kept.text, mergeId: 'kept-merge-planted', typedIn: { document: kept.document, update: kept.update } })).rejects.toMatchObject({ status: 400 });
    expect(Date.now() - started).toBeLessThan(250);
  });
});

describe('compaction', () => {
  it("compacts what it read once everyone left: the state holds the text, the log is empty and the stored hash is the text's", async () => {
    const f = builtinFixture();
    const made = await checkout(f, 'one\n');
    await type(f, made.id, 'one\ntwo\n', 1);
    const text = await read(f, made.id);
    await write(f, made.id, 'one\ntwo\nthree\n', text.liveRevision);
    const full = 'one\ntwo\nthree\n';
    // While this process holds the document its row follows the text; the store's hash waits for the compaction.
    expect((await row(f, made.id))!.contentHash).toBe(sha256(full));
    expect(await f.store.link(made.id)).toMatchObject({ seq: 2, gen: 0, contentSeq: 0, contentHash: sha256('one\n') });
    expect((await f.store.document(made.id, 1))!.log).toHaveLength(2);
    await f.liveNotes.setActive(repository, made.id, 0);
    const stored = (await f.store.document(made.id, 1))!;
    expect(stored).toMatchObject({ log: [], gen: 1, seq: 2 });
    expect(storedText(stored)).toBe(full);
    expect(await f.store.link(made.id)).toMatchObject({ seq: 2, gen: 1, contentSeq: 2, contentHash: sha256(full) });
    expect((await row(f, made.id))!.contentHash).toBe(sha256(full));
    // Compaction is no edit: both are still listed, and with nothing new there is nothing to compact.
    expect((await f.store.editors(made.id)).map(editor => editor.key)).toEqual(['agent:p3@example.test', editorOf(1).key]);
    await type(f, made.id, full, 1);
    await f.liveNotes.setActive(repository, made.id, 0);
    expect(await f.store.link(made.id)).toMatchObject({ seq: 2, gen: 1 });
  });

  it('compacts a document that stays open, a moment after its last update, with nobody leaving', async () => {
    const f = builtinFixture();
    const made = await checkout(f, 'one\n');
    const link = (await f.store.link(made.id))!;
    // A tab holds the document open and types, as a socket will: nothing lets the document go.
    const held = await f.documents.open(link);
    const tab = new Y.Doc();
    Y.applyUpdate(tab, Y.encodeStateAsUpdate(held.document));
    const updates: Uint8Array[] = [];
    tab.on('update', (update: Uint8Array) => void updates.push(update));
    tab.getText('content').insert(4, 'two\n');
    await f.documents.accept(link, updates[0], editorOf(1));
    expect(await f.store.document(made.id, 1)).toMatchObject({ gen: 0, seq: 1, log: [expect.any(Uint8Array)] });
    await vi.waitFor(async () => expect(await f.store.document(made.id, 1)).toMatchObject({ gen: 1, seq: 1, log: [] }), { timeout: 10_000, interval: 100 });
    expect(await f.store.link(made.id)).toMatchObject({ contentSeq: 1, contentHash: sha256('one\ntwo\n') });
    // It is still held, and takes the next update on the compacted state.
    tab.getText('content').insert(8, 'three\n');
    await f.documents.accept(link, updates[1], editorOf(1));
    expect(held.document.getText('content').toString()).toBe('one\ntwo\nthree\n');
    await held.close();
    expect((await read(f, made.id)).content).toBe('one\ntwo\nthree\n');
  }, 20_000);

  it('never drops what another process appended: a compaction on a generation that moved changes nothing', async () => {
    const shared = memoryLiveStore();
    let beforeCompact: (() => Promise<void>) | undefined;
    const compacted: boolean[] = [];
    const one = builtinFixture({
      store: wrapStore(shared, {
        compact: async (...args) => {
          const run = beforeCompact;
          beforeCompact = undefined;
          await run?.();
          const done = await shared.compact(...args);
          compacted.push(done);
          return done;
        },
      }),
    });
    const two = builtinFixture({ store: shared, files: one.files, time: one.time });
    const made = await checkout(one, 'base\n');
    await type(one, made.id, 'base\none\n', 1);
    await type(two, made.id, 'base\none\ntwo\n', 2);
    // Process one read the log (two entries) to compact it. Before its state lands, process two appends a third and compacts all three.
    beforeCompact = async () => {
      await type(two, made.id, 'base\none\ntwo\nthree\n', 2);
      await two.liveNotes.setActive(repository, made.id, 0);
    };
    await one.liveNotes.setActive(repository, made.id, 0);
    expect(compacted).toEqual([false]);
    expect(await shared.link(made.id)).toMatchObject({ seq: 3, gen: 1, contentSeq: 3, contentHash: sha256('base\none\ntwo\nthree\n') });
    expect(storedText(await shared.document(made.id, 1))).toBe('base\none\ntwo\nthree\n');
    expect((await read(one, made.id)).content).toBe('base\none\ntwo\nthree\n');
    expect((await read(two, made.id)).content).toBe('base\none\ntwo\nthree\n');
    // The next compaction of process one is on the current generation, and lands.
    await type(one, made.id, 'base\none\ntwo\nthree\nfour\n', 1);
    await one.liveNotes.setActive(repository, made.id, 0);
    expect(compacted).toEqual([false, true]);
    expect(await shared.document(made.id, 1)).toMatchObject({ log: [], gen: 2, seq: 4 });
    expect(storedText(await shared.document(made.id, 1))).toBe('base\none\ntwo\nthree\nfour\n');
  });

  it('leaves the updates in the log when the store refuses a compaction, still serves the text and its hash, and compacts the next time', async () => {
    const inner = memoryLiveStore();
    let full = true;
    const f = builtinFixture({ store: wrapStore(inner, { compact: async (...args) => full ? Promise.reject(new LiveUnavailableError()) : inner.compact(...args) }) });
    const made = await checkout(f, 'one\n');
    await type(f, made.id, 'one\nsecret two\n', 1);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await f.liveNotes.setActive(repository, made.id, 0);
    expect(await inner.document(made.id, 1)).toMatchObject({ gen: 0, seq: 1, log: [expect.any(Uint8Array)] });
    // Nobody holds the document and its stored hash is behind: listing reads the text, and its compaction is refused too.
    expect((await row(f, made.id))!.contentHash).toBe(sha256('one\nsecret two\n'));
    expect((await read(f, made.id)).content).toBe('one\nsecret two\n');
    const logged = warn.mock.calls.flat().join('\n');
    expect(logged).toContain(`Compacting live note ${made.id} failed`);
    expect(logged).not.toContain('secret');
    expect(await inner.link(made.id)).toMatchObject({ gen: 0, contentSeq: 0, contentHash: sha256('one\n') });
    full = false;
    expect((await row(f, made.id))!.contentHash).toBe(sha256('one\nsecret two\n'));
    expect(await inner.document(made.id, 1)).toMatchObject({ gen: 1, seq: 1, log: [] });
    expect(await inner.link(made.id)).toMatchObject({ contentSeq: 1, contentHash: sha256('one\nsecret two\n') });
  });

  it('compacts every document it holds at shutdown, and serves them from the store afterwards', async () => {
    const f = builtinFixture();
    const first = await checkout(f, 'one\n'), second = await draft(f, '# Draft\n');
    await type(f, first.id, 'one\ntwo\n', 1);
    await type(f, second.id, '# Draft\nwords\n', 2);
    await f.liveNotes.shutdown();
    expect(await f.store.document(first.id, 1)).toMatchObject({ log: [], gen: 1, seq: 1 });
    expect(await f.store.document(second.id, 1)).toMatchObject({ log: [], gen: 1, seq: 1 });
    expect((await read(f, first.id)).content).toBe('one\ntwo\n');
    expect((await read(f, second.id)).content).toBe('# Draft\nwords\n');
    await f.liveNotes.shutdown();
  });

  it('serves a new process everything the store acknowledged to one that died, and gives its row the hash of that text', async () => {
    const shared = memoryLiveStore();
    const one = builtinFixture({ store: shared });
    const made = await checkout(one, 'one\n');
    await type(one, made.id, 'one\ntwo\n', 1);
    const text = await read(one, made.id);
    await write(one, made.id, 'one\ntwo\nthree\n', text.liveRevision);
    const full = 'one\ntwo\nthree\n';
    // Process one dies here: nothing was compacted, and the stored hash is still the checkout's.
    expect(await shared.link(made.id)).toMatchObject({ seq: 2, gen: 0, contentSeq: 0, contentHash: sha256('one\n') });
    const two = builtinFixture({ store: shared, files: one.files, time: one.time });
    expect(await read(two, made.id)).toEqual({ content: full, liveRevision: `t:${sha256(full)}`, contentHash: sha256(full) });
    expect((await row(two, made.id))!).toMatchObject({ contentHash: sha256(full), lastEditAt: iso(T0) });
    // Listing it compacted what the dead process left, so the stored hash is the text's again.
    expect(await shared.link(made.id)).toMatchObject({ seq: 2, gen: 1, contentSeq: 2, contentHash: sha256(full) });
    expect(storedText(await shared.document(made.id, 1))).toBe(full);
    const lease = await two.liveNotes.service.lease(repository, made.id);
    expect((await two.liveNotes.service.detail(repository, made.id, lease)).editors.map(editor => [editor.email, editor.agent])).toEqual([['p3@example.test', true], ['p1@example.test', false]]);
  });
});

describe('writes', () => {
  it('lets two typists and a write made on the same text converge, keeping all three, in every process', async () => {
    const inner = memoryLiveStore();
    let held: ReturnType<typeof gate> | undefined;
    let waiting = 0;
    const f = builtinFixture({
      store: wrapStore(inner, {
        append: async (...args) => {
          if (held) {
            waiting += 1;
            await held.opened;
          }
          return inner.append(...args);
        },
      }),
    });
    const made = await checkout(f, 'alpha\nbeta\ngamma\n');
    const before = await read(f, made.id, 3);
    held = gate();
    const all = Promise.all([type(f, made.id, 'ALPHA\nbeta\ngamma\n', 1), type(f, made.id, 'alpha\nbeta\ngamma\ndelta\n', 2), write(f, made.id, 'alpha\nBETA\ngamma\n', before.liveRevision)]);
    await settle();
    // All three were made on the same text, and none of them is in the document yet.
    expect(waiting).toBe(3);
    expect((await read(f, made.id)).content).toBe('alpha\nbeta\ngamma\n');
    held.open();
    held = undefined;
    expect((await all)[2].changed).toBe(true);
    const merged = 'ALPHA\nBETA\ngamma\ndelta\n';
    expect(await read(f, made.id)).toEqual({ content: merged, liveRevision: `t:${sha256(merged)}`, contentHash: sha256(merged) });
    expect(storedText(await inner.document(made.id, 1))).toBe(merged);
    expect((await read(builtinFixture({ store: inner, files: f.files, time: f.time }), made.id)).content).toBe(merged);
    expect((await inner.editors(made.id)).map(editor => editor.key).sort()).toEqual(['agent:p3@example.test', editorOf(1).key, editorOf(2).key]);
  });

  it('runs the writes of one note one after another: a write made on the same text as the one before is rebased over it, or refused', async () => {
    const f = builtinFixture();
    const made = await checkout(f, 'one\ntwo\nthree\n');
    const before = await read(f, made.id);
    const [first, second, third] = await Promise.allSettled([write(f, made.id, 'ONE\ntwo\nthree\n', before.liveRevision), write(f, made.id, 'uno\ntwo\nthree\n', before.liveRevision), write(f, made.id, 'one\ntwo\nTHREE\n', before.liveRevision)]);
    expect(first).toEqual({ status: 'fulfilled', value: { changed: true, liveRevision: `t:${sha256('ONE\ntwo\nthree\n')}` } });
    // The second rewrote the line the first had just rewritten: it is refused, never typed into it.
    expect(second).toMatchObject({ status: 'rejected', reason: expect.any(LiveStaleError) });
    expect(third).toEqual({ status: 'fulfilled', value: { changed: true, liveRevision: `t:${sha256('ONE\ntwo\nTHREE\n')}` } });
    expect((await read(f, made.id)).content).toBe('ONE\ntwo\nTHREE\n');
    expect(await f.store.link(made.id)).toMatchObject({ seq: 2 });
  });

  it('rebases a write by character over the typing since, and refuses one that changed the same characters', async () => {
    const f = builtinFixture();
    const made = await checkout(f, 'the quick brown fox\n');
    const before = await read(f, made.id);
    await type(f, made.id, 'the quick red fox\n', 2);
    await expect(write(f, made.id, 'the quick green fox\n', before.liveRevision)).rejects.toBeInstanceOf(LiveStaleError);
    expect((await read(f, made.id)).content).toBe('the quick red fox\n');
    expect((await f.store.link(made.id))!.seq).toBe(1);
    // Another word of the same line lands beside the typing.
    expect(await write(f, made.id, 'a quick brown fox\n', before.liveRevision)).toEqual({ changed: true, liveRevision: `t:${sha256('a quick red fox\n')}` });
    expect((await read(f, made.id)).content).toBe('a quick red fox\n');
    // A write that only repeats what the typing did changes nothing, and names nobody.
    expect(await write(f, made.id, 'a quick red fox\n', before.liveRevision)).toEqual({ changed: false, liveRevision: `t:${sha256('a quick red fox\n')}` });
    expect((await f.store.link(made.id))!.seq).toBe(2);
    // An append is never stale, whatever was read.
    const appended = await f.liveNotes.person(person(3)).append(repository, made.id, { text: 'the end\n', agent: true });
    expect(appended).toEqual({ liveRevision: `t:${sha256('a quick red fox\nthe end\n')}` });
    expect((await f.store.editors(made.id)).map(editor => [editor.key, editor.lastSeq])).toEqual([['agent:p3@example.test', 3], [editorOf(2).key, 1]]);
  });

  it('takes as a base only a text it handed out and still keeps, or the current one', async () => {
    const f = builtinFixture({ limits: { ringTexts: 2 } });
    const made = await checkout(f, 'one\n');
    const first = await read(f, made.id);
    await type(f, made.id, 'one\ntwo\n', 2);
    const second = await read(f, made.id);
    await type(f, made.id, 'one\ntwo\nthree\n', 2);
    await read(f, made.id);
    await type(f, made.id, 'one\ntwo\nthree\nfour\n', 2);
    // It keeps two texts: the first one read is gone, the second still rebases.
    await expect(write(f, made.id, 'ONE\n', first.liveRevision)).rejects.toBeInstanceOf(LiveStaleError);
    expect((await write(f, made.id, 'one\nTWO\n', second.liveRevision)).changed).toBe(true);
    expect((await read(f, made.id)).content).toBe('one\nTWO\nthree\nfour\n');
    // Never a revision: not its form, a hash it never handed out, another note's.
    for (const revision of ['e1:2', `h:${sha256('one\n')}`, `t:${'0'.repeat(64)}`, 't:short', '']) await expect(write(f, made.id, 'x\n', revision), revision).rejects.toBeInstanceOf(LiveStaleError);
    // Everyone leaves: what was handed out before is no base any more, the current text always is.
    const kept = await read(f, made.id);
    await type(f, made.id, 'one\nTWO\nthree\nfour\nfive\n', 2);
    await f.liveNotes.setActive(repository, made.id, 0);
    await expect(write(f, made.id, 'ONE\nTWO\nthree\nfour\n', kept.liveRevision)).rejects.toBeInstanceOf(LiveStaleError);
    const current = 'one\nTWO\nthree\nfour\nfive\n';
    expect(await write(f, made.id, `${current}six\n`, `t:${sha256(current)}`)).toEqual({ changed: true, liveRevision: `t:${sha256(`${current}six\n`)}` });
  });

  it('refuses a text past the size limit with 413, by write, append, merge, typing, checkout and a new note, and stores none of it', async () => {
    const f = builtinFixture({ limits: { maxBytes: 64 } });
    await expect(checkout(f, 'x'.repeat(65))).rejects.toBeInstanceOf(LiveTooLargeError);
    // 22 characters, 66 bytes.
    await expect(draft(f, '中'.repeat(22))).rejects.toBeInstanceOf(LiveTooLargeError);
    expect(await f.liveNotes.service.checkouts(repository)).toEqual([]);
    const text = `${'x'.repeat(60)}\n`;
    const made = await checkout(f, text);
    const live = await read(f, made.id);
    await expect(write(f, made.id, 'x'.repeat(65), live.liveRevision)).rejects.toMatchObject({ status: 413 });
    await expect(f.liveNotes.person(person(1)).append(repository, made.id, { text: 'yyyy', agent: false })).rejects.toBeInstanceOf(LiveTooLargeError);
    await expect(type(f, made.id, `${text}yyyy`, 2)).rejects.toBeInstanceOf(LiveTooLargeError);
    const lease = await f.liveNotes.service.lease(repository, made.id);
    await expect(f.liveNotes.service.mergeIn(repository, made.id, lease, { content: `${text}yyyy`, baseRevision: live.liveRevision })).rejects.toBeInstanceOf(LiveTooLargeError);
    expect(await f.store.link(made.id)).toMatchObject({ seq: 0, lastEditAt: null });
    expect((await read(f, made.id)).content).toBe(text);
    // At the limit it is taken.
    await f.liveNotes.person(person(1)).append(repository, made.id, { text: 'yyy', agent: false });
    expect(Buffer.byteLength((await read(f, made.id)).content)).toBe(64);
  });

  it('takes 5 MiB and refuses one byte more, by default', async () => {
    const f = builtinFixture();
    const made = await checkout(f, '# Big\n');
    const live = await read(f, made.id);
    await expect(write(f, made.id, 'x'.repeat(LIVE_MAX_BYTES + 1), live.liveRevision)).rejects.toMatchObject({ status: 413 });
    expect((await write(f, made.id, 'x'.repeat(LIVE_MAX_BYTES), live.liveRevision)).changed).toBe(true);
    expect((await row(f, made.id))!.contentHash).toBe(sha256('x'.repeat(LIVE_MAX_BYTES)));
  });
});

describe('check-in calls', () => {
  it('clears the editors a receipt covers by sequence: someone who typed in the very millisecond of its read stays', async () => {
    const f = builtinFixture();
    const made = await checkout(f, 'one\n');
    await type(f, made.id, 'one\ntwo\n', 1);
    await type(f, made.id, 'one\ntwo\nthree\n', 2);
    const { service } = f.liveNotes;
    const lease = await service.lease(repository, made.id);
    const detail = await service.detail(repository, made.id, lease);
    expect(detail.editors).toEqual([listed(1), listed(2)]);
    expect(detail).toMatchObject({ content: 'one\ntwo\nthree\n', liveRevision: `t:${detail.contentHash}`, contentHash: sha256('one\ntwo\nthree\n'), checkout: { id: made.id, contentHash: detail.contentHash, lastEditAt: iso(T0) } });
    expect(detail).not.toHaveProperty('initialText');
    // The first person types again while the commit is made. The clock never moved: only the sequence tells this edit from the ones committed.
    await type(f, made.id, 'one\ntwo\nthree\nfour\n', 1);
    expect((await f.store.editors(made.id)).map(editor => [editor.key, editor.firstAt, editor.lastAt, editor.lastSeq])).toEqual([[editorOf(1).key, T0, T0, 3], [editorOf(2).key, T0, T0, 2]]);
    await service.synced(repository, made.id, lease, receipt(detail.contentHash, note));
    await service.synced(repository, made.id, lease, receipt(detail.contentHash, note));
    const after = await service.detail(repository, made.id, lease);
    expect(after.editors).toEqual([listed(1)]);
    expect(after.checkout).toMatchObject({ syncedAt: iso(T0), base: { commit: 'c'.repeat(40), blob: 'd'.repeat(40), contentHash: detail.contentHash } });
    // The text moved on after the receipt: it is not released on the old text, and the next receipt clears everyone.
    expect(await service.release(repository, made.id, lease, { contentHash: detail.contentHash })).toEqual({ released: false, reason: 'changed' });
    await service.synced(repository, made.id, lease, receipt(after.contentHash, note));
    expect((await service.detail(repository, made.id, lease)).editors).toEqual([]);
    expect(await service.release(repository, made.id, lease, { contentHash: after.contentHash })).toEqual({ released: true });
    expect(await f.liveNotes.person(person(1)).filed(repository, made.id)).toBe(note);
    expect(await f.store.document(made.id, 1)).toBeNull();
  });

  it('tells a call without the lease apart from one on a note that is not live, and never merges without the lease', async () => {
    const f = builtinFixture({ limits: { leaseMs: 1000 } });
    const made = await checkout(f, 'one\n');
    const { service } = f.liveNotes;
    const lease = await service.lease(repository, made.id);
    expect(lease).toEqual({ token: expect.stringMatching(/^[0-9a-f]{32}$/), until: iso(T0 + 1000) });
    const forged = { token: `${lease.token}0`, until: lease.until };
    const live = await read(f, made.id);
    await expect(service.detail(repository, made.id, forged)).rejects.toBeInstanceOf(LiveLeasedError);
    await expect(service.mergeIn(repository, made.id, forged, { content: 'forged\n', baseRevision: live.liveRevision })).rejects.toBeInstanceOf(LiveLeasedError);
    await expect(service.discard(repository, made.id, forged, { contentHash: live.contentHash })).rejects.toBeInstanceOf(LiveLeasedError);
    expect(await f.store.link(made.id)).toMatchObject({ seq: 0 });
    for (const id of [unknown, 'not an id', '']) {
      await expect(service.lease(repository, id), id).rejects.toBeInstanceOf(LiveNotLiveError);
      await expect(service.detail(repository, id, lease), id).rejects.toBeInstanceOf(LiveNotLiveError);
      await expect(service.release(repository, id, lease, { contentHash: live.contentHash }), id).rejects.toBeInstanceOf(LiveNotLiveError);
      await expect(read(f, id), id).rejects.toBeInstanceOf(LiveNotLiveError);
      expect(await f.liveNotes.person(person(1)).filed(repository, id)).toBeNull();
    }
    // It runs out by the adapter's clock, after the time its limit gives it.
    f.time.advance(999);
    await expect(service.lease(repository, made.id)).rejects.toBeInstanceOf(LiveLeasedError);
    f.time.advance(1);
    await expect(service.detail(repository, made.id, lease)).rejects.toBeInstanceOf(LiveLeasedError);
    expect((await service.lease(repository, made.id)).token).not.toBe(lease.token);
  });

  it('counts as editing the people active within the idle window, and releases past an idle tab', async () => {
    const f = builtinFixture({ limits: { idleMs: 30_000 } });
    const made = await checkout(f, 'one\n');
    await f.liveNotes.setActive(repository, made.id, 2);
    expect((await row(f, made.id))!.activeEditors).toBe(2);
    const { lease, detail, release } = await checkIn(f, made.id);
    expect(release).toEqual({ released: false, reason: 'active', activeEditors: 2 });
    f.time.advance(30_000);
    expect((await row(f, made.id))!.activeEditors).toBe(2);
    f.time.advance(1);
    expect((await row(f, made.id))!.activeEditors).toBe(0);
    expect(await f.liveNotes.service.release(repository, made.id, lease, { contentHash: detail.contentHash })).toEqual({ released: true });
  });
});

describe('pending notes', () => {
  it("keeps the text a pending note began with and no lastEditAt until someone types: a merge is nobody's edit", async () => {
    const f = builtinFixture();
    const text = '---\ntitle: Draft\n---\n\nStart here.\n';
    const pending = await draft(f, text);
    expect(pending).toEqual({ id: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/), notebook, path: null, pathRule: '{{title}}.md', since: iso(T0), contentHash: sha256(text), activeEditors: 0, lastEditAt: null, syncedAt: null, base: null, conflict: null });
    const { service } = f.liveNotes;
    const lease = await service.lease(repository, pending.id);
    await service.mergeIn(repository, pending.id, lease, { content: `${text}merged\n`, baseRevision: `t:${sha256(text)}` });
    expect(await service.detail(repository, pending.id, lease)).toMatchObject({ content: `${text}merged\n`, initialText: text, editors: [], checkout: { path: null, pathRule: '{{title}}.md', lastEditAt: null } });
    f.time.advance(5000);
    await type(f, pending.id, `${text}merged\ntyped\n`, 2);
    const typed = await service.detail(repository, pending.id, lease);
    expect(typed).toMatchObject({ initialText: text, checkout: { lastEditAt: iso(T0 + 5000) } });
    expect(typed.editors.map(editor => editor.email)).toEqual(['p2@example.test']);
    // Filed, it is a note like any other: it has a path, and no initial text.
    await service.synced(repository, pending.id, lease, receipt(typed.contentHash, 'notes/life/Draft.md'));
    const filed = await service.detail(repository, pending.id, lease);
    expect(filed).not.toHaveProperty('initialText');
    expect(filed.checkout).toMatchObject({ path: 'notes/life/Draft.md' });
    expect(filed.checkout).not.toHaveProperty('pathRule');
    await expect(service.synced(repository, pending.id, lease, receipt(typed.contentHash, 'notes/life/Elsewhere.md'))).rejects.toMatchObject({ status: 409 });
  });

  it('discards a pending note only: unchanged, then with nobody editing, and then it is gone with its document and tickets', async () => {
    const f = builtinFixture();
    const pending = await draft(f, '# Draft\n');
    const ticket = await f.liveNotes.socketTicket(person(1), repository, pending.id);
    await type(f, pending.id, '# Draft\nwords\n', 2);
    const { service } = f.liveNotes;
    const lease = await service.lease(repository, pending.id);
    const detail = await service.detail(repository, pending.id, lease);
    await f.liveNotes.setActive(repository, pending.id, 1);
    // A text that is not the one checked is told first, whoever is editing.
    expect(await service.discard(repository, pending.id, lease, { contentHash: sha256('# Draft\n') })).toEqual({ released: false, reason: 'changed' });
    expect(await service.discard(repository, pending.id, lease, { contentHash: detail.contentHash })).toEqual({ released: false, reason: 'active', activeEditors: 1 });
    expect(await row(f, pending.id)).toMatchObject({ path: null, contentHash: detail.contentHash });
    await f.liveNotes.setActive(repository, pending.id, 0);
    expect(await service.discard(repository, pending.id, lease, { contentHash: detail.contentHash })).toEqual({ released: true });
    expect(await f.store.link(pending.id)).toBeNull();
    expect(await f.store.document(pending.id, 1)).toBeNull();
    expect(await f.store.initialText(pending.id)).toBeNull();
    expect(await f.store.editors(pending.id)).toEqual([]);
    expect(await f.store.takeTicket(ticketHash(ticket.ticket), f.time.now())).toBeNull();
    expect(await f.liveNotes.person(person(1)).filed(repository, pending.id)).toBeNull();
    expect(await service.repositories()).toEqual([]);
    await expect(read(f, pending.id)).rejects.toBeInstanceOf(LiveNotLiveError);
    await expect(type(f, pending.id, 'late\n')).rejects.toBeInstanceOf(LiveNotLiveError);
    await expect(f.liveNotes.socketTicket(person(1), repository, pending.id)).rejects.toBeInstanceOf(LiveNotLiveError);
    await expect(service.discard(repository, pending.id, lease, { contentHash: detail.contentHash })).rejects.toBeInstanceOf(LiveNotLiveError);
    // A note with a path is never discarded, and stays live.
    const made = await checkout(f, '# Filed\n');
    const held = await service.lease(repository, made.id);
    await expect(service.discard(repository, made.id, held, { contentHash: made.contentHash })).rejects.toMatchObject({ status: 409 });
    expect(await row(f, made.id)).toMatchObject({ path: note });
  });

  it('retargets a pending note under its lease, which ends with the call, and touches nothing else of it', async () => {
    const f = builtinFixture();
    const pending = await draft(f, '# Draft\n', 'inbox/{{title}}.md');
    await type(f, pending.id, '# Draft\nwords\n', 2);
    const { service } = f.liveNotes;
    const lease = await service.lease(repository, pending.id);
    const moved = await service.retarget(repository, pending.id, lease, { pathRule: 'archive/{{date}} {{title}}.md' });
    expect(moved).toEqual({ ...pending, pathRule: 'archive/{{date}} {{title}}.md', contentHash: sha256('# Draft\nwords\n'), lastEditAt: iso(T0) });
    expect(await f.store.link(pending.id)).toMatchObject({ path: null, pathRule: 'archive/{{date}} {{title}}.md', seq: 1 });
    expect(await f.store.initialText(pending.id)).toBe('# Draft\n');
    expect(await f.store.leaseHeld(pending.id, lease.token, f.time.now())).toBe(false);
    await expect(service.retarget(repository, pending.id, lease, { pathRule: 'again/{{title}}.md' })).rejects.toBeInstanceOf(LiveLeasedError);
    await expect(service.retarget(repository, unknown, lease, { pathRule: 'nowhere/{{title}}.md' })).rejects.toBeInstanceOf(LiveNotLiveError);
    expect((await row(f, pending.id))!.pathRule).toBe('archive/{{date}} {{title}}.md');
  });
});

describe('socket tickets', () => {
  it("names the document of the link's epoch, and keeps the ticket hashed, for one use, bound to the person", async () => {
    const f = builtinFixture();
    const made = await checkout(f, '# Ticket\n');
    const ticket = await f.liveNotes.socketTicket(person(1), repository, made.id);
    expect(ticket).toEqual({ ticket: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), document: `${made.id}.1` });
    expect(liveSocketTicketOf(ticket)).toEqual(ticket);
    expect(await f.store.takeTicket(ticketHash(ticket.ticket), f.time.now())).toEqual({ repository, id: made.id, epoch: 1, document: `${made.id}.1`, editor: editorOf(1), display: 'Person 1' });
    expect(await f.store.takeTicket(ticketHash(ticket.ticket), f.time.now())).toBeNull();
    // It holds for a minute of the adapter's clock.
    const late = await f.liveNotes.socketTicket(person(2), repository, made.id);
    expect(late.ticket).not.toBe(ticket.ticket);
    f.time.advance(60_000);
    expect(await f.store.takeTicket(ticketHash(late.ticket), f.time.now())).toBeNull();
    // Without a verified author the sign-in names the person, and no email is made up.
    const bare: LiveContext = { person: { realm: 'edition', userId: 'p9' }, request: { headers: {} } };
    const unnamed = await f.store.takeTicket(ticketHash((await f.liveNotes.socketTicket(bare, repository, made.id)).ticket), f.time.now());
    expect(unnamed).toMatchObject({ editor: { key: 'person:edition:p9', name: 'edition:p9', agent: false }, display: 'edition:p9' });
    expect(unnamed!.editor).not.toHaveProperty('email');
    // A person is one editor however their email is written.
    const shouting: LiveContext = { ...person(1), author: { name: 'Person 1', email: 'P1@Example.Test' } };
    expect((await f.store.takeTicket(ticketHash((await f.liveNotes.socketTicket(shouting, repository, made.id)).ticket), f.time.now()))!.editor).toEqual({ ...editorOf(1), email: 'P1@Example.Test' });
    await expect(f.liveNotes.socketTicket(person(1), elsewhere, made.id)).rejects.toBeInstanceOf(LiveUnavailableError);
    await expect(f.liveNotes.socketTicket(person(1), repository, unknown)).rejects.toBeInstanceOf(LiveNotLiveError);
  });

  it('gives a pending note epoch 1 and a reopened note the next epoch, whose document holds nothing of the earlier one', async () => {
    const f = builtinFixture();
    const pending = await draft(f);
    expect((await f.liveNotes.socketTicket(person(1), repository, pending.id)).document).toBe(`${pending.id}.1`);
    const made = await checkout(f, 'first epoch\n');
    await type(f, made.id, 'first epoch\ntyped\n', 1);
    const old = (await f.store.link(made.id))!;
    expect((await checkIn(f, made.id)).release).toEqual({ released: true });
    await expect(f.liveNotes.socketTicket(person(1), repository, made.id)).rejects.toBeInstanceOf(LiveNotLiveError);
    f.time.advance(1000);
    const again = await f.liveNotes.person(person(2)).checkout(repository, { notebook, path: note, base: base('second epoch\n', 2) });
    expect(again).toMatchObject({ outcome: 'reopened', checkout: { id: made.id, since: iso(T0 + 1000), contentHash: sha256('second epoch\n'), lastEditAt: null, syncedAt: null } });
    expect((await f.liveNotes.socketTicket(person(1), repository, made.id)).document).toBe(`${made.id}.2`);
    expect(await f.store.link(made.id)).toMatchObject({ epoch: 2, seq: 1, contentSeq: 1 });
    expect((await read(f, made.id)).content).toBe('second epoch\n');
    // The earlier epoch's document is refused at load, and typing for it is refused: a tab that still holds it writes nothing.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(f.documents.open(old)).rejects.toBeInstanceOf(LiveNotLiveError);
    await expect(f.documents.accept(old, new Uint8Array([0, 0]), editorOf(1))).rejects.toBeInstanceOf(LiveNotLiveError);
    expect(await f.store.document(made.id, 1)).toBeNull();
    expect(storedText(await f.store.document(made.id, 2))).toBe('second epoch\n');
    await type(f, made.id, 'second epoch\nmore\n', 2);
    expect((await f.store.editors(made.id)).map(editor => editor.key)).toEqual([editorOf(2).key]);
    expect((await read(f, made.id)).content).toBe('second epoch\nmore\n');
  });
});

describe.skipIf(!url)('over a real Redis (MYGITNOTES_TEST_REDIS_URL)', () => {
  const redis = redisTestStores(url);
  beforeAll(() => redis.begin());
  afterAll(async () => {
    expect(await redis.end()).toBe(0);
  });

  liveNotesContract('builtin (redis)', kit(() => redis.store()));

  it('serves a second process on the same Redis the text, editors and tickets of the first, and compacts under its generation', async () => {
    const store = redis.store();
    const one = builtinFixture({ store });
    const two = builtinFixture({ store, files: one.files, time: one.time });
    const made = await checkout(one, 'one\n');
    await type(one, made.id, 'one\ntwo 中文 😀\n', 1);
    await type(two, made.id, 'one\ntwo 中文 😀\nthree\n', 2);
    const full = 'one\ntwo 中文 😀\nthree\n';
    expect((await read(one, made.id)).content).toBe(full);
    expect((await read(two, made.id)).content).toBe(full);
    const ticket = await one.liveNotes.socketTicket(person(1), repository, made.id);
    expect(await store.takeTicket(ticketHash(ticket.ticket), one.time.now())).toMatchObject({ document: `${made.id}.1`, editor: editorOf(1) });
    await one.liveNotes.setActive(repository, made.id, 0);
    await two.liveNotes.setActive(repository, made.id, 0);
    expect(await store.document(made.id, 1)).toMatchObject({ log: [], gen: 1, seq: 2 });
    expect(storedText(await store.document(made.id, 1))).toBe(full);
    expect(await store.link(made.id)).toMatchObject({ contentSeq: 2, contentHash: sha256(full) });
    const { detail, release } = await checkIn(two, made.id);
    expect(detail.editors.map(editor => editor.email)).toEqual(['p1@example.test', 'p2@example.test']);
    expect(release).toEqual({ released: true });
    await expect(read(one, made.id)).rejects.toBeInstanceOf(LiveNotLiveError);
  });
});
