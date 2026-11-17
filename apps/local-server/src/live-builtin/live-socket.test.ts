import { randomBytes } from 'node:crypto';
import net from 'node:net';
import { checkInLink, LiveUnavailableError } from '@mygitnotes/core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type WebSocket from 'ws';
import * as Y from 'yjs';
import { textUpdate } from './documents.js';
import { memoryLiveStore } from './memory-store.js';
import { APP_ORIGIN, type LiveServer, liveServer, type LiveTab, notePath, pause, stubLiveEnv, until } from './socket-fixture.js';
import type { LiveStore } from './store.js';
import { type BuiltinFixture, builtinFixture, gate, hugeDeletedUpdate, manifest, person, redisTestStores, repository, sha256, shutdownFixtures, storedText, wrapStore } from './test-fixture.js';

/*
 * The socket of the built-in live editor (docs/specs/2026-11-15-builtin-live-editor §6, §4.3, §4.5, §4.6, §5.5; slice
 * N4): real sockets and `@hocuspocus/provider` tabs against an HTTP server that runs the app over the built-in adapter.
 * It runs over the memory store always, and over a real Redis when MYGITNOTES_TEST_REDIS_URL names a throwaway one.
 */

const url = process.env.MYGITNOTES_TEST_REDIS_URL;
const A = '# A\n';
const note = { notebookId: 'notes~life', path: notePath };
const second = 'notes/life/b.md';
const twoNotes = () => new Map([['.mygitnotes.yaml', manifest], [notePath, A], [second, '# B\n']]);
const released = [{ type: 'released' }];

