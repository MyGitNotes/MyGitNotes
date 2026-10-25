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
