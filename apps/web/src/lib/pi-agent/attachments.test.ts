// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { type PdfDocument, PdfLoadError } from '../pdf/pdf-document.js';
import { acceptedTypes, addFiles, type Attachment, attachmentFiles, attachmentImages, MAX_ATTACHED_TEXT, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, MAX_ATTACHMENTS_BYTES, MAX_TEXT_FILE_BYTES, type PiImage, thumbnailUrl } from './attachments.js';

const file = (name: string, type: string, bytes: number | string | Uint8Array<ArrayBuffer> = 4) => new File([typeof bytes === 'number' ? new Uint8Array(bytes) : bytes], name, { type });
const withImages = { images: true };
const names = (attachments: Attachment[]) => attachments.map(attachment => attachment.name);

it("reads an image into the shape of Pi's RPC `images` as base64 without a data: prefix", async () => {
  const { attachments, problems } = await addFiles([], [file('shot.png', 'image/png', 'abc')], withImages);
  expect(problems).toEqual([]);
  expect(attachments).toHaveLength(1);
  expect(attachments[0]).toMatchObject({ kind: 'image', name: 'shot.png', size: 3, image: { type: 'image', data: 'YWJj', mimeType: 'image/png' } });
  expect(thumbnailUrl(attachmentImages(attachments)[0])).toBe('data:image/png;base64,YWJj');
});

