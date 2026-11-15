import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';

/**
 * The live editor's provider (docs/specs/2026-11-15-builtin-live-editor §8.2): it sends no update until a connect
 * synced. An update sent on a connect before the tab's sync step 2 builds on typing the server never got (typed
 * offline, or refused last time), which the server refuses with 1011; steady typing through a reconnect would loop on
 * it. The step 2 carries everything the tab typed before it, so the updates held up to then are dropped when a connect
 * starts its sync, and the ones typed after go out once, merged, when the server's step 2 arrives. Held typing counts as
 * unsaved; the Y.Doc keeps all of it whatever ends the socket.
 *
 * A synced connect holds too while its socket is not open: a keystroke typed while the browser socket is CLOSING (the
 * server sent its close frame, the close event is a round trip away) would otherwise wait in the provider websocket's
 * queue and go out on the next connect before its step 2 (BG-F001). For the same reason a connect's sync drops any
 * update of this document still in that queue: its step 2 carries it.
 */
export class LiveProvider extends HocuspocusProvider {
  #held: Uint8Array[] = [];
  #dirty = false;

  #onDirty?: (event: { dirty: boolean; }) => void;

  constructor(configuration: ConstructorParameters<typeof HocuspocusProvider>[0] & { onDirty?: (event: { dirty: boolean; }) => void; }) {
    super(configuration);
    this.#onDirty = configuration.onDirty;
    this.on('synced', () => this.#release());
    this.on('unsyncedChanges', ({ number }: { number: number; }) => {
      if (number === 0) this.#mark(false);
    });
  }

  /**
   * The tab typed something the server has not stored yet (BG-F003). `unsyncedChanges` also counts each connect's own
   * sync step, which is no typing: prompts about unsaved text read this, and fire `dirty` events when it changes.
   */
  get dirty() {
    return this.#dirty;
  }

  #mark(dirty: boolean) {
    if (this.#dirty === dirty) return;
    this.#dirty = dirty;
    this.emit('dirty', { dirty });
    this.#onDirty?.({ dirty });
  }

  /** The provider websocket's socket is open: what is sent now goes out now, not from its queue on a later connect. */
  get #open() {
    return this.configuration.websocketProvider.webSocket?.readyState === 1;
  }

  override documentUpdateHandler(update: Uint8Array, origin: unknown) {
    if (origin !== this) this.#mark(true);
    if (origin === this || (this.synced && this.#open)) return super.documentUpdateHandler(update, origin);
    if (!this.#held.length) this.incrementUnsyncedChanges();
    this.#held.push(update);
  }

  override startSync() {
    // Counted as unsaved from here by the step 2, which carries them.
    this.#held = [];
    // The queue is the provider websocket's own (private in its types); dropping a message from it is all this reads.
    const websocket = this.configuration.websocketProvider as unknown as { messageQueue: unknown[]; };
    websocket.messageQueue = websocket.messageQueue.filter(message => !this.#ownSync(message));
    super.startSync();
  }

  /** A sync message (step 1, step 2 or update) of this document. */
  #ownSync(message: unknown) {
    if (!(message instanceof Uint8Array)) return false;
    let at = 0;
    const varUint = () => {
      let n = 0, shift = 0, byte;
      do {
        if (at >= message.length) return -1;
        byte = message[at++];
        n += (byte & 127) * 2 ** shift;
        shift += 7;
      } while (byte & 128);
      return n;
    };
    const length = varUint();
    if (length < 0 || at + length > message.length) return false;
    const name = new TextDecoder().decode(message.subarray(at, at + length));
    at += length;
    return name === this.effectiveName && varUint() === 0;
  }

  #release() {
    if (!this.#held.length || !this.#open) return;
    const update = this.#held.length === 1 ? this.#held[0] : Y.mergeUpdates(this.#held);
    this.#held = [];
    // The held batch counted once; sending it counts it again.
    this.decrementUnsyncedChanges();
    super.documentUpdateHandler(update, null);
  }
}
