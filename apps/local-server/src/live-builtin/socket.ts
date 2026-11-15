import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { type Connection, type Extension, OutgoingMessage } from '@hocuspocus/server';
import { LiveNotLiveError, LiveTooLargeError, type RepositoryId } from '@mygitnotes/core';
import { type RawData, type WebSocket, WebSocketServer } from 'ws';
import { liveDocumentName, type LiveDocuments, type LiveEpoch, LiveUpdateRefusedError, LiveUpdateWaitingError, RELEASED } from './documents.js';
import { socketAddress } from './socket-address.js';
import { type EditorRef, LIVE_PRESENCE_MS, type LiveStore } from './store.js';

/*
 * The socket people type through (docs/specs/2026-11-15-builtin-live-editor §6, §4.3, §4.6, §5.5): `/live/socket` on
 * the app's own server, handed to the Hocuspocus instance of `documents.ts`. A socket opens only from the app's origin,
 * and a document on it only for a single-use ticket, which also says who types. An update is in the store before it is
 * acknowledged, awareness names are the server's, and what each person last did is kept as presence for `activeEditors`.
 */

/** The path of the socket on the app's server. */
export const LIVE_SOCKET_PATH = '/live/socket';

/** The limits the socket keeps (§4.6), and how often it does what it does on a timer. */
export interface LiveSocketLimits {
  /** The largest WebSocket message, in bytes; a larger one closes the socket (1009). */
  maxPayload: number;
  /** The documents this process holds before a socket's new one is refused; server writes still load theirs. */
  maxDocuments: number;
  /** The sockets on one document. */
  maxConnections: number;
  /**
   * The sockets this process keeps open without a document on them (waiting for their ticket, or after their document
   * closed), each of which may hold messages waiting for authentication; an upgrade past it answers 503.
   */
  maxUnseated: number;
  /**
   * The sockets without a document one address keeps open (`socketAddress`), within `maxUnseated`: one client that opens
   * sockets and presents no ticket answers 503 to its own, not to every new tab.
   */
  maxUnseatedPerAddress: number;
  /** The largest awareness state of one client, in bytes of JSON; a larger one is dropped. */
  maxAwarenessBytes: number;
  /** How often a document with sockets catches up with the store. */
  pollMs: number;
  /** How often sockets are pinged and changed presence is written. */
  beatMs: number;
  /** How long `shutdown` takes at most. */
  shutdownMs: number;
}

export interface LiveSocketOptions {
  documents: LiveDocuments;
  store: LiveStore;
  clock: () => number;
  /** This process's name among those that share the store. */
  process: string;
  /** Resolves once the store passed its start-up check; rejects when it refused. */
  ready(): Promise<void>;
  covers(repository: RepositoryId): boolean;
  /** The app's origin; left out, `APP_URL` as each socket opens. */
  appUrl?: string;
  limits: LiveSocketLimits;
}

export interface LiveSocket {
  /** For `server.on('upgrade')`: takes the request when its path is `/live/socket` and returns true; false otherwise. */
  upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean;
  /** Writes what this process knows of the people on the link's document now, when it changed since it was last written. */
  settle(link: LiveEpoch): Promise<void>;
  /** Stops new sockets, compacts every document, and closes the sockets with 1012; resolves within `shutdownMs`. */
  shutdown(): Promise<void>;
}

/** One document open on one socket: a person, from the ticket the socket presented. */
interface Seat {
  /** `<id>.<epoch>`. */
  name: string;
  link: LiveEpoch & { repository: RepositoryId; };
  /** Who its updates are recorded for: the ticket's person, never the client's word. */
  editor: EditorRef;
  /** The name other people see. */
  display: string;
  socket: WebSocket;
  connection?: Connection;
  /** The document is open: the seat counts as a person present. */
  connected: boolean;
  left: boolean;
  /** The person's last activity here, by the adapter's clock. */
  at: number;
  /** The Yjs client id it speaks for in awareness: the first it sent a state for. */
  claim?: number;
  /** Its last awareness state without `user`, as JSON: a change of it is activity. */
  cursor: string;
  /** Resolves when the seat is given up. */
  gone: Promise<void>;
  leave(): void;
}

/** The seats on one document, and what the store was last told of them. */
interface Room {
  link: Seat['link'];
  seats: Set<Seat>;
  /** Awareness client id to the seat that speaks for it. */
  claims: Map<number, Seat>;
  /** Someone's activity changed since the presence was written. */
  dirty: boolean;
  /** When the presence was last written, by the adapter's clock. */
  written: number;
}

