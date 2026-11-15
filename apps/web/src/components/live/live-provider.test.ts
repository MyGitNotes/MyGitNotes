import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { LiveProvider } from './live-provider.js';

/*
 * BF-F001 (docs/specs/2026-11-15-builtin-live-editor §8.2): typing sent on a connect before the tab's sync step 2 builds
 * on typing the server never got, which it refuses with 1011, so steady typing through a reconnect looped. The tab
 * sends no update until the connect synced; its step 2 carries everything typed before it, and the typing after it
 * goes out once, merged, when the server's step 2 arrives.
 */

const varUint = (n: number) => {
  const bytes: number[] = [];
  while (n > 127) {
    bytes.push((n & 127) | 128);
    n >>>= 7;
  }
  bytes.push(n);
  return bytes;
};
const varBytes = (data: Uint8Array) => [...varUint(data.length), ...data];
const NAME = 'live-1.1';
const name = () => varBytes(new TextEncoder().encode(NAME));
/** A message of the server to the tab: sync (0) step 1 (0) or step 2 (1), or sync status (8). */
const step1 = (vector: Uint8Array) => new Uint8Array([...name(), 0, 0, ...varBytes(vector)]);
const step2 = (update: Uint8Array) => new Uint8Array([...name(), 0, 1, ...varBytes(update)]);
const applied = () => new Uint8Array([...name(), 8, 1]);

/** What the tab sent, read back: its kind, and the Yjs payload of a sync message. */
const read = (message: Uint8Array) => {
  let at = 0;
  const uint = () => {
    let n = 0, shift = 0, byte;
    do {
      byte = message[at++];
      n |= (byte & 127) << shift;
      shift += 7;
    } while (byte & 128);
    return n;
  };
  const skip = uint();
  at += skip;
  const type = uint();
  if (type !== 0) return { kind: type === 2 ? 'auth' : type === 1 ? 'awareness' : `type ${type}` };
  const step = uint();
  const length = uint();
  return { kind: step === 0 ? 'step1' : step === 1 ? 'step2' : 'update', payload: message.slice(at, at + length) };
};

/** A socket the test drives by hand: it records what the tab sends, and lets the test open it and deliver messages. */
const fakeSocket = () => {
  const handlers = new Map<string, Set<(event: unknown) => void>>();
  const sent: Uint8Array[] = [];
  const socket = { webSocket: { readyState: 1 }, messageQueue: [] as unknown[], on: (event: string, handler: (event: unknown) => void) => handlers.set(event, (handlers.get(event) ?? new Set()).add(handler)), off: (event: string, handler: (event: unknown) => void) => handlers.get(event)?.delete(handler), attach: () => {}, detach: () => {}, send: (message: Uint8Array) => sent.push(message), emit: (event: string, payload: unknown = {}) => handlers.get(event)?.forEach(handler => handler(payload)) };
  return { socket, sent };
};

