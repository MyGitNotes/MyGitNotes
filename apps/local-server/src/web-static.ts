import express from 'express';
import path from 'node:path';

/** The service worker's file name, as the web build writes it (`apps/web/pwa/service-worker-plugin.ts`). */
const SERVICE_WORKER_FILE = 'sw.js';

/**
 * Serves the built web app. The service worker file must never be served from a cache, or an installed app would not see a deployment
 * until the cached copy expired.
 */
export const webStatic = (dir: string): express.RequestHandler =>
  express.static(dir, {
    redirect: false,
    setHeaders: (res, file) => {
      if (path.basename(file) === SERVICE_WORKER_FILE) res.setHeader('Cache-Control', 'no-cache');
    },
  });

/**
 * A path that names a built file: the worker file, something under `assets/`, or a data file of the PDF viewer under `pdfjs/`. When no such file exists the answer is a plain 404,
 * never the app's `index.html`, which a browser would take for the file (a "worker" that is a page, or a script that is a page).
 */
export const namesBuiltFile = (requestPath: string): boolean => requestPath === `/${SERVICE_WORKER_FILE}` || /^\/(?:assets|pdfjs)\/./.test(requestPath);