/** What Hocuspocus carries for a connection: the socket it came on, and from authentication on, its seat. */
interface SocketContext {
  socket?: WebSocket;
  seat?: Seat;
}

/** Why a socket's document is refused. It has no message: Hocuspocus logs a hook's error only when it has one. */
class Refusal extends Error {
  constructor(readonly reason: 'permission-denied' | 'not-live' | 'busy' | 'too-large' | 'invalid' | 'released' | 'unavailable') {
    super('');
  }
}

const TICKET = /^[A-Za-z0-9_-]{32,128}$/;
const REFUSED = (reason: 'too-large' | 'busy' | 'invalid') => JSON.stringify({ type: 'refused', reason });
const errorName = (error: unknown) => error instanceof Error ? error.constructor.name : 'error';

/** A colour of the person's own, the same in every tab and for everyone: a hue from their key, dark enough for white text. */
function liveColour(key: string): string {
  const hue = createHash('sha256').update(key, 'utf8').digest().readUInt16BE(0) % 360;
  const saturation = 0.7, lightness = 0.4, chroma = saturation * Math.min(lightness, 1 - lightness);
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12;
    return Math.round(255 * (lightness - chroma * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

const bytesOf = (data: RawData): Uint8Array => Array.isArray(data) ? Buffer.concat(data) : data instanceof ArrayBuffer ? new Uint8Array(data) : data;

export function liveSocket({ documents, store, clock, process: processName, ready, covers, appUrl, limits }: LiveSocketOptions): LiveSocket {
  const { hocuspocus } = documents;
  const server = new WebSocketServer({ noServer: true, maxPayload: limits.maxPayload });
  /** Every open socket, with the documents open or being opened on it. */
  const sockets = new Map<WebSocket, Set<Seat>>();
  /** The open sockets with no document open or being opened on them. */
  const unseated = new Set<WebSocket>();
  /** Where each open socket's upgrade came from. */
  const addresses = new Map<WebSocket, string>();
  const unseatedFrom = (address: string) => {
    let count = 0;
    for (const socket of unseated) if (addresses.get(socket) === address) count++;
    return count;
  };
  const rooms = new Map<string, Room>();
  /** The last write of each document's presence that is still under way, also once everyone left it. */
  const writes = new Map<string, Promise<void>>();
  /** What runs unawaited: presence writes and the unloading of documents everyone left. `shutdown` waits for it. */
  const work = new Set<Promise<unknown>>();
  let stopping: Promise<void> | undefined;
  let beat: NodeJS.Timeout | undefined, poll: NodeJS.Timeout | undefined, polling = false;

  const background = (task: Promise<unknown>) => {
    const settled = task.catch(() => {}).finally(() => work.delete(settled));
    work.add(settled);
  };

  /** The origin sockets must come from: the given one, else `APP_URL`; none when that is no web address, and every socket is refused. */
  const appOrigin = () => {
    try {
      const { protocol, origin } = new URL(appUrl ?? process.env.APP_URL ?? '');
      // Any other scheme has the origin `null`, which is also what a sandboxed page sends.
      return protocol === 'https:' || protocol === 'http:' ? origin : null;
    } catch {
      return null;
    }
  };

  /**
   * Tells the store who this process has on a document, and when each last did something. The writes of one document
   * land in order, and each says who is there as it is made: one that was held up never undoes a later one.
   */
  const writePresence = (link: LiveEpoch) => {
    const name = liveDocumentName(link);
    const asked = rooms.get(name);
    if (asked) asked.dirty = false;
    const writing = (writes.get(name) ?? Promise.resolve()).then(async () => {
      const room = rooms.get(name);
      const people: Record<string, number> = {};
      for (const seat of room?.seats ?? []) if (seat.connected) people[seat.editor.key] = Math.max(people[seat.editor.key] ?? 0, seat.at);
      const now = clock();
      if (room) room.written = now;
      try {
        await store.presence(link.id, processName, people, now);
      } catch (error) {
        // With people there, the next beat writes it; with nobody, the entry runs out by itself.
        if (room) room.dirty = true;
        console.warn(`[live-builtin] Writing who is on live note ${link.id} failed: ${errorName(error)}.`);
      }
      if (writes.get(name) === writing) writes.delete(name);
    });
    writes.set(name, writing);
    background(writing);
    return writing;
  };
  /** Sends a socket a message, unless it is closing: Hocuspocus then has nobody to tell either. */
  const tell = (socket: WebSocket, message: Uint8Array) => {
    if (socket.readyState === socket.OPEN) socket.send(message);
  };

  const startTimers = () => {
    beat ??= setInterval(() => {
      for (const socket of sockets.keys()) if (socket.readyState === socket.OPEN) socket.ping();
      // An entry lasts LIVE_PRESENCE_MS after it was written: one nobody changed is written again well before.
      for (const room of rooms.values()) if ([...room.seats].some(seat => seat.connected) && (room.dirty || clock() - room.written >= LIVE_PRESENCE_MS / 3)) void writePresence(room.link);
    }, limits.beatMs).unref();
    poll ??= setInterval(() => {
      if (polling) return;
      polling = true;
      background(documents.catchUp().finally(() => void (polling = false)));
    }, limits.pollMs).unref();
  };
  const stopTimers = () => {
    clearInterval(beat);
    clearInterval(poll);
    beat = poll = undefined;
  };

  /** The seat's document is open: its person is present from now. */
  const enter = (seat: Seat, connection: Connection) => {
    seat.connection = connection;
    if (seat.connected || seat.left) return;
    seat.connected = true;
    seat.at = clock();
    void writePresence(seat.link);
  };
  const active = (seat: Seat) => {
    seat.at = clock();
    const room = rooms.get(seat.name);
    if (room) room.dirty = true;
  };

  /** Admits a ticket's person to a document, which is then loaded for them. */
  const seatFor = (name: string, link: Seat['link'], editor: EditorRef, display: string, socket: WebSocket): Seat => {
    const room: Room = rooms.get(name) ?? { link, seats: new Set(), claims: new Map(), dirty: false, written: 0 };
    rooms.set(name, room);
    let leave!: () => void;
    const gone = new Promise<void>(resolve => {
      leave = resolve;
    });
    const seat: Seat = {
      name,
      link,
      editor,
      display,
      socket,
      connected: false,
      left: false,
      at: 0,
      cursor: '',
      gone,
      leave() {
        if (seat.left) return;
        seat.left = true;
        room.seats.delete(seat);
        const held = sockets.get(socket);
        held?.delete(seat);
        if (held && !held.size) unseated.add(socket);
        if (seat.claim !== undefined && room.claims.get(seat.claim) === seat) room.claims.delete(seat.claim);
        if (!room.seats.size && rooms.get(name) === room) rooms.delete(name);
        if (seat.connected) {
          // Written at once, so a note someone just left can be checked in and released.
          void writePresence(link);
          // The last one out: the document is compacted and let go now, once Hocuspocus has done with the connection, unless someone came meanwhile.
          if (!rooms.has(name) && !stopping) background(new Promise<void>(resolve => setImmediate(resolve)).then(() => rooms.has(name) ? undefined : documents.unload(link)));
        }
        leave();
      },
    };
    room.seats.add(seat);
    sockets.get(socket)?.add(seat);
    unseated.delete(socket);
    return seat;
  };

  /** Whether `seat` may speak for an awareness client id: its own, or one nobody else's, which it then claims. */
  const speaksFor = (room: Room, seat: Seat, client: number) => {
    const owner = room.claims.get(client);
    if (owner === seat) return true;
    // One client id a seat. Another person's is never taken; the same person's is, when their tab came back before its old socket closed.
    if (seat.claim !== undefined || (owner && owner.editor.key !== seat.editor.key)) return false;
    if (owner) owner.claim = undefined;
    room.claims.set(client, seat);
    seat.claim = client;
    return true;
  };

  const hooks: Extension = {
    /** The ticket is the only credential (§6.3): taken once, for this document, of a live link's current epoch. */
    async onAuthenticate({ token, documentName, context }) {
      const { socket } = context as SocketContext;
      if (stopping || !socket) throw new Refusal('unavailable');
      let ticket, link;
      try {
        await ready();
        ticket = typeof token === 'string' && TICKET.test(token) ? await store.takeTicket(createHash('sha256').update(token, 'utf8').digest('hex'), clock()) : null;
        link = ticket ? await store.link(ticket.id) : null;
      } catch (error) {
        // The document's name is the client's word until a ticket names it too: it is not logged.
        console.warn(`[live-builtin] Checking a socket ticket failed: ${errorName(error)}.`);
        throw new Refusal('unavailable');
      }
      if (stopping) throw new Refusal('unavailable');
      if (!ticket || ticket.document !== documentName) throw new Refusal('permission-denied');
      if (!link?.live || link.epoch !== ticket.epoch || link.repository !== ticket.repository || !covers(link.repository)) throw new Refusal('not-live');
      const loaded = new Set([...hocuspocus.documents.keys(), ...hocuspocus.loadingDocuments.keys(), ...rooms.keys()]);
      if ((rooms.get(documentName)?.seats.size ?? 0) >= limits.maxConnections || (!loaded.has(documentName) && loaded.size >= limits.maxDocuments)) {
        tell(socket, new OutgoingMessage(documentName).writeStateless(REFUSED('busy')).toUint8Array());
        throw new Refusal('busy');
      }
      const seat = seatFor(documentName, { id: link.id, epoch: link.epoch, repository: link.repository }, ticket.editor, ticket.display, socket);
      return { seat } satisfies SocketContext;
    },
    async connected({ context, connection }) {
      const { seat } = context as SocketContext;
      if (seat) enter(seat, connection);
    },
    /** Durable before acknowledged (§4.3): what a tab sends is in the store before Hocuspocus applies and acknowledges it. */
    async beforeSync({ type, payload, connection, context }) {
      const { seat } = context as SocketContext;
      if (!seat) throw new Refusal('permission-denied');
      // Step 1 carries a state vector; step 2 and an update carry what the tab typed.
      if (type !== 1 && type !== 2) return;
      enter(seat, connection);
      try {
        if (await documents.accept(seat.link, payload, seat.editor)) active(seat);
      } catch (error) {
        // The reason travels first: the close that follows carries none to the tab.
        if (error instanceof LiveNotLiveError) {
          connection.sendStateless(RELEASED);
          // The epoch ended under everyone on the document, not only under who typed.
          background(documents.drop(seat.link));
          throw new Refusal('released');
        }
        if (error instanceof LiveTooLargeError) {
          connection.sendStateless(REFUSED('too-large'));
          throw new Refusal('too-large');
        }
        // Not typing in the note: no tab of the app sends it. Its document is closed, and the tab is not asked to try again.
        if (error instanceof LiveUpdateRefusedError) {
          console.warn(`[live-builtin] A socket of live note ${seat.link.id} sent an update that is not typing in the note. It was not stored.`);
          connection.sendStateless(REFUSED('invalid'));
          throw new Refusal('invalid');
        }
        // Typing on typing that neither the document nor the store has, which the tab holds: it typed on before it sent
        // what it typed offline. Nothing was acknowledged; the socket closes, and the tab connects again and sends all it holds.
        if (error instanceof LiveUpdateWaitingError) {
          console.warn(`[live-builtin] A socket of live note ${seat.link.id} sent typing that builds on typing the server does not have yet. It was not stored; the socket is closed so the tab sends everything again.`);
          seat.socket.close(1011, 'Live editor out of step');
          throw new Refusal('unavailable');
        }
        // The store failed: nothing was acknowledged. The socket closes, so the tab connects again and sends what it holds.
        console.warn(`[live-builtin] Storing an update of live note ${seat.link.id} failed: ${errorName(error)}. Its socket is closed.`);
        seat.socket.close(1011, 'Live editor unavailable');
        throw new Refusal('unavailable');
      }
    },
    /** Awareness is the server's word on who is who (§6.4): a seat speaks for one client id, under its ticket's name. */
    async beforeHandleAwareness({ states, removedClients, connection, context }) {
      const { seat } = (context ?? {}) as SocketContext;
      const room = seat && rooms.get(seat.name);
      if (!seat || !room || !connection) {
        states.clear();
        removedClients.clear();
        return;
      }
      enter(seat, connection);
      for (const [client, state] of states) {
        if (!speaksFor(room, seat, client) || typeof state !== 'object' || state === null || Array.isArray(state) || Buffer.byteLength(JSON.stringify(state), 'utf8') > limits.maxAwarenessBytes) {
          states.delete(client);
          continue;
        }
        state.user = { name: seat.display, color: liveColour(seat.editor.key) };
        // A cursor or selection that moved is activity; the same state sent again to stay alive is not.
        const cursor = JSON.stringify({ ...state, user: undefined });
        if (cursor !== seat.cursor) {
          seat.cursor = cursor;
          active(seat);
        }
      }
      for (const client of removedClients) if (room.claims.get(client) !== seat) removedClients.delete(client);
    },
    async onDisconnect({ context }) {
      (context as SocketContext | undefined)?.seat?.leave();
    },
  };
  hocuspocus.configuration.extensions.push(hooks);

  const serve = (socket: WebSocket, address: string) => {
    const seats = new Set<Seat>();
    sockets.set(socket, seats);
    addresses.set(socket, address);
    unseated.add(socket);
    // Hocuspocus gets no header of the upgrade: cookies on it are ignored, and the ticket is the only credential.
    const client = hocuspocus.handleConnection(socket, new Request(`http://localhost${LIVE_SOCKET_PATH}`), { socket } satisfies SocketContext);
    socket.on('message', (data, binary) => {
      if (binary) client.handleMessage(bytesOf(data));
      else socket.close(1003, 'Binary frames only');
    });
    // A socket that answers the ping is alive while it has a document open; one without is closed by Hocuspocus's idle timeout.
    socket.on('pong', () => {
      if ([...seats].some(seat => seat.connected)) client.touch();
    });
    // `ws` reports a frame past `maxPayload` here, and closes the socket with 1009 itself.
    socket.on('error', () => {});
    socket.on('close', (code, reason) => {
      client.handleClose({ code, reason: reason.toString() });
      // A document still loading has no connection to close: its seat is given up here.
      for (const seat of seats) if (!seat.connected) seat.leave();
      sockets.delete(socket);
      unseated.delete(socket);
      addresses.delete(socket);
      if (!sockets.size) stopTimers();
    });
    if (!stopping) startTimers();
  };

  const refuse = (socket: Duplex, status: string) => {
    socket.on('error', () => {});
    socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`, () => socket.destroy());
  };

  /** Resolves with whether `task` finished within `ms`. */
  const within = async (task: Promise<unknown>, ms: number) => {
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<false>(resolve => {
      timer = setTimeout(() => resolve(false), Math.max(0, ms));
    });
    try {
      return await Promise.race([task.then(() => true, () => true), late]);
    } finally {
      clearTimeout(timer);
    }
  };

  const stop = async () => {
    const end = Date.now() + limits.shutdownMs;
    stopTimers();
    const seats = [...sockets.values()].flatMap(held => [...held]);
    // What sockets sent so far is taken and compacted, within most of the time there is; the rest is for closing them.
    const flushed = await within(
      (async () => {
        await Promise.all(seats.map(seat => seat.connection?.waitForPendingMessages()));
        await documents.shutdown();
      })(),
      limits.shutdownMs * 0.8,
    );
    if (!flushed) console.error(`[live-builtin] Shutting down took longer than allowed; live notes not compacted: ${[...hocuspocus.documents.keys()].join(', ') || 'none'}. What they acknowledged is in the store's log.`);
    // "Server restarting": the tabs connect again, with a new ticket, to whichever process serves then.
    const open = [...sockets.keys()];
    const closed = Promise.all(open.map(socket =>
      new Promise<void>(resolve => {
        socket.once('close', () => resolve());
        socket.close(1012, 'Server restarting');
      })
    ));
    // One that does not answer the close in time is cut off.
    const answered = await within(closed, Math.min(2000, end - Date.now()));
    for (const socket of answered ? [] : open) socket.terminate();
    server.close();
    if (!flushed) return;
    // The seats are given up and their people leave the presence; then what arrived meanwhile is compacted, and every document let go.
    await within(
      (async () => {
        await Promise.all(seats.map(seat => seat.gone));
        while (work.size) await Promise.all(work);
        await documents.shutdown();
      })(),
      end - Date.now(),
    );
  };

  return {
    upgrade(request, socket, head) {
      // The request target as it was sent, up to its query: one that is no path, or spells this path another way, is not this socket's.
      if ((request.url ?? '').split('?', 1)[0] !== LIVE_SOCKET_PATH) return false;
      const origin = appOrigin();
      if (stopping) refuse(socket, '503 Service Unavailable');
      else if (!origin || request.headers.origin !== origin) refuse(socket, '403 Forbidden');
      // `handleUpgrade` serves the socket before it returns, so the count holds every socket it let in.
      else {
        const address = socketAddress(request);
        if (unseated.size >= limits.maxUnseated || unseatedFrom(address) >= limits.maxUnseatedPerAddress) refuse(socket, '503 Service Unavailable');
        else server.handleUpgrade(request, socket, head, ws => serve(ws, address));
      }
      return true;
    },
    async settle(link) {
      const name = liveDocumentName(link);
      // Also what a tab that just closed left under way: its person is gone from the presence before anyone counts.
      await (rooms.get(name)?.dirty ? writePresence(link) : writes.get(name));
    },
    shutdown: () => stopping ??= stop(),
  };
}