const servers: LiveServer[] = [];
/** An app over a new built-in adapter, on its own HTTP server. */
const serverOver = async (options: Parameters<typeof builtinFixture>[0] = {}) => {
  const server = await liveServer(builtinFixture(options));
  servers.push(server);
  return server;
};
/** How a bare socket ends: open, or the status the upgrade answered, or the code it was closed with. */
const answer = (socket: WebSocket) =>
  new Promise<number | 'open' | 'dropped'>(resolve => {
    socket.on('open', () => resolve('open'));
    socket.on('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0));
    socket.on('error', () => resolve('dropped'));
  });
/** Asks for an upgrade with a request target exactly as written, which no WebSocket client sends; resolves when the server closed the connection. */
const rawUpgrade = (server: LiveServer, target: string) =>
  new Promise<void>((resolve, reject) => {
    const socket = net.connect(Number(new URL(server.base).port), '127.0.0.1', () => socket.write(`GET ${target} HTTP/1.1\r\nHost: localhost\r\nOrigin: ${APP_ORIGIN}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\n\r\n`));
    socket.on('close', () => resolve());
    socket.on('error', reject);
    socket.setTimeout(3000, () => socket.destroy(new Error(`The server left the upgrade of ${target} open.`)));
  });
const activeEditors = async (live: BuiltinFixture, id: string) => (await live.liveNotes.service.checkouts(repository)).find(row => row.id === id)?.activeEditors;
const checkIn = (live: BuiltinFixture, id: string) => checkInLink(live.liveNotes, repository, id, { mode: 'manual', now: live.time.now, timeZone: 'Asia/Taipei', sleep: async () => {} });
const stored = async (store: LiveStore, id: string, epoch = 1) => storedText(await store.document(id, epoch));
/** What `watcher` knows of the awareness state of `tab`'s client. */
const seen = (watcher: LiveTab, tab: LiveTab) => watcher.provider.awareness!.getStates().get(tab.provider.document.clientID);
/**
 * Waits until the server holds the awareness state each of `tabs` set: a watcher of another person sees it relayed,
 * which the server does only after it judged the state. The watcher then leaves, and the tabs' person alone counts.
 */
const cursorsHeld = async (server: LiveServer, id: string, tabs: LiveTab[]) => {
  const watcher = await server.tab(2);
  await until('the server holds the cursor of every tab', () => tabs.every(tab => JSON.stringify(seen(watcher, tab)?.cursor) === JSON.stringify(tab.provider.awareness!.getLocalState()?.cursor)));
  watcher.destroy();
  await until("only the tabs' person counts", async () => (await activeEditors(server.live, id)) === 1);
};
/** Sends, over `tab`'s socket, an awareness state (or a removal) for a client id that is not its own. */
const speakFor = (tab: LiveTab, client: number, state: Record<string, unknown> | null) => {
  const awareness = tab.provider.awareness!;
  if (state) awareness.states.set(client, state);
  else awareness.states.delete(client);
  awareness.meta.set(client, { clock: (awareness.meta.get(client)?.clock ?? 0) + 1000, lastUpdated: Date.now() });
  awareness.emit('update', [{ added: [], updated: state ? [client] : [], removed: state ? [] : [client] }, 'spoof']);
};

beforeEach(() => stubLiveEnv());
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  await shutdownFixtures();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const sockets = (name: string, makeStore: () => LiveStore) =>
  describe(`the live socket over the ${name}`, () => {
    it('opens only from the origin of the app, and leaves every other path to the caller', async () => {
      const server = await serverOver({ store: makeStore() });
      for (const origin of ['https://evil.example', undefined, 'http://localhost:8080', 'https://localhost', 'null']) expect(await answer(server.socket(origin)), String(origin)).toBe(403);
      expect(await answer(server.socket(APP_ORIGIN))).toBe('open');
      expect(await answer(server.socket(APP_ORIGIN, '/live/socket?from=tab'))).toBe('open');
      expect(server.left).toEqual([]);
      expect(await answer(server.socket(APP_ORIGIN, '/pi/socket'))).toBe('dropped');
      expect(await answer(server.socket(APP_ORIGIN, '/live/socket/more'))).toBe('dropped');
      expect(server.left).toEqual(['/pi/socket', '/live/socket/more']);
      // So is a request target that is no URL at all, or that spells the path another way: the server stays up.
      for (const target of ['//', 'http://[', '/%2e%2e/live/socket', '/live/socket/', '/live/./socket']) await rawUpgrade(server, target);
      expect(server.left.slice(2)).toEqual(['//', 'http://[', '/%2e%2e/live/socket', '/live/socket/', '/live/./socket']);
      expect(await answer(server.socket(APP_ORIGIN))).toBe('open');
      // The origin is APP_URL's as each socket opens; with none, no socket opens at all.
      vi.stubEnv('APP_URL', '');
      expect(await answer(server.socket(APP_ORIGIN))).toBe(403);
      // Nor with one that is no web address, whose origin reads `null` as a sandboxed page's does.
      vi.stubEnv('APP_URL', 'file:///srv/app');
      expect(await answer(server.socket('null'))).toBe(403);
      // An adapter given its own origin takes that one, whatever APP_URL says.
      vi.stubEnv('APP_URL', APP_ORIGIN);
      const given = await serverOver({ store: makeStore(), appUrl: 'https://notes.example.com/' });
      expect(await answer(given.socket('https://notes.example.com'))).toBe('open');
      expect(await answer(given.socket(APP_ORIGIN))).toBe(403);
    });

    it('lets two people type in one note: each sees the other, and what a tab is told is saved is in the store, under the name of its ticket', async () => {
      const server = await serverOver({ store: makeStore() });
      const { store, liveNotes } = server.live;
      const id = await server.checkout();
      const one = await server.tab(1), two = await server.tab(2);
      await Promise.all([one.synced(), two.synced()]);
      expect([one.document, one.text(), two.text()]).toEqual([`${id}.1`, A, A]);
      one.type(`${A}one\n`);
      await one.saved();
      // Saved, to a tab, means the store has it: nothing was compacted yet, so it is in the log.
      expect(await store.document(id, 1)).toMatchObject({ log: [expect.any(Uint8Array)], seq: 1 });
      expect(await stored(store, id)).toBe(`${A}one\n`);
      await until('the second tab shows what the first typed', () => two.text() === `${A}one\n`);
      two.type(`${A}one\ntwo\n`);
      await two.saved();
      await until('the first tab shows what the second typed', () => one.text() === `${A}one\ntwo\n`);
      expect(await stored(store, id)).toBe(`${A}one\ntwo\n`);
      expect((await store.editors(id)).map(editor => [editor.key, editor.name, editor.email, editor.agent, editor.lastSeq])).toEqual([['person:p1@example.test', 'Person 1', 'p1@example.test', false, 1], ['person:p2@example.test', 'Person 2', 'p2@example.test', false, 2]]);
      // The seam serves the same text, and an agent's write on it reaches both tabs.
      const read = await liveNotes.person(person(3)).read(repository, id);
      expect(read).toEqual({ content: `${A}one\ntwo\n`, liveRevision: `t:${sha256(`${A}one\ntwo\n`)}`, contentHash: sha256(`${A}one\ntwo\n`) });
      one.type(`${A}one\ntwo\ntyped since\n`);
      await one.saved();
      expect((await liveNotes.person(person(3)).write(repository, id, { content: `${A}ONE\ntwo\n`, baseRevision: read.liveRevision, agent: true })).changed).toBe(true);
      const text = `${A}ONE\ntwo\ntyped since\n`;
      await until('both tabs show the write of the agent', () => one.text() === text && two.text() === text);
      expect(await stored(store, id)).toBe(text);
      // Each tab asked for one ticket, and opened one socket with it.
      expect([one.asked, two.asked, one.refused, one.closes, one.told]).toEqual([1, 1, [], [], []]);
    });

    it('tells every tab how many people have the note open, each person once however many windows, at once as they come, close, go offline and come back', async () => {
      const server = await serverOver({ store: makeStore() });
      await server.checkout();
      const latest = (tab: LiveTab) => tab.people.at(-1);
      const one = await server.tab(1), two = await server.tab(2);
      await Promise.all([one.synced(), two.synced()]);
      await until('both tabs count two people', () => latest(one) === 2 && latest(two) === 2, 1000);
      // A second window of person 2 is told the count as it opens, and it counts them once: the same in every window.
      const window = await server.tab(2);
      await window.synced();
      await until('the second window counts two people', () => latest(window) === 2, 1000);
      expect([latest(one), latest(two)]).toEqual([2, 2]);
      // Closing that window leaves person 2 with the note open in the other.
      window.destroy();
      await pause(200);
      expect([latest(one), latest(two)]).toEqual([2, 2]);
      // A closing editor takes its awareness state away before its socket closes: it stops counting then. The app's
      // editor speaks for its client id once it is let in.
      two.provider.awareness!.setLocalState({ cursor: null });
      await pause(200);
      two.provider.awareness!.setLocalState(null);
      await until('person 1 counts one once person 2 closes the editor', () => latest(one) === 1, 1000);
      two.provider.awareness!.setLocalState({ cursor: null });
      await until('person 2 counts again', () => latest(one) === 2 && latest(two) === 2, 1000);
      // Offline, person 2 stops counting at once; back online, their tab is told the count as it connects.
      two.offline();
      await until('person 1 counts one while person 2 is offline', () => latest(one) === 1, 1000);
      const before = two.people.length;
      two.online();
      await two.synced();
      await until('person 2 is told two people as they come back', () => two.people.length > before && latest(two) === 2 && latest(one) === 2, 1000);
      // A tab that stays open counts however long it sends nothing: an idle or background tab is still there.
      two.destroy();
      await until('person 1 counts one once person 2 left', () => latest(one) === 1, 1000);
      expect(one.told).toEqual([]);
    });

    it('tells the others that someone came only once their presence is written, and the one who came at once (FCP-F002)', async () => {
      const real = makeStore(), slow = gate();
      let hold = false;
      const server = await serverOver({
        store: wrapStore(real, {
          presence: async (...given) => {
            if (hold) await slow.opened;
            return real.presence(...given);
          },
        }),
      });
      await server.checkout();
      const latest = (tab: LiveTab) => tab.people.at(-1);
      const one = await server.tab(1);
      await one.synced();
      await until('person 1 counts one', () => latest(one) === 1, 1000);
      hold = true;
      const two = await server.tab(2);
      await two.synced();
      await until('person 2 is told two at once', () => latest(two) === 2, 1000);
      await pause(200);
      // Person 2's presence is not written yet: person 1, whose lists would read it again, is not told yet.
      expect(latest(one)).toBe(1);
      slow.open();
      await until('person 1 counts two once person 2 is written', () => latest(one) === 2, 1000);
    });

    it('keeps the count of the others as a tab renews its socket: they are never told it went down (FCP-F001)', async () => {
      const server = await serverOver({ store: makeStore(), limits: { socketMs: 60_000, beatMs: 40 } });
      const { time } = server.live;
      await server.checkout();
      const latest = (tab: LiveTab) => tab.people.at(-1);
      const one = await server.tab(1);
      await one.synced();
      time.advance(30_000);
      const two = await server.tab(2);
      await two.synced();
      await until('both count two', () => latest(one) === 2 && latest(two) === 2, 1000);
      const told = two.people.length;
      // Person 1's socket is renewed; person 2's is not due yet.
      time.advance(30_000);
      await until('person 1 renewed', () => one.closes.length === 1 && one.asked === 2 && one.provider.isSynced, 2000);
      await pause(300);
      expect(one.closes).toEqual([{ code: 4000, reason: 'Live ticket renewal' }]);
      expect(two.people.slice(told)).toEqual([]);
      expect(latest(one)).toBe(2);
    });

    it("opens a document only for a ticket of its own: not for none, a malformed, an unknown, a used or an expired one, or another document's", async () => {
      const server = await serverOver({ store: makeStore(), files: twoNotes() });
      const { time } = server.live;
      const id = await server.checkout(), other = await server.checkout(1, second);
      const refusedTab = async (ticket: string, document = `${id}.1`) => {
        const tab = await server.tab(1, { ticket: () => ticket, document });
        await until(`the tab with ticket ${JSON.stringify(ticket.slice(0, 8))} was refused`, () => tab.refused.length > 0);
        await pause(60);
        // Refused, a tab holds nothing of the note, and does not try again by itself.
        expect([tab.provider.isSynced, tab.text(), tab.asked]).toEqual([false, '', 1]);
        return tab.refused;
      };
      for (const bad of ['', 'x', 'a'.repeat(31), `${'a'.repeat(32)}=`, 'a'.repeat(129), randomBytes(32).toString('base64url')]) expect(await refusedTab(bad), bad).toEqual(['permission-denied']);
      // A ticket opens one socket, once.
      const { ticket } = await server.ticket(1);
      const first = await server.tab(1, { ticket: () => ticket, document: `${id}.1` });
      await first.synced();
      expect(await refusedTab(ticket)).toEqual(['permission-denied']);
      // It holds for a minute.
      const kept = (await server.ticket(1)).ticket, late = (await server.ticket(1)).ticket;
      time.advance(59_999);
      const inTime = await server.tab(1, { ticket: () => kept, document: `${id}.1` });
      await inTime.synced();
      time.advance(1);
      expect(await refusedTab(late)).toEqual(['permission-denied']);
      // It opens the document it was given for, and is spent on any other.
      const elsewhere = await server.ticket(1, second);
      expect(elsewhere.document).toBe(`${other}.1`);
      expect(await refusedTab(elsewhere.ticket)).toEqual(['permission-denied']);
      expect(await refusedTab(elsewhere.ticket, `${other}.1`)).toEqual(['permission-denied']);
      // The tabs that got in were not disturbed.
      first.type(`${A}still here\n`);
      await first.saved();
      await until('the other open tab shows it', () => inTime.text() === `${A}still here\n`);
    });

    it('gives a reader and a signed-out visitor no ticket, so no socket of theirs opens a note', async () => {
      const server = await serverOver({ store: makeStore() });
      const id = await server.checkout();
      expect((await server.call('POST', '/api/live/socket-ticket', note, 'p3')).status).toBe(403);
      expect((await server.call('POST', '/api/live/socket-ticket', note, null)).status).toBe(403);
      expect(await server.call('POST', '/api/live/socket-ticket', note, 'p2')).toMatchObject({ status: 200, body: { document: `${id}.1` } });
      // A reader's session on the upgrade is no credential either: the socket opens, and the document does not.
      const reader = await server.tab(3, { ticket: () => '', document: `${id}.1` });
      await until('the reader was refused', () => reader.refused.length > 0);
      expect([reader.refused, reader.text()]).toEqual([['permission-denied'], '']);
    });

    it("makes a socket its ticket's person whatever the tab claims: the name and colour others see are the server's, and it speaks for no client id but its own", async () => {
      const server = await serverOver({ store: makeStore() });
      const id = await server.checkout();
      const one = await server.tab(1), two = await server.tab(2), watcher = await server.tab(2);
      await Promise.all([one.synced(), two.synced(), watcher.synced()]);
      // The first person's tab gives itself a name, a colour and a title: others see the person of its ticket, in a colour the server gave.
      one.provider.awareness!.setLocalState({ user: { name: 'Mallory', color: '#000000', admin: true }, cursor: { anchor: 1, head: 1 } });
      await until("the watcher sees the first tab's cursor", () => seen(watcher, one)?.cursor);
      const personOne = { name: 'Person 1', color: seen(watcher, one)!.user.color as string };
      expect(seen(watcher, one)).toEqual({ user: { name: 'Person 1', color: expect.stringMatching(/^#[0-9a-f]{6}$/) }, cursor: { anchor: 1, head: 1 } });
      expect(personOne.color).not.toBe('#000000');
      // The second person's tab says it is the first, in the first's colour: it is the second person, in a colour of their own.
      two.provider.awareness!.setLocalState({ user: personOne, cursor: { anchor: 2, head: 2 } });
      await until("the watcher sees the second tab's cursor", () => seen(watcher, two)?.cursor);
      const personTwo = { name: 'Person 2', color: seen(watcher, two)!.user.color as string };
      expect(seen(watcher, two)).toEqual({ user: { name: 'Person 2', color: expect.stringMatching(/^#[0-9a-f]{6}$/) }, cursor: { anchor: 2, head: 2 } });
      expect(personTwo.color).not.toBe(personOne.color);
      // A person has one colour, in every tab of theirs and for everyone who looks.
      watcher.provider.awareness!.setLocalState({ cursor: { anchor: 9, head: 9 } });
      await until("the first tab sees the watcher's cursor, and the second tab's", () => seen(one, watcher)?.cursor && seen(one, two)?.cursor);
      expect([seen(one, watcher)!.user, seen(one, two)!.user]).toEqual([personTwo, personTwo]);
      // What it types is recorded for the ticket's person too.
      two.type(`${A}by two\n`);
      await two.saved();
      expect((await server.live.store.editors(id)).map(editor => editor.email)).toEqual(['p2@example.test']);
      // The first tab speaks for the second's client id, then removes it: neither reaches anyone.
      const everSeen: string[] = [];
      watcher.provider.awareness!.on('change', () => void everSeen.push(JSON.stringify([seen(watcher, one), seen(watcher, two)])));
      speakFor(one, two.provider.document.clientID, { user: { name: 'Person 2' }, cursor: { anchor: 99, head: 99 } });
      speakFor(one, two.provider.document.clientID, null);
      // A state over 4 KiB is dropped as well.
      one.provider.awareness!.setLocalState({ cursor: { anchor: 1, head: 1 }, junk: 'x'.repeat(5000) });
      // Its own next state arrives after those, so they were handled by then.
      one.provider.awareness!.setLocalState({ cursor: { anchor: 3, head: 3 } });
      await until('the watcher sees the first tab move', () => seen(watcher, one)?.cursor?.anchor === 3);
      await pause(60);
      expect(seen(watcher, one)).toEqual({ user: personOne, cursor: { anchor: 3, head: 3 } });
      expect(seen(watcher, two)).toEqual({ user: personTwo, cursor: { anchor: 2, head: 2 } });
      expect(everSeen.join('\n')).not.toMatch(/"anchor":99|junk|Mallory/);
      // Another person's tab that takes the first's client id is not heard; the first person's own tab that comes back with it is.
      const thief = await server.tab(2, { clientId: one.provider.document.clientID });
      await thief.synced();
      thief.provider.awareness!.setLocalState({ cursor: { anchor: 50, head: 50 } });
      two.provider.awareness!.setLocalState({ cursor: { anchor: 4, head: 4 } });
      await until('the watcher sees the second tab move', () => seen(watcher, two)?.cursor?.anchor === 4);
      await pause(60);
      expect(seen(watcher, one)).toEqual({ user: personOne, cursor: { anchor: 3, head: 3 } });
      const back = await server.tab(1, { clientId: one.provider.document.clientID });
      await back.synced();
      back.provider.awareness!.setLocalState({ cursor: { anchor: 7, head: 7 } });
      await until("the watcher sees the first person's new tab under the same client id", () => seen(watcher, one)?.cursor?.anchor === 7);
      expect(seen(watcher, one)).toEqual({ user: personOne, cursor: { anchor: 7, head: 7 } });
    });

    it('closes a socket that sends a message over 8 MiB', async () => {
      const server = await serverOver({ store: makeStore() });
      const closedWith = (bytes: number) =>
        new Promise<number>(resolve => {
          const socket = server.socket(APP_ORIGIN);
          socket.on('open', () => socket.send(Buffer.alloc(bytes, 1)));
          socket.on('close', code => resolve(code));
        });
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(await closedWith(8 * 1024 * 1024 + 1)).toBe(1009);
      expect(await closedWith(8 * 1024 * 1024)).not.toBe(1009);
      // A text frame is no part of the protocol.
      const texted = server.socket(APP_ORIGIN);
      texted.on('open', () => texted.send('hello'));
      expect(await new Promise<number>(resolve => texted.on('close', code => resolve(code)))).toBe(1003);
    });

    it('refuses typing that takes the text past the limit: the tab is told too-large, and none of it is stored or shown to anyone', async () => {
      const server = await serverOver({ store: makeStore(), limits: { maxBytes: 64 } });
      const { store } = server.live;
      const id = await server.checkout();
      const one = await server.tab(1), two = await server.tab(2);
      await Promise.all([one.synced(), two.synced()]);
      // 61 bytes of UTF-8.
      const fits = `${A}${'好'.repeat(19)}`;
      one.type(fits);
      await one.saved();
      await until('the second tab shows it', () => two.text() === fits);
      vi.spyOn(console, 'error').mockImplementation(() => {});
      // Two more characters of three bytes each are 67 bytes.
      two.type(`${fits}好好`);
      await until('the second tab was told', () => two.told.length > 0);
      await pause(60);
      expect(two.told).toEqual([{ type: 'refused', reason: 'too-large' }]);
      expect(two.provider.unsyncedChanges).toBeGreaterThan(0);
      expect([await stored(store, id), one.text()]).toEqual([fits, fits]);
      expect((await store.editors(id)).map(editor => editor.email)).toEqual(['p1@example.test']);
      // The first tab goes on, up to the limit itself.
      one.type(`${fits}好`);
      await one.saved();
      expect(await stored(store, id)).toBe(`${fits}好`);
    });

    // cfx-F001: a deleted run is stored as its length alone; one that claims more than any live text is refused, so no later merge walks it.
    it('refuses typing that claims a deleted run past any live text: the tab is told too-large, and none of it is stored', async () => {
      const server = await serverOver({ store: makeStore() });
      const { store } = server.live;
      const id = await server.checkout();
      const one = await server.tab(1), two = await server.tab(2);
      await Promise.all([one.synced(), two.synced()]);
      vi.spyOn(console, 'error').mockImplementation(() => {});
      two.sendUpdate(hugeDeletedUpdate(3e8));
      await until('the tab was told', () => two.told.length > 0);
      expect(two.told).toEqual([{ type: 'refused', reason: 'too-large' }]);
      expect(await store.document(id, 1)).toMatchObject({ seq: 0, log: [] });
      one.type(`${A}on\n`);
      await one.saved();
      expect(await stored(store, id)).toBe(`${A}on\n`);
    });

    it('refuses the socket past the most one document takes, and takes one again when someone left', async () => {
      const server = await serverOver({ store: makeStore(), limits: { maxConnections: 2 } });
      const id = await server.checkout();
      const one = await server.tab(1), two = await server.tab(2);
      await Promise.all([one.synced(), two.synced()]);
      const third = await server.tab(1);
      await until('the third tab was refused', () => third.refused.length > 0);
      expect([third.refused, third.told, third.text()]).toEqual([['busy'], [{ type: 'refused', reason: 'busy' }], '']);
      one.destroy();
      await until('the first person left', async () => (await activeEditors(server.live, id)) === 1);
      const fourth = await server.tab(1);
      await fourth.synced();
      expect(fourth.text()).toBe(A);
    });

    it('answers 503 to a socket past the most that are open without a document, and takes one again once one of them closed', async () => {
      const server = await serverOver({ store: makeStore(), limits: { maxUnseated: 2 } });
      await server.checkout();
      const idle = [server.socket(APP_ORIGIN), server.socket(APP_ORIGIN)];
      expect(await Promise.all(idle.map(answer))).toEqual(['open', 'open']);
      // Sockets that present no ticket hold memory each, whoever opens them: past the most, none opens.
      expect(await answer(server.socket(APP_ORIGIN))).toBe(503);
      // A tab waits too, and gets in once one of them closed; with its document open, its socket no longer counts.
      const tab = await server.tab(1);
      await pause(150);
      expect(tab.provider.isSynced).toBe(false);
      idle[0].close();
      await tab.synced();
      expect(await answer(server.socket(APP_ORIGIN))).toBe('open');
      expect(await answer(server.socket(APP_ORIGIN))).toBe(503);
      expect(tab.asked).toBe(1);
    });

    it('answers 503 to one address past the most it keeps open without a document, while other addresses still get in', async () => {
      const server = await serverOver({ store: makeStore(), limits: { maxUnseated: 100, maxUnseatedPerAddress: 2 } });
      await server.checkout();
      // The test's sockets come from 127.0.0.1, as a reverse proxy on the host does: the address it forwarded counts.
      const from = (address: string) => server.socket(APP_ORIGIN, undefined, { 'X-Forwarded-For': address });
      const one = [from('203.0.113.5'), from('198.51.100.1, 203.0.113.5')];
      expect(await Promise.all(one.map(answer))).toEqual(['open', 'open']);
      expect(await answer(from('203.0.113.5'))).toBe(503);
      expect(await answer(from('203.0.113.6'))).toBe('open');
      expect(await answer(server.socket(APP_ORIGIN))).toBe('open');
      one[0].close();
      await until('the closed socket no longer counts', async () => (await answer(from('203.0.113.5'))) === 'open');
    });

    it("refuses a socket's document past the most this process holds, while a server write still loads its own", async () => {
      const server = await serverOver({ store: makeStore(), files: twoNotes(), limits: { maxDocuments: 1 } });
      const { liveNotes, documents } = server.live;
      const id = await server.checkout(), other = await server.checkout(1, second);
      const one = await server.tab(1);
      await one.synced();
      const refused = await server.tab(1, { path: second });
      await until('the tab on the second note was refused', () => refused.refused.length > 0);
      expect([refused.refused, refused.told]).toEqual([['busy'], [{ type: 'refused', reason: 'busy' }]]);
      // Once the first note's last tab left and its document was let go, the second note opens.
      one.destroy();
      await until('the first document was let go', () => documents.hocuspocus.documents.size === 0);
      const two = await server.tab(1, { path: second });
      await two.synced();
      expect(two.text()).toBe('# B\n');
      // An agent writes into the first note all the same.
      const read = await liveNotes.person(person(3)).read(repository, id);
      expect((await liveNotes.person(person(3)).write(repository, id, { content: `${A}by an agent\n`, baseRevision: read.liveRevision, agent: true })).changed).toBe(true);
      expect((await liveNotes.person(person(3)).read(repository, other)).content).toBe('# B\n');
    });

    it('takes a carriage return or a NUL that a tab typed out again, for everyone and in the store', async () => {
      const server = await serverOver({ store: makeStore() });
      const { store, liveNotes } = server.live;
      const id = await server.checkout();
      const one = await server.tab(1), two = await server.tab(2);
      await Promise.all([one.synced(), two.synced()]);
      one.type(`${A}first\r\nsec\0ond\r\n`);
      await one.saved();
      const clean = `${A}first\nsecond\n`;
      await until('both tabs show the text in normal form', () => one.text() === clean && two.text() === clean);
      expect(await stored(store, id)).toBe(clean);
      expect(await liveNotes.person(person(2)).read(repository, id)).toEqual({ content: clean, liveRevision: `t:${sha256(clean)}`, contentHash: sha256(clean) });
      // The tidying is the typist's own edit, not a second editor's.
      expect((await store.editors(id)).map(editor => editor.email)).toEqual(['p1@example.test']);
      two.type(`${clean}third\n`);
      await two.saved();
      expect(await stored(store, id)).toBe(`${clean}third\n`);
    });

    it('stores of what a socket sends only typing in the note: an update that cannot be read or that holds anything else is refused, one that waits for what the server lacks has its tab send everything again, and the note stays whole', async () => {
      const store = makeStore();
      const server = await serverOver({ store });
      const { files, time } = server.live;
      const id = await server.checkout();
      const one = await server.tab(1), two = await server.tab(2);
      await Promise.all([one.synced(), two.synced()]);
      one.type(`${A}typed\n`);
      await one.saved();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      /** What another client that holds the note would send for typing each word at its start, and then taking `removed` characters out there: one update for each. */
      const typedElsewhere = (words: string[], removed = 0) => {
        const elsewhere = new Y.Doc();
        Y.applyUpdate(elsewhere, Y.encodeStateAsUpdate(one.provider.document));
        const updates: Uint8Array[] = [];
        elsewhere.on('update', (update: Uint8Array) => void updates.push(update));
        for (const word of words) elsewhere.getText('content').insert(0, word);
        if (removed) elsewhere.getText('content').delete(0, removed);
        return updates;
      };
      const [whole] = typedElsewhere(['SECRET WORDS ']);
      const [, second] = typedElsewhere(['first ', 'SECRET second ']);
      const [, removal] = typedElsewhere(['SECRET '], 3);
      const refusals = new Map<string, (tab: LiveTab) => void>();
      refusals.set('cut short', tab => tab.sendUpdate(whole.slice(0, whole.length - 1)));
      refusals.set('no update at all', tab => tab.sendUpdate(Uint8Array.from([1, 2, 3, 250, 251, 252, 253, 254, 255])));
      refusals.set('a map beside the text', tab => void tab.provider.document.getMap('SECRET').set('key', 'value'));
      refusals.set('an embedded object in the text', tab => tab.provider.document.getText('content').insertEmbed(0, { SECRET: 'image' }));
      refusals.set('formatting in the text', tab => tab.provider.document.getText('content').format(0, 1, { SECRET: true }));
      refusals.set('a text of another name', tab => tab.provider.document.getText('SECRET').insert(0, 'words'));
      for (const [what, send] of refusals) {
        const tab = await server.tab(1);
        await tab.synced();
        send(tab);
        await until(`the tab was told its update is refused: ${what}`, () => tab.told.length > 0);
        expect(tab.told, what).toEqual([{ type: 'refused', reason: 'invalid' }]);
        // Its document is closed, its socket is not, and it does not try again by itself.
        await until(`the tab's document was closed: ${what}`, () => tab.closes.length > 0);
        expect([tab.closes, tab.asked], what).toEqual([[{ code: 1000, reason: 'invalid' }], 1]);
        tab.destroy();
      }
      // Typing that builds on typing the server never got may only be ahead of it: its tab is told nothing, its socket closes, and the tab connects again and sends all it holds.
      const waiting = new Map<string, Uint8Array>([['waiting for typing the server never got', second], ['taking out typing the server never got', removal]]);
      for (const [what, update] of waiting) {
        const tab = await server.tab(1);
        await tab.synced();
        tab.sendUpdate(update);
        await until(`the tab's socket was closed: ${what}`, () => tab.closes.some(close => close.code === 1011));
        await until(`the tab connected again: ${what}`, () => tab.asked === 2 && tab.provider.isSynced);
        expect(tab.told, what).toEqual([]);
        tab.destroy();
      }
      // Nothing of them was stored, shown to anyone, or recorded for anyone; the log says which note, and nothing of what was sent.
      expect(await store.document(id, 1)).toMatchObject({ seq: 1 });
      expect([await stored(store, id), one.text(), two.text()]).toEqual([`${A}typed\n`, `${A}typed\n`, `${A}typed\n`]);
      expect(warn.mock.calls).toHaveLength(refusals.size + waiting.size);
      expect(warn.mock.calls.flat().join('\n')).toContain(id);
      expect([...warn.mock.calls, ...error.mock.calls].flat().map(String).join('\n')).not.toContain('SECRET');
      // The same typing, sent whole, is taken; so is typing that builds on another client's which arrives with it.
      const sender = await server.tab(1);
      await sender.synced();
      sender.sendUpdate(whole);
      await until('the typing sent whole reached the other tabs', () => two.text() === `SECRET WORDS ${A}typed\n`);
      const [first, next] = typedElsewhere(['first ', 'second ']);
      sender.sendUpdate(Y.mergeUpdates([next, first]));
      const text = `second first SECRET WORDS ${A}typed\n`;
      await until('the typing of two updates in one reached the other tabs', () => one.text() === text && two.text() === text);
      one.type(`${text}and on\n`);
      await one.saved();
      // A process that starts on the store loads the note, and serves all of it.
      const fresh = builtinFixture({ store, files, time });
      expect((await fresh.liveNotes.person(person(2)).read(repository, id)).content).toBe(`${text}and on\n`);
    });

    it('takes one update that holds the typing of two clients, one building on the other', async () => {
      const server = await serverOver({ store: makeStore() });
      const { store } = server.live;
      const id = await server.checkout();
      const one = await server.tab(1), two = await server.tab(2);
      await Promise.all([one.synced(), two.synced()]);
      // What a tab holds from a process that has gone: a client this server never met typed, and the tab typed after it.
      const theirs = new Y.Doc();
      Y.applyUpdate(theirs, Y.encodeStateAsUpdate(one.provider.document));
      theirs.getText('content').insert(A.length, 'theirs\n');
      const mine = new Y.Doc();
      Y.applyUpdate(mine, Y.encodeStateAsUpdate(theirs));
      mine.getText('content').insert(A.length + 'theirs\n'.length, 'mine\n');
      // All the server lacks, as one update, the way a tab's first sync sends it.
      one.sendUpdate(Y.encodeStateAsUpdate(mine, Y.encodeStateVector(one.provider.document)));
      const text = `${A}theirs\nmine\n`;
      await until('both tabs show the typing of both clients', () => one.text() === text && two.text() === text);
      expect(await stored(store, id)).toBe(text);
      expect((await store.editors(id)).map(editor => editor.email)).toEqual(['p1@example.test']);
      expect([one.told, two.told]).toEqual([[], []]);
    });

    it('tells a tab its typing is saved only once the store has it', async () => {
      const real = makeStore(), slow = gate();
      let hold = false;
      const server = await serverOver({
        store: wrapStore(real, {
          append: async (...given) => {
            if (hold) await slow.opened;
            return real.append(...given);
          },
        }),
      });
      const id = await server.checkout();
      const one = await server.tab(1), two = await server.tab(2);
      await Promise.all([one.saved(), two.saved()]);
      hold = true;
      one.type(`${A}slow\n`);
      await pause(200);
      // The update reached the server, which holds it back: unsaved for the tab, unseen by the other, not in the store.
      expect([one.provider.unsyncedChanges, two.text(), await stored(real, id)]).toEqual([1, A, A]);
      slow.open();
      await one.saved();
      expect(await stored(real, id)).toBe(`${A}slow\n`);
      await until('the other tab shows it', () => two.text() === `${A}slow\n`);
    });

    it('tells a tab nothing is saved when the store failed: its socket closes, and the tab sends its typing again, which is stored once', async () => {
      const real = makeStore();
      let failing = false;
      const server = await serverOver({
        store: wrapStore(real, {
          append: async (...given) => {
            if (!failing) return real.append(...given);
            failing = false;
            throw new LiveUnavailableError();
          },
        }),
      });
      const id = await server.checkout();
      const one = await server.tab(1);
      await one.saved();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      failing = true;
      one.type(`${A}kept by the tab\n`);
      await until('the socket was closed as failed', () => one.closes.some(close => close.code === 1011));
      expect(await stored(real, id)).toBe(A);
      await one.saved();
      expect([one.asked, one.text(), await stored(real, id)]).toEqual([2, `${A}kept by the tab\n`, `${A}kept by the tab\n`]);
      expect(await real.document(id, 1)).toMatchObject({ seq: 1 });
      // The log names the note and the failure, never the text.
      expect(warn.mock.calls.flat().join('\n')).toContain(id);
      expect(warn.mock.calls.flat().join('\n')).not.toContain('kept by the tab');
    });

    it('closes a socket with 4000 once it was open for socketMs, and its tab goes on over a socket of a fresh ticket', async () => {
      const server = await serverOver({ store: makeStore(), limits: { socketMs: 60_000, beatMs: 40 } });
      const { store, time } = server.live;
      const id = await server.checkout();
      const one = await server.tab(1);
      await one.saved();
      time.advance(59_999);
      await pause(120);
      expect(one.closes).toEqual([]);
      // Open past its time, the socket is closed on the next beat, whether or not the tab sends anything.
      time.advance(1);
      await until('the socket was closed for a new ticket', () => one.closes.length > 0);
      expect(one.closes).toEqual([{ code: 4000, reason: 'Live ticket renewal' }]);
      // The tab connects again with a ticket it asks for, which takes a signed-in writer, and types on.
      await until('the tab connected again with a fresh ticket', () => one.asked === 2 && one.provider.isSynced);
      one.type(`${A}after renewal\n`);
      await one.saved();
      expect(await stored(store, id)).toBe(`${A}after renewal\n`);
      // The new socket's time counts from when it opened.
      await pause(120);
      expect(one.closes).toHaveLength(1);
    });

    it('does not count a renewal as activity: with the default limits, an idle open tab stops counting ten minutes after its last move, across a 4000 renewal (cf14-F001)', async () => {
      const server = await serverOver({ store: makeStore(), limits: { beatMs: 40 } });
      const { time } = server.live;
      const id = await server.checkout();
      const one = await server.tab(1);
      await one.synced();
      one.provider.awareness!.setLocalState({ cursor: { anchor: 0, head: 0 } });
      // Its cursor reached the server before the clock moves on.
      await cursorsHeld(server, id, [one]);
      // Ten minutes on, the socket is renewed and the tab comes back on a fresh ticket, doing nothing.
      time.advance(10 * 60_000 + 1);
      await until('the socket was closed for a new ticket', () => one.closes.length > 0);
      expect(one.closes).toEqual([{ code: 4000, reason: 'Live ticket renewal' }]);
      await until('the tab connected again with a fresh ticket', () => one.asked === 2 && one.provider.isSynced);
      await pause(200);
      expect(await activeEditors(server.live, id)).toBe(0);
      // What it does next counts again.
      one.type(`${A}back\n`);
      await one.saved();
      expect(await activeEditors(server.live, id)).toBe(1);
    });

    it('does not count two tabs of one person renewed in the same beat as activity, whichever comes back first (cf15-F001)', async () => {
      const server = await serverOver({ store: makeStore(), limits: { beatMs: 40 } });
      const { time } = server.live;
      const id = await server.checkout();
      const one = await server.tab(1), two = await server.tab(1);
      await Promise.all([one.synced(), two.synced()]);
      one.provider.awareness!.setLocalState({ cursor: { anchor: 0, head: 0 } });
      two.provider.awareness!.setLocalState({ cursor: { anchor: 1, head: 1 } });
      await cursorsHeld(server, id, [one, two]);
      // Ten minutes on, one beat closes both sockets, and both tabs come back doing nothing.
      time.advance(10 * 60_000 + 1);
      await until('both sockets were closed for a new ticket', () => one.closes.length > 0 && two.closes.length > 0);
      await until('both tabs connected again with a fresh ticket', () => one.asked === 2 && two.asked === 2 && one.provider.isSynced && two.provider.isSynced);
      await pause(200);
      expect(await activeEditors(server.live, id)).toBe(0);
      // What either does next counts again.
      two.type(`${A}back\n`);
      await two.saved();
      expect(await activeEditors(server.live, id)).toBe(1);
    });

    it('stores nothing a socket sends once it was open for socketMs: the tab gets it in again only with a fresh ticket, which a signed-out person is refused', async () => {
      const server = await serverOver({ store: makeStore(), limits: { socketMs: 60_000, beatMs: 60_000 } });
      const { store, time } = server.live;
      const id = await server.checkout();
      let signedIn = true;
      // As the web asks: a ticket POST on every connect, which answers 403 once the session ended, and the tab's token call fails.
      const ticket = async () => {
        if (signedIn) return (await server.ticket(2)).ticket;
        const answer = await server.call('POST', '/api/live/socket-ticket', note, null);
        throw new Error(`socket-ticket: ${answer.status}`);
      };
      const one = await server.tab(1), two = await server.tab(2, { ticket, document: `${id}.1` });
      await Promise.all([one.saved(), two.saved()]);
      expect(two.asked).toBe(1);
      signedIn = false;
      // Past their time, before any beat: what each sends closes its socket instead of being stored.
      time.advance(60_000);
      two.type(`${A}two after sign-out\n`);
      await until('the second socket was closed for a new ticket', () => two.closes.some(close => close.code === 4000));
      await until('the signed-out tab got no ticket', () => two.refused.length > 0);
      expect(two.refused).toEqual([expect.stringContaining('socket-ticket: 403')]);
      one.type(`${A}one\n`);
      await until('the first socket was closed for a new ticket', () => one.closes.some(close => close.code === 4000));
      // The person still signed in loses nothing: the tab sends it again over its new socket.
      await until('the first tab connected again', () => one.asked === 2);
      await one.saved();
      await pause(60);
      expect(await stored(store, id)).toBe(`${A}one\n`);
      // The signed-out tab still holds what it typed, for the person to copy.
      expect(two.text()).toContain('two after sign-out');
    });

    it('stores no update sent past socketMs that waited behind a slow one while its socket closed (BG-F002)', async () => {
      const real = makeStore(), slow = gate();
      let hold = false;
      const server = await serverOver({
        store: wrapStore(real, {
          append: async (...given) => {
            if (hold) await slow.opened;
            return real.append(...given);
          },
        }),
        limits: { socketMs: 60_000, beatMs: 60_000 },
      });
      const { time } = server.live;
      const id = await server.checkout();
      const one = await server.tab(1);
      await one.saved();
      hold = true;
      // Sent in time, and held by the store.
      one.type(`${A}in time\n`);
      await pause(100);
      // Sent past the socket's time: it waits behind the first in the server's queue for the socket.
      time.advance(60_000);
      one.type(`${A}in time\nlate\n`);
      await pause(50);
      // The socket closes before the first is stored, as when a tab answers the server's close at once.
      one.offline();
      await until('the socket closed', () => one.closes.length > 0);
      await pause(50);
      slow.open();
      await pause(200);
      expect(await stored(real, id)).toBe(`${A}in time\n`);
    });

    it('tells the tabs of a note that was checked in that it is released, takes nothing more of that epoch, and opens the next only by its own name', async () => {
      // Its clock runs past a socket's time, which is not what this test is about: a tab's half of its first sync that
      // reached the server only after that would close its socket for a new ticket.
      const server = await serverOver({ store: makeStore(), limits: { socketMs: 24 * 3_600_000 } });
      const { store, time, files, liveNotes } = server.live;
      const id = await server.checkout();
      const one = await server.tab(1), two = await server.tab(2);
      await Promise.all([one.synced(), two.synced()]);
      const text = `${A}typed\n`;
      one.type(text);
      await one.saved();
      const old = await server.ticket(1);
      // Both left their tabs open and went idle: the note is checked in under them.
      time.advance(10 * 60_000 + 1);
      expect(await server.call('POST', '/api/live/checkin', note)).toMatchObject({ status: 200, body: { id, committed: true, released: true } });
      await until('both tabs were told', () => one.told.length > 0 && two.told.length > 0);
      await pause(120);
      // Told once, their document closed, their sockets left alone: neither connects again by itself.
      expect([one.told, two.told]).toEqual([released, released]);
      expect([one.closes, two.closes]).toEqual([[{ code: 1000, reason: 'Reset Connection' }], [{ code: 1000, reason: 'Reset Connection' }]]);
      expect([one.asked, two.asked]).toEqual([1, 1]);
      expect(files.get(notePath)).toBe(text);
      // What a tab still types is not taken.
      one.type(`${text}too late\n`);
      await pause(120);
      expect(one.provider.unsyncedChanges).toBeGreaterThan(0);
      expect(await liveNotes.person(person(1)).filed(repository, id)).toBe(notePath);
      expect((await server.call('POST', '/api/live/socket-ticket', note)).status).toBe(409);
      // Reopened, it is the next epoch, on Git's text. The old document's name and the old ticket open nothing.
      expect(await server.checkout()).toBe(id);
      const stale = await server.tab(1, { document: `${id}.1` });
      await until('the tab that names the old epoch was refused', () => stale.refused.length > 0);
      const spent = await server.tab(1, { ticket: () => old.ticket, document: old.document });
      await until('the tab with the old ticket was refused', () => spent.refused.length > 0);
      expect([stale.refused, spent.refused, stale.text()]).toEqual([['permission-denied'], ['permission-denied'], '']);
      const fresh = await server.tab(1);
      await fresh.synced();
      expect([fresh.document, fresh.text()]).toEqual([`${id}.2`, text]);
      expect(await stored(store, id, 2)).toBe(text);
    });

    it('releases a note nobody typed in, or whose typing was undone, as soon as its last tab leaves, so a move is not refused; one typed in waits for the idle check-in (F006)', async () => {
      const server = await serverOver({ store: makeStore(), limits: { beatMs: 40, socketMs: 24 * 3_600_000, leaveMs: 20 } });
      const { store, files } = server.live;
      const listed = async (id: string) => (await server.live.liveNotes.service.checkouts(repository)).some(row => row.id === id);
      const id = await server.checkout();
      const viewer = await server.tab(1), other = await server.tab(2);
      await Promise.all([viewer.synced(), other.synced()]);
      // Someone is still in it: nothing is released.
      viewer.destroy();
      await pause(150);
      expect(await listed(id)).toBe(true);
      other.type(`${A}undone\n`);
      await other.saved();
      other.type(A);
      await other.saved();
      // The last one leaves, the text Git's: released at once, nothing committed, and a move goes ahead.
      other.destroy();
      await until('the note only viewed was released', async () => (await store.link(id))?.live === false, 2000);
      expect(await listed(id)).toBe(false);
      expect(files.get(notePath)).toBe(A);
      const { revision } = (await server.call('GET', '/api/workspace')).body.repositories[0];
      expect(await server.call('POST', '/api/files', { revision, command: { kind: 'move', notebookId: 'notes~life', path: notePath, destination: second } })).toMatchObject({ status: 200 });
      // A note typed in stays checked out when everyone left, for the idle check-in.
      const typed = await server.checkout(1, second);
      const typist = await server.tab(1, { path: second });
      await typist.synced();
      typist.type(`${A}kept\n`);
      await typist.saved();
      typist.destroy();
      await pause(200);
      expect(await store.link(typed)).toMatchObject({ live: true });
    });

    it('releases nothing when the last tab of an untouched note only renews its socket (F006)', async () => {
      const server = await serverOver({ store: makeStore(), limits: { beatMs: 40, leaveMs: 0 } });
      const { store, time } = server.live;
      const id = await server.checkout();
      const viewer = await server.tab(1);
      await viewer.synced();
      await viewer.saved();
      time.advance(10 * 60_000 + 1);
      await until('the tab connected again with a fresh ticket', () => viewer.asked === 2, 3000);
      await viewer.synced();
      await pause(150);
      expect(await store.link(id)).toMatchObject({ live: true });
      viewer.destroy();
    });

    it('tells the tab of a draft that was discarded that it is released', async () => {
      // Its clock runs past a socket's time, which is not what this test is about: a tab's half of its first sync that
      // reached the server only after that would close its socket, and the draft would go while the tab is between sockets.
      const server = await serverOver({ store: makeStore(), limits: { socketMs: 24 * 3_600_000 } });
      const made = await server.call('POST', '/api/live/new', { notebookId: 'notes~life', title: 'Idea', content: 'Some idea\n' });
      const pending = made.body.checkout as { id: string; path: string; };
      const one = await server.tab(1, { path: pending.path });
      await one.synced();
      expect(one.document).toBe(`${pending.id}.1`);
      server.live.time.advance(10 * 60_000 + 1);
      expect(await server.call('POST', '/api/live/discard', { notebookId: 'notes~life', path: pending.path })).toMatchObject({ status: 200, body: { discarded: true } });
      await until('the tab was told', () => one.told.length > 0);
      expect(one.told).toEqual(released);
      expect(await server.live.store.link(pending.id)).toBeNull();
    });

    // VQ P1-a: a tab that closed its editor sends its awareness state away before its socket's close, which can come late.
    it('stops counting a person at once whose tab took its awareness state away, though its socket is still open, and counts them again when it sends one', async () => {
      const server = await serverOver({ store: makeStore(), limits: { beatMs: 40 } });
      const id = await server.checkout();
      const one = await server.tab(1), two = await server.tab(2);
      await Promise.all([one.synced(), two.synced()]);
      // Each tab speaks for its client id, as the app's editor does once it is let in.
      for (const tab of [one, two]) tab.provider.awareness!.setLocalState({ cursor: null });
      await until('both people count', async () => (await activeEditors(server.live, id)) === 2);
      two.provider.awareness!.setLocalState(null);
      await until('the second person no longer counts', async () => (await activeEditors(server.live, id)) === 1, 1000);
      expect(await checkIn(server.live, id)).toMatchObject({ released: false, reason: 'active', activeEditors: 1 });
      two.provider.awareness!.setLocalState({ cursor: { anchor: 0, head: 0 } });
      await until('the second person counts again', async () => (await activeEditors(server.live, id)) === 2, 1000);
      one.provider.awareness!.setLocalState(null);
      two.provider.awareness!.setLocalState(null);
      await until('nobody counts', async () => (await activeEditors(server.live, id)) === 0, 1000);
      expect(await checkIn(server.live, id)).toMatchObject({ released: true });
    });

    it('counts the people on its sockets by what each last did, and stops counting one whose tabs closed at once', async () => {
      // Its clock runs on for over twenty minutes: the sockets stay open meanwhile.
      const server = await serverOver({ store: makeStore(), limits: { beatMs: 40, socketMs: 24 * 3_600_000 } });
      const { store, time, documents, liveNotes } = server.live;
      const id = await server.checkout();
      const one = await server.tab(1), two = await server.tab(2), again = await server.tab(2);
      await Promise.all([one.synced(), two.synced(), again.synced()]);
      // Two people, on three sockets.
      await until('both people count', async () => (await activeEditors(server.live, id)) === 2);
      const text = `${A}typed\n`;
      one.type(text);
      await one.saved();
      expect(await checkIn(server.live, id)).toMatchObject({ committed: true, released: false, reason: 'active', activeEditors: 2 });
      // An open tab still counts after its presence entry would have run out: it is written again while the tab is there.
      time.advance(100_000);
      await until('the presence was written again', async () => (await activeEditors(server.live, id)) === 2);
      // Ten minutes after their last move, nobody counts, though every tab is open.
      time.advance(10 * 60_000);
      await until('nobody counts', async () => (await activeEditors(server.live, id)) === 0);
      // Typing counts at once, a cursor that moved counts, and the same state sent again to stay alive does not.
      two.type(`${text}more\n`);
      await two.saved();
      expect(await activeEditors(server.live, id)).toBe(1);
      one.provider.awareness!.setLocalState({ cursor: { anchor: 1, head: 1 } });
      await until('the first person counts for moving the cursor', async () => (await activeEditors(server.live, id)) === 2);
      time.advance(10 * 60_000 + 1);
      one.provider.awareness!.setLocalState(one.provider.awareness!.getLocalState());
      await pause(150);
      expect(await activeEditors(server.live, id)).toBe(0);
      // The last tab of a person closes: they are gone at once. The last tab of all closes: the document is compacted and let go, with the texts it handed out.
      again.type(`${text}more\nand more\n`);
      await again.saved();
      one.type(`${text}more\nand more\nlast\n`);
      await one.saved();
      const full = `${text}more\nand more\nlast\n`;
      expect(await activeEditors(server.live, id)).toBe(2);
      again.destroy();
      two.destroy();
      await until('the second person left', async () => (await activeEditors(server.live, id)) === 1, 1000);
      const handed = await liveNotes.person(person(3)).read(repository, id);
      const link = (await store.link(id))!;
      expect(documents.recall(link, handed.contentHash)).toBe(full);
      expect((await store.document(id, 1))!.log.length).toBeGreaterThan(0);
      one.destroy();
      await until('the document was compacted and let go', async () => (await store.document(id, 1))!.log.length === 0 && documents.hocuspocus.documents.size === 0, 1000);
      expect(await store.link(id)).toMatchObject({ seq: link.seq, contentSeq: link.seq, contentHash: sha256(full) });
      expect([await activeEditors(server.live, id), documents.recall(link, handed.contentHash)]).toEqual([0, undefined]);
      // With nobody on it, the check-in releases it.
      expect(await checkIn(server.live, id)).toMatchObject({ released: true });
    });

    it("brings a tab what another process's tab typed, counts that process's people, and drops a document whose epoch the other process ended", async () => {
      const store = makeStore();
      const first = await serverOver({ store, limits: { pollMs: 40 } });
      const next = await serverOver({ store, files: first.live.files, time: first.live.time, limits: { pollMs: 40 } });
      const id = await first.checkout();
      const one = await first.tab(1), two = await next.tab(2);
      await Promise.all([one.synced(), two.synced()]);
      one.type(`${A}from one\n`);
      await one.saved();
      await until("the other process's tab shows it", () => two.text() === `${A}from one\n`);
      two.type(`${A}from one\nfrom two\n`);
      await two.saved();
      const text = `${A}from one\nfrom two\n`;
      await until("the first process's tab shows it", () => one.text() === text);
      expect([await activeEditors(first.live, id), await activeEditors(next.live, id)]).toEqual([2, 2]);
      expect(await checkIn(first.live, id)).toMatchObject({ committed: true, released: false, reason: 'active', activeEditors: 2 });
      // Both idle, the first process releases the note. Its own tab is told at once; the other process finds out by itself.
      first.live.time.advance(10 * 60_000 + 1);
      expect(await checkIn(first.live, id)).toMatchObject({ committed: false, released: true });
      await until('both tabs were told', () => one.told.length > 0 && two.told.length > 0);
      expect([one.told, two.told]).toEqual([released, released]);
      expect(first.live.files.get(notePath)).toBe(text);
      await until('neither process holds the document', () => first.live.documents.hocuspocus.documents.size === 0 && next.live.documents.hocuspocus.documents.size === 0);
    });

    it("takes typing that builds on what another process stored and this one has not read yet: it catches up from the store, and the tab's socket stays open", async () => {
      const store = makeStore();
      // The poll is too slow to catch up: the typing itself must.
      const first = await serverOver({ store, limits: { pollMs: 60_000 } });
      const next = await serverOver({ store, files: first.live.files, time: first.live.time, limits: { pollMs: 60_000 } });
      const id = await first.checkout();
      let slow: ReturnType<typeof gate> | undefined, asking = false, spare: string | undefined;
      const one = await next.tab(1, {
        document: (await next.ticket(1)).document,
        ticket: async () => {
          const ticket = spare ?? (await next.ticket(1)).ticket;
          spare = undefined;
          asking = true;
          await slow?.opened;
          return ticket;
        },
      });
      const two = await first.tab(2);
      await Promise.all([one.synced(), two.synced()]);
      one.type(`${A}stored by next\n`);
      await one.saved();
      // The first process holds the document for its own tab, one poll behind the store.
      await pause(100);
      expect([two.text(), await stored(store, id)]).toEqual([A, `${A}stored by next\n`]);
      // The next process dies; the first takes its sockets. The tab types again while its ticket is on the way, from a
      // process that read the store (a ticket the first process issued would have caught it up).
      spare = (await next.ticket(1)).ticket;
      next.serve(first.live);
      slow = gate();
      asking = false;
      one.cut();
      await until('the tab asks for its next ticket', () => asking);
      one.type(`${A}stored by next\nthen typed\n`);
      await pause(50);
      slow.open();
      const text = `${A}stored by next\nthen typed\n`;
      await until('both tabs show everything', () => one.text() === text && two.text() === text);
      await one.saved();
      expect(await stored(store, id)).toBe(text);
      // Taken on the first try: nothing refused, and no socket closed to send it again.
      expect([one.told, one.refused, one.closes.filter(close => close.code !== 1006), one.asked]).toEqual([[], [], [], 2]);
    });

    it('tells everyone on a document that it is released when the store refuses an update of its epoch', async () => {
      const store = makeStore();
      // The poll is too slow to tell: the refused update is what does.
      const first = await serverOver({ store });
      // Its clock runs past a socket's time, which is not what this test is about.
      const next = await serverOver({ store, files: first.live.files, time: first.live.time, limits: { socketMs: 24 * 3_600_000 } });
      const id = await first.checkout();
      const typist = await next.tab(1), reader = await next.tab(2);
      await Promise.all([typist.synced(), reader.synced()]);
      first.live.time.advance(10 * 60_000 + 1);
      expect(await checkIn(first.live, id)).toMatchObject({ released: true });
      vi.spyOn(console, 'error').mockImplementation(() => {});
      typist.type(`${A}after the release\n`);
      await until('both tabs were told', () => typist.told.length > 0 && reader.told.length > 0);
      expect(reader.told).toEqual(released);
      expect(typist.told[0]).toEqual({ type: 'released' });
      expect(typist.provider.unsyncedChanges).toBeGreaterThan(0);
      expect(first.live.files.get(notePath)).toBe(A);
    });

    it('on shutdown compacts what was typed and closes the sockets with 1012; the tab goes on in the process that serves next', async () => {
      const store = makeStore();
      const server = await serverOver({ store });
      const { files, time } = server.live;
      const id = await server.checkout();
      const one = await server.tab(1);
      await one.synced();
      one.type(`${A}before\n`);
      await one.saved();
      expect((await store.document(id, 1))!.log).toHaveLength(1);
      expect(await activeEditors(server.live, id)).toBe(1);
      await server.live.liveNotes.shutdown();
      expect(await store.document(id, 1)).toMatchObject({ log: [], seq: 1 });
      expect(await store.link(id)).toMatchObject({ contentSeq: 1, contentHash: sha256(`${A}before\n`) });
      await until('the tab saw its socket closed for a restart', () => one.closes.some(close => close.code === 1012));
      expect(one.provider.isSynced).toBe(false);
      // The stopped process takes no socket, holds nothing, and left nobody in the presence.
      expect(await answer(server.socket(APP_ORIGIN))).toBe(503);
      expect(server.live.documents.hocuspocus.documents.size).toBe(0);
      const next = builtinFixture({ store, files, time });
      expect(await activeEditors(next, id)).toBe(0);
      server.serve(next);
      await one.saved();
      expect(one.asked).toBe(2);
      one.type(`${A}before\nafter\n`);
      await one.saved();
      expect([one.text(), await stored(store, id)]).toEqual([`${A}before\nafter\n`, `${A}before\nafter\n`]);
      // Asked again, a shutdown is the one that ran.
      await server.live.liveNotes.shutdown();
    });

    it('gives up compacting when its time runs out, and still closes the sockets with 1012', async () => {
      const real = makeStore(), stuck = gate();
      let hang = false;
      const server = await serverOver({
        store: wrapStore(real, {
          compact: async (...given) => {
            if (hang) await stuck.opened;
            return real.compact(...given);
          },
        }),
        limits: { shutdownMs: 500 },
      });
      const id = await server.checkout();
      const one = await server.tab(1);
      await one.synced();
      one.type(`${A}acknowledged\n`);
      await one.saved();
      hang = true;
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const started = Date.now();
      await server.live.liveNotes.shutdown();
      // Half a second is all it has; the bound here leaves a slow machine room.
      expect(Date.now() - started).toBeLessThan(2000);
      expect(error.mock.calls.flat().join('\n')).toContain(`${id}.1`);
      await until('the tab saw its socket closed for a restart', () => one.closes.some(close => close.code === 1012));
      // What the tab was told is saved is in the log, for the next process.
      expect(await stored(real, id)).toBe(`${A}acknowledged\n`);
      stuck.open();
    });

    it('serves, from a process started after a crash, everything a tab was told is saved', async () => {
      const store = makeStore();
      const server = await serverOver({ store });
      const { files, time } = server.live;
      const id = await server.checkout();
      const one = await server.tab(1);
      await one.synced();
      one.type(`${A}acknowledged\n`);
      await one.saved();
      // The process dies here: no shutdown, nothing compacted. Another starts on the same store.
      expect((await store.document(id, 1))!.log).toHaveLength(1);
      const next = builtinFixture({ store, files, time });
      expect((await next.liveNotes.person(person(2)).read(repository, id)).content).toBe(`${A}acknowledged\n`);
      server.serve(next);
      one.cut();
      await until('the tab connected again', () => one.asked === 2);
      await one.saved();
      one.type(`${A}acknowledged\nand on\n`);
      await one.saved();
      expect(await stored(store, id)).toBe(`${A}acknowledged\nand on\n`);
      expect((await store.editors(id)).map(editor => editor.email)).toEqual(['p1@example.test']);
    });

    it('takes what a tab typed while it was offline once it connects again', async () => {
      const server = await serverOver({ store: makeStore() });
      const { store } = server.live;
      const id = await server.checkout();
      const one = await server.tab(1), two = await server.tab(2);
      await Promise.all([one.synced(), two.synced()]);
      one.offline();
      await until('the first person is offline', async () => (await activeEditors(server.live, id)) === 1);
      one.type(`${A}offline\n`);
      two.type(`${A}meanwhile\n`);
      await two.saved();
      expect([one.provider.unsyncedChanges > 0, await stored(store, id)]).toEqual([true, `${A}meanwhile\n`]);
      one.online();
      await one.saved();
      await until('the tabs agree', () => one.text() === two.text() && one.text().length === `${A}offline\nmeanwhile\n`.length);
      expect([`${A}offline\nmeanwhile\n`, `${A}meanwhile\noffline\n`]).toContain(one.text());
      expect(await stored(store, id)).toBe(one.text());
      expect(one.asked).toBe(2);
    });

    it('connects a tab again that is put back online before its own socket finished closing', async () => {
      const server = await serverOver({ store: makeStore() });
      const id = await server.checkout();
      const one = await server.tab(1);
      await one.synced();
      // The tab's own close event has not landed yet when it is asked to connect again.
      one.offline();
      one.online();
      await until('the tab connected again', () => one.asked === 2 && one.provider.isSynced);
      expect(await activeEditors(server.live, id)).toBe(1);
    });

    it('takes what a tab typed offline and while its next ticket was on the way: none of it is refused, and the tabs and the store agree', async () => {
      const server = await serverOver({ store: makeStore() });
      const { store } = server.live;
      const id = await server.checkout();
      // The tab asks the app for each ticket, as the web does; a request can take its time.
      let slow: ReturnType<typeof gate> | undefined, asking = false;
      const one = await server.tab(1, {
        document: (await server.ticket(1)).document,
        ticket: async () => {
          const { ticket } = await server.ticket(1);
          asking = true;
          await slow?.opened;
          return ticket;
        },
      });
      const two = await server.tab(2);
      await Promise.all([one.synced(), two.synced()]);
      one.offline();
      await until('the first person is offline', async () => (await activeEditors(server.live, id)) === 1);
      one.type(`${A}offline\n`);
      slow = gate();
      asking = false;
      one.online();
      // Its socket is open and its ticket on the way: what it types now reaches the server before what it typed offline.
      await until('the tab asks for its next ticket', () => asking);
      one.type(`${A}offline\nmore\n`);
      await pause(50);
      slow.open();
      const text = `${A}offline\nmore\n`;
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      await until('both tabs show everything the first one typed', () => one.text() === text && two.text() === text);
      await one.saved();
      expect(await stored(store, id)).toBe(text);
      expect([one.told, one.refused, one.closes.filter(close => close.code === 1000)]).toEqual([[], [], []]);
    });

    it('keeps a document that was loaded again just after it was let go', async () => {
      const f = builtinFixture({ store: makeStore() });
      const { documents, store } = f;
      const { id } = (await f.liveNotes.person(person(1)).checkout(repository, { notebook: 'notes~life', path: notePath, base: { commit: 'c'.repeat(40), blob: 'b'.repeat(40), content: A } })).checkout;
      const link = (await store.link(id))!;
      await (await documents.open(link)).close();
      // Everyone left, and a tab comes straight back: Hocuspocus's late second unload must not take the new document.
      await documents.unload(link);
      const held = await documents.open(link);
      await pause(50);
      expect(await documents.accept(link, textUpdate(held.document, `${A}back\n`)!, { key: 'person:p1@example.test', name: 'Person 1', email: 'p1@example.test', agent: false })).toBe(true);
      await held.close();
      expect(await stored(store, id)).toBe(`${A}back\n`);
    });

    it('lands a merge while two tabs type: every tab and the store end with the typing of both and the merged text, once', async () => {
      const text = 'one\ntwo\nthree\n';
      const server = await serverOver({ store: makeStore(), files: new Map([['.mygitnotes.yaml', manifest], [notePath, text]]) });
      const id = await server.checkout();
      const [one, two] = [await server.tab(1), await server.tab(2)];
      await Promise.all([one.synced(), two.synced()]);
      const request = { notebookId: 'notes~life', path: notePath, base: text, text: `${text}merged offline\n`, mergeId: 'socket-merge-1' };
      one.type(one.text().replace('one', 'one typed'));
      // The merge is asked for while both type, on the text Git holds.
      const merging = server.call('POST', '/api/live/merge', request, 'p1');
      two.type(two.text().replace('two', 'two typed'));
      const answer = await merging;
      expect(answer).toMatchObject({ status: 200, body: { applied: true, outcome: 'joined', checkout: { id } } });
      await Promise.all([one.saved(), two.saved()]);
      const full = 'one typed\ntwo typed\nthree\nmerged offline\n';
      await until('both tabs show the typing of both and the merge', () => one.text() === full && two.text() === full);
      expect(await stored(server.live.store, id)).toBe(full);
      // The request again while they type on: the first answer, and no second copy anywhere.
      one.type(one.text().replace('three', 'three typed'));
      expect((await server.call('POST', '/api/live/merge', request, 'p1')).body).toMatchObject({ applied: true, contentHash: answer.body.contentHash });
      await one.saved();
      const after = full.replace('three', 'three typed');
      await until('both tabs show one copy of the merge', () => one.text() === after && two.text() === after);
      expect(await stored(server.live.store, id)).toBe(after);
      expect((await server.live.store.editors(id)).map(editor => editor.key).sort()).toEqual(['person:p1@example.test', 'person:p2@example.test']);
    });
  });

sockets('memory store', () => memoryLiveStore());

describe.skipIf(!url)('over a real Redis (MYGITNOTES_TEST_REDIS_URL)', () => {
  const redis = redisTestStores(url);
  beforeAll(() => redis.begin());
  afterAll(async () => {
    expect(await redis.end()).toBe(0);
  });
  sockets('Redis store', () => redis.store());
});
