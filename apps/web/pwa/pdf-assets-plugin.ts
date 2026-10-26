import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Plugin } from 'vite';

/** The folders pdf.js reads on demand: CJK cmaps, the 14 standard fonts, and the wasm image decoders. Scripting (`quickjs-eval.*`) is unused. */
const FOLDERS = ['cmaps', 'standard_fonts', 'wasm'] as const;
const skipped = (file: string) => file.startsWith('quickjs-eval.');

const MIME: Record<string, string> = { '.wasm': 'application/wasm', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream', '.ttf': 'font/ttf' };

/**
 * Ships the data folders of `pdfjs-dist` under `pdfjs/<version>/` in the build output and serves them from the dev server, so the page
 * viewer can pass their address to pdf.js (`cMapUrl`, `standardFontDataUrl`, `wasmUrl`). The files are fetched only when a PDF needs one,
 * so a note without a PDF figure never requests them. Both the community and the Pro web configs use it.
 */
export function pdfAssetsPlugin(): Plugin {
  const root = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string; };
  const base = `/pdfjs/${version}/`;
  const files = (folder: string) => fs.readdirSync(path.join(root, folder)).filter(file => !skipped(file));

  return {
    name: 'mygitnotes-pdf-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = decodeURIComponent((request.url ?? '').split('?')[0]);
        const [folder, file, ...rest] = pathname.startsWith(base) ? pathname.slice(base.length).split('/') : [];
        if (!(FOLDERS as readonly string[]).includes(folder) || !file || rest.length || skipped(file) || !files(folder).includes(file)) return next();
        response.setHeader('Content-Type', MIME[path.extname(file)] ?? 'application/octet-stream');
        fs.createReadStream(path.join(root, folder, file)).pipe(response);
      });
    },
    generateBundle() {
      for (const folder of FOLDERS) {
        for (const file of files(folder)) this.emitFile({ type: 'asset', fileName: `pdfjs/${version}/${folder}/${file}`, source: fs.readFileSync(path.join(root, folder, file)) });
      }
    },
  };
}
