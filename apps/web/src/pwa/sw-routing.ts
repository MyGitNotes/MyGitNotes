/** What the service worker does with one request. */
export type SwRoute =
  /** Not ours: the browser handles it, so the service worker never sees its answer. */
  | 'bypass'
  /** A page load inside the scope: the network first, the cached app shell when the network fails. */
  | 'navigate'
  /** A built file: the cache first, remembered after the first fetch. */
  | 'asset'
  /** A stylesheet or font of Google Fonts: the cache first, refreshed in the background. */
  | 'font';

export interface SwRequest {
  method: string;
  url: string;
  mode: string;
  /** The request asks for a byte range, as a media element does. */
  ranged: boolean;
}

/** Paths under the scope that belong to the server, not to the shell: data, sign-in and its callbacks, file downloads. */
export const SERVER_PATHS = ['api', 'mcp', 'raw-assets', 'r2-assets'] as const;
/** The worker's own file is never cached, so a deployment can replace it. */
export const SERVICE_WORKER_FILE = 'sw.js';
const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);
/** Vite writes every built file with a content hash under this folder. */
export const HASHED_FOLDER = 'assets/';

/**
 * Decides how the service worker answers a request. `base` is the registration's scope URL (with its trailing slash),
 * and `precached` the shell files' paths relative to it. Only GET requests inside the scope reach a cache, and nothing the server
 * answers per visitor (`/api`, sign-in callbacks, raw files, MCP) is ever kept.
 */
export function routeRequest(request: SwRequest, base: URL, precached: ReadonlySet<string>): SwRoute {
  if (request.method !== 'GET' || request.ranged) return 'bypass';
  const url = parseUrl(request.url);
  if (!url) return 'bypass';
  if (url.origin !== base.origin) return FONT_HOSTS.has(url.hostname) && url.protocol === 'https:' ? 'font' : 'bypass';
  if (!url.pathname.startsWith(base.pathname)) return 'bypass';
  const path = decodeRelative(url.pathname.slice(base.pathname.length));
  if (path === null || path === SERVICE_WORKER_FILE) return 'bypass';
  if (SERVER_PATHS.some(server => path === server || path.startsWith(`${server}/`))) return 'bypass';
  if (request.mode === 'navigate') return 'navigate';
  return precached.has(path) || path.startsWith(HASHED_FOLDER) ? 'asset' : 'bypass';
}

/** The path without escapes or `..`, so a prefix check cannot be sidestepped; null when it cannot be read. */
function decodeRelative(path: string): string | null {
  try {
    const decoded = decodeURIComponent(path);
    return decoded.split('/').includes('..') ? null : decoded;
  } catch {
    return null;
  }
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
