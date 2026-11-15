import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';

/**
 * The live editor's provider (docs/specs/2026-11-15-builtin-live-editor §8.2): it sends no update until a connect
 * synced. An update sent on a connect before the tab's sync step 2 builds on typing the server never got (typed
 * offline, or refused last time), which the server refuses with 1011; steady typing through a reconnect would loop on
 * it. The step 2 carries everything the tab typed before it, so the updates held up to then are dropped when a connect
 * starts its sync, and the ones typed after go out once, merged, when the server's step 2 arrives. Held typing counts as
 * unsaved; the Y.Doc keeps all of it whatever ends the socket.
 */
export class LiveProvider extends HocuspocusProvider {
  #held: Uint8Array[] = [];

  constructor(...args: ConstructorParameters<typeof HocuspocusProvider>) {
    super(...args);
    this.on('synced', () => this.#release());
  }

  override documentUpdateHandler(update: Uint8Array, origin: unknown) {
    if (origin === this || this.synced) return super.documentUpdateHandler(update, origin);
    if (!this.#held.length) this.incrementUnsyncedChanges();
    this.#held.push(update);
  }

  override startSync() {
    // Counted as unsaved from here by the step 2, which carries them.
    this.#held = [];
    super.startSync();
  }

  #release() {
    if (!this.#held.length) return;
    const update = this.#held.length === 1 ? this.#held[0] : Y.mergeUpdates(this.#held);
    this.#held = [];
    // The held batch counted once; sending it counts it again.
    this.decrementUnsyncedChanges();
    super.documentUpdateHandler(update, null);
  }
}
