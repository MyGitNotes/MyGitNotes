import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { expect, it } from 'vitest';
import { pdfAssetsPlugin } from './pdf-assets-plugin.js';

const root = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string; };

function emitted(): string[] {
  const names: string[] = [];
  const plugin = pdfAssetsPlugin();
  (plugin.generateBundle as (this: { emitFile: (file: { fileName: string; }) => void; }) => void).call({ emitFile: file => void names.push(file.fileName) });
  return names;
}

it('ships the cmaps, standard fonts and wasm decoders under a versioned folder, without the scripting engine', () => {
  const names = emitted();
  expect(names).toContain(`pdfjs/${version}/cmaps/ETen-B5-H.bcmap`);
  expect(names.some(name => name.startsWith(`pdfjs/${version}/standard_fonts/`))).toBe(true);
  expect(names.some(name => name.startsWith(`pdfjs/${version}/iccs/`) && name.endsWith('.icc'))).toBe(true);
  expect(names.some(name => name.startsWith(`pdfjs/${version}/wasm/openjpeg`))).toBe(true);
  expect(names.filter(name => name.includes('quickjs-eval'))).toEqual([]);
  expect(names.every(name => name.startsWith(`pdfjs/${version}/`))).toBe(true);
});

it('serves the same files from the dev server and passes every other request on', async () => {
  const plugin = pdfAssetsPlugin();
  let handler!: (request: { url: string; }, response: unknown, next: () => void) => void;
  (plugin.configureServer as (server: unknown) => void)({ middlewares: { use: (fn: typeof handler) => void (handler = fn) } });
  const passed = (url: string) => {
    let called = false;
    handler({ url }, { setHeader: () => undefined }, () => void (called = true));
    return called;
  };
  expect(passed('/api/notes')).toBe(true);
  expect(passed(`/pdfjs/${version}/cmaps/missing.bcmap`)).toBe(true);
  expect(passed(`/pdfjs/${version}/cmaps/../../package.json`)).toBe(true);
  expect(passed(`/pdfjs/${version}/wasm/quickjs-eval.js`)).toBe(true);
  expect(passed(`/pdfjs/${version}/cmaps/%E0%A4%A`)).toBe(true);
  expect(passed('/pdfjs/%')).toBe(true);
  const headers: Record<string, string> = {};
  const piped = await new Promise<boolean>(resolve => {
    const response = Object.assign(new PassThrough(), { setHeader: (name: string, value: string) => void (headers[name] = value) });
    response.on('finish', () => resolve(true));
    handler({ url: `/pdfjs/${version}/cmaps/ETen-B5-H.bcmap` }, response, () => resolve(false));
    response.resume();
  });
  expect(piped).toBe(true);
  expect(headers['Content-Type']).toBe('application/octet-stream');
});

it('keeps the data folders out of the single-page-app rewrite, so a missing file answers 404', () => {
  const { rewrites } = JSON.parse(fs.readFileSync(new URL('../../../vercel.json', import.meta.url), 'utf8')) as { rewrites: Array<{ source: string; destination: string; }>; };
  const fallback = rewrites.find(rewrite => rewrite.destination === '/index.html')!;
  const pattern = new RegExp(`^${fallback.source.replace(/^\//, '\\/')}$`);
  expect(pattern.test(`/pdfjs/${version}/cmaps/missing.bcmap`)).toBe(false);
  expect(pattern.test('/notes/a')).toBe(true);
});