describe('LiveProvider', () => {
  it('sends no update before a connect synced, and the typing after its step 2 once, merged, when it did', async () => {
    const { socket, sent } = fakeSocket();
    const doc = new Y.Doc();
    const text = doc.getText('content');
    const unsynced: number[] = [];
    const provider = new LiveProvider({ websocketProvider: socket as unknown as HocuspocusProviderWebsocket, name: NAME, document: doc, token: 'ticket', onUnsyncedChanges: ({ number }) => unsynced.push(number) });
    provider.attach();
    const updates = () => sent.map(read).filter(message => message.kind === 'update');

    // Offline: the typing is unsaved, and nothing is sent of it.
    text.insert(0, 'offline ');
    expect(updates()).toHaveLength(0);
    expect(unsynced.at(-1)).toBeGreaterThan(0);

    socket.emit('open');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(sent.map(read).map(message => message.kind)).toContain('step1');
    // Typed while the ticket was fetched and the socket authenticated: held, since the step 2 carries it.
    text.insert(text.length, 'during ');
    expect(updates()).toHaveLength(0);

    const server = new Y.Doc();
    provider.onMessage({ data: step1(Y.encodeStateVector(server)) } as MessageEvent);
    const tabStep2 = sent.map(read).find(message => message.kind === 'step2');
    expect(tabStep2).toBeDefined();
    Y.applyUpdate(server, tabStep2!.payload!);
    expect(server.getText('content').toString()).toBe('offline during ');

    // After the step 2 went out and before the server's arrived: held too, since the step 2 does not carry it.
    text.insert(text.length, 'after ');
    expect(updates()).toHaveLength(0);
    provider.onMessage({ data: step2(Y.encodeStateAsUpdate(server, Y.encodeStateVector(doc))) } as MessageEvent);
    expect(provider.synced).toBe(true);
    expect(updates()).toHaveLength(1);
    // Every update the server gets builds on what it has: the held one applies whole.
    const held = updates()[0].payload!;
    const missing = Y.decodeUpdate(held).structs.length;
    expect(missing).toBeGreaterThan(0);
    Y.applyUpdate(server, held);
    expect(server.getText('content').toString()).toBe('offline during after ');
    expect(server.store.pendingStructs).toBeNull();

    // Synced, typing goes out at once.
    text.insert(text.length, 'now');
    expect(updates()).toHaveLength(2);
    // Three acknowledgements: the step 2, the held update, and the last one; nothing then is unsaved.
    for (let i = 0; i < 3; i++) provider.onMessage({ data: applied() } as MessageEvent);
    expect(unsynced.at(-1)).toBe(0);
    provider.destroy();
  });

  it('holds again after the socket closed, until the next connect synced', async () => {
    const { socket, sent } = fakeSocket();
    const doc = new Y.Doc();
    const provider = new LiveProvider({ websocketProvider: socket as unknown as HocuspocusProviderWebsocket, name: NAME, document: doc, token: 'ticket' });
    provider.attach();
    socket.emit('open');
    await new Promise(resolve => setTimeout(resolve, 0));
    provider.onMessage({ data: step2(new Uint8Array([0, 0])) } as MessageEvent);
    expect(provider.synced).toBe(true);
    doc.getText('content').insert(0, 'a');
    expect(sent.map(read).filter(message => message.kind === 'update')).toHaveLength(1);
    socket.emit('close', { event: { code: 1011, reason: '' } });
    expect(provider.synced).toBe(false);
    doc.getText('content').insert(1, 'b');
    expect(sent.map(read).filter(message => message.kind === 'update')).toHaveLength(1);
    provider.destroy();
  });

  /*
   * BG-F001: a keystroke typed while the browser socket is CLOSING (the server sent its close frame, the close event
   * is one round trip away) went to HocuspocusProviderWebsocket's queue, which the next connect flushes at the
   * server's first message, before the tab's step 2: refused with 1011 when it builds on typing the server refused,
   * and its acknowledgement zeroed the unsaved count while the step 2 was still unstored. These run the real provider
   * websocket over a socket the test drives.
   */
  describe('over the real provider websocket', () => {
    const sockets: FakeWebSocket[] = [];
    class FakeWebSocket {
      readyState = 0;
      sent: Uint8Array[] = [];
      listeners = new Map<string, Set<(event: unknown) => void>>();
      constructor(public url: string) {
        sockets.push(this);
      }
      addEventListener(name: string, listener: (event: unknown) => void) {
        this.listeners.set(name, (this.listeners.get(name) ?? new Set()).add(listener));
      }
      removeEventListener(name: string, listener: (event: unknown) => void) {
        this.listeners.get(name)?.delete(listener);
      }
      fire(name: string, event: unknown = {}) {
        this.listeners.get(name)?.forEach(listener => listener(event));
      }
      send(message: Uint8Array) {
        this.sent.push(new Uint8Array(message));
      }
      close() {
        this.readyState = 3;
      }
    }
    const tick = () => new Promise(resolve => setTimeout(resolve, 5));
    const authenticated = () => new Uint8Array([...name(), 2, 2, ...varBytes(new TextEncoder().encode('read-write'))]);
    const deliver = (socket: FakeWebSocket, data: Uint8Array) => socket.fire('message', { data: data.buffer });
    const kinds = (socket: FakeWebSocket) => socket.sent.map(read).map(message => message.kind);

    const setup = async () => {
      sockets.length = 0;
      const websocket = new HocuspocusProviderWebsocket({ url: 'ws://live.test', WebSocketPolyfill: FakeWebSocket, delay: 1, initialDelay: 0, minDelay: 1, maxDelay: 1, jitter: false });
      const doc = new Y.Doc();
      const text = doc.getText('content');
      const provider = new LiveProvider({ websocketProvider: websocket, name: NAME, document: doc, token: 'ticket' });
      provider.attach();
      const server = new Y.Doc();
      /** Opens the latest socket and syncs it with the server, storing the tab's step 2. */
      const connect = async () => {
        await tick();
        const socket = sockets.at(-1)!;
        socket.readyState = 1;
        socket.fire('open');
        await tick();
        deliver(socket, authenticated());
        deliver(socket, step1(Y.encodeStateVector(server)));
        return socket;
      };
      const finishSync = (socket: FakeWebSocket) => {
        for (const message of socket.sent.map(read).filter(message => message.kind === 'step2')) Y.applyUpdate(server, message.payload!);
        deliver(socket, step2(Y.encodeStateAsUpdate(server, Y.encodeStateVector(doc))));
        deliver(socket, applied());
      };
      return { websocket, provider, text, server, connect, finishSync };
    };

    it('holds typing done while the socket is closing, and sends no update before the next step 2', async () => {
      const { websocket, provider, text, server, connect, finishSync } = await setup();
      const first = await connect();
      finishSync(first);
      expect(provider.synced).toBe(true);
      expect(provider.unsyncedChanges).toBe(0);

      // The server closes for a new ticket (4000); the browser marks the socket CLOSING before the close event.
      first.readyState = 2;
      text.insert(0, 'closing ');
      expect(provider.unsyncedChanges).toBeGreaterThan(0);
      first.readyState = 3;
      first.fire('close', { code: 4000, reason: 'Live ticket renewal' });
      text.insert(text.length, 'offline');

      const second = await connect();
      // Nothing of the typing went out as an update: the step 2 carries all of it.
      expect(kinds(second)).not.toContain('update');
      expect(websocket.messageQueue).toHaveLength(0);
      // An early acknowledgement cannot zero the count while the step 2 is unstored.
      expect(provider.unsyncedChanges).toBeGreaterThan(0);
      finishSync(second);
      expect(server.getText('content').toString()).toBe('closing offline');
      expect(server.store.pendingStructs).toBeNull();
      expect(provider.unsyncedChanges).toBe(0);
      provider.destroy();
      websocket.destroy();
    });

    it('keeps steady typing through a 4000 renewal applicable on the server', async () => {
      const { websocket, provider, text, server, connect, finishSync } = await setup();
      const first = await connect();
      finishSync(first);
      text.insert(0, 'a');
      // Sent just before the tab saw the close frame, and refused by the server as past the socket's time.
      expect(kinds(first).filter(kind => kind === 'update')).toHaveLength(1);
      first.readyState = 2;
      text.insert(1, 'b');
      first.readyState = 3;
      first.fire('close', { code: 4000, reason: 'Live ticket renewal' });
      const second = await connect();
      const beforeStep2 = second.sent.map(read);
      const step2At = beforeStep2.findIndex(message => message.kind === 'step2');
      expect(step2At).toBeGreaterThanOrEqual(0);
      expect(beforeStep2.slice(0, step2At).some(message => message.kind === 'update')).toBe(false);
      // Each update the server sees builds on what it stored: none waits on missing structs.
      for (const message of beforeStep2.filter(message => message.kind === 'step2' || message.kind === 'update')) Y.applyUpdate(server, message.payload!);
      expect(server.store.pendingStructs).toBeNull();
      finishSync(second);
      text.insert(2, 'c');
      for (const message of second.sent.map(read).filter(message => message.kind === 'update')) Y.applyUpdate(server, message.payload!);
      expect(server.getText('content').toString()).toBe('abc');
      expect(server.store.pendingStructs).toBeNull();
      provider.destroy();
      websocket.destroy();
    });

    it('drops an update of its document left in the provider queue when a connect starts its sync', async () => {
      const { websocket, provider, text, connect, finishSync } = await setup();
      const first = await connect();
      finishSync(first);
      first.readyState = 3;
      first.fire('close', { code: 4000, reason: 'Live ticket renewal' });
      text.insert(0, 'x');
      // An update queued before this connect began its sync.
      const queue = (websocket as unknown as { messageQueue: unknown[]; }).messageQueue;
      queue.push(new Uint8Array([...name(), 0, 2, ...varBytes(Y.encodeStateAsUpdate(new Y.Doc()))]));
      const second = await connect();
      expect(kinds(second)).not.toContain('update');
      expect(kinds(second)).toContain('step2');
      provider.destroy();
      websocket.destroy();
    });

    it('is dirty only with local typing the server has not stored, not for a connect\'s own sync step (BG-F003)', async () => {
      const { websocket, provider, text, connect, finishSync } = await setup();
      const dirty: boolean[] = [];
      provider.on('dirty', ({ dirty: value }: { dirty: boolean; }) => dirty.push(value));
      const first = await connect();
      // Mid-connect: the step 2 counts as unsynced, but nothing was typed.
      expect(provider.unsyncedChanges).toBeGreaterThan(0);
      expect(provider.dirty).toBe(false);
      finishSync(first);
      text.insert(0, 'a');
      expect(provider.dirty).toBe(true);
      deliver(first, applied());
      expect(provider.unsyncedChanges).toBe(0);
      expect(provider.dirty).toBe(false);
      // Typing through a close stays dirty until the next connect stored its step 2.
      first.readyState = 3;
      first.fire('close', { code: 4000, reason: 'Live ticket renewal' });
      text.insert(1, 'b');
      const second = await connect();
      expect(provider.dirty).toBe(true);
      finishSync(second);
      expect(provider.dirty).toBe(false);
      expect(dirty).toEqual([true, false, true, false]);
      provider.destroy();
      websocket.destroy();
    });
  });
});
