/// <reference types="vite/client" />

/** True in a build that ships `sw.js` (see `pwa/service-worker-plugin.ts`); undefined in dev and in tests. */
declare const __SERVICE_WORKER__: boolean | undefined;
