/// The service worker, built by `apps/web/pwa/service-worker-plugin.ts` into `sw.js` with the build's file list.
/// It keeps the app shell so the app opens offline; it never keeps notes, API answers or sign-in routes (see `sw-routing.ts`).
import { navigateWithShell } from './sw-navigate.js';
import { routeRequest, type SwRequest } from './sw-routing.js';
import type { SwManifest } from './sw-manifest.js';

// The worker global scope is not in the DOM library this project compiles with, so the parts used are named here.
interface SwEvent {
  waitUntil(work: Promise<unknown>): void;
}
interface SwFetchEvent extends SwEvent {
  request: Request;
  respondWith(response: Promise<Response> | Response): void;
}
interface SwMessageEvent extends SwEvent {
  data: unknown;
}
interface SwScope {
  registration: { scope: string; };
  clients: { claim(): Promise<void>; };
  skipWaiting(): Promise<void>;
  addEventListener(type: 'install' | 'activate', listener: (event: SwEvent) => void): void;
  addEventListener(type: 'fetch', listener: (event: SwFetchEvent) => void): void;
  addEventListener(type: 'message', listener: (event: SwMessageEvent) => void): void;
}

declare const __SW_MANIFEST__: SwManifest;
// SAFETY: this file is only ever loaded as a service worker, whose global is a ServiceWorkerGlobalScope; SwScope names the parts used.
const worker = self as unknown as SwScope;
const manifest = __SW_MANIFEST__;

const SHELL_PREFIX = 'mygitnotes-shell-';
const SHELL_CACHE = `${SHELL_PREFIX}${manifest.version}`;
const RUNTIME_CACHE = 'mygitnotes-runtime';

// A registration's scope is always an absolute URL.
const scope = new URL(worker.registration.scope);
const precached = new Set(manifest.entries.map(entry => entry.url));
const hashed = new Set(manifest.hashed);
const at = (path: string) => new URL(path, scope).href;

worker.addEventListener('install', event => event.waitUntil(precache()));
worker.addEventListener('activate', event => event.waitUntil(activate()));
worker.addEventListener('message', event => {
  // The page asks for the swap only after the person chose to reload, so a new version never replaces an open one by itself.
  if (isSkipWaiting(event.data)) void worker.skipWaiting();
});
worker.addEventListener('fetch', event => {
  const request: SwRequest = { method: event.request.method, url: event.request.url, mode: event.request.mode, ranged: event.request.headers.has('range') };
  const route = routeRequest(request, scope, precached);
  if (route === 'navigate') event.respondWith(navigate(event.request));
  else if (route === 'asset') event.respondWith(cacheFirst(event.request, true));
  else if (route === 'font') event.respondWith(cacheFirst(event.request, false));
});

function isSkipWaiting(data: unknown): boolean {
  return typeof data === 'object' && data !== null && (data as { type?: unknown; }).type === 'SKIP_WAITING';
}

/** Fetches every shell file into this version's cache; one failure stops the install, so a version is whole or absent. */
async function precache(): Promise<void> {
  const cache = await caches.open(SHELL_CACHE);
  await Promise.all(manifest.entries.map(async entry => {
    const url = at(entry.url);
    // A built file's name carries its content hash, so an earlier version's copy is the same file.
    if (entry.revision === null) {
      const earlier = await caches.match(url);
      if (earlier) return cache.put(url, earlier);
    }
    const response = await fetch(new Request(url, { cache: 'reload' }));
    if (!response.ok) throw new Error(`Could not cache ${url}: ${response.status}`);
    await cache.put(url, response);
  }));
}

/** Drops the shell caches of other versions and the built files this version no longer has, then takes the open pages. */
async function activate(): Promise<void> {
  for (const name of await caches.keys()) {
    if (name.startsWith(SHELL_PREFIX) && name !== SHELL_CACHE) await caches.delete(name);
  }
  const runtime = await caches.open(RUNTIME_CACHE);
  for (const request of await runtime.keys()) {
    const path = request.url.startsWith(scope.href) ? request.url.slice(scope.href.length) : null;
    if (path?.startsWith('assets/') && !hashed.has(path)) await runtime.delete(request);
  }
  await worker.clients.claim();
}

/** The network's answer; the cached shell only when the network fails or the server answers 5xx. */
function navigate(request: Request): Promise<Response> {
  return navigateWithShell(request, fetch, async () => (await caches.open(SHELL_CACHE)).match(at(manifest.shell)));
}

/** The cached copy when there is one; otherwise the network's, remembered. `keep` is false for files that change under one URL. */
async function cacheFirst(request: Request, keep: boolean): Promise<Response> {
  const cached = await caches.match(request);
  if (cached) {
    if (!keep) void refresh(request);
    return cached;
  }
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') {
    const copy = response.clone();
    void caches.open(RUNTIME_CACHE).then(cache => cache.put(request, copy));
  }
  return response;
}

async function refresh(request: Request): Promise<void> {
  try {
    const response = await fetch(request);
    if (response.ok || response.type === 'opaque') await (await caches.open(RUNTIME_CACHE)).put(request, response);
  } catch { /* The cached copy keeps serving. */ }
}
