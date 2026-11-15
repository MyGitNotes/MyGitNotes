import type { LiveStore } from './store.js';

/** The live store in memory. Not built yet: every call fails. */
export function memoryLiveStore(): LiveStore {
  return new Proxy({}, { get: (_target, name) => name === 'then' ? undefined : async () => Promise.reject(new Error(`memoryLiveStore.${String(name)} is not built yet.`)) }) as LiveStore;
}
