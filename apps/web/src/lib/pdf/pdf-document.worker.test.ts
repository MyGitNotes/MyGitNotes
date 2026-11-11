// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';

const { documents } = vi.hoisted(() => ({ documents: [] as Array<{ worker?: unknown; iccUrl?: string; }> }));
vi.mock('pdfjs-dist/legacy/build/pdf.min.mjs', async importOriginal => {
  const actual = await importOriginal<typeof import('pdfjs-dist/legacy/build/pdf.min.mjs')>();
  return {
    ...actual,
    getDocument: (source: { worker?: unknown; iccUrl?: string; }) => {
      documents.push(source);
      return actual.getDocument(source as never);
    },
  };
});

const { openPdfBytes } = await import('./pdf-document.js');
const bytes = () => new Uint8Array(readFileSync(new URL('../annotations/fixtures/pdf/multi-page.pdf', import.meta.url)));

it('opens every document on one shared PDFWorker, and destroying a document leaves that worker alive', async () => {
  const first = await openPdfBytes(bytes());
  const second = await openPdfBytes(bytes());
  expect(documents).toHaveLength(2);
  expect(documents[0].worker).toBeDefined();
  expect(documents[1].worker).toBe(documents[0].worker);
  await first.destroy();
  expect((documents[0].worker as { destroyed: boolean; }).destroyed).toBe(false);
  expect(await second.pageSize(1)).toEqual({ width: 612, height: 792 });
  const third = await openPdfBytes(bytes());
  expect(documents[2].worker).toBe(documents[0].worker);
  await second.destroy();
  await third.destroy();
});

it('reads the text layer of a page, and none from a page that only draws', async () => {
  const pdf = await openPdfBytes(new Uint8Array(readFileSync(new URL('../annotations/fixtures/pdf/scanned.pdf', import.meta.url))));
  expect((await pdf.text(1)).trim()).toBe('A page of typed text');
  expect(await pdf.text(2)).toBe('');
  const pages = await openPdfBytes(bytes());
  expect(await pages.text(2)).toContain('A4 landscape, 842 x 595');
  await pdf.destroy();
  await pages.destroy();
});
