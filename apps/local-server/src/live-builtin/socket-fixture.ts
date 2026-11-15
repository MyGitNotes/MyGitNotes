import fs from 'node:fs';
import { createServer, type RequestListener } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { OutgoingMessage } from '@hocuspocus/server';
import { deriveAlias, type EditionSourceConfig, repositoryName, repositoryRef, siteOf, textEdits, type WorkspaceConfigSource, type WorkspaceMember } from '@mygitnotes/core';
import { Router } from 'express';
import { vi } from 'vitest';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { createApp } from '../app.js';
import type { IdentityService } from '../identity.js';
import { memoryEditionSources } from '../memory-edition-source.js';
import { createRecordStore } from '../record-store/index.js';
import { type BuiltinFixture, edition, manifest } from './test-fixture.js';

/*
 * What the socket tests of the built-in live editor share (docs/specs/2026-11-15-builtin-live-editor §6, slice N4): an
 * HTTP server that runs the app over a built-in adapter and hands it the upgrades, as a deployment composes them, and
 * tabs that open a live note the way the web does, with `@hocuspocus/provider` over a real socket.
 */

/** The origin the app is told it has (`APP_URL`): the only one its socket takes. */
export const APP_ORIGIN = 'http://localhost';
export const notePath = 'notes/life/a.md';
const other: EditionSourceConfig = { type: 'edition', platform: 'hosted', repository: 'p1/other', branch: 'main', label: 'Other' };

