import { recordKeyPrefix } from '../record-store/index.js';
import type { LiveStore } from './store.js';

/** The prefix of every live store key of this deployment. */
export function liveStorePrefix(): string {
  return `${recordKeyPrefix()}:live-store`;
}

/** The live store over any way to send one Redis command. Not built yet: every call fails. */
export function redisLiveStoreOver(_send: (command: string[]) => Promise<unknown>, _prefix = liveStorePrefix()): LiveStore {
  return new Proxy({}, { get: (_target, name) => name === 'then' ? undefined : async () => Promise.reject(new Error(`redisLiveStore.${String(name)} is not built yet.`)) }) as LiveStore;
}

/** The live store in Redis. Not built yet: every call fails. */
export function redisLiveStore({ prefix }: { url: string; prefix?: string; }): LiveStore {
  return redisLiveStoreOver(async () => undefined, prefix);
}