it('takes PNG, JPEG, GIF and WebP images, and names each file of a type it cannot read as refused while keeping the rest', async () => {
  const { attachments, problems } = await addFiles([], [file('a.png', 'image/png'), file('b.jpg', 'image/jpeg'), file('c.gif', 'image/gif'), file('d.webp', 'image/webp'), file('e.svg', 'image/svg+xml'), file('f.zip', 'application/zip'), file('', '')], withImages);
  expect(attachmentImages(attachments).map(image => image.mimeType)).toEqual(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
  expect(problems).toEqual([{ kind: 'type', name: 'e.svg' }, { kind: 'type', name: 'f.zip' }, { kind: 'type', name: 'file' }]);
});

it('refuses an image for a model that cannot read one, and still takes a text file', async () => {
  const { attachments, problems } = await addFiles([], [file('a.png', 'image/png'), file('notes.txt', 'text/plain', 'hello')], { images: false });
  expect(names(attachments)).toEqual(['notes.txt']);
  expect(problems).toEqual([{ kind: 'imageModel', name: 'a.png' }]);
});

it('refuses an image over the per-image size, and one that would pass the total, naming why', async () => {
  const big = file('big.png', 'image/png', MAX_ATTACHMENT_BYTES + 1);
  const exact = file('exact.png', 'image/png', MAX_ATTACHMENT_BYTES);
  const first = await addFiles([], [big, exact], withImages);
  expect(names(first.attachments)).toEqual(['exact.png']);
  expect(first.problems).toEqual([{ kind: 'size', name: 'big.png', limit: '5 MB' }]);
  const second = await addFiles(first.attachments, [file('b.png', 'image/png', MAX_ATTACHMENT_BYTES), file('c.png', 'image/png', 1)], withImages);
  expect(names(second.attachments)).toEqual(['exact.png', 'b.png']);
  expect(second.problems).toEqual([{ kind: 'total', name: 'c.png' }]);
  expect(MAX_ATTACHMENTS_BYTES).toBe(2 * MAX_ATTACHMENT_BYTES);
});

it('takes at most the count limit of images across additions', async () => {
  const pngs = Array.from({ length: MAX_ATTACHMENTS + 2 }, (_, index) => `${index}.png`);
  const first = await addFiles([], pngs.slice(0, 3).map(name => file(name, 'image/png')), withImages);
  const second = await addFiles(first.attachments, pngs.slice(3).map(name => file(name, 'image/png')), withImages);
  expect(second.attachments).toHaveLength(MAX_ATTACHMENTS);
  expect(second.problems).toEqual([{ kind: 'count', name: pngs[5] }, { kind: 'count', name: pngs[6] }]);
});

describe('text and code files', () => {
  it('reads them as UTF-8 by name whatever type the browser gives, without a byte order mark', async () => {
    const { attachments, problems } = await addFiles([], [file('plan.md', '', '\uFEFF# 計畫\n'), file('app.ts', 'video/mp2t', 'export {};'), file('data.json', 'application/json', '{}'), file('README', 'text/plain', 'read me')], { images: false });
    expect(problems).toEqual([]);
    expect(attachmentFiles(attachments)).toEqual([{ name: 'plan.md', text: '# 計畫\n' }, { name: 'app.ts', text: 'export {};' }, { name: 'data.json', text: '{}' }, { name: 'README', text: 'read me' }]);
    expect(attachmentImages(attachments)).toEqual([]);
  });

  it('refuses a file that is not UTF-8 or holds a NUL, as binary files do, and one over the size limit', async () => {
    const { attachments, problems } = await addFiles([], [file('latin.txt', 'text/plain', Uint8Array.of(0x63, 0x61, 0xe9)), file('blob.log', '', 'a\0b'), file('huge.csv', 'text/csv', MAX_TEXT_FILE_BYTES + 1)], withImages);
    expect(attachments).toEqual([]);
    expect(problems).toEqual([{ kind: 'type', name: 'latin.txt' }, { kind: 'type', name: 'blob.log' }, { kind: 'size', name: 'huge.csv', limit: '2 MB' }]);
  });

  it('cuts a file that passes the text all files of a message share, says so in it, and refuses files after it', async () => {
    const first = await addFiles([], [file('a.txt', 'text/plain', 'x'.repeat(MAX_ATTACHED_TEXT - 10)), file('b.txt', 'text/plain', 'y'.repeat(30))], withImages);
    expect(first.problems).toEqual([{ kind: 'truncated', name: 'b.txt' }]);
    const cut = attachmentFiles(first.attachments)[1].text;
    expect(cut).toBe(`${'y'.repeat(10)}\n[cut: only the first 10 of 30 characters are attached]`);
    const second = await addFiles(first.attachments, [file('c.txt', 'text/plain', 'z')], withImages);
    expect(second.attachments).toHaveLength(2);
    expect(second.problems).toEqual([{ kind: 'textTotal', name: 'c.txt' }]);
  });
});

describe('PDFs', () => {
  const picture = (page: number): PiImage => ({ type: 'image', data: btoa(`page ${page}`), mimeType: 'image/jpeg' });
  function fakePdf(pages: string[]) {
    const pdf: PdfDocument = { pageCount: pages.length, pageSize: async () => ({ width: 612, height: 792 }), render: () => ({ promise: Promise.resolve(), cancel: () => undefined }), text: async page => pages[page - 1], destroy: vi.fn(async () => undefined) };
    return { pdf, openPdf: vi.fn(async () => pdf), renderPage: vi.fn(async (_pdf: PdfDocument, page: number) => picture(page)) };
  }
  const body = 'A paragraph of the report with enough letters.';

  it('puts the text of each page under its number, and draws a page without text as an image for a model that reads them', async () => {
    const { pdf, openPdf, renderPage } = fakePdf([body, '  ', '3', `${body}\n${body}`]);
    const { attachments, problems } = await addFiles([], [file('report.pdf', 'application/pdf', '%PDF')], { images: true, openPdf, renderPage });
    expect(problems).toEqual([]);
    expect(attachmentFiles(attachments)).toEqual([{ name: 'report.pdf', text: `[PDF, 4 pages]\n\n[page 1]\n${body}\n\n[page 2: no text layer; its picture is attached as an image]\n\n[page 3: no text layer; its picture is attached as an image]\n3\n\n[page 4]\n${body}\n${body}` }]);
    expect(renderPage.mock.calls.map(call => call[1])).toEqual([2, 3]);
    expect(attachmentImages(attachments)).toEqual([picture(2), picture(3)]);
    expect(pdf.destroy).toHaveBeenCalledOnce();
  });

  it('takes a PDF by its name when the browser gives no type', async () => {
    const { openPdf } = fakePdf([body]);
    const { attachments } = await addFiles([], [file('scan.PDF', '', '%PDF')], { images: false, openPdf });
    expect(names(attachments)).toEqual(['scan.PDF']);
  });

  it('draws no page for a model that cannot read images, and says which pages Pi gets only by number', async () => {
    const { openPdf, renderPage } = fakePdf([body, '']);
    const { attachments, problems } = await addFiles([], [file('report.pdf', 'application/pdf')], { images: false, openPdf, renderPage });
    expect(renderPage).not.toHaveBeenCalled();
    expect(attachmentFiles(attachments)[0].text).toContain('[page 2: no text layer; not attached]');
    expect(problems).toEqual([{ kind: 'pages', name: 'report.pdf' }]);
  });

  it('draws pages only while the images of the message have room', async () => {
    const images = await addFiles([], Array.from({ length: MAX_ATTACHMENTS - 1 }, (_, index) => file(`${index}.png`, 'image/png')), withImages);
    const { openPdf, renderPage } = fakePdf(['', '', body]);
    const { attachments, problems } = await addFiles(images.attachments, [file('scan.pdf', 'application/pdf')], { images: true, openPdf, renderPage });
    expect(attachmentImages(attachments)).toHaveLength(MAX_ATTACHMENTS);
    expect(renderPage).toHaveBeenCalledOnce();
    expect(attachmentFiles(attachments)[0].text).toContain('[page 2: no text layer; not attached]');
    expect(problems).toEqual([{ kind: 'pages', name: 'scan.pdf' }]);
  });

  it('refuses a PDF with nothing to read, a locked one and a broken one, naming why', async () => {
    const empty = fakePdf(['', '']);
    const locked = vi.fn(async () => {
      throw new PdfLoadError('password');
    });
    const broken = vi.fn(async () => {
      throw new PdfLoadError('not-pdf');
    });
    const results = [await addFiles([], [file('scan.pdf', 'application/pdf')], { images: false, openPdf: empty.openPdf }), await addFiles([], [file('locked.pdf', 'application/pdf')], { images: true, openPdf: locked }), await addFiles([], [file('broken.pdf', 'application/pdf')], { images: true, openPdf: broken })];
    expect(results.map(result => result.attachments)).toEqual([[], [], []]);
    expect(results.flatMap(result => result.problems)).toEqual([{ kind: 'empty', name: 'scan.pdf' }, { kind: 'password', name: 'locked.pdf' }, { kind: 'read', name: 'broken.pdf' }]);
    expect(empty.pdf.destroy).toHaveBeenCalledOnce();
  });
});

it('offers images in the file picker only for a model that reads them, and PDFs and text files always', () => {
  expect(acceptedTypes(true).split(',')).toEqual(expect.arrayContaining(['image/png', 'application/pdf', '.pdf', 'text/*', '.md', '.ts']));
  expect(acceptedTypes(false).split(',')).not.toContain('image/png');
  expect(acceptedTypes(false).split(',')).toContain('.pdf');
});
