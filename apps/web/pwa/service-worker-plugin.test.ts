import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { serviceWorkerPlugin, type ServiceWorkerOptions } from './service-worker-plugin.js';

let publicDir: string;
beforeEach(() => {
  publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-sw-public-'));
  fs.mkdirSync(path.join(publicDir, 'brand'));
  fs.writeFileSync(path.join(publicDir, 'site.webmanifest'), '{}');
  fs.writeFileSync(path.join(publicDir, 'brand/icon-192.png'), 'icon');
  fs.writeFileSync(path.join(publicDir, 'brand/logo-original.png'), 'huge artwork');
});
afterEach(() => fs.rmSync(publicDir, { recursive: true, force: true }));

const chunk = (fileName: string, extra: Record<string, unknown> = {}) => ({ type: 'chunk', fileName, isEntry: false, imports: [], dynamicImports: [], viteMetadata: { importedCss: new Set<string>() }, ...extra });
const bundle = () => ({
  'index.html': { type: 'asset', fileName: 'index.html', source: '<html></html>' },
  'assets/index-1.js': chunk('assets/index-1.js', { isEntry: true, imports: ['assets/shared-2.js'], dynamicImports: ['assets/App-3.js'], viteMetadata: { importedCss: new Set(['assets/index-1.css']) } }),
  'assets/shared-2.js': chunk('assets/shared-2.js'),
  'assets/App-3.js': chunk('assets/App-3.js', { imports: ['assets/shared-2.js'], viteMetadata: { importedCss: new Set(['assets/App-3.css']) } }),
  // Reached only through a dynamic import of the app itself: kept the first time it is fetched, not on install.
  'assets/mermaid-4.js': chunk('assets/mermaid-4.js'),
  'assets/index-1.js.map': { type: 'asset', fileName: 'assets/index-1.js.map', source: '{}' },
});

interface Emitted {
  fileName: string;
  source: string;
}
/** The two hooks the build calls, as this plugin defines them. */
interface BuildHooks {
  configResolved(config: { publicDir: string; }): void;
  generateBundle(this: { emitFile(file: Emitted): void; }, output: unknown, bundle: unknown): Promise<void>;
}

async function generate(options?: ServiceWorkerOptions) {
  // SAFETY: the plugin defines configResolved and generateBundle as methods; Vite's Plugin type allows other shapes of them.
  const plugin = serviceWorkerPlugin(options) as unknown as BuildHooks;
  plugin.configResolved({ publicDir });
  const emitted: Emitted[] = [];
  await plugin.generateBundle.call({ emitFile: file => void emitted.push(file) }, {}, bundle());
  const worker = emitted.find(file => file.fileName === 'sw.js')!.source;
  const manifestText = worker.match(/entries:\[(.*?)\],hashed/s)?.[1] ?? '';
  return { worker, urls: [...manifestText.matchAll(/url:`([^`]+)`/g)].map(match => match[1]), shell: worker.match(/shell:`([^`]+)`/)?.[1], version: worker.match(/version:`([^`]+)`/)?.[1] };
}

it('precaches the page, the entry chunks and the chunk it loads at once, their stylesheets, the manifest and the icons', async () => {
  const { urls, shell, version } = await generate();
  expect(shell).toBe('index.html');
  expect(version).toMatch(/^[a-f0-9]{12}$/);
  expect(urls.sort()).toEqual(['assets/App-3.css', 'assets/App-3.js', 'assets/index-1.css', 'assets/index-1.js', 'assets/shared-2.js', 'brand/icon-192.png', 'index.html', 'site.webmanifest'].sort());
});

it('leaves out lazy chunks, source maps and the large original artwork, though the build knows every built file', async () => {
  const { worker, urls } = await generate();
  expect(urls).not.toContain('assets/mermaid-4.js');
  expect(urls.some(url => url.endsWith('.map') || url.includes('original'))).toBe(false);
  expect(worker).toContain('assets/mermaid-4.js');
});

it('names the page an edition serves after renaming index.html', async () => {
  const { shell, urls } = await generate({ shell: 'app.html' });
  expect(shell).toBe('app.html');
  expect(urls).toContain('app.html');
  expect(urls).not.toContain('index.html');
});

it('changes the cache version when a shell file changes', async () => {
  const first = await generate();
  fs.writeFileSync(path.join(publicDir, 'site.webmanifest'), '{"name":"changed"}');
  expect((await generate()).version).not.toBe(first.version);
});
