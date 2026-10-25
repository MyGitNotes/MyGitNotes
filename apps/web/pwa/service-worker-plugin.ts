import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type Plugin, type Rolldown } from 'vite';
import type { SwEntry, SwManifest } from '../src/pwa/sw-manifest.js';

export interface ServiceWorkerOptions {
  /**
   * The page the worker opens offline, as the host serves it. A build that renames `index.html` after bundling names the new file here;
   * its content is still taken from the bundle's `index.html`.
   */
  shell?: string;
  /** Public files kept with the shell, relative to the public directory; the web manifest and the brand icons by default. */
  publicFiles?: string[];
}

const swSource = fileURLToPath(new URL('../src/pwa/sw.ts', import.meta.url));
const digest = (content: string | Uint8Array) => createHash('sha256').update(content).digest('hex').slice(0, 16);
const isMap = (file: string) => file.endsWith('.map');

/** The public files a shell needs offline: the manifest and the brand icons (not the large original artwork). */
function defaultPublicFiles(publicDir: string): string[] {
  const brand = path.join(publicDir, 'brand');
  const icons = fs.existsSync(brand) ? fs.readdirSync(brand).filter(file => file.endsWith('.png') && !file.includes('original')).map(file => `brand/${file}`) : [];
  return [...['site.webmanifest'].filter(file => fs.existsSync(path.join(publicDir, file))), ...icons];
}

/**
 * The built files the page needs before it shows anything: the entry bundle, the chunks it imports, and those it starts loading at once
 * (the workspace chunk), with their stylesheets. Everything else under `assets/` is kept the first time it is fetched.
 */
function shellFiles(bundle: Rolldown.OutputBundle): string[] {
  const files = new Set<string>();
  const visit = (name: string) => {
    const chunk = bundle[name];
    if (chunk?.type !== 'chunk' || files.has(name)) return;
    files.add(name);
    for (const css of chunk.viteMetadata?.importedCss ?? []) files.add(css);
    chunk.imports.forEach(visit);
  };
  for (const chunk of Object.values(bundle)) {
    if (chunk.type !== 'chunk' || !chunk.isEntry) continue;
    visit(chunk.fileName);
    chunk.dynamicImports.forEach(visit);
  }
  return [...files].filter(file => !isMap(file)).sort();
}

/**
 * Writes `sw.js` beside the built app: a service worker that keeps the app shell, so the app opens offline.
 * The page registers it only when the plugin ran (`__SERVICE_WORKER__`), so a dev server and a host that does not ship it stay without one.
 */
export function serviceWorkerPlugin(options: ServiceWorkerOptions = {}): Plugin {
  let publicDir = '';
  return {
    name: 'mygitnotes-service-worker',
    apply: 'build',
    // Vite's own build plugins emit index.html in generateBundle; this one needs to see it.
    enforce: 'post',
    config: () => ({ define: { __SERVICE_WORKER__: 'true' } }),
    configResolved(config) {
      publicDir = config.publicDir;
    },
    async generateBundle(_output, bundle) {
      const html = bundle['index.html'];
      if (html?.type !== 'asset') throw new Error('The service worker plugin needs the build to emit index.html.');
      const entries: SwEntry[] = [{ url: options.shell ?? 'index.html', revision: digest(html.source) }];
      for (const file of shellFiles(bundle)) entries.push({ url: file, revision: null });
      for (const file of options.publicFiles ?? defaultPublicFiles(publicDir)) entries.push({ url: file, revision: digest(fs.readFileSync(path.join(publicDir, file))) });
      const manifest: SwManifest = { version: digest(entries.map(entry => `${entry.url}:${entry.revision ?? ''}`).join('\n')).slice(0, 12), shell: entries[0].url, entries, hashed: Object.keys(bundle).filter(file => file.startsWith('assets/') && !isMap(file)).sort() };
      const result = await build({ configFile: false, logLevel: 'silent', publicDir: false, define: { __SW_MANIFEST__: JSON.stringify(manifest) }, build: { write: false, minify: true, target: 'es2020', lib: { entry: swSource, formats: ['iife'], name: 'mygitnotesServiceWorker', fileName: () => 'sw.js' } } });
      const outputs = (Array.isArray(result) ? result : [result]).flatMap(output => 'output' in output ? output.output : []);
      const code = outputs.find(output => output.type === 'chunk')?.code;
      if (!code) throw new Error('The service worker build produced no code.');
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: code });
    },
  };
}