/** Waits until `check` holds; the error of a wait that ran out says what was waited for. */
export async function until(what: string, check: () => unknown, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  for (;;) {
    if (await check()) return;
    if (Date.now() > end) throw new Error(`Still not so after ${ms} ms: ${what}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
export const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** `x-person` names who is signed in: `p1`, `p2`, … with the author of the fixture's n-th person. p3 may only read. */
const identity: IdentityService = {
  router: Router(),
  signedIn: async req => {
    const who = req.headers['x-person'];
    return typeof who === 'string' ? { person: { realm: 'edition', userId: who }, login: who, owner: `edition:${who}`, author: { name: `Person ${who.slice(1)}`, email: `${who}@example.test` } } : null;
  },
  token: async () => undefined,
  grantCredential: async () => undefined,
  grantToken: async () => undefined,
  noCredentialMessage: () => 'No credential.',
  signInOptions: async () => [],
  configured: async () => true,
  signOut: async () => {},
};

/** The workspace of the tests: a site, then the covered repository as the default, then one the editor does not cover. */
const configSource: WorkspaceConfigSource = {
  mode: 'remote',
  settings: async () => {
    const taken = new Set<string>();
    const member = (source: EditionSourceConfig, isDefault: boolean): WorkspaceMember => {
      const alias = deriveAlias(repositoryName(source), taken);
      taken.add(alias);
      return { ref: repositoryRef(source), alias, default: isDefault, hidden: false, editable: 'none' };
    };
    return { site: siteOf({ type: 'github', repository: 'owner/site', branch: 'main' }), members: [member(edition, true), member(other, false)], manifest: (_member, inRepository) => inRepository() };
  },
};

/** A socket as a browser on the app's own page opens it: with that page's origin. */
const socketFrom = (origin: string | undefined) =>
  class extends WebSocket {
    constructor(address: string | URL) {
      super(address, origin === undefined ? {} : { origin });
    }
  };

export interface LiveTab {
  provider: HocuspocusProvider;
  /** The name of the document it opened: `<id>.<epoch>`. */
  document: string;
  /** What the tab shows. */
  text(): string;
  /** Types until the tab reads `next`: the difference, as one change. */
  type(next: string): void;
  /** Sends bytes as an update of the tab's document, exactly as given and whatever they are: what no tab of the app does. */
  sendUpdate(update: Uint8Array): void;
  /** Every stateless message the server sent it, parsed. */
  told: unknown[];
  /** How many tickets it asked for: one each time its socket opened. */
  asked: number;
  /** Why its document was refused, each time it was. */
  refused: string[];
  /** Every close it saw: its socket's, with the code, and its document's (code 1000, with the server's reason). */
  closes: { code: number; reason: string; }[];
  /** The first sync with the server is done. */
  synced(): Promise<void>;
  /** The server acknowledged everything the tab typed. */
  saved(): Promise<void>;
  /** Closes the tab's socket and keeps it closed, as a network that went away. */
  offline(): void;
  /** Lets the tab connect again. */
  online(): void;
  /** Drops the tab's socket without a goodbye, as when the server died: the tab connects again by itself. */
  cut(): void;
  destroy(): void;
}

export interface LiveTabOptions {
  path?: string;
  /** The ticket to present, in place of asking the app for one each time the socket opens. */
  ticket?: () => Promise<string> | string;
  /** The document to open, in place of the one the first ticket names. */
  document?: string;
  /** The Yjs client id of the tab's document, in place of a random one. */
  clientId?: number;
}

export interface LiveServer {
  /** `http://127.0.0.1:<port>` of the app. */
  base: string;
  /** `ws://127.0.0.1:<port>/live/socket`. */
  socketUrl: string;
  /** The process behind the server now. */
  live: BuiltinFixture;
  /** Puts another process behind the server, as a deploy does: its app answers, and its adapter takes the upgrades. */
  serve(live: BuiltinFixture): void;
  /** The paths of upgrades the adapter left to the caller. */
  left: string[];
  call(method: string, url: string, body?: unknown, who?: string | null): Promise<{ status: number; body: any; }>;
  /** Asks the app for a socket ticket as the n-th person, the way the web does. */
  ticket(n: number, file?: string): Promise<{ ticket: string; document: string; }>;
  /** Checks a note out as the n-th person; answers its link id. */
  checkout(n?: number, file?: string): Promise<string>;
  /** A tab of the n-th person on a live note, connecting. */
  tab(n: number, options?: LiveTabOptions): Promise<LiveTab>;
  /** A bare socket to the server, from `origin` (none: no Origin header). */
  socket(origin: string | undefined, pathname?: string): WebSocket;
  close(): Promise<void>;
}

/** The environment `createApp` reads, for a test: stubbed until `vi.unstubAllEnvs()`. */
export function stubLiveEnv(): void {
  for (const [key, value] of Object.entries({ SESSION_SECRET: 's'.repeat(64), UPSTASH_REDIS_REST_URL: '', REDIS_URL: '', KV_REST_API_URL: '', MYGITNOTES_STORAGE: '', APP_URL: APP_ORIGIN, VERCEL: '', MYGITNOTES_PRODUCT_REPOSITORY: '', MYGITNOTES_SOURCE: 'github', MYGITNOTES_LIVE_SWEEP_SECRET: '', MYGITNOTES_LIVE_CHECKIN_AT: 'off', MYGITNOTES_TIMEZONE: '' })) vi.stubEnv(key, value);
}

/** An HTTP server that runs the app over `first` and hands its adapter the upgrades. People p1 and p2 write; p3 only reads. */
export async function liveServer(first: BuiltinFixture): Promise<LiveServer> {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-live-socket-')));
  const records = createRecordStore(root);
  const tabs: LiveTab[] = [], sockets: WebSocket[] = [];
  let app: RequestListener;
  const http = createServer((req, res) => app(req, res));
  const server: LiveServer = {
    base: '',
    socketUrl: '',
    live: first,
    left: [],
    serve(live) {
      const editionSources = memoryEditionSources({ repositories: new Map([['p1/notes', live.files], ['p1/other', new Map([['.mygitnotes.yaml', manifest], ['notes/life/z.md', '# Z\n']])]]), mayWrite: who => who.userId !== 'p3' });
      app = createApp(root, { configSource, recordStore: records, remoteCache: undefined, workspaceChoices: null, identity, editionSources, liveNotes: live.liveNotes });
      server.live = live;
    },
    async call(method, url, body, who = 'p1') {
      const response = await fetch(server.base + url, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(who ? { 'x-person': who } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await response.text();
      return { status: response.status, body: (response.headers.get('content-type') ?? '').includes('application/json') && text ? JSON.parse(text) : null };
    },
    async ticket(n, file = notePath) {
      const answer = await server.call('POST', '/api/live/socket-ticket', { notebookId: 'notes~life', path: file }, `p${n}`);
      if (answer.status !== 200) throw new Error(`socket-ticket: ${answer.status} ${JSON.stringify(answer.body)}`);
      return answer.body;
    },
    async checkout(n = 1, file = notePath) {
      const answer = await server.call('POST', '/api/live/checkout', { notebookId: 'notes~life', path: file }, `p${n}`);
      if (answer.status !== 200) throw new Error(`checkout: ${answer.status} ${JSON.stringify(answer.body)}`);
      return answer.body.checkout.id;
    },
    async tab(n, options = {}) {
      let first = options.ticket ? undefined : await server.ticket(n, options.path);
      const name = options.document ?? first?.document;
      if (!name) throw new Error('A tab with a ticket of its own names the document it opens.');
      const document = new Y.Doc();
      if (options.clientId !== undefined) document.clientID = options.clientId;
      const content = document.getText('content');
      const tab: LiveTab = {
        provider: undefined as unknown as HocuspocusProvider,
        document: name,
        text: () => content.toString(),
        type(next) {
          const edits = textEdits(content.toString(), next);
          document.transact(() => {
            for (let i = edits.length - 1; i >= 0; i--) {
              if (edits[i].to > edits[i].from) content.delete(edits[i].from, edits[i].to - edits[i].from);
              if (edits[i].text) content.insert(edits[i].from, edits[i].text);
            }
          });
        },
        sendUpdate: update => websocket.send(new OutgoingMessage(name).createSyncMessage().writeUpdate(update).toUint8Array()),
        told: [],
        asked: 0,
        refused: [],
        closes: [],
        synced: () => until(`the tab of person ${n} synced with the server`, () => tab.provider.isSynced),
        saved: () => until(`the server acknowledged what person ${n} typed`, () => tab.provider.isSynced && tab.provider.unsyncedChanges === 0),
        offline: () => websocket.disconnect(),
        online: () => void websocket.connect(),
        cut: () => (websocket.webSocket as unknown as WebSocket | null)?.terminate(),
        destroy() {
          tab.provider.destroy();
          websocket.destroy();
        },
      };
      // A tab that lost its socket tries again soon, and steadily.
      const websocket = new HocuspocusProviderWebsocket({ url: server.socketUrl, WebSocketPolyfill: socketFrom(APP_ORIGIN), delay: 30, minDelay: 30, maxDelay: 30, factor: 1, jitter: false });
      tab.provider = new HocuspocusProvider({
        websocketProvider: websocket,
        name,
        document,
        // A tab asks for a ticket each time its socket opens: a ticket opens one socket, once.
        token: async () => {
          tab.asked += 1;
          if (options.ticket) return options.ticket();
          const given = first ?? await server.ticket(n, options.path);
          first = undefined;
          return given.ticket;
        },
        onStateless: ({ payload }) => void tab.told.push(JSON.parse(payload)),
        onAuthenticationFailed: ({ reason }) => void tab.refused.push(reason),
        onClose: ({ event }) => void tab.closes.push({ code: event.code, reason: String(event.reason ?? '') }),
      });
      tab.provider.attach();
      tabs.push(tab);
      return tab;
    },
    socket(origin, pathname = '/live/socket') {
      const socket = new (socketFrom(origin))(`ws://127.0.0.1:${new URL(server.base).port}${pathname}`);
      socket.on('error', () => {});
      sockets.push(socket);
      return socket;
    },
    async close() {
      for (const tab of tabs.splice(0)) tab.destroy();
      for (const socket of sockets.splice(0)) socket.terminate();
      http.closeAllConnections();
      await new Promise<void>(resolve => http.close(() => resolve()));
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
  server.serve(first);
  http.on('upgrade', (request, socket, head) => {
    if (server.live.liveNotes.upgrade(request, socket, head)) return;
    server.left.push(request.url ?? '');
    socket.destroy();
  });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  const { port } = http.address() as { port: number; };
  server.base = `http://127.0.0.1:${port}`;
  server.socketUrl = `ws://127.0.0.1:${port}/live/socket`;
  return server;
}
