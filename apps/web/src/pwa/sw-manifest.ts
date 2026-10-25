/** One file of the app shell, as the service worker plugin lists it, relative to the app's base. */
export interface SwEntry {
  url: string;
  /** A hash of the file's content, or null for a built file whose name already carries one. */
  revision: string | null;
}

/** What the service worker plugin writes into `sw.js` at build time. */
export interface SwManifest {
  /** Names this build's cache; changes whenever any shell file changes. */
  version: string;
  /** The page the worker answers an offline navigation with. */
  shell: string;
  /** The files fetched when the worker installs: the page, the entry bundles, the icons. */
  entries: SwEntry[];
  /** Every built file of this build, so files of an older build can be dropped from the runtime cache. */
  hashed: string[];
}
