import { describe, expect, it } from 'vitest';
import { noteArchive, zipStore } from './note-archive.js';

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** Reads a ZIP's central directory and each entry's stored bytes, as an unzip tool would. */
function unzip(zip: Uint8Array) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.byteLength - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  expect(offset + view.getUint32(end + 12, true)).toBe(end);
  const entries: { name: string; data: Uint8Array; crc: number; utf8: boolean; method: number; }[] = [];
  for (let index = 0; index < count; index++) {
    expect(view.getUint32(offset, true)).toBe(0x02014b50);
    const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true), crc = view.getUint32(offset + 16, true);
    const size = view.getUint32(offset + 24, true), nameLength = view.getUint16(offset + 28, true), local = view.getUint32(offset + 42, true);
    const name = text(zip.subarray(offset + 46, offset + 46 + nameLength));
    // The local header repeats the name and sizes, and the bytes follow it.
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    expect(view.getUint32(local + 14, true)).toBe(crc);
    expect(view.getUint32(local + 18, true)).toBe(size);
    expect(view.getUint32(local + 22, true)).toBe(size);
    expect(text(zip.subarray(local + 30, local + 30 + view.getUint16(local + 26, true)))).toBe(name);
    const start = local + 30 + nameLength + view.getUint16(local + 28, true);
    entries.push({ name, data: zip.subarray(start, start + size), crc, utf8: Boolean(flags & 0x0800), method });
    offset += 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  expect(offset).toBe(end);
  return entries;
}

describe('zipStore', () => {
  it('writes a stored ZIP an unzip tool reads: names in UTF-8, sizes and CRC-32 per entry', () => {
    const zip = zipStore([{ name: 'note.md', data: new TextEncoder().encode('map bytes') }, { name: 'assets/地圖/old west.png', data: new TextEncoder().encode('core bytes') }, { name: 'empty.txt', data: new Uint8Array() }]);
    const entries = unzip(zip);
    expect(entries.map(entry => [entry.name, text(entry.data), entry.crc, entry.utf8, entry.method])).toEqual([['note.md', 'map bytes', 0xcb1bb3b6, true, 0], ['assets/地圖/old west.png', 'core bytes', 0x1d6cdd3a, true, 0], ['empty.txt', '', 0, true, 0]]);
  });
});

describe('a note downloaded with its images', () => {
  const NOTE = { path: 'notes/ex/trip plan.md', content: '# Trip\n\n![Map](<r2:ex/maps/old west.png>)\n[Ticket](r2:ex/ticket.pdf)\n[Gone](r2:ex/gone.png)\n![Web](https://example.com/a.png) ![Local](assets/b.png)\n\n`r2:ex/in-code.png`\n' };
  const objects: Record<string, string> = { '/r2-assets/ex/maps/old%20west.png': 'map bytes', '/r2-assets/ex/ticket.pdf': 'ticket' };

  it('holds the note and the private objects it references, fetched through the note-checked route, with the references pointing at the files', async () => {
    const asked: { url: string; credentials?: string; }[] = [];
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input), 'https://notes.example');
      asked.push({ url: url.pathname + url.search, credentials: init?.credentials });
      return url.pathname in objects ? new Response(objects[url.pathname]) : new Response('', { status: 404 });
    }) as typeof fetch;
    const archive = await noteArchive(NOTE, fetcher);

    expect(archive.filename).toBe('trip plan.zip');
    // Only the keys the note references are asked for, each for this note, with the session cookie and nothing else.
    expect(asked).toEqual(['ex/maps/old%20west.png', 'ex/ticket.pdf', 'ex/gone.png'].map(key => ({ url: `/r2-assets/${key}?note=notes%2Fex%2Ftrip%20plan.md`, credentials: 'same-origin' })));
    expect(archive.included).toEqual(['ex/maps/old west.png', 'ex/ticket.pdf']);
    expect(archive.missing).toEqual([{ key: 'ex/gone.png', reason: 'status 404' }]);

    const entries = unzip(archive.bytes);
    expect(entries.map(entry => entry.name)).toEqual(['trip plan.md', 'assets/ex/maps/old west.png', 'assets/ex/ticket.pdf', 'missing-assets.txt']);
    // Downloaded references point into the archive; the one that could not be fetched stays an r2: reference.
    expect(text(entries[0].data)).toBe('# Trip\n\n![Map](<assets/ex/maps/old west.png>)\n[Ticket](assets/ex/ticket.pdf)\n[Gone](r2:ex/gone.png)\n![Web](https://example.com/a.png) ![Local](assets/b.png)\n\n`r2:ex/in-code.png`\n');
    expect(text(entries[1].data)).toBe('map bytes');
    expect(text(entries[2].data)).toBe('ticket');
    expect(text(entries[3].data)).toBe('r2:ex/gone.png\tstatus 404\n');
  });

  it('is only the note when it references no private object, and survives a network failure', async () => {
    const plain = await noteArchive({ path: 'notes/ex/plain.md', content: '# Plain\n' }, (async () => expect.unreachable('nothing to fetch')) as unknown as typeof fetch);
    expect(unzip(plain.bytes).map(entry => entry.name)).toEqual(['plain.md']);
    const offline = await noteArchive(
      NOTE,
      (async () => {
        throw new TypeError('Failed to fetch');
      }) as typeof fetch,
    );
    expect(offline.included).toEqual([]);
    expect(offline.missing.map(entry => entry.reason)).toEqual(['Failed to fetch', 'Failed to fetch', 'Failed to fetch']);
    expect(unzip(offline.bytes).map(entry => entry.name)).toEqual(['trip plan.md', 'missing-assets.txt']);
    expect(text(unzip(offline.bytes)[0].data)).toBe(NOTE.content);
  });

  it('leaves out a key that could name a path outside the archive, and stops at the size limit', async () => {
    const note = { path: 'notes/ex/a.md', content: '![x](<r2:ex/a\\..\\..\\evil.png>)\n![big](r2:ex/big.bin)\n![small](r2:ex/small.png)\n' };
    const fetcher = (async (input: string | URL | Request) => String(input).includes('big.bin') ? new Response('0123456789') : new Response('ok')) as typeof fetch;
    const archive = await noteArchive(note, fetcher, { maxBytes: 8 });
    expect(archive.included).toEqual(['ex/small.png']);
    expect(archive.missing).toEqual([{ key: 'ex/a\\..\\..\\evil.png', reason: 'the key cannot be a file name in an archive' }, { key: 'ex/big.bin', reason: 'the archive is limited to 8 bytes' }]);
    expect(unzip(archive.bytes).map(entry => entry.name)).toEqual(['a.md', 'assets/ex/small.png', 'missing-assets.txt']);
  });

  it('holds an archive to 512 MiB by default, judged by the declared size before a body is read into memory', async () => {
    const note = { path: 'notes/ex/a.md', content: '![big](r2:ex/big.bin)\n![small](r2:ex/small.png)\n' };
    const fetcher = (async (input: string | URL | Request) => String(input).includes('big.bin') ? new Response('x', { headers: { 'content-length': String(600 * 1024 ** 2) } }) : new Response('ok')) as typeof fetch;
    const archive = await noteArchive(note, fetcher);
    expect(archive.included).toEqual(['ex/small.png']);
    expect(archive.missing).toEqual([{ key: 'ex/big.bin', reason: `the archive is limited to ${512 * 1024 ** 2} bytes` }]);
  });
});
