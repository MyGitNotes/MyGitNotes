import express from 'express';
import path from 'node:path';
import { bucketR2Source, type CachedR2Object, fetchR2ObjectToCache, presignR2Object, R2_VIEW_CACHE_BYTES, type R2Cache, R2CacheWriteError, type R2ObjectSource, R2ObjectTooLargeError, r2PreviewType, r2ReferenceKeys, SourceError } from '@mygitnotes/core';
import { type AssetStorage, inAssetScope, resolveAssetScope } from './asset-storage.js';
import type { RepositoryHandle } from './request-workspace.js';

/** Reads a configured note's Markdown with the requester's workspace permission, with the repository that holds it; throws when unreadable. */
export type NoteReader = (res: express.Response, notePath: string) => Promise<{ content: string; repository: RepositoryHandle; }>;

/**
 * Redirects to a short-lived R2 URL only when the requester can read `note`, that note references the
 * requested key, and the key lies in the requester's asset scope.
 */
export function createR2AssetHandler(storage: AssetStorage, readNote: NoteReader): express.RequestHandler {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const key = (req.params as Record<string, string>)[0];
    const notePath = req.query.note;
    if (!key || typeof notePath !== 'string') return res.status(404).json({ error: 'Asset not found.' });
    let note: Awaited<ReturnType<NoteReader>>;
    try {
      note = await readNote(res, notePath);
    } catch {
      return res.status(404).json({ error: 'Asset not found.' });
    }
    try {
      const scope = await resolveAssetScope(storage, req, res, note.repository);
      if (!scope || !inAssetScope(scope, key) || !r2ReferenceKeys(note.content).includes(key)) return res.status(404).json({ error: 'Asset not found.' });
      res.redirect(302, await presignR2Object(scope.settings, key));
    } catch (error) {
      // A storage that fails (a lookup in an edition's database) answers 502 here; an async handler's rejection would hang the request.
      res.status(error instanceof SourceError ? error.status : 502).json({ error: error instanceof Error ? error.message : 'Asset lookup failed.' });
    }
  };
}

export interface LocalR2AssetOptions {
  /** Where objects are read from when the asset storage has no bucket for the request: a hosted deployment, or none. Asked on each miss. */
  remote?: () => R2ObjectSource | null;
  /** The largest object a first view caches; defaults to 64 MiB. */
  maxObjectBytes?: number;
}

/**
 * Serves a local workspace's private objects through `cache`, so a note shows them offline. The check is the one
 * `createR2AssetHandler` makes: the requester reads `note`, the note references the key, and the key lies in the asset
 * scope when the request has one; a cached object is held to it too. A cached object is answered from disk without
 * asking the bucket. A miss reads the object once, from the scope's bucket or else from `remote`, into the cache and
 * answers it; without either it is not found. An object too large to cache on a view, and any object while the
 * cache folder cannot be written, is redirected to its short-lived URL, as before the cache.
 */
export function createLocalR2AssetHandler(storage: AssetStorage, readNote: NoteReader, cache: R2Cache, { remote, maxObjectBytes = R2_VIEW_CACHE_BYTES }: LocalR2AssetOptions = {}): express.RequestHandler {
  /** Reads in flight by key, so views that arrive together read the bucket once. */
  const reading = new Map<string, Promise<CachedR2Object>>();
  /** Keys found too large on an earlier view, so the next one redirects without reading the bucket to learn the size. */
  const tooLarge = new Set<string>();
  let warned = false;
  const send = (res: express.Response, object: CachedR2Object) => {
    const { kind, contentType } = r2PreviewType(object.key);
    const filename = encodeURIComponent(object.key.split('/').pop() || 'file').replace(/'/g, '%27');
    // The object is answered from this origin, so it gets the sandbox raw assets get. The preview frame needs the global
    // frame denial lifted, and the browser's PDF viewer refuses a sandboxed document, so a PDF is framed by this origin without one.
    res.removeHeader('X-Frame-Options');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', kind === 'pdf' ? "default-src 'none'; frame-ancestors 'self'" : "default-src 'none'; sandbox; frame-ancestors 'self'");
    res.setHeader('Content-Disposition', `${kind === 'file' ? 'attachment' : 'inline'}; filename*=UTF-8''${filename}`);
    res.type(contentType);
    // The cache may lie under a dot folder (`.cache`), which a path without `root` would be refused for.
    res.sendFile(path.basename(object.file), { root: path.dirname(object.file), dotfiles: 'allow' });
  };
  // The cache is trusted local state, keyed by object key alone: it assumes one bucket per checkout (see docs/agent/security).
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const notFound = () => res.status(404).json({ error: 'Asset not found.' });
    const key = (req.params as Record<string, string>)[0];
    const notePath = req.query.note;
    if (!key || typeof notePath !== 'string') return notFound();
    let note: Awaited<ReturnType<NoteReader>>;
    try {
      note = await readNote(res, notePath);
    } catch {
      return notFound();
    }
    try {
      const scope = await resolveAssetScope(storage, req, res, note.repository);
      if (!r2ReferenceKeys(note.content).includes(key) || (scope && !inAssetScope(scope, key))) return notFound();
      const cached = cache.find(key);
      if (cached) return send(res, cached);
      const source = scope ? bucketR2Source(scope) : remote?.() ?? null;
      const url = source ? (await source.urls(notePath, [key])).get(key) : undefined;
      if (!url) return notFound();
      if (tooLarge.has(key)) return res.redirect(302, url);
      let pending = reading.get(key);
      if (!pending) {
        pending = fetchR2ObjectToCache(cache, key, url, { maxBytes: maxObjectBytes }).finally(() => reading.delete(key));
        reading.set(key, pending);
      }
      try {
        send(res, await pending);
      } catch (error) {
        if (error instanceof R2CacheWriteError) {
          // Without a writable cache the object is still shown, straight from the bucket; the reason is logged once.
          if (!warned) console.warn(`[r2-assets] ${error.message} Objects are redirected to the bucket and not cached.`);
          warned = true;
          return res.redirect(302, url);
        }
        if (!(error instanceof R2ObjectTooLargeError)) throw error;
        if (tooLarge.size >= 1000) tooLarge.clear();
        tooLarge.add(key);
        res.redirect(302, url);
      }
    } catch (error) {
      res.status(error instanceof SourceError ? error.status : 502).json({ error: error instanceof Error ? error.message : 'Asset lookup failed.' });
    }
  };
}
