import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { HocuspocusProviderWebsocket } from '@hocuspocus/provider';
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
  const socket = {
    on: (event: string, handler: (event: unknown) => void) => handlers.set(event, (handlers.get(event) ?? new Set()).add(handler)),
    off: (event: string, handler: (event: unknown) => void) => handlers.get(event)?.delete(handler),
    attach: () => {},
    detach: () => {},
    send: (message: Uint8Array) => sent.push(message),
    emit: (event: string, payload: unknown = {}) => handlers.get(event)?.forEach(handler => handler(payload)),
  };
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
});
